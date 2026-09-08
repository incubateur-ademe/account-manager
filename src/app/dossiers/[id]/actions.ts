"use server";

import { revalidatePath } from "next/cache";

import type { Acteur, EtatEtape, EtatValidation, SensDossier } from "@/core/dossier";
import {
  dossierVivant,
  ETATS_VIVANTS,
  etatDUnPlanRemplace,
  etatQuiSolde,
  peutAnnuler,
  peutClore,
  peutConfirmer,
  peutPointer,
  peutRecalculer,
  peutValider,
  planAAnnuler,
  planPointable,
  REFUS_HORS_DOSSIER,
  REGARD_D_UN_OPERATEUR,
  validationApresPointage,
} from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { origineFigeeSchema } from "@/core/modele-plan";
import { peremptionDuPlan } from "@/core/plan";
import { actionTracee } from "@/lib/actions";
import { profilDeLaPolitique } from "@/lib/arrivee";
import { prisma } from "@/lib/db";
import { calculerPlan, enregistrerPlan, messageDeRefus, reposerLEtatDuPlan } from "@/lib/dossier";
import { executerPlan, type ResultatDExecution } from "@/lib/execution";
import { droitDeParticiper } from "@/lib/participation";
import { requireOperateur, requireUtilisateur, type Utilisateur } from "@/lib/session";

export interface EtatAction {
  erreur?: string;
  /**
   * Ce qu'un passage de la boucle d'exécution a fait, ou n'a pas fait.
   *
   * Il se rend à l'écran plutôt que de se déduire des étapes : en simulation, aucune
   * étape prête ne change d'état, et une page qui se contenterait de se rafraîchir
   * n'aurait rien à montrer d'un lancement qui a bel et bien eu lieu.
   */
  execution?: ResultatDExecution;
}

const POINTAGES: Record<string, EtatEtape> = {
  fait: "SUCCEEDED",
  "deja-absent": "ALREADY_ABSENT",
  "deja-present": "ALREADY_PRESENT",
  ignoree: "SKIPPED",
  echec: "FAILED",
};

/**
 * Le constat qu'un autre est passé avant, et il n'y en a qu'un par sens. Le refus
 * n'est pas cosmétique : consigner « déjà absent » sous une étape d'octroi ferait
 * dire au journal l'inverse de ce qui a été constaté, et l'écran le relirait ainsi
 * dans deux ans.
 */
const CONSTAT_DU_SENS: Record<SensDossier, EtatEtape> = {
  ONBOARDING: "ALREADY_PRESENT",
  OFFBOARDING: "ALREADY_ABSENT",
};

const VERDICTS: Record<string, "ACCEPTED" | "REFUSED"> = {
  accepter: "ACCEPTED",
  refuser: "REFUSED",
};

interface PorteurDuDossier {
  id: string;
  username: string;
}

/**
 * Le porteur se reconnaît à sa fiche, et à son nom seulement quand la session n'en
 * désigne aucune.
 *
 * Le jeton fige le nom à la connexion là où la fiche s'y relit à chaque geste :
 * renommer une fiche fabriquée pendant qu'une session de son titulaire est ouverte,
 * seul renommage que ce dépôt autorise, ferait de lui un délégué sur son propre
 * dossier. Une session sans fiche est celle d'un opérateur, dont l'allowlist interdit
 * qu'un renommage prenne le nom : le sien départage donc sans danger.
 */
function estLePorteur(utilisateur: Utilisateur, porteur: PorteurDuDossier): boolean {
  return utilisateur.personId === null
    ? utilisateur.username === porteur.username
    : utilisateur.personId === porteur.id;
}

/**
 * Ce que celui qui agit est devant ce dossier.
 *
 * Rien n'y est présumé : la qualité d'opérateur vient de la session, le droit par
 * dossier de la base, et les deux se relisent à chaque geste. Un rôle nul reste nul,
 * et c'est un refus que les deux gardes opposent ; le promouvoir en `OPERATOR` par
 * défaut, comme le faisait le mur de `requireOperateur` qui n'est plus là, ouvrirait à
 * un délégué les étapes de l'équipe transverse tout en lui fermant les siennes, et
 * ferait lire une substitution là où il n'y en a pas.
 *
 * Qui n'est pas de l'équipe n'a de rôle que par son droit, et ce refus-là se pose
 * avant tout le reste plutôt que de se déduire de l'égalité des identités : le porteur
 * de son propre dossier, à qui ce ticket ouvre précisément le pointage, garderait
 * sinon ses étapes après la révocation de son droit comme après son échéance, sa
 * session survivant à l'une comme à l'autre.
 *
 * Un plan dont le dossier a disparu n'a plus de porteur devant qui se situer : il ne
 * reste alors que l'appartenance à l'équipe, que le refus précédent a déjà exigée
 * puisqu'un dossier absent est aussi un dossier sur lequel aucun droit ne porte.
 */
function roleDuDeclarant(
  utilisateur: Utilisateur,
  porteur: PorteurDuDossier | null,
  participe: boolean,
): Acteur | null {
  if (!utilisateur.operateur && !participe) {
    return null;
  }
  if (porteur === null) {
    return utilisateur.operateur ? "OPERATOR" : null;
  }
  if (estLePorteur(utilisateur, porteur)) {
    return "SUBJECT";
  }
  // Le même ordre que `roleSurDossier`, et pour la même raison : une participation
  // n'ajoute rien à qui a déjà tout, et rendre `DELEGATE` à un opérateur qui en détient
  // une lui ferait refuser une validation qu'il pouvait faire.
  return utilisateur.operateur ? "OPERATOR" : "DELEGATE";
}

/**
 * Ce qu'une action rend quand l'identifiant reçu ne mène à rien.
 *
 * Deux phrases pour l'équipe, une seule pour les autres : « cette étape n'existe
 * plus » et « ce dossier ne vous concerne pas » distinguées feraient de l'identifiant
 * une sonde d'existence pour qui n'a rien à faire là.
 */
function refusDEtape(utilisateur: Utilisateur): string {
  return utilisateur.operateur ? "Cette étape n'existe plus." : REFUS_HORS_DOSSIER;
}

async function planDuDossier(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      state: true,
      planDigest: true,
      expiresAt: true,
      accessCaseId: true,
      accessCase: {
        select: {
          kind: true,
          state: true,
          profileKey: true,
          person: { select: { id: true, username: true } },
        },
      },
      steps: {
        select: {
          id: true,
          state: true,
          ordre: true,
          label: true,
          systemKey: true,
          expectedActor: true,
          validationBy: true,
          validation: true,
          declaredBy: true,
          validatedBy: true,
          validatedAt: true,
          validationNote: true,
        },
      },
    },
  });
}

/**
 * Fige l'approbation. Le digest confirmé est recopié à ce moment : c'est lui qui
 * dira, plus tard, si ce qui a été exécuté correspond à ce qui avait été approuvé.
 */
export async function confirmerPlan(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  await requireOperateur();

  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.accessCase) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const sens = plan.accessCase.kind;
  const maintenant = new Date();
  const actuel = await calculerPlan(
    sens,
    plan.accessCase.person.id,
    plan.accessCase.person.username,
    maintenant,
    profilDeLaPolitique(plan.accessCase.profileKey),
  );

  // L'état du dossier d'abord : sa garde ne portait que sur le plan, si bien qu'un
  // dossier annulé entre deux clics laissait son brouillon confirmable.
  if (!dossierVivant(plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const verdict = peutConfirmer(
    plan.state,
    peremptionDuPlan(plan, actuel.empreinte, maintenant),
    plan.steps.length,
  );

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.confirmation",
    targetType: "plan",
    targetId: plan.id,
    after: { sens, etapes: plan.steps.length, empreinte: plan.planDigest },
    revalider: [`/dossiers/${plan.accessCaseId}`],
    ecrire: async (operateur) => {
      // Conditionnée sur ce qui a été lu, plan et dossier : la garde seule laisse
      // passer une annulation arrivée entre la lecture et l'écriture, et un plan
      // confirmé sous un dossier annulé n'a plus personne pour le contredire.
      const { count } = await prisma.plan.updateMany({
        where: {
          id: plan.id,
          state: "DRAFT",
          accessCase: { state: { in: [...ETATS_VIVANTS] } },
        },
        data: {
          state: "EXECUTING",
          confirmedDigest: plan.planDigest,
          confirmedBy: operateur.username,
          confirmedAt: maintenant,
        },
      });

      if (count === 0) {
        throw new Error("Ce plan ou son dossier a changé d'état pendant la confirmation.");
      }
    },
  });

  return {};
}

/**
 * Consigne ce qu'un humain déclare avoir fait, ou constaté. Rien n'est exécuté ici :
 * l'outil n'appelle aucun système, il enregistre une parole et la date.
 */
export async function pointerEtape(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  // La garde précède la trace : `peutPointer` a besoin de savoir qui pointe avant
  // qu'on écrive quoi que ce soit, et `declaredBy` a besoin de son nom.
  const utilisateur = await requireUtilisateur();

  const etapeId = String(formData.get("etapeId") ?? "").trim();
  const choix = String(formData.get("pointage") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const reponse = String(formData.get("reponse") ?? "").trim();

  const nouvelEtat = POINTAGES[choix];
  if (!nouvelEtat) {
    return { erreur: "Pointage inconnu." };
  }

  // Écarter une étape n'est pas déclarer un geste, c'est décider qu'un geste prévu
  // n'aura pas lieu, et cette décision-là ne se délègue pas. Les trois autres verdicts
  // affirment un fait constaté, y compris ceux qui disent qu'un autre est passé avant.
  if (nouvelEtat === "SKIPPED" && !utilisateur.operateur) {
    return { erreur: "Écarter une étape appartient à l'équipe transverse." };
  }

  const etape = await prisma.planStep.findUnique({
    where: { id: etapeId },
    select: {
      id: true,
      label: true,
      systemKey: true,
      state: true,
      template: true,
      expectedActor: true,
      validationBy: true,
      validation: true,
      declaredBy: true,
      plan: {
        select: {
          id: true,
          state: true,
          accessCaseId: true,
          accessCase: {
            select: {
              kind: true,
              state: true,
              person: { select: { id: true, username: true } },
            },
          },
        },
      },
    },
  });

  if (!etape) {
    return { erreur: refusDEtape(utilisateur) };
  }

  const porteur = etape.plan.accessCase?.person ?? null;
  // Relu ici et non porté par la session : un droit que le jeton porterait serait un
  // droit que la révocation ne saurait plus retirer avant son expiration. Le dossier
  // vient de l'étape relue et jamais du formulaire, sans quoi détenir un droit sur l'un
  // suffirait à écrire sur l'autre.
  const participe =
    etape.plan.accessCaseId !== null &&
    (await droitDeParticiper(utilisateur.personId, etape.plan.accessCaseId));
  const role = roleDuDeclarant(utilisateur, porteur, participe);

  if (role === null) {
    return { erreur: REFUS_HORS_DOSSIER };
  }

  // L'état du dossier avant celui du plan, comme la confirmation et le recalcul le
  // font déjà : cette action était la seule des trois à ne regarder que le plan, et
  // consignait donc un geste sur un dossier que quelqu'un venait d'abandonner.
  if (etape.plan.accessCase && !dossierVivant(etape.plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const sens = etape.plan.accessCase?.kind ?? null;
  if (
    sens !== null &&
    (nouvelEtat === "ALREADY_ABSENT" || nouvelEtat === "ALREADY_PRESENT") &&
    nouvelEtat !== CONSTAT_DU_SENS[sens]
  ) {
    return { erreur: "Ce constat ne vaut pas dans le sens de ce dossier." };
  }

  // L'appartenance à l'équipe se dit à côté du rôle, qui la tait quand il vaut
  // `SUBJECT` : c'est elle qui rend le pointage de son propre dossier possible à un
  // opérateur sans lui en rendre la signature.
  const verdict = peutPointer(etape.plan.state, etape.expectedActor as Acteur, {
    role,
    operateur: utilisateur.operateur,
  });
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  if ((nouvelEtat === "SKIPPED" || nouvelEtat === "FAILED") && note.length < 3) {
    return {
      erreur:
        nouvelEtat === "SKIPPED"
          ? "Dites pourquoi cette étape est écartée : sans raison, elle deviendra un accès oublié."
          : "Dites ce qui a échoué, sinon personne ne saura quoi reprendre.",
    };
  }

  // Une origine gelée illisible ne peut venir que d'une écriture faite hors de cet
  // outil. La taire ferait pointer « fait » sur une étape qui réclamait une valeur,
  // et lever ici ôterait toute issue à l'écran : le pointage se refuse, et le dit.
  const origine = origineFigeeSchema.nullish().safeParse(etape.template);
  if (!origine.success) {
    return {
      erreur:
        "L'origine déclarée de cette étape est illisible : reprenez-la depuis son modèle avant de la pointer.",
    };
  }

  const saisie = origine.data?.saisie ?? null;

  // « Déjà présent » et « déjà absent » affirment que le geste a eu lieu, quelqu'un
  // d'autre étant passé avant : ils le déclarent au même titre que « fait », donc ils
  // lui réclament la même valeur. « Écartée » et « échec » n'affirment rien, et sont
  // les seuls à s'en dispenser.
  const critereConstate =
    nouvelEtat === "SUCCEEDED" ||
    nouvelEtat === "ALREADY_PRESENT" ||
    nouvelEtat === "ALREADY_ABSENT";

  // Même refus que celui de la note, pour la même raison : sans la valeur qu'elle
  // demandait, l'étape ne dit pas ce qui a été fait.
  if (critereConstate && saisie?.obligatoire === true && reponse.length === 0) {
    return {
      erreur: `Renseignez « ${saisie.libelle} » : sans elle, personne ne saura ce qui a été fait.`,
    };
  }

  // Rattachée au constat du critère et non à la seule présence d'une saisie : corrigée
  // en écart ou en échec, l'étape garderait sinon la valeur du pointage précédent,
  // affichée sous un geste que personne n'a fait.
  const valeur = critereConstate && saisie && reponse ? reponse : null;

  // Le second regard suit ce qui solde l'étape, et non ce qui affirme le geste : ce
  // sont deux questions, et `critereConstate` ne répond qu'à la première. Il est déjà
  // porté quand celui qui déclare se substitue à l'acteur attendu tout en tenant le
  // rôle qui contrôle : le journal montre alors les deux gestes d'une seule main, ce
  // qui est le cas nominal d'un outil à un seul mainteneur.
  //
  // L'échec ne solde rien, le plan retombe en partiellement exécuté et l'étape reste à
  // reprendre : y attendre un contrôle bloquerait le dossier au nom d'une preuve qui
  // n'a pas d'objet. L'écart, lui, solde et ferme le dossier, et le second regard n'y
  // porte pas sur un geste que personne n'affirme mais sur la décision de ne pas le
  // faire, laquelle a bien un objet. Sans lui, une raison de trois caractères soldait
  // une étape que le plan confiait au regard d'un autre.
  const validation = etatQuiSolde(nouvelEtat)
    ? validationApresPointage(
        etape.expectedActor as Acteur,
        etape.validationBy as Acteur | null,
        { username: utilisateur.username, role },
        porteur?.username ?? null,
      )
    : "NONE";

  const maintenant = new Date();

  await actionTracee({
    action: "dossier.pointage",
    targetType: "etape",
    targetId: `${etape.systemKey}:${etape.label}`,
    before: { etat: etape.state, validation: etape.validation },
    after: {
      sens,
      etat: nouvelEtat,
      validation,
      ...(note ? { note } : {}),
      ...(valeur ? { reponse: valeur } : {}),
    },
    // La route du participant autant que celle de l'opérateur : elle est celle
    // depuis laquelle il vient de pointer, et sans elle son écran garderait
    // l'affichage d'avant son propre geste.
    revalider: [`/dossiers/${etape.plan.accessCaseId}`, `/moi/dossiers/${etape.plan.accessCaseId}`],
    utilisateur,
    ecrire: async () => {
      // Conditionnée sur la déclaration lue, comme celle du verdict : entre la lecture
      // et l'écriture, un contrôleur a pu trancher, et écrire par le seul identifiant
      // effacerait son avis en silence. Celui qui repointe après un refus l'a lu, lui,
      // donc sa condition porte ce refus.
      const { count } = await prisma.planStep.updateMany({
        where: {
          id: etape.id,
          state: etape.state,
          validation: etape.validation,
          declaredBy: etape.declaredBy,
        },
        data: {
          state: nouvelEtat,
          executedAt: maintenant,
          attempts: { increment: 1 },
          ...(note ? { lastError: note } : {}),
          reponse: valeur,
          declaredBy: utilisateur.username,
          validation,
          // L'avis du contrôleur porte sur une déclaration précise : le laisser en
          // place sous un geste repointé l'afficherait comme s'il jugeait celui-ci.
          // Le validateur attendu qui pointe lui-même signe du même coup, et c'est
          // le seul cas où sa signature s'écrit ici.
          validatedBy: validation === "ACCEPTED" ? utilisateur.username : null,
          validatedAt: validation === "ACCEPTED" ? maintenant : null,
          validationNote: null,
        },
      });

      if (count === 0) {
        throw new Error("Cette étape a changé pendant le pointage.");
      }

      // L'état du plan se déduit de ses étapes et jamais à la main. La relecture suit
      // l'écriture, et non l'inverse : voir `reposerLEtatDuPlan`.
      await reposerLEtatDuPlan(etape.plan.id);
    },
  });

  return {};
}

/**
 * Porte le second regard sur une déclaration : la preuve est faite, ou elle ne l'est
 * pas. Rien n'est exécuté ici non plus, pas davantage qu'au pointage.
 *
 * Un refus renvoie l'étape à `PENDING` et jamais à `FAILED` : « échoué » dit que le
 * geste a été tenté et que l'accès est resté ce qu'il était, un refus dit seulement
 * que la preuve n'est pas faite, donc que l'étape est de nouveau à faire. Il
 * n'incrémente pas `attempts`, qui compte les tentatives de l'acteur et non les avis
 * du contrôleur, et il se journalise en `SUCCESS`, ce champ disant si l'action a eu
 * lieu et non quel avis elle portait.
 */
export async function validerEtape(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const utilisateur = await requireUtilisateur();

  const etapeId = String(formData.get("etapeId") ?? "").trim();
  const choix = String(formData.get("verdict") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const avis = VERDICTS[choix];
  if (!avis) {
    return { erreur: "Verdict inconnu." };
  }

  const etape = await prisma.planStep.findUnique({
    where: { id: etapeId },
    select: {
      id: true,
      label: true,
      systemKey: true,
      state: true,
      validation: true,
      validationBy: true,
      declaredBy: true,
      attempts: true,
      plan: {
        select: {
          id: true,
          state: true,
          accessCaseId: true,
          accessCase: {
            select: {
              kind: true,
              state: true,
              person: { select: { id: true, username: true } },
            },
          },
        },
      },
    },
  });

  if (!etape) {
    return { erreur: refusDEtape(utilisateur) };
  }

  const participe =
    etape.plan.accessCaseId !== null &&
    (await droitDeParticiper(utilisateur.personId, etape.plan.accessCaseId));
  const role = roleDuDeclarant(utilisateur, etape.plan.accessCase?.person ?? null, participe);

  if (role === null) {
    return { erreur: REFUS_HORS_DOSSIER };
  }

  if (etape.plan.accessCase && !dossierVivant(etape.plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  const pointable = planPointable(etape.plan.state);
  if (!pointable.possible) {
    return { erreur: pointable.raison };
  }

  // Un délégué contrôle ce qu'une étape lui confie, et `peutValider` s'en charge seul :
  // il ne lui oppose que le contrôle attendu d'un opérateur, et il refuse de toute
  // façon celui qui a déclaré, par son nom.
  const verdict = peutValider(
    {
      validation: etape.validation as EtatValidation,
      validationBy: etape.validationBy as Acteur | null,
      declaredBy: etape.declaredBy,
    },
    { username: utilisateur.username, role },
  );

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  // Un écart ne se signe pas par qui ne peut pas en lire la raison : elle vit dans une
  // note libre qu'aucun écran de non-opérateur ne montre, et signer une décision dont
  // on tait le motif serait signer à l'aveugle. La projection du participant l'écarte
  // déjà de sa liste, mais l'identifiant qu'elle lui a remis survit à un repointage en
  // écart, et une règle que seul un écran tient n'en est pas une.
  //
  // Après la garde et non avant : l'écart qui n'attend aucun regard s'entend le dire,
  // plutôt que d'apprendre qu'il en attend un.
  if (role !== "OPERATOR" && etape.state === "SKIPPED") {
    return { erreur: REGARD_D_UN_OPERATEUR };
  }

  // Même exigence que le refus de note d'un pointage, et pour la même raison : un
  // refus muet renvoie l'étape à faire sans dire ce qui manque, et son déclarant
  // referait le même geste.
  if (avis === "REFUSED" && note.length < 3) {
    return {
      erreur: "Dites ce qui manque : sans motif, le refus renvoie l'étape à faire sans dire quoi.",
    };
  }

  const etatApres: EtatEtape = avis === "REFUSED" ? "PENDING" : (etape.state as EtatEtape);
  const maintenant = new Date();

  await actionTracee({
    action: "dossier.validation",
    targetType: "etape",
    targetId: `${etape.systemKey}:${etape.label}`,
    before: { etat: etape.state, validation: etape.validation, declarePar: etape.declaredBy },
    after: {
      sens: etape.plan.accessCase?.kind ?? null,
      etat: etatApres,
      validation: avis,
      ...(note ? { note } : {}),
    },
    revalider: [`/dossiers/${etape.plan.accessCaseId}`, `/moi/dossiers/${etape.plan.accessCaseId}`],
    utilisateur,
    ecrire: async () => {
      // Conditionnée sur la déclaration lue, et pas seulement sur l'identifiant :
      // entre la lecture et l'écriture, un second contrôleur a pu trancher, ou le
      // déclarant repointer son étape. Écrire sans regarder poserait un avis sur une
      // déclaration que personne n'a vue.
      //
      // `attempts` s'y ajoute parce que les trois autres colonnes ne suffisent pas :
      // un même déclarant qui repointe le même choix les repose à l'identique, et le
      // verdict signerait alors une valeur que le contrôleur n'a jamais lue. Le
      // pointage, lui, s'en dispense : le double clic sur un même formulaire repose
      // les mêmes valeurs, l'y compter le ferait échouer sans rien protéger.
      const { count } = await prisma.planStep.updateMany({
        where: {
          id: etape.id,
          validation: "AWAITING",
          state: etape.state,
          declaredBy: etape.declaredBy,
          attempts: etape.attempts,
        },
        data: {
          validation: avis,
          state: etatApres,
          validatedBy: utilisateur.username,
          validatedAt: maintenant,
          validationNote: note.length > 0 ? note : null,
        },
      });

      if (count === 0) {
        throw new Error("Cette étape a changé pendant la validation.");
      }

      await reposerLEtatDuPlan(etape.plan.id);
    },
  });

  return {};
}

/**
 * Clôt le dossier. Réservé à un plan entièrement soldé : un dossier clos sur des
 * accès encore ouverts est pire que pas de dossier du tout, il affirme que
 * l'affaire est réglée.
 */
export async function cloreDossier(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  await requireOperateur();

  const dossierId = String(formData.get("dossierId") ?? "").trim();

  const dossier = await prisma.accessCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      kind: true,
      state: true,
      person: { select: { username: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { state: true, _count: { select: { steps: true } } },
      },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }

  const dernier = dossier.plans[0] ?? null;
  const verdict = peutClore(
    dossier.kind,
    dossier.state,
    dernier?.state ?? null,
    dernier?._count.steps ?? 0,
  );
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  const maintenant = new Date();

  await actionTracee({
    action: "dossier.cloture",
    targetType: "personne",
    targetId: dossier.person.username,
    after: { sens: dossier.kind, etat: "DONE", closedAt: maintenant },
    revalider: [`/dossiers/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.accessCase.update({
        where: { id: dossier.id },
        data: { state: "DONE", closedAt: maintenant },
      });
    },
  });

  return {};
}

/**
 * Annule un dossier, et le brouillon qui l'accompagne.
 *
 * Un dossier qui n'aura pas lieu doit pouvoir se dire, sinon il reste ouvert et
 * bloque : la fusion de deux fiches le refuse, et la fiche continue d'annoncer un
 * mouvement que personne ne prépare plus.
 *
 * Le plan tombe dans la même transaction que le dossier. Séparés, un brouillon
 * survivrait sous un dossier annulé, et sa confirmation resterait offerte.
 */
export async function annulerDossier(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  await requireOperateur();

  const dossierId = String(formData.get("dossierId") ?? "").trim();
  const motif = String(formData.get("motif") ?? "").trim();

  const dossier = await prisma.accessCase.findUnique({
    where: { id: dossierId },
    select: {
      id: true,
      kind: true,
      state: true,
      person: { select: { username: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, state: true },
      },
    },
  });

  if (!dossier) {
    return { erreur: "Ce dossier n'existe plus." };
  }

  // Le motif se contrôle après la lecture, et non avant : sa phrase nomme le sens du
  // dossier, qu'on ne connaît qu'une fois le dossier lu.
  if (motif.length < 3) {
    return { erreur: LIBELLE_DOSSIER[dossier.kind].motifAttendu };
  }

  const plan = dossier.plans[0] ?? null;
  const verdict = peutAnnuler(dossier.state, plan?.state ?? null);
  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.annulation",
    targetType: "personne",
    targetId: dossier.person.username,
    before: { etat: dossier.state, plan: plan?.state ?? null },
    after: {
      sens: dossier.kind,
      etat: "CANCELLED",
      // L'état réel du plan après le geste : « null » pour les deux cas, plan absent
      // et plan laissé intact parce qu'il était déjà remplacé, aurait rendu la trace
      // incapable de les distinguer.
      plan: planAAnnuler(plan?.state ?? null) ? "CANCELLED" : (plan?.state ?? null),
      motif,
    },
    revalider: [`/dossiers/${dossier.id}`, `/personnes/${dossier.person.username}`],
    ecrire: async () => {
      await prisma.$transaction(async (transaction) => {
        // Conditionné sur l'état lu : entre la lecture et l'écriture, quelqu'un a pu
        // clore ou annuler ce dossier, et un `update` par identifiant seul écraserait
        // sa décision sans que rien ne le dise.
        const { count } = await transaction.accessCase.updateMany({
          where: { id: dossier.id, state: { in: [...ETATS_VIVANTS] } },
          data: { state: "CANCELLED", cancelledReason: motif },
        });

        if (count === 0) {
          throw new Error("Ce dossier a changé d'état pendant l'annulation.");
        }

        if (plan && planAAnnuler(plan.state)) {
          const remplace = await transaction.plan.updateMany({
            where: { id: plan.id, state: plan.state },
            data: { state: "CANCELLED" },
          });

          // Le silence ici laissait un plan confirmé sous un dossier annulé, que plus
          // aucun geste n'atteint : ni pointage, le dossier étant mort, ni clôture,
          // ni annulation. La transaction se défait plutôt que de murer le dossier.
          if (remplace.count === 0) {
            throw new Error("Ce plan a changé d'état pendant l'annulation de son dossier.");
          }
        }
      });
    },
  });

  return {};
}

/**
 * Remplace un brouillon que le temps ou une collecte a démenti.
 *
 * Sans ce geste, un plan périmé fige son dossier : la confirmation le refuse, et
 * personne ne peut en calculer un autre. Le dossier resterait ouvert sur des accès
 * dont plus rien ne s'occupe, ce qui est la panne la plus discrète de cet écran.
 *
 * Le plan remplacé n'est pas supprimé : il garde ce qu'il proposait et pourquoi il a
 * cessé de valoir, comme tout ce qui a été calculé ici.
 */
export async function recalculerPlan(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  await requireOperateur();

  const planId = String(formData.get("planId") ?? "").trim();
  const plan = await planDuDossier(planId);

  if (!plan?.accessCase || !plan.accessCaseId) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const sens = plan.accessCase.kind;
  const dossierId = plan.accessCaseId;
  const maintenant = new Date();
  const actuel = await calculerPlan(
    sens,
    plan.accessCase.person.id,
    plan.accessCase.person.username,
    maintenant,
    profilDeLaPolitique(plan.accessCase.profileKey),
  );

  if (!dossierVivant(plan.accessCase.state)) {
    return { erreur: "Ce dossier n'est plus ouvert." };
  }

  // Le recalcul est le seul chemin qui réécrive un plan : un profil devenu invalide
  // depuis l'ouverture s'y dit ici, sous le formulaire, plutôt qu'au milieu de la
  // transaction qui remplace le brouillon.
  if (actuel.refus.length > 0) {
    return { erreur: messageDeRefus(actuel.refus) };
  }

  const peremption = peremptionDuPlan(plan, actuel.empreinte, maintenant);
  const verdict = peutRecalculer(plan.state, peremption);

  if (!verdict.possible) {
    return { erreur: verdict.raison };
  }

  await actionTracee({
    action: "dossier.recalcul",
    targetType: "plan",
    targetId: plan.id,
    before: { empreinte: plan.planDigest, etapes: plan.steps.length },
    after: { sens, empreinte: actuel.empreinte, etapes: actuel.etapes.length },
    revalider: [`/dossiers/${dossierId}`],
    ecrire: async (operateur) => {
      // Les deux écritures dans la même transaction : séparées, une panne entre les
      // deux laissait le plan remplacé comme plan le plus récent, et `peutRecalculer`
      // exigeant un brouillon, le dossier n'avait plus que l'annulation pour sortie.
      await prisma.$transaction(async (transaction) => {
        // Le remplacement d'abord, et sous condition : sans elle, un dossier annulé
        // entre la lecture et l'écriture recevrait un brouillon neuf que plus rien
        // n'irait contredire.
        const { count } = await transaction.plan.updateMany({
          where: {
            id: plan.id,
            state: "DRAFT",
            accessCase: { state: { in: [...ETATS_VIVANTS] } },
          },
          data: { state: etatDUnPlanRemplace(peremption) },
        });

        if (count === 0) {
          throw new Error("Ce plan ou son dossier a changé d'état pendant le recalcul.");
        }

        await enregistrerPlan(dossierId, actuel, operateur.username, maintenant, transaction);
      });
    },
  });

  return {};
}

/**
 * Lance l'exécution d'un plan confirmé.
 *
 * Le geste de masse est une case que l'opérateur coche lui-même, jamais un défaut ni un
 * paramètre d'URL : au-delà du plafond, un plan ne part pas sans que quelqu'un ait dit
 * une seconde fois qu'il en répond. Son absence n'est pas une erreur de saisie, c'est
 * le cas nominal, et le refus dit alors ce qu'il refuse et ce qu'il faut faire.
 *
 * Rien n'est tracé ici : `executerPlan` journalise le plan puis chaque étape avant de
 * l'appeler, nominativement, et une trace de plus posée en amont dirait qu'un geste a
 * eu lieu avant même de savoir si le plan était exécutable.
 */
export async function lancerExecution(
  _etat: EtatAction | null,
  formData: FormData,
): Promise<EtatAction> {
  const operateur = await requireOperateur();

  const planId = String(formData.get("planId") ?? "").trim();
  const masseConfirmee = String(formData.get("masse") ?? "") === "confirmee";

  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { accessCaseId: true },
  });

  if (!plan) {
    return { erreur: "Ce plan n'existe plus." };
  }

  const resultat = await executerPlan(planId, {
    operateur: operateur.username,
    masseConfirmee,
    maintenant: new Date(),
  });

  if (plan.accessCaseId) {
    revalidatePath(`/dossiers/${plan.accessCaseId}`);
  }

  return resultat.refus ? { erreur: resultat.refus } : { execution: resultat };
}

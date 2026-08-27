import { randomUUID } from "node:crypto";

import { CONNECTEURS } from "@/connectors";
import type { Connector, Intent, PlannedStep, RunContext } from "@/core/connector";
import {
  ETATS_VIVANTS,
  type EtatEtape,
  type EtatValidation,
  etatApresPointage,
  etatDeNaissance,
  type SensDossier,
  type SystemesDuDepart,
  systemesDuDepart,
} from "@/core/dossier";
import type { RefusDOctroi } from "@/core/octroi";
import {
  assembler,
  type EtapeAssemblee,
  type EtapeEcartee,
  empreinteDuPlan,
  exigerDesCombinaisonsValides,
} from "@/core/plan";
import type { Profil } from "@/core/policy";
import { Prisma } from "@/generated/prisma/client";
import { octroisDUnProfil } from "@/lib/arrivee";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { etapesDeclarees } from "@/lib/modele-plan";

/**
 * Durée de validité d'un plan. Passé ce délai, ce qui a été constaté est trop vieux
 * pour qu'on agisse dessus sans regarder à nouveau : la personne a pu récupérer un
 * accès, en perdre un autre, ou revenir.
 */
const VALIDITE_JOURS = 7;

const RISQUE = { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const;

/** Ce qu'un plan demande aux connecteurs, dans un sens comme dans l'autre. */
const INTENTION: Record<SensDossier, Intent["kind"]> = {
  ONBOARDING: "grant",
  OFFBOARDING: "revoke",
};

const AUCUN_SYSTEME: SystemesDuDepart = { revocables: [], observes: [], nonConfirmes: [] };

const AUCUN_OCTROI = { etapes: [], refus: [] } as const;

/**
 * Les systèmes sur lesquels la personne a été observée, répartis selon ce qu'on a le
 * droit d'y faire. Planifier ailleurs reviendrait à demander de retirer quelqu'un
 * d'un endroit où il n'est pas : chaque ligne d'un plan doit appeler un geste, sinon
 * c'est une liste qu'on cesse de lire.
 *
 * Une identité disparue ne compte pas : elle dit qu'on ne l'observe plus, donc qu'il
 * n'y a plus rien à couper.
 */
async function systemesDeLaPersonne(personId: string): Promise<SystemesDuDepart> {
  const identites = await prisma.externalIdentity.findMany({
    where: { personId, vanishedAt: null },
    select: { provider: true, matchMethod: true },
  });

  return systemesDuDepart(
    identites.map((identite) => ({
      provider: identite.provider,
      methode: identite.matchMethod,
    })),
  );
}

/**
 * Les connecteurs qu'un plan interroge, et ce ne sont pas les mêmes dans les deux
 * sens.
 *
 * Pour un départ, seuls ceux où la personne est observée avec un rattachement sûr :
 * une ressemblance ne coupe rien, et un système où elle n'a pas de compte n'appelle
 * aucun geste.
 *
 * Pour une arrivée, tous ceux qui savent donner un accès, sans regarder ce qui est
 * déjà là : un compte déjà ouvert se pointe « déjà présent », il ne fait pas
 * disparaître l'étape qui l'exigeait. Aucune identité n'entre donc dans ce filtre,
 * et une ressemblance n'y produit pas davantage d'étape que dans l'autre sens.
 */
function interroge(
  sens: SensDossier,
  connecteur: Connector,
  presente: ReadonlySet<string>,
): boolean {
  if (sens === "OFFBOARDING") {
    return presente.has(connecteur.contract.key);
  }
  return connecteur.contract.capabilities.grant !== undefined;
}

export interface PlanCalcule {
  sens: SensDossier;
  /** Les étapes retenues, chacune avec son origine et son rang de lecture. */
  etapes: readonly EtapeAssemblee[];
  /**
   * Ce qui n'a pas été retenu, et pourquoi : un geste déjà demandé ailleurs, ou une
   * étape de startup que l'incubateur n'admet pas. Rien n'est écarté en silence.
   */
  ecartees: readonly EtapeEcartee[];
  empreinte: string;
  /**
   * Les systèmes qu'un connecteur a interrogés pour ce plan, et ils ne se choisissent
   * pas de la même façon dans les deux sens : au départ, ceux où la personne a un
   * compte qu'on a le droit de couper ; à l'arrivée, ceux qui déclarent savoir donner,
   * sans qu'aucun compte n'ait été regardé et sans qu'aucune étape n'en sorte encore.
   */
  systemes: readonly string[];
  /** Systèmes où elle a un compte, mais qu'aucun connecteur ne sait traiter. */
  sansConnecteur: readonly string[];
  /**
   * Systèmes couverts par un connecteur où elle a un compte qu'aucune étape ne peut
   * viser, faute d'un rattachement sûr. Sans cette liste, le plan se tairait sur eux
   * et son silence passerait pour une absence de compte.
   */
  nonConfirmes: readonly string[];
  /**
   * Ce qui empêche d'enregistrer ce plan : un accès de profil qui ne s'applique pas,
   * un scope qu'aucun schéma n'accepte, un rôle à risque élevé sans échéance. Non
   * vide, aucune étape ne sort, et c'est la construction qui échoue et non
   * l'exécution : refuser plus tard laisserait un plan confirmé que personne ne peut
   * exécuter.
   */
  refus: readonly RefusDOctroi[];
}

/**
 * Ce qu'il faudrait faire pour donner ou pour retirer ses accès à quelqu'un : ce que
 * les modèles déclarent, ce que les connecteurs disent aujourd'hui, et ce que le profil
 * choisi ouvre. Ne touche à rien, ni ici ni ailleurs.
 *
 * Le profil n'arrive que pour une arrivée, et son absence n'est pas une erreur : un
 * départ n'en applique aucun, et une arrivée ouverte sans profil est une arrivée qui
 * n'ouvre rien sur les systèmes couverts, ce qui reste une décision licite.
 *
 * Il arrive par paramètre plutôt que d'être lu ici, pour que l'appelant qui recalcule
 * un plan à l'exécution passe exactement celui que le dossier porte : lire la politique
 * au fond de cette fonction ferait dépendre l'empreinte d'un fichier plutôt que du
 * dossier.
 */
export async function calculerPlan(
  sens: SensDossier,
  personId: string,
  username: string,
  maintenant: Date,
  profil?: Profil | undefined,
): Promise<PlanCalcule> {
  // Les comptes observés ne disent rien de ce qu'il faut donner : les lire pour une
  // arrivée serait une requête pour rien, et les afficher ferait passer un accès
  // existant pour un manque.
  const constates = sens === "OFFBOARDING" ? await systemesDeLaPersonne(personId) : AUCUN_SYSTEME;
  const presente = new Set(constates.revocables);

  const ctx: RunContext = {
    runId: randomUUID(),
    now: maintenant,
    // Calculer n'écrit nulle part, mais le contexte le dit quand même : un
    // connecteur qui sonderait le système cible pour affiner son plan doit savoir
    // qu'il n'a le droit de rien changer.
    dryRun: !env.ACTIONS_ENABLED,
    audit,
  };

  const proposees: PlannedStep[] = [];
  const systemes: string[] = [];

  for (const connecteur of CONNECTEURS) {
    if (!interroge(sens, connecteur, presente)) {
      continue;
    }

    systemes.push(connecteur.contract.key);
    // Sans scope : ce qu'un connecteur rend ici est ce qu'une arrivée exige quel que
    // soit le profil. Ce qui dépend du profil passe par `octroisDUnProfil`, qui porte
    // le scope validé, et les deux voies ne doivent jamais proposer le même geste.
    proposees.push(
      ...(await connecteur.plan(
        { kind: INTENTION[sens], subject: { kind: "person", username } },
        ctx,
      )),
    );
  }

  const octrois =
    sens === "ONBOARDING" && profil
      ? await octroisDUnProfil(profil, personId, username, maintenant)
      : AUCUN_OCTROI;

  proposees.push(...octrois.etapes);

  // L'ordre dans lequel les origines sont fournies n'a aucun effet : `assembler`
  // retrie par rang d'origine, sans quoi l'empreinte suivrait l'appelant.
  const declarees = await etapesDeclarees(personId, sens, maintenant);
  const assemblage = assembler({
    origines: [...declarees.origines, { origine: "connecteur", etapes: proposees }],
  });

  const couverts = new Set(CONNECTEURS.map((connecteur) => connecteur.contract.key));

  return {
    sens,
    etapes: assemblage.etapes,
    // Les neutralisées d'abord : une étape que l'incubateur n'admet pas n'est jamais
    // arrivée jusqu'au dédoublonnage, et les taire ferait de l'autorisation refermée
    // une panne muette.
    ecartees: [...declarees.ecartees, ...assemblage.ecartees],
    // Sur les étapes nues, avant que l'enregistrement ne suffixe leurs clés
    // d'idempotence : hacher après suffixage donnerait à deux plans du même dossier
    // des empreintes incomparables, et un plan confirmé se dirait obsolète tout seul.
    empreinte: empreinteDuPlan(assemblage.etapes.map(({ etape }) => etape)),
    systemes,
    // Sur tous les systèmes observés et non sur les seuls révocables : un compte que
    // rien ici ne sait traiter est à traiter dehors, que son rattachement soit sûr
    // ou non.
    sansConnecteur: constates.observes.filter((provider) => !couverts.has(provider)),
    nonConfirmes: constates.nonConfirmes.filter((provider) => couverts.has(provider)),
    refus: octrois.refus,
  };
}

/**
 * Ouvre un dossier, ou rend celui qui est déjà ouvert.
 *
 * Un seul dossier vivant par personne et par sens : deux dossiers concurrents pour
 * un même départ produiraient deux plans, deux approbations, et deux façons de
 * croire que l'affaire est réglée. Par sens, parce qu'une arrivée et un départ ne se
 * gênent pas : quelqu'un qui revient a un départ clos derrière lui, et rien
 * n'interdit qu'on prépare son retour pendant qu'on solde sa sortie.
 *
 * La lecture avant création ne suffit pas : deux ouvertures simultanées la passent
 * toutes les deux. Un index partiel la double en base, et la course s'y résout comme
 * elle se serait résolue une milliseconde plus tôt, en rendant le dossier gagnant.
 */
export async function ouvrirDossier(
  personId: string,
  sens: SensDossier,
  effectiveDate: Date | null,
  /**
   * Le profil que cette arrivée applique. Il se fige à l'ouverture parce que le
   * recalcul doit le retrouver : un plan recalculé sans lui ne porterait aucune de ses
   * étapes d'octroi et se dirait obsolète tout seul.
   */
  profileKey: string | null = null,
): Promise<{ id: string; deja: boolean }> {
  const ouvert = await prisma.accessCase.findFirst({
    where: { personId, kind: sens, state: { in: [...ETATS_VIVANTS] } },
    select: { id: true },
  });

  if (ouvert) {
    return { id: ouvert.id, deja: true };
  }

  try {
    const cree = await prisma.accessCase.create({
      data: {
        personId,
        kind: sens,
        state: etatDeNaissance(sens),
        ...(effectiveDate ? { effectiveDate } : {}),
        ...(profileKey ? { profileKey } : {}),
      },
      select: { id: true },
    });

    return { id: cree.id, deja: false };
  } catch (erreur) {
    if (!(erreur instanceof Prisma.PrismaClientKnownRequestError) || erreur.code !== "P2002") {
      throw erreur;
    }

    const gagnant = await prisma.accessCase.findFirst({
      where: { personId, kind: sens, state: { in: [...ETATS_VIVANTS] } },
      select: { id: true },
    });

    if (!gagnant) {
      throw erreur;
    }

    return { id: gagnant.id, deja: true };
  }
}

/**
 * Assez de tentatives pour que deux clics simultanés se rangent, pas assez pour qu'une
 * boucle d'écriture continue accapare la requête : au-delà, le pointage suivant
 * reposera l'état de toute façon.
 */
const TENTATIVES_DETAT = 5;

/**
 * Repose l'état d'un plan sur ce que ses étapes disent maintenant.
 *
 * La relecture suit l'écriture au lieu de la précéder, et c'est tout l'objet de cette
 * fonction : deux pointages simultanés sur deux étapes du même plan calculaient sinon
 * chacun sur une photo prise avant que l'autre n'écrive, et le dernier posait un état
 * que le détail dément, « en cours » sur un plan dont plus rien n'attend.
 *
 * L'état et les étapes se lisent d'une seule requête : lus séparément, l'état
 * servirait de témoin à une photo qu'il n'a pas vue, et la condition d'écriture ne
 * garderait plus rien.
 *
 * Le conflit se rejoue plutôt qu'il ne s'abandonne, à la différence des trois autres
 * courses de ce dépôt : celles-là résolvent un doublon, où le gagnant a raison et le
 * perdant n'a plus rien à faire. Ici le perdant porte une étape que le gagnant n'a pas
 * vue, et renoncer laisserait l'état muet sur elle.
 */
export async function reposerLEtatDuPlan(planId: string): Promise<void> {
  for (let tentative = 0; tentative < TENTATIVES_DETAT; tentative += 1) {
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      select: { state: true, steps: { select: { state: true, validation: true } } },
    });

    if (!plan) {
      return;
    }

    const { count } = await prisma.plan.updateMany({
      where: { id: planId, state: plan.state },
      data: {
        state: etatApresPointage(
          plan.steps.map((etape) => ({
            etat: etape.state as EtatEtape,
            validation: etape.validation as EtatValidation,
          })),
        ),
      },
    });

    if (count > 0) {
      return;
    }
  }
}

/**
 * Ce qu'un refus de construction dit, et il nomme tout ce qu'il faut pour le corriger :
 * le profil, le rang de l'accès dans sa liste, le système, et le motif.
 */
export function messageDeRefus(refus: readonly RefusDOctroi[]): string {
  const lignes = refus.map(
    (motif) =>
      `  profil « ${motif.profil} », accès n°${motif.acces + 1} sur ${motif.systeme} : ${motif.motif}`,
  );

  return `Ce plan ne peut pas être construit :\n${lignes.join("\n")}`;
}

/**
 * Fige un plan calculé. Chaque étape stocke la photo de ce qu'elle engage, jamais
 * une référence : ce qui a été approuvé doit rester lisible tel quel dans deux ans,
 * même si la ressource visée a changé de nom depuis.
 *
 * Un plan porteur du moindre refus ne s'écrit pas, et la garde vit ici plutôt que chez
 * l'appelant : un profil dont un accès ne s'applique pas n'ouvre pas les autres à
 * moitié, et un appelant qui oublierait de regarder `refus` enregistrerait sinon un
 * plan amputé sans que rien ne le signale.
 */
export async function enregistrerPlan(
  accessCaseId: string,
  calcule: PlanCalcule,
  createdBy: string,
  maintenant: Date,
  /**
   * Le client d'une transaction en cours, quand l'appelant en ouvre une. Le recalcul
   * remplace un plan puis en enregistre un neuf : séparées, une panne entre les deux
   * laisse le plan remplacé comme plan le plus récent, et le dossier sans autre issue
   * que l'annulation.
   */
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  if (calcule.refus.length > 0) {
    throw new Error(messageDeRefus(calcule.refus));
  }

  // Le seul garde de la répartition des rôles, la base n'en portant aucun : elle est
  // écrite ici et nulle part ailleurs, donc c'est ici qu'une combinaison impossible
  // doit mourir. Plus loin, elle attendrait pour toujours un validateur qui ne peut
  // pas exister.
  exigerDesCombinaisonsValides(calcule.etapes.map(({ etape }) => etape));

  const expiresAt = new Date(maintenant.getTime() + VALIDITE_JOURS * 24 * 60 * 60_000);

  // L'identifiant est tiré ici pour entrer dans les clés d'idempotence, uniques en
  // base. Les suffixer par le dossier donnerait les mêmes clés à deux plans successifs
  // du même dossier, ce qui interdirait d'en recalculer un après péremption.
  const planId = randomUUID();

  const plan = await client.plan.create({
    data: {
      id: planId,
      accessCaseId,
      kind: calcule.sens,
      state: "DRAFT",
      planDigest: calcule.empreinte,
      createdBy,
      expiresAt,
      steps: {
        create: calcule.etapes.map(({ etape, ordre }) => ({
          systemKey: etape.systemKey,
          tier: etape.tier,
          capability: etape.capability,
          action: etape.action,
          label: etape.label,
          ordre,
          params: etape.params as object,
          riskLevel: RISQUE[etape.riskLevel],
          expectedState: (etape.expectedState ?? {}) as object,
          idempotencyKey: `${etape.idempotencyKey}:${planId}`,
          // Recopie directe, sans table de traduction : `Acteur` et `StepActor`
          // portent les mêmes littéraux, comme `EtatEtape` et `StepState`. Le détour
          // par un dictionnaire d'identité aurait été une liste de plus à tenir à
          // jour, pas une garde.
          ...(etape.expectedActor ? { expectedActor: etape.expectedActor } : {}),
          ...(etape.validationBy ? { validationBy: etape.validationBy } : {}),
          ...(etape.grantExpiresAt ? { grantExpiresAt: etape.grantExpiresAt } : {}),
          ...(etape.manual ? { manual: etape.manual as object } : {}),
          ...(etape.template ? { template: etape.template as object } : {}),
        })),
      },
    },
    select: { id: true },
  });

  return plan.id;
}

/**
 * Le plan d'un dossier qu'on vient d'ouvrir, ou dont l'ouverture s'etait interrompue
 * avant d'en ecrire un.
 *
 * Compter les plans avant d'en ecrire un ne suffit pas : deux ouvertures simultanees
 * comptent toutes les deux zero, et tout le calcul s'ecoule entre ce comptage et
 * l'ecriture. Un index partiel double la garde en base, comme pour le dossier lui-meme,
 * et la course s'y resout en gardant le plan gagnant.
 *
 * Le rattrapage vit ici et non dans `enregistrerPlan` : le recalcul remplace un plan
 * avant d'en ecrire un autre, sous transaction, et une violation d'unicite y dirait que
 * le remplacement n'a pas eu lieu. L'avaler la-bas murerait le dossier au lieu de
 * defaire la transaction.
 */
export async function enregistrerPlanDOuverture(
  accessCaseId: string,
  calcule: PlanCalcule,
  createdBy: string,
  maintenant: Date,
): Promise<void> {
  try {
    await enregistrerPlan(accessCaseId, calcule, createdBy, maintenant);
  } catch (erreur) {
    if (!(erreur instanceof Prisma.PrismaClientKnownRequestError) || erreur.code !== "P2002") {
      throw erreur;
    }

    // Meme prudence que sur le dossier : sans plan derriere, la collision ne vient pas
    // d'une course, et l'avaler annoncerait un geste abouti sans rien pour le porter.
    if ((await prisma.plan.count({ where: { accessCaseId } })) === 0) {
      throw erreur;
    }
  }
}

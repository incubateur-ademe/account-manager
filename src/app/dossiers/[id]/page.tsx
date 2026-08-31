import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CONNECTEURS } from "@/connectors";
import { type Capability, type ResolvedCapability, resolveCapability } from "@/core/connector";
import {
  type Acteur,
  type Declarant,
  type EtatEtape,
  type EtatPlan,
  type EtatValidation,
  estSoldee,
  peutAnnuler,
  peutClore,
  peutPointer,
  peutValider,
  planPointable,
  roleSurDossier,
  type SensDossier,
  type Valideur,
} from "@/core/dossier";
import { peutExecuter } from "@/core/execution";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import {
  CLE_INCUBATEUR,
  ecartDeModele,
  type OrigineFigee,
  origineFigeeSchema,
  type SaisieAttendue,
} from "@/core/modele-plan";
import {
  masseDuPlan,
  type OrigineEtape,
  peremptionDuPlan,
  type RaisonDEcart,
  refusDeMasse,
} from "@/core/plan";
import { profilDeLaPolitique } from "@/lib/arrivee";
import { prisma } from "@/lib/db";
import { calculerPlan } from "@/lib/dossier";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";
import {
  BoutonAnnuler,
  BoutonClore,
  BoutonConfirmer,
  BoutonExecuter,
  BoutonRecalculer,
  Pointage,
  Validation,
} from "./Pointage";

export const dynamic = "force-dynamic";

/**
 * Sans fuseau, donc dans celui du lecteur, et c'est ce qu'il faut pour un horodatage :
 * un plan confirmé à minuit et demi s'est bien confirmé ce jour-là pour qui l'a fait.
 * Une échéance, elle, est une date sans heure côté base, que ce formateur reculerait
 * d'un jour la moitié de l'année : elle passe par `dateFr`, en UTC.
 */
const dateLocale = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

const TIER: Record<
  string,
  { libelle: string; severite: "success" | "warning" | "info" | "error" }
> = {
  auto: { libelle: "automatique", severite: "success" },
  assisted: { libelle: "assisté", severite: "info" },
  manual: { libelle: "à faire à la main", severite: "warning" },
  // Une étape peut sortir sans aucune voie praticable : elle est émise quand même,
  // portant le runbook du contrat, parce qu'une ligne d'arrivée qui manque est le mode
  // de panne que ce produit existe pour éviter.
  none: { libelle: "sans voie", severite: "error" },
};

const ETAPE: Record<EtatEtape, { libelle: string; severite: "success" | "warning" | "error" }> = {
  PENDING: { libelle: "à faire", severite: "warning" },
  SUCCEEDED: { libelle: "fait", severite: "success" },
  ALREADY_ABSENT: { libelle: "déjà absent", severite: "success" },
  ALREADY_PRESENT: { libelle: "déjà présent", severite: "success" },
  SKIPPED: { libelle: "écartée", severite: "warning" },
  FAILED: { libelle: "échec", severite: "error" },
  STALE: { libelle: "situation changée", severite: "warning" },
};

/**
 * À qui l'étape revient. Rien sous un opérateur : c'est le cas nominal de ce plan, et
 * décorer chaque ligne d'un badge que toutes portent n'apprend rien à personne, tout
 * en noyant les deux qui disent quelque chose.
 */
const ACTEUR: Record<Acteur, { libelle: string; severite: "info" } | null> = {
  OPERATOR: null,
  SUBJECT: { libelle: "à la personne concernée", severite: "info" },
  DELEGATE: { libelle: "à un délégué", severite: "info" },
};

/** Qui porte le second regard, dit dans une phrase. */
const CONTROLEUR: Record<Acteur, string> = {
  OPERATOR: "d'un opérateur",
  SUBJECT: "de la personne concernée",
  DELEGATE: "d'un délégué",
};

const ECART: Record<RaisonDEcart, string> = {
  doublon: "déjà demandée plus haut",
  "doublon-sans-controle": "déjà demandée plus haut, sans son second regard",
  "non-autorise": "non autorisée sur ce compte",
  "saisie-illisible": "saisie attendue illisible",
};

const PREFIXE_STARTUP = "modele:startup:";

function origineLisible(origine: OrigineEtape, nomsDeStartup: ReadonlyMap<string, string>): string {
  if (origine === "connecteur") {
    return "connecteur";
  }
  if (origine === "modele:incubateur") {
    return "modèle de l'incubateur";
  }
  const ghid = origine.slice(PREFIXE_STARTUP.length);
  return `modèle de la startup ${nomsDeStartup.get(ghid) ?? ghid}`;
}

interface MarcheASuivre {
  runbook?: string;
  deeplink?: string;
  doneWhen?: string;
}

function marche(valeur: unknown): MarcheASuivre {
  return valeur && typeof valeur === "object" ? (valeur as MarcheASuivre) : {};
}

interface EtapeFigee {
  id: string;
  label: string;
  systemKey: string;
  capability: string;
  idempotencyKey: string;
  tier: string;
  riskLevel: string;
  state: string;
  validation: string;
  expectedActor: string;
  validationBy: string | null;
  declaredBy: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  validationNote: string | null;
  manual: unknown;
  reponse: string | null;
  lastError: string | null;
  executedAt: Date | null;
  grantExpiresAt: Date | null;
}

/**
 * Ce que chaque geste du plan vaudrait aujourd'hui, credentials en main.
 *
 * Le plan affiche le tier figé, qui est celui qui a été approuvé, mais ce n'est pas
 * toujours celui qui s'appliquera : la boucle d'exécution recalcule le plan et suit la
 * voie du jour. Taire l'écart afficherait un tier théorique, exactement ce que ce
 * produit s'interdit, et un opérateur lirait « à faire à la main » sur une étape que la
 * machine s'apprête à exécuter.
 *
 * Les sondes ne regardent que l'environnement, sans appel sortant, et ne sont
 * interrogées que pour les systèmes que ce plan touche.
 */
async function voiesDuJour(
  etapes: readonly { systemKey: string; capability: string }[],
): Promise<ReadonlyMap<string, ResolvedCapability>> {
  const attendues = new Set(
    etapes.map(({ systemKey, capability }) => `${systemKey}:${capability}`),
  );
  const resolues = new Map<string, ResolvedCapability>();

  for (const connecteur of CONNECTEURS) {
    const { contract } = connecteur;
    const utiles = [...attendues].filter((cle) => cle.startsWith(`${contract.key}:`));
    if (utiles.length === 0) {
      continue;
    }

    const sondes = await connecteur.probe();
    for (const cle of utiles) {
      const capacite = cle.slice(contract.key.length + 1) as Capability;
      resolues.set(
        cle,
        resolveCapability(capacite, contract.capabilities[capacite], sondes, contract.runbook),
      );
    }
  }

  return resolues;
}

/**
 * Ce qu'il faut dire d'une étape en plus de son tier figé : la voie du jour quand elle
 * diffère, et ce qui manque pour faire mieux quand une meilleure existe sans être
 * praticable.
 *
 * La voie du jour vient du plan recalculé et non de `resolveCapability`, et l'écart
 * n'est pas théorique : la résolution ne parle que de credentials, quand un connecteur
 * dégrade aussi pour une donnée qui manque, tel un identifiant GitHub sûr. Annoncer
 * « automatique » sur la foi du seul jeton ferait promettre un geste que la boucle
 * n'emprunterait pas. `degradedFrom`, lui, garde sa raison d'être : c'est le seul
 * endroit qui nomme le credential absent.
 */
function voieLisible(
  tierFige: string,
  tierDuJour: string | undefined,
  resolue: ResolvedCapability | undefined,
): string | null {
  const libelleDe = (tier: string) => TIER[tier]?.libelle ?? tier;
  const manque =
    tierDuJour !== "auto" && resolue?.degradedFrom
      ? `Pour faire mieux : ${libelleDe(resolue.degradedFrom.tier)} si ${resolue.degradedFrom.missing.join(", ")}.`
      : "";

  if (tierDuJour === undefined || tierDuJour === tierFige) {
    return manque === "" ? null : manque;
  }

  return `Ce plan a figé « ${libelleDe(tierFige)} » ; aujourd'hui cette voie est ${libelleDe(tierDuJour)}, et c'est celle-là qu'une exécution emprunterait. ${manque}`.trim();
}

/**
 * Une étape déclarée se reconnaît à son origine gelée, jamais à son `systemKey` : la
 * constante réservée d'un modèle est un détail de remplissage, la colonne est la
 * décision.
 *
 * Une origine illisible ne peut venir que d'une écriture faite hors de cet outil.
 * L'étape passe alors pour une étape de connecteur plutôt que de faire tomber le
 * dossier : elle reste lisible, et le pointage, lui, la refuse en le disant.
 */
function origineFigee(valeur: unknown): OrigineFigee | null {
  const origine = origineFigeeSchema.safeParse(valeur);
  return origine.success ? origine.data : null;
}

interface LigneDEtape {
  etape: EtapeFigee;
  origine: OrigineFigee | null;
}

interface GroupeDEtapes {
  /** Le ghid de la startup, la clé de l'incubateur, ou rien pour un connecteur. */
  proprietaire: string | null;
  /** Rang de sa première étape, pour que la numérotation continue d'un groupe à l'autre. */
  premier: number;
  lignes: LigneDEtape[];
}

/**
 * Les étapes réunies par ce qui les a demandées, dans leur ordre de lecture.
 *
 * Le regroupement suit l'ordre figé et ne le réarrange pas : c'est l'assemblage qui a
 * décidé du rang, l'incubateur d'abord, puis les startups par ghid, puis les
 * connecteurs. Un groupe se ferme dès que l'origine change, plutôt que de rassembler
 * ce qui ne se suit pas : la numérotation d'un groupe part du rang de sa première
 * étape, et rassembler mentirait dessus.
 */
function grouperParOrigine(lignes: readonly LigneDEtape[]): GroupeDEtapes[] {
  const groupes: GroupeDEtapes[] = [];

  lignes.forEach((ligne, rang) => {
    const proprietaire = ligne.origine?.owner ?? null;
    const courant = groupes.at(-1);

    if (courant && courant.proprietaire === proprietaire) {
      courant.lignes.push(ligne);
      return;
    }

    groupes.push({ proprietaire, premier: rang, lignes: [ligne] });
  });

  return groupes;
}

/**
 * Le titre d'un groupe. Il nomme celui qui demande, jamais le mécanisme qui a produit
 * l'étape : ce que le lecteur a besoin de savoir est à qui s'adresser quand une ligne
 * ne lui parle pas.
 */
function titreDuGroupe(proprietaire: string | null, nomsDeStartup: ReadonlyMap<string, string>) {
  if (proprietaire === null) {
    return "Sur les systèmes couverts";
  }
  if (proprietaire === CLE_INCUBATEUR) {
    return "Ce que l'incubateur demande";
  }
  return `Ce que la startup ${nomsDeStartup.get(proprietaire) ?? proprietaire} demande`;
}

/**
 * Ce que les restantes attendent d'un contrôle, dit relativement à leur nombre.
 *
 * « L'une d'elles » sous une seule étape restante se lit comme une faute, et c'est le
 * cas le plus fréquent en fin de dossier : quand l'attente est la totalité des
 * restantes, la phrase le dit plutôt que d'en désigner une partie.
 *
 * Muette sur ce qui a été déclaré, et il faut qu'elle le reste : elle compte des
 * étapes qu'elle ne lit pas une par une, et une étape écartée attend ce même regard
 * sans que personne ait déclaré le geste fait.
 */
function attenteDeControle(enAttente: number, restantes: number): string {
  if (enAttente === 0) {
    return "";
  }

  let sujet: string;
  if (enAttente === restantes) {
    sujet = enAttente === 1 ? "Elle attend" : "Toutes attendent";
  } else if (enAttente === 1) {
    sujet = "L'une d'elles attend";
  } else {
    sujet = `${enAttente} d'entre elles attendent`;
  }

  return ` ${sujet} un second regard : une déclaration que personne n'a contrôlée ne solde pas son étape.`;
}

/** Une étape figée, telle qu'elle se lit et telle qu'elle se pointe. */
function Etape({
  etape,
  saisie,
  voie,
  pointable,
  etatPlan,
  sens,
  declarant,
  valideur,
}: {
  etape: EtapeFigee;
  saisie: SaisieAttendue | null;
  /** L'écart entre le tier figé et la voie du jour, ou ce qui manque pour faire mieux. */
  voie: string | null;
  pointable: boolean;
  /** L'état du plan, tel que la garde de pointage a besoin de le lire. */
  etatPlan: EtatPlan;
  sens: SensDossier;
  /** Celui qui lit, tel que la garde de pointage a besoin de le connaître. */
  declarant: Declarant;
  /** Le même, tel que la garde de validation a besoin de le connaître. */
  valideur: Valideur;
}) {
  const aide = marche(etape.manual);
  const tier = TIER[etape.tier] ?? { libelle: etape.tier, severite: "info" as const };
  const pointee = ETAPE[etape.state as EtatEtape];
  const validation = etape.validation as EtatValidation;
  const soldee = estSoldee({ etat: etape.state as EtatEtape, validation });
  const acteur = ACTEUR[etape.expectedActor as Acteur];
  const controleur = etape.validationBy ? CONTROLEUR[etape.validationBy as Acteur] : null;

  // Adossé à la garde comme la validation l'est déjà : offrir le pointage puis le
  // refuser au clic est exactement ce que cet écran évite partout ailleurs.
  const pointage = peutPointer(etatPlan, etape.expectedActor as Acteur, declarant);

  // Adossé à la garde plutôt que rejoué ici : l'écran qui connaît la règle de son côté
  // est ce qui a muré ce dossier le jour où une étape a échoué.
  const controle =
    validation === "AWAITING"
      ? peutValider(
          {
            validation,
            validationBy: etape.validationBy as Acteur | null,
            declaredBy: etape.declaredBy,
          },
          valideur,
        )
      : null;

  return (
    <li className={fr.cx("fr-mb-4w")}>
      <strong>{etape.label}</strong>{" "}
      <Badge severity={pointee.severite} small noIcon>
        {pointee.libelle}
      </Badge>{" "}
      <Badge severity={tier.severite} small noIcon>
        {tier.libelle}
      </Badge>{" "}
      {acteur ? (
        <>
          <Badge severity={acteur.severite} small noIcon>
            {acteur.libelle}
          </Badge>{" "}
        </>
      ) : null}
      {validation === "AWAITING" ? (
        <>
          <Badge severity="warning" small noIcon>
            en attente de validation
          </Badge>{" "}
        </>
      ) : null}
      {/* Un refus a renvoyé l'étape à faire : sans ce badge, elle se relit comme une
          étape que personne n'a jamais pointée. « Déclaration » et non « preuve » :
          le refus l'a remise à `PENDING`, si bien que plus rien ici ne dit si ce qui a
          été refusé était un geste donné pour fait ou la raison de l'avoir écarté. */}
      {validation === "REFUSED" ? (
        <>
          <Badge severity="error" small noIcon>
            déclaration refusée
          </Badge>{" "}
        </>
      ) : null}
      {etape.riskLevel === "HIGH" ? (
        <Badge severity="error" small noIcon>
          risque élevé
        </Badge>
      ) : null}
      {voie ? <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>{voie}</p> : null}
      {aide.runbook ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>{aide.runbook}</p>
      ) : null}
      {aide.deeplink ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <a
            href={aide.deeplink}
            target="_blank"
            rel="noreferrer"
            title="Ouvrir la page concernée, nouvelle fenêtre"
          >
            Ouvrir la page concernée
          </a>
        </p>
      ) : null}
      {aide.doneWhen ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <em>C'est fait quand : {aide.doneWhen}</em>
        </p>
      ) : null}
      {etape.grantExpiresAt ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Accès accordé jusqu'au {dateLocale.format(etape.grantExpiresAt)}.</strong> Le
          terme est absolu et compté depuis le calcul de ce plan : une prolongation de mission ne le
          repousse pas, et reconduire cet accès demandera un nouveau plan, donc une nouvelle
          décision tracée.
        </p>
      ) : null}
      {saisie ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Valeur demandée : {saisie.libelle}
          {saisie.obligatoire ? " (sans elle, l'étape ne peut pas être donnée pour faite)" : ""}.
        </p>
      ) : null}
      {etape.reponse ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Valeur saisie :</strong> {etape.reponse}
        </p>
      ) : null}
      {etape.lastError ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Note :</strong> {etape.lastError}
        </p>
      ) : null}
      {etape.executedAt ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Pointée le {dateLocale.format(etape.executedAt)}
          {etape.declaredBy ? ` par ${etape.declaredBy}` : ""}.
        </p>
      ) : null}
      {validation === "AWAITING" ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Cette déclaration attend le regard {controleur ?? "de quelqu'un d'autre"}. Tant qu'il n'a
          pas eu lieu, l'étape reste à solder et le dossier ne se clôt pas.
        </p>
      ) : null}
      {validation === "REFUSED" ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          <strong>Déclaration refusée</strong>
          {etape.validatedBy ? ` par ${etape.validatedBy}` : ""}
          {etape.validatedAt ? ` le ${dateLocale.format(etape.validatedAt)}` : ""}
          {etape.validationNote ? ` : ${etape.validationNote}` : ""}. L'étape est de nouveau à
          faire.
        </p>
      ) : null}
      {validation === "ACCEPTED" && etape.validatedBy ? (
        <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
          Validée par {etape.validatedBy}
          {etape.validatedAt ? ` le ${dateLocale.format(etape.validatedAt)}` : ""}.
        </p>
      ) : null}
      {pointable ? (
        <Pointage
          etapeId={etape.id}
          // Une déclaration en attente de contrôle a bel et bien eu lieu : le bouton
          // corrige ce qui a été dit, il n'enregistre pas une première parole.
          faite={soldee || validation === "AWAITING"}
          sens={sens}
          saisie={saisie}
          reponse={etape.reponse}
          possible={pointage.possible}
          raison={pointage.possible ? null : pointage.raison}
        />
      ) : null}
      {pointable && controle ? (
        <Validation
          etapeId={etape.id}
          ecart={etape.state === "SKIPPED"}
          possible={controle.possible}
          raison={controle.possible ? null : controle.raison}
        />
      ) : null}
    </li>
  );
}

export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const operateur = await requireOperateur();
  const { id } = await params;
  const { deja } = await searchParams;

  const dossier = await prisma.accessCase.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      state: true,
      cancelledReason: true,
      effectiveDate: true,
      firstSignalAt: true,
      profileKey: true,
      person: { select: { id: true, username: true, fullname: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          state: true,
          planDigest: true,
          expiresAt: true,
          createdAt: true,
          createdBy: true,
          confirmedBy: true,
          confirmedAt: true,
          steps: {
            // Le rang de lecture figé à la création, et non plus un tri alphabétique :
            // l'ordre d'un plan est une décision de l'assemblage, que l'écran restitue.
            // Départagé quand même : les étapes figées avant que ce rang n'existe valent
            // toutes zéro, et sans second critère leur ordre changerait à chaque pointage.
            orderBy: [{ ordre: "asc" }, { systemKey: "asc" }, { label: "asc" }, { id: "asc" }],
            select: {
              id: true,
              ordre: true,
              systemKey: true,
              tier: true,
              label: true,
              capability: true,
              idempotencyKey: true,
              riskLevel: true,
              state: true,
              validation: true,
              expectedActor: true,
              validationBy: true,
              declaredBy: true,
              validatedBy: true,
              validatedAt: true,
              validationNote: true,
              manual: true,
              template: true,
              reponse: true,
              lastError: true,
              executedAt: true,
              grantExpiresAt: true,
            },
          },
        },
      },
    },
  });

  if (!dossier) {
    notFound();
  }

  const mots = LIBELLE_DOSSIER[dossier.kind];
  const maintenant = new Date();
  const plan = dossier.plans[0];
  const annule = dossier.state === "CANCELLED";

  // Recalculé à l'affichage et comparé à ce qui est figé : c'est la seule façon de
  // savoir qu'une collecte est passée depuis. Le plan affiché reste celui qui a été
  // enregistré, jamais le recalcul.
  //
  // Sauf sur un dossier annulé : rien ne s'y compare plus, et sonder les connecteurs
  // pour afficher une dérive sans issue serait un appel sortant pour rien.
  //
  // Le profil du dossier lui est passé, et c'est celui que le dossier porte et non
  // celui qu'un formulaire redirait : sans lui, le recalcul d'une arrivée ne porterait
  // aucune de ses étapes d'octroi, et le plan se déclarerait obsolète tout seul.
  const profil = profilDeLaPolitique(dossier.profileKey);
  const actuel = annule
    ? null
    : await calculerPlan(
        dossier.kind,
        dossier.person.id,
        dossier.person.username,
        maintenant,
        profil,
      );

  const etat = plan && actuel ? peremptionDuPlan(plan, actuel.empreinte, maintenant) : null;
  const clos = dossier.state === "DONE";
  const brouillon = !annule && plan?.state === "DRAFT";
  const remplace = plan?.state === "EXPIRED" || plan?.state === "STALE";
  // Un plan dont quelqu'un répond : la dérive le concerne aussi, faute de quoi elle
  // ne se disait qu'aux brouillons et un plan confirmé restait muet sur ce que la
  // collecte a démenti depuis. Pas sur un dossier clos en revanche : ce que la
  // collecte y dément, c'est le plan mené à son terme, et l'annoncer en avertissement
  // donnerait le résultat recherché pour un incident.
  const confirme =
    plan !== undefined && !annule && !clos && !brouillon && !remplace && plan.state !== "CANCELLED";
  // Adossé à la garde plutôt que recopié : l'écran connaissait la règle de son côté,
  // et c'est cet écart qui a muré le dossier le jour où une étape a échoué.
  const pointable = plan !== undefined && !annule && planPointable(plan.state).possible;
  const restantes =
    plan?.steps.filter(
      (etape) =>
        !estSoldee({
          etat: etape.state as EtatEtape,
          validation: etape.validation as EtatValidation,
        }),
    ).length ?? 0;
  // Comptées à part parce qu'elles ne se lisent pas comme les autres restantes : rien
  // n'y reste à faire, quelqu'un a déjà déclaré quelque chose, et c'est le contrôle
  // qui manque. Sans ce décompte, l'écran dirait « à faire » d'une étape déclarée.
  // Ce qui a été déclaré n'est pas lu ici : une étape écartée attend ce regard comme
  // une étape donnée pour faite, et le décompte ne les distingue pas.
  const enAttenteDeControle =
    plan?.steps.filter((etape) => etape.validation === "AWAITING").length ?? 0;

  // Le porteur passe avant l'opérateur : sans cette priorité, quelqu'un validerait ses
  // propres cases sur son propre dossier.
  const valideur: Valideur = {
    username: operateur.username,
    role: roleSurDossier(operateur.username, { porteur: dossier.person.username }, true),
  };

  // Ce que le rôle tait : `requireOperateur` a muré la page avant, donc qui la lit est
  // de l'équipe transverse même quand le dossier affiché est le sien. Le pointage s'y
  // adosse, la validation non.
  const declarant: Declarant = { role: valideur.role, operateur: true };

  // Sur les étapes figées, qui sont celles dont l'écran parle. La boucle, elle,
  // recalcule : d'où l'écart que `voieLisible` dit ligne à ligne.
  const voies = await voiesDuJour(plan?.steps ?? []);

  // Rapprochées sur la clé d'idempotence, comme la boucle d'exécution le fait :
  // l'enregistrement la suffixe par l'identifiant du plan, ce qui la rend unique en
  // base sans changer ce qu'elle désigne. Une clé qui ne se retrouve pas laisse l'écran
  // muet sur la voie du jour plutôt que de la deviner.
  const tiersDuJour = new Map<string, string>(
    plan
      ? (actuel?.etapes ?? []).map(({ etape }) => [
          `${etape.idempotencyKey}:${plan.id}`,
          etape.tier,
        ])
      : [],
  );

  const executable = plan !== undefined && !annule && peutExecuter(plan.state).possible;
  const simulation = !env.ACTIONS_ENABLED;

  // Mesurée sur le plan recalculé, comme la boucle le fait, et sur toutes ses étapes et
  // non sur les seules restantes : la masse est une propriété du plan, et la compter au
  // fil des reprises laisserait un plan anormalement gros partir en deux fois.
  const masse =
    executable && actuel
      ? masseDuPlan(
          actuel.etapes.map(({ etape }) => etape),
          policy().thresholds.maxPlanSteps,
        )
      : null;

  // Hors de l'empreinte, donc invisible à la confrontation qui garde l'exécution :
  // l'échéance se lit avant le lancement ou ne se lit pas du tout.
  const echeances = (plan?.steps ?? []).flatMap((etape) =>
    etape.grantExpiresAt ? [{ id: etape.id, label: etape.label, terme: etape.grantExpiresAt }] : [],
  );

  const lignes: LigneDEtape[] = (plan?.steps ?? []).map((etape) => ({
    etape,
    origine: origineFigee(etape.template),
  }));
  const groupes = grouperParOrigine(lignes);

  // Les modèles ne portent que des ghid, sans clé étrangère vers les startups :
  // afficher le ghid brut au-dessus d'une liste d'étapes, ou sous une étape écartée,
  // ferait chercher qui demande quoi. Les deux listes puisent au même endroit, sans
  // quoi la même startup serait nommée ici et réduite à son ghid là. Un ghid qu'aucune
  // startup ne porte reste affiché tel quel, faute de mieux.
  const proprietaires = [
    ...new Set([
      ...lignes.flatMap(({ origine }) =>
        origine && origine.owner !== CLE_INCUBATEUR ? [origine.owner] : [],
      ),
      ...(actuel?.ecartees ?? []).flatMap(({ origine }) =>
        origine.startsWith(PREFIXE_STARTUP) ? [origine.slice(PREFIXE_STARTUP.length)] : [],
      ),
    ]),
  ];
  const nomsDeStartup = new Map(
    proprietaires.length === 0
      ? []
      : (
          await prisma.startup.findMany({
            where: { ghid: { in: proprietaires } },
            select: { ghid: true, name: true },
          })
        ).map((startup) => [startup.ghid, startup.name] as const),
  );

  // Comparé au calcul du jour, et seulement pour le dire : un plan figé ne se
  // rattrape pas tout seul, et un rattachement postérieur ne doit pas le changer.
  const ecart =
    plan && actuel
      ? ecartDeModele(
          plan.steps,
          actuel.etapes.map(({ etape }) => etape),
        )
      : null;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1 className={fr.cx("fr-mb-1v")}>
        {mots.nom} de {dossier.person.fullname}{" "}
        {clos ? (
          <Badge severity="success" noIcon>
            dossier clos
          </Badge>
        ) : null}
        {annule ? (
          <Badge severity="info" noIcon>
            {mots.annule}
          </Badge>
        ) : null}
      </h1>
      <p className={fr.cx("fr-text--sm")}>
        <Link href={`/personnes/${dossier.person.username}`}>{dossier.person.username}</Link>
        {", ouvert le "}
        {dateLocale.format(dossier.firstSignalAt)}
        {dossier.effectiveDate ? `, fin de mission au ${dateFr.format(dossier.effectiveDate)}` : ""}
        {dossier.profileKey
          ? `, profil « ${profil?.label ?? dossier.profileKey} »${profil ? "" : ", que la politique ne déclare plus"}`
          : ""}
      </p>

      {deja ? (
        <Alert severity="info" className={fr.cx("fr-mt-3w")} small description={mots.dejaOuvert} />
      ) : null}

      {/* Rien à cocher sur un dossier annulé ou clos : la dire quand même ferait
          promettre un geste que l'écran n'offre plus. */}
      {annule || clos ? null : (
        <Alert severity="info" className={fr.cx("fr-my-3w")} small description={mots.cocher} />
      )}

      {etat?.obsolete && (brouillon || confirme) ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan ne décrit plus la situation"
          description={
            brouillon ? (
              <>
                <p className={fr.cx("fr-mb-1w")}>{mots.derive}</p>
                {plan ? <BoutonRecalculer planId={plan.id} /> : null}
              </>
            ) : (
              /* Sans bouton de recalcul : `peutRecalculer` refuse un plan engagé, à
                 raison, et un bouton qui répond toujours non serait pire que pas de
                 bouton du tout. */
              <>
                <p className={fr.cx("fr-mb-1w")}>
                  Ce plan reste celui qui a été confirmé et ne se recalcule plus : ses étapes valent
                  telles quelles. Ce qui a changé depuis se traite hors de lui, et la collecte
                  suivante le redira.
                </p>
                {ecart && ecart.manquantes.length > 0 ? (
                  <>
                    <p className={fr.cx("fr-mb-1v")}>
                      Le rattachement de cette personne a changé depuis ce plan :{" "}
                      {ecart.manquantes.length} étape
                      {ecart.manquantes.length > 1
                        ? "s déclarées n'y figurent"
                        : " déclarée n'y figure"}{" "}
                      pas.
                    </p>
                    <ul className={fr.cx("fr-mb-1w")}>
                      {ecart.manquantes.map((etape) => (
                        <li key={etape.cle}>{etape.titre}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {ecart && ecart.retirees.length > 0 ? (
                  <p className={fr.cx("fr-mb-0")}>
                    {ecart.retirees.length} étape
                    {ecart.retirees.length > 1 ? "s de ce plan ne sont" : " de ce plan n'est"} plus
                    déclarée{ecart.retirees.length > 1 ? "s" : ""} par aucun modèle :{" "}
                    {ecart.retirees.map(({ titre }) => titre).join(", ")}. Elle
                    {ecart.retirees.length > 1 ? "s restent" : " reste"} à faire, ce plan étant
                    confirmé.
                  </p>
                ) : null}
              </>
            )
          }
        />
      ) : null}

      {etat?.perime && (brouillon || confirme) ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan a dépassé sa date de validité"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Il valait jusqu'au {dateLocale.format(plan?.expiresAt ?? maintenant)}. Ce qu'il
                décrit a été constaté avant cette date.
              </p>
              {/* La date ne concerne plus le seul brouillon depuis que l'exécution la
                  regarde : un plan confirmé et périmé refuse de partir, et le découvrir
                  au clic serait une perte de temps. Mais un plan confirmé ne se
                  recalcule plus, d'où deux issues distinctes selon l'état. */}
              {brouillon && plan && !etat.obsolete ? (
                <BoutonRecalculer planId={plan.id} />
              ) : brouillon ? (
                <p className={fr.cx("fr-mb-0")}>
                  Le recalcul est proposé plus haut, avec la dérive qui le motive.
                </p>
              ) : (
                <p className={fr.cx("fr-mb-0")}>
                  Il ne partira pas et ne se recalcule plus : pointez à la main ce qui a été fait,
                  clôturez ce dossier, et rouvrez-en un pour repartir d'un plan à jour.
                </p>
              )}
            </>
          }
        />
      ) : null}

      {actuel && actuel.nonConfirmes.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Des comptes ne peuvent pas entrer dans ce plan"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                {actuel.nonConfirmes.join(", ")}. Ces comptes lui sont rattachés sur une simple
                ressemblance de nom, jamais sur une preuve. Couper sur cette base reviendrait à
                couper l'accès d'un homonyme, donc aucune étape ne les vise.
              </p>
              <p className={fr.cx("fr-mb-0")}>
                <Link href="/comptes-isoles">
                  Confirmer ou détacher ces comptes pour qu'ils entrent dans un plan
                </Link>
              </p>
            </>
          }
        />
      ) : null}

      {actuel && actuel.refus.length > 0 ? (
        <Alert
          severity="error"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan ne peut pas être construit"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Un accès du profil appliqué ne s'applique pas en l'état. Rien ne s'enregistre à
                moitié : tant que ces lignes ne sont pas corrigées, aucune étape d'octroi ne sort,
                et le recalcul refusera de la même façon.
              </p>
              <ul className={fr.cx("fr-mb-1w")}>
                {actuel.refus.map((refus) => (
                  <li key={`${refus.profil}:${refus.acces}:${refus.systeme}:${refus.motif}`}>
                    Profil « {refus.profil} », accès n°{refus.acces + 1} sur {refus.systeme} :{" "}
                    {refus.motif}
                  </li>
                ))}
              </ul>
              <p className={fr.cx("fr-mb-0")}>
                Cela se corrige dans le fichier de politique, sous <code>profiles</code>, lu une
                seule fois au démarrage : le serveur doit redémarrer pour que la correction se voie
                ici.
              </p>
            </>
          }
        />
      ) : null}

      {actuel && actuel.sansConnecteur.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Des comptes ne sont couverts par aucun connecteur"
          description={`${actuel.sansConnecteur.join(", ")}. Ces accès existent, mais rien ici ne sait quoi en faire : ils sont à traiter hors de l'outil.`}
        />
      ) : null}

      {annule ? (
        <Alert
          severity="info"
          className={fr.cx("fr-mb-3w")}
          title={mots.annulationTitre}
          description={
            dossier.cancelledReason
              ? `${dossier.cancelledReason.replace(/[.!?]?$/, ".")} ${mots.annulationConsequence}`
              : mots.annulationConsequence
          }
        />
      ) : null}

      <h2 className={fr.cx("fr-h4")}>
        {annule
          ? "Ce qui n'aura pas lieu"
          : remplace
            ? mots.propose
            : brouillon
              ? mots.aFaire
              : mots.restant}
      </h2>

      {!plan ? (
        <p>
          Aucun plan n'a été enregistré pour ce dossier : son calcul n'a pas abouti.
          {annule || clos ? "" : mots.sansPlanIssue}
        </p>
      ) : plan.steps.length === 0 ? (
        <p>{mots.planVide}</p>
      ) : (
        <>
          {groupes.map((groupe) => (
            <section key={`${groupe.proprietaire ?? "connecteur"}:${groupe.premier}`}>
              {/* Un plan qui ne réunit qu'une origine n'a rien à distinguer : le titre
                  y répéterait ce que celui de la liste dit déjà. */}
              {groupes.length > 1 ? (
                <h3 className={fr.cx("fr-h6", "fr-mt-3w", "fr-mb-0")}>
                  {titreDuGroupe(groupe.proprietaire, nomsDeStartup)}
                </h3>
              ) : null}
              <ol className={fr.cx("fr-mt-2w")} start={groupe.premier + 1}>
                {groupe.lignes.map(({ etape, origine }) => (
                  <Etape
                    key={etape.id}
                    etape={etape}
                    saisie={origine?.saisie ?? null}
                    voie={voieLisible(
                      etape.tier,
                      tiersDuJour.get(etape.idempotencyKey),
                      voies.get(`${etape.systemKey}:${etape.capability}`),
                    )}
                    pointable={pointable}
                    etatPlan={plan.state as EtatPlan}
                    sens={dossier.kind}
                    declarant={declarant}
                    valideur={valideur}
                  />
                ))}
              </ol>
            </section>
          ))}

          {brouillon ? (
            <>
              <p className={fr.cx("fr-text--sm")}>
                Confirmer, c'est dire que vous répondez de cette liste. Elle ne bougera plus
                ensuite, et chaque étape pourra être pointée.
              </p>
              <BoutonConfirmer planId={plan.id} />
            </>
          ) : null}

          {/* Sur l'état du plan, et non sur un décompte d'étapes : un plan `EXECUTING`
              porte par construction au moins une étape en attente, si bien que la
              condition d'avant ne pouvait jamais être vraie et qu'aucun dossier ne
              se cloturait. */}
          {pointable && restantes > 0 ? (
            <p className={fr.cx("fr-text--sm")}>
              {restantes} étape{restantes > 1 ? "s" : ""} restante{restantes > 1 ? "s" : ""}. Le
              dossier se clôt quand il n'en reste aucune.
              {attenteDeControle(enAttenteDeControle, restantes)}
            </p>
          ) : null}

          {plan.state === "PARTIALLY_EXECUTED" ? (
            <Alert
              severity="warning"
              className={fr.cx("fr-mt-2w")}
              title={mots.echecTitre}
              description="Une étape au moins a échoué. Le dossier ne peut pas être clos tant qu'elle n'est pas reprise."
            />
          ) : null}
        </>
      )}

      {plan && masse ? (
        <section className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h5")}>
            {simulation ? "Lancer une simulation" : "Lancer l'exécution"}
          </h2>

          {/* Avant le bouton et non après : une simulation qui ressemble à une
              exécution réussie est un mensonge, et l'opérateur doit lire ce que son
              clic fera avant de le faire. */}
          {simulation ? (
            <Alert
              severity="info"
              className={fr.cx("fr-mb-2w")}
              small
              title="Rien ne partira"
              description="Les actions ne sont pas autorisées sur ce serveur : aucune écriture n'aura lieu sur les systèmes couverts, et ce bouton n'en fera aucune. Seul le précheck part, qui est une lecture. Une étape prête restera à faire, son état ne bougeant pas, parce que c'est le seul état honnête d'un geste qui n'a pas eu lieu ; le journal, lui, dira étape par étape ce qui aurait été appelé."
            />
          ) : (
            <Alert
              severity="warning"
              className={fr.cx("fr-mb-2w")}
              small
              title="Les actions sont autorisées"
              description="Ce bouton écrira réellement sur les systèmes couverts, étape par étape, dans l'ordre de la réversibilité décroissante : ce qui se défait le mieux part en premier, pour qu'une exécution interrompue laisse derrière elle ce qu'on sait le mieux reprendre."
            />
          )}

          <p className={fr.cx("fr-text--sm")}>
            Le précheck précède chaque étape, y compris celles à faire à la main : éviter d'envoyer
            quelqu'un faire ce qui est déjà fait en est le meilleur usage. Une étape qu'il trouve
            déjà en place est soldée sans le moindre appel. Une étape dont l'état constaté diffère
            de l'état attendu n'est jamais exécutée : un octroi n'est pas idempotent, et le refaire
            changerait le rôle en place au lieu de ne rien faire.
          </p>

          {echeances.length > 0 ? (
            <>
              <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                Ce plan pose des termes, et ils n'entrent pas dans l'empreinte qui garde son
                exécution : à lire avant de lancer, pas après.
              </p>
              <ul className={fr.cx("fr-text--sm")}>
                {echeances.map(({ id, label, terme }) => (
                  <li key={id}>
                    {label} : jusqu'au {dateLocale.format(terme)}.
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <p className={fr.cx("fr-text--sm")}>
            {masse.executables === 0
              ? "Aucune étape de ce plan n'a de voie que la boucle emprunte elle-même : le lancement s'arrêtera au précheck, ce qui reste utile."
              : `${masse.executables} étape${masse.executables > 1 ? "s" : ""} de ce plan ${masse.executables > 1 ? "portent" : "porte"} une voie que la boucle emprunte elle-même, pour un plafond de ${masse.seuil}.`}
          </p>

          <BoutonExecuter
            planId={plan.id}
            masse={masse}
            raisonDeMasse={refusDeMasse(masse, false)}
            simulation={simulation}
          />
        </section>
      ) : null}

      {actuel && actuel.ecartees.length > 0 ? (
        <section className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h5")}>Ce que le calcul n'a pas retenu</h2>
          <p className={fr.cx("fr-text--sm")}>
            Ces étapes ont été proposées puis écartées à l'assemblage du calcul du jour. Rien n'est
            écarté en silence : si l'une d'elles compte, elle est à traiter hors de ce plan.
          </p>
          <ul>
            {actuel.ecartees.map((ecartee) => (
              <li key={`${ecartee.origine}:${ecartee.etape.idempotencyKey}`}>
                {ecartee.etape.label}{" "}
                <Badge severity="info" small noIcon>
                  {ECART[ecartee.raison]}
                </Badge>{" "}
                <span className={fr.cx("fr-text--sm")}>
                  ({origineLisible(ecartee.origine, nomsDeStartup)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Hors du bloc des étapes, comme l'annulation : un plan qui n'en porte aucune
          est soldé par construction, et le bouton vivait dans une branche que ce
          cas-là n'atteint jamais. */}
      {plan && peutClore(dossier.kind, dossier.state, plan.state, plan.steps.length).possible ? (
        <BoutonClore dossierId={dossier.id} />
      ) : null}

      <BoutonAnnuler
        dossierId={dossier.id}
        sens={dossier.kind}
        etapes={plan?.steps.length ?? 0}
        annulable={peutAnnuler(dossier.state, plan?.state ?? null).possible}
      />

      {plan ? (
        <p className={fr.cx("fr-text--sm", "fr-mt-3w")}>
          Plan calculé le {dateLocale.format(plan.createdAt)} par {plan.createdBy}
          {plan.confirmedBy
            ? `, confirmé le ${dateLocale.format(plan.confirmedAt ?? maintenant)} par ${plan.confirmedBy}`
            : annule || remplace || etat?.perime
              ? ""
              : `, valable jusqu'au ${dateLocale.format(plan.expiresAt)}`}
          .
        </p>
      ) : null}
    </main>
  );
}

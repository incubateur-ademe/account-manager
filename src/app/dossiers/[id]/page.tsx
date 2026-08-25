import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  type EtatEtape,
  estSoldee,
  peutAnnuler,
  peutClore,
  peutPointer,
  type SensDossier,
} from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import {
  CLE_INCUBATEUR,
  ecartDeModele,
  type OrigineFigee,
  origineFigeeSchema,
  type SaisieAttendue,
} from "@/core/modele-plan";
import { type OrigineEtape, peremptionDuPlan, type RaisonDEcart } from "@/core/plan";
import { prisma } from "@/lib/db";
import { calculerPlan } from "@/lib/dossier";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";
import {
  BoutonAnnuler,
  BoutonClore,
  BoutonConfirmer,
  BoutonRecalculer,
  Pointage,
} from "./Pointage";

export const dynamic = "force-dynamic";

/**
 * Sans fuseau, donc dans celui du lecteur, et c'est ce qu'il faut pour un horodatage :
 * un plan confirmé à minuit et demi s'est bien confirmé ce jour-là pour qui l'a fait.
 * Une échéance, elle, est une date sans heure côté base, que ce formateur reculerait
 * d'un jour la moitié de l'année : elle passe par `dateFr`, en UTC.
 */
const dateLocale = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

const TIER: Record<string, { libelle: string; severite: "success" | "warning" | "info" }> = {
  auto: { libelle: "automatique", severite: "success" },
  assisted: { libelle: "assisté", severite: "info" },
  manual: { libelle: "à faire à la main", severite: "warning" },
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

const ECART: Record<RaisonDEcart, string> = {
  doublon: "déjà demandée plus haut",
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
  tier: string;
  riskLevel: string;
  state: string;
  manual: unknown;
  reponse: string | null;
  lastError: string | null;
  executedAt: Date | null;
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

/** Une étape figée, telle qu'elle se lit et telle qu'elle se pointe. */
function Etape({
  etape,
  saisie,
  pointable,
  sens,
}: {
  etape: EtapeFigee;
  saisie: SaisieAttendue | null;
  pointable: boolean;
  sens: SensDossier;
}) {
  const aide = marche(etape.manual);
  const tier = TIER[etape.tier] ?? { libelle: etape.tier, severite: "info" as const };
  const pointee = ETAPE[etape.state as EtatEtape];
  const soldee = estSoldee(etape.state as EtatEtape);

  return (
    <li className={fr.cx("fr-mb-4w")}>
      <strong>{etape.label}</strong>{" "}
      <Badge severity={pointee.severite} small noIcon>
        {pointee.libelle}
      </Badge>{" "}
      <Badge severity={tier.severite} small noIcon>
        {tier.libelle}
      </Badge>{" "}
      {etape.riskLevel === "HIGH" ? (
        <Badge severity="error" small noIcon>
          risque élevé
        </Badge>
      ) : null}
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
          Pointée le {dateLocale.format(etape.executedAt)}.
        </p>
      ) : null}
      {pointable ? (
        <Pointage
          etapeId={etape.id}
          faite={soldee}
          sens={sens}
          saisie={saisie}
          reponse={etape.reponse}
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
  await requireOperateur();
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
              riskLevel: true,
              state: true,
              manual: true,
              template: true,
              reponse: true,
              lastError: true,
              executedAt: true,
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
  const actuel = annule
    ? null
    : await calculerPlan(dossier.kind, dossier.person.id, dossier.person.username, maintenant);

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
  const pointable = plan !== undefined && !annule && peutPointer(plan.state).possible;
  const restantes = plan?.steps.filter((etape) => !estSoldee(etape.state as EtatEtape)).length ?? 0;

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

      {etat?.perime && brouillon ? (
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
              {plan && !etat.obsolete ? <BoutonRecalculer planId={plan.id} /> : null}
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
                    pointable={pointable}
                    sens={dossier.kind}
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
              {restantes} étape{restantes > 1 ? "s" : ""} en attente. Le dossier se clôt quand il
              n'en reste aucune.
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

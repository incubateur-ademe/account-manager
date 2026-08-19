import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { libelleAppartenance, surchargeSuperflue } from "@/core/appartenance";
import { fraicheurDe } from "@/core/collecte";
import type { ConstatKind } from "@/core/constat";
import { ficheEditable, RAISON_NON_EDITABLE, renommable } from "@/core/fiche-manuelle";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { echeanceEffective, enCours, startupsEffectives } from "@/core/rattachement-startup";
import { LIBELLE_STATUT, type Statut, statutDePersonne } from "@/core/statut";
import type { MatchMethod, PersonSource } from "@/generated/prisma/enums";
import { appartenanceDeLaLigne } from "@/lib/appartenance";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { Appartenance } from "./Appartenance";
import { BoutonDepart } from "./BoutonDepart";
import { Detacher } from "./Detacher";
import { FicheEditable } from "./FicheEditable";
import { Identifiant } from "./Identifiant";
import { RattacherStartup } from "./RattacherStartup";
import { RetirerRattachement } from "./RetirerRattachement";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

const SEVERITE_STATUT: Record<Statut, "success" | "info" | "warning" | "error" | "new"> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "new",
  ACTIF: "success",
  SANS_ECHEANCE: "info",
  ANCIEN: "info",
};

const SEVERITE_CONSTAT = { HIGH: "error", MEDIUM: "warning", LOW: "info" } as const;
const LIBELLE_SEVERITE = { HIGH: "Haute", MEDIUM: "Moyenne", LOW: "Basse" } as const;

// Exhaustives et non `Record<string, ...>` : sous @tsconfig/strictest, une clé
// d'union littérale n'est pas une signature d'index, si bien qu'ajouter une valeur
// à l'enum casse le typecheck au lieu de tomber dans un repli qui afficherait la
// valeur brute.
const SOURCE: Record<PersonSource, string> = {
  BETA: "Espace-membre beta.gouv",
  LOCAL: "Saisie locale",
  SERVICE: "Compte de service",
};

const RATTACHEMENT_IDENTITE: Record<MatchMethod, { libelle: string; sur: boolean }> = {
  DECLARED: { libelle: "Déclaré", sur: true },
  GITHUB_LOGIN: { libelle: "Login GitHub", sur: true },
  EMAIL_EXACT: { libelle: "Adresse exacte", sur: true },
  HEURISTIC: { libelle: "Heuristique", sur: false },
  NONE: { libelle: "Aucun", sur: false },
};

const LIBELLE_PHASE: Record<string, string> = {
  investigation: "Investigation",
  construction: "Construction",
  acceleration: "Accélération",
  transfer: "Transfert",
  transfere: "Transférée",
  success: "Pérennisée",
  alumni: "Alumni",
  abandon: "Abandonnée",
  "abandon-investigation": "Abandonnée en investigation",
};

/**
 * L'ingestion du périmètre passe par ce fournisseur : ses runs disent qu'on connaît
 * les personnes, jamais qu'on a lu un système cible. Les compter comme une collecte
 * de comptes ferait passer une absence d'observation pour une absence d'accès.
 */
const FOURNISSEUR_PERIMETRE = "espace-membre";

function expliquerStatut(
  statut: Statut,
  { graceDays, soonDays, staleDays }: { graceDays: number; soonDays: number; staleDays: number },
): string {
  switch (statut) {
    case "SORTI":
      return "Elle a quitté le référentiel de l'incubateur et rien n'indique que ses accès ont été traités.";
    case "A_TRAITER":
      return `Son échéance est dépassée au-delà du délai de grâce de ${graceDays} jours : il y a quelque chose à faire.`;
    case "EN_SURSIS":
      return `Son échéance est dépassée, mais le délai de grâce de ${graceDays} jours court encore : un renouvellement signé en retard est encore possible.`;
    case "BIENTOT":
      return `Son échéance tombe dans les ${soonDays} prochains jours.`;
    case "ACTIF":
      return "Son échéance est lointaine, il n'y a rien à faire.";
    case "SANS_ECHEANCE":
      return "Aucune date de fin de mission n'est connue : rien ne déclenchera de coupure pour elle.";
    case "ANCIEN":
      return `Son échéance est dépassée depuis plus de ${staleDays} jours : cela relève de l'historique, pas d'une action.`;
  }
}

function Champ({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
      <dt className={fr.cx("fr-text--sm", "fr-mb-0")}>{libelle}</dt>
      <dd className={fr.cx("fr-text--bold", "fr-ml-0")}>{children}</dd>
    </div>
  );
}

function Absent({ mention = "non renseigné" }: { mention?: string }) {
  return <span className={fr.cx("fr-hint-text")}>{mention}</span>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const personne = await prisma.person.findUnique({
    where: { username },
    select: { fullname: true },
  });

  return { title: personne ? `${personne.fullname} (${username})` : "Personne introuvable" };
}

export default async function FichePersonnePage({ params }: Props) {
  await requireOperateur();

  const { username } = await params;
  const { thresholds, startups: reglesStartups, scope } = policy();
  const today = new Date();

  const [personne, collectes, dernierePasse] = await Promise.all([
    prisma.person.findUnique({
      where: { username },
      select: {
        username: true,
        fullname: true,
        primaryEmail: true,
        communicationEmail: true,
        githubLogin: true,
        missionEnd: true,
        source: true,
        usernameFabricated: true,
        attachment: true,
        startups: true,
        scopeOverride: {
          select: { decision: true, reason: true, createdBy: true, createdAt: true },
        },
        startupAssignments: {
          orderBy: [{ endedAt: "asc" }, { until: "desc" }],
          select: {
            id: true,
            startupGhid: true,
            until: true,
            reason: true,
            createdBy: true,
            createdAt: true,
            endedAt: true,
            endedBy: true,
          },
        },
        firstSeenAt: true,
        lastSeenAt: true,
        vanishedAt: true,
        identities: {
          orderBy: [{ provider: "asc" }, { handle: "asc" }],
          select: {
            id: true,
            provider: true,
            handle: true,
            matchMethod: true,
            lastSeenAt: true,
            vanishedAt: true,
          },
        },
        findings: {
          orderBy: { openedAt: "desc" },
          select: {
            id: true,
            kind: true,
            severity: true,
            openedAt: true,
            closedAt: true,
            closeReason: true,
          },
        },
      },
    }),
    prisma.syncRun.findMany({
      where: { capability: "list", status: { in: ["OK", "PARTIAL"] } },
      distinct: ["provider"],
      select: { provider: true },
    }),
    prisma.syncRun.findFirst({
      where: { provider: FOURNISSEUR_PERIMETRE },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  if (!personne) {
    notFound();
  }

  // Dix-neuf startups : une lecture complète coûte moins qu'une requête par
  // rattachement, et sert à la fois le tableau et la liste de saisie.
  const startupsConnues = await prisma.startup.findMany({
    select: { ghid: true, name: true, currentPhase: true, phaseStart: true, vanishedAt: true },
    orderBy: { name: "asc" },
  });

  const parGhid = new Map(startupsConnues.map((startup) => [startup.ghid, startup]));
  const phasesTerminales = new Set(reglesStartups.terminalPhases);

  const rattachementsEnCours = personne.startupAssignments.filter((rattachement) =>
    enCours(rattachement, today),
  );
  const rattachementsClos = personne.startupAssignments.filter(
    (rattachement) => !enCours(rattachement, today),
  );
  // Deux rattachements ouverts sur la même startup restent possibles, Prisma ne
  // sachant pas exprimer d'index unique partiel. On retient le plus lointain, celui
  // que retient aussi l'échéance effective : afficher l'autre ferait dire à la ligne
  // le contraire de la date en haut de page.
  const manuelParGhid = new Map<string, (typeof rattachementsEnCours)[number]>();
  for (const rattachement of rattachementsEnCours) {
    const connu = manuelParGhid.get(rattachement.startupGhid);
    if (!connu || rattachement.until > connu.until) {
      manuelParGhid.set(rattachement.startupGhid, rattachement);
    }
  }

  const lignesStartups = startupsEffectives(personne.startups, rattachementsEnCours, today)
    .map((ghid) => {
      const collectee = parGhid.get(ghid);
      const phase = collectee?.currentPhase ?? null;
      return {
        ghid,
        nom: collectee?.name ?? null,
        phase,
        phaseStart: collectee?.phaseStart ?? null,
        terminale: phase !== null && phasesTerminales.has(phase),
        connue: phase !== null,
        collectee: personne.startups.includes(ghid),
        manuel: manuelParGhid.get(ghid) ?? null,
      };
    })
    .sort((a, b) => (a.nom ?? a.ghid).localeCompare(b.nom ?? b.ghid, "fr"));

  const inconnues = lignesStartups.filter((ligne) => !ligne.connue).length;
  const toutesTerminees =
    lignesStartups.length > 0 && lignesStartups.every((ligne) => ligne.terminale);

  const echeance = echeanceEffective(personne.missionEnd, rattachementsEnCours, today);
  const prolongee =
    echeance !== null &&
    (personne.missionEnd === null || echeance.getTime() !== personne.missionEnd.getTime());

  const statut = statutDePersonne(
    { missionEnd: echeance, vanishedAt: personne.vanishedAt },
    today,
    {
      graceDays: thresholds.graceDays,
      soonDays: thresholds.soonDays,
      staleDays: thresholds.staleDays,
    },
  );

  const fraicheur = fraicheurDe(
    dernierePasse?.startedAt ?? null,
    today,
    thresholds.collectStaleHours,
  );
  const appartenance = appartenanceDeLaLigne(
    personne,
    new Map(startupsConnues.map((startup) => [startup.ghid, startup.currentPhase])),
    reglesStartups.terminalPhases,
    today,
  );
  const titre = libelleAppartenance(appartenance);
  const declaresLocaux = scope.local.map((entree) => entree.username);
  const editabilite = ficheEditable(personne, declaresLocaux);
  const ouverts = personne.findings.filter((constat) => constat.closedAt === null);
  const fermes = personne.findings.filter((constat) => constat.closedAt !== null);
  const systemesCollectes = collectes
    .map((collecte) => collecte.provider)
    .filter((provider) => provider !== FOURNISSEUR_PERIMETRE)
    .sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel={personne.fullname}
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Personnes suivies", linkProps: { href: "/personnes" } }]}
      />

      <h1 className={fr.cx("fr-mb-1v")}>{personne.fullname}</h1>
      <p className={fr.cx("fr-text--sm", "fr-mb-2v")}>{personne.username}</p>

      <Badge severity={SEVERITE_STATUT[statut]} noIcon>
        {LIBELLE_STATUT[statut]}
      </Badge>
      <p className={fr.cx("fr-mt-2v")}>{expliquerStatut(statut, thresholds)}</p>

      {/* C'est sur cette page qu'on décide de couper un accès : elle doit dire quand
          ce qu'elle affiche a cessé d'être frais. */}
      {fraicheur.perimee ? (
        <Alert
          severity="warning"
          small
          className={fr.cx("fr-mt-2w")}
          description={
            fraicheur.heures === null
              ? "Aucune collecte n'a jamais eu lieu : cette fiche ne reflète aucune observation."
              : `Dernière collecte il y a ${fraicheur.heures} heures. Sa situation a pu changer depuis.`
          }
        />
      ) : null}

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Situation</h2>

        <dl className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
          <Champ libelle="Échéance">
            {echeance ? dateFr.format(echeance) : <Absent mention="aucune date de fin connue" />}
          </Champ>
          <Champ libelle="Appartenance">{titre.libelle}</Champ>
          <Champ libelle="Source">{SOURCE[personne.source]}</Champ>
          <Champ libelle="Adresse principale">
            {personne.primaryEmail ? (
              <a className={fr.cx("fr-link")} href={`mailto:${personne.primaryEmail}`}>
                {personne.primaryEmail}
              </a>
            ) : (
              <Absent />
            )}
          </Champ>
          <Champ libelle="Adresse de communication">
            {personne.communicationEmail ? (
              <a className={fr.cx("fr-link")} href={`mailto:${personne.communicationEmail}`}>
                {personne.communicationEmail}
              </a>
            ) : (
              <Absent />
            )}
          </Champ>
          <Champ libelle="Compte GitHub">
            {personne.githubLogin ? (
              <a
                className={fr.cx("fr-link")}
                href={`https://github.com/${personne.githubLogin}`}
                target="_blank"
                rel="noreferrer"
              >
                {personne.githubLogin}
              </a>
            ) : (
              <Absent />
            )}
          </Champ>
        </dl>

        <p className={fr.cx("fr-text--sm")}>{titre.precision}</p>

        {/* Une date affichée sans son motif serait une troisième vérité, entre ce que
            dit l'amont et ce qu'un opérateur a décidé. */}
        {prolongee ? (
          <p className={fr.cx("fr-text--sm")}>
            Sa fin de mission connue est{" "}
            {personne.missionEnd ? `le ${dateFr.format(personne.missionEnd)}` : "inexistante"} :
            l'échéance affichée vient d'un rattachement manuel à une startup.
          </p>
        ) : null}

        {/* Ce que l'outil existe pour éviter, c'est la recopie d'un identifiant vers
            les consoles tierces : autant que chaque fiche y mène directement. */}
        <p className={fr.cx("fr-mt-2w")}>
          <a
            className={fr.cx("fr-link", "fr-mr-3w")}
            href={`${env.ESPACE_MEMBRE_URL}/community/${encodeURIComponent(personne.username)}`}
            target="_blank"
            rel="noreferrer"
          >
            Fiche espace-membre
          </a>
          <Link
            className={fr.cx("fr-link")}
            href={`/journal?personne=${encodeURIComponent(personne.username)}`}
          >
            Historique de cette personne
          </Link>
        </p>
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Appartenance à l'incubateur</h2>

        {appartenance.surcharge ? (
          <Alert
            className={fr.cx("fr-mb-2w")}
            severity={surchargeSuperflue(appartenance) ? "info" : "warning"}
            title={
              appartenance.surcharge.sens === "EXCLUDE"
                ? "Hors incubateur, forcé"
                : "Dans l'incubateur, forcé"
            }
            description={
              <>
                <p className={fr.cx("fr-mb-1w")}>
                  Décidée par {appartenance.surcharge.par} le{" "}
                  {dateFr.format(appartenance.surcharge.depuis)} : « {appartenance.surcharge.raison}{" "}
                  ».
                </p>
                <p className={fr.cx("fr-mb-1w")}>
                  {surchargeSuperflue(appartenance)
                    ? "La collecte dit désormais la même chose : cette décision est devenue superflue et peut être retirée. Elle ne se retire pas d'elle-même, une décision nominative ne s'annule pas par une collecte anonyme."
                    : "Elle dit l'appartenance et n'ordonne rien : aucun accès n'est coupé, ses comptes continuent d'être examinés, et un départ reste à instruire par un dossier."}
                </p>

                {/* Deux autorités qui se contredisent, et une seule visible ici. Sans
                    cette phrase, un opérateur croirait avoir sorti quelqu'un que la
                    politique continue de réclamer chaque nuit. */}
                {appartenance.surcharge.sens === "EXCLUDE" &&
                (appartenance.sansSurcharge === "EQUIPE" ||
                  appartenance.sansSurcharge === "EQUIPE_ET_STARTUP") ? (
                  <p className={fr.cx("fr-mb-0")}>
                    L'espace-membre la rattache pourtant par une équipe, et la collecte le réécrira
                    à chaque passage. Pour que la sortie soit portée des deux côtés, il reste à la
                    retirer de <code>scope.transverse</code> dans la politique.
                  </p>
                ) : null}
              </>
            }
          />
        ) : null}

        <Appartenance
          username={personne.username}
          surcharge={
            appartenance.surcharge
              ? {
                  sens: appartenance.surcharge.sens,
                  par: appartenance.surcharge.par,
                  depuis: appartenance.surcharge.depuis.toISOString().slice(0, 10),
                  raison: appartenance.surcharge.raison,
                }
              : null
          }
        />
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Corriger la fiche</h2>

        {editabilite.editable ? (
          <>
            <FicheEditable fiche={personne} />
            {renommable(personne, declaresLocaux) ? (
              <div className={fr.cx("fr-mt-4w")}>
                <Identifiant username={personne.username} />
              </div>
            ) : null}
          </>
        ) : (
          <p>{RAISON_NON_EDITABLE[editabilite.raison]}</p>
        )}
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Départ</h2>
        <p className={fr.cx("fr-text--sm")}>
          Prépare la liste de ce qu'il faut retirer, système par système, à partir des comptes
          observés. Rien n'est exécuté et rien n'est coupé.
        </p>
        <BoutonDepart username={personne.username} />
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Startups</h2>

        {lignesStartups.length === 0 ? (
          <>
            <p>Aucune startup ne lui est rattachée.</p>
            {appartenance.sansStartupConnue ? (
              <Alert
                severity="warning"
                small
                description="Son rattachement est pourtant censé passer par des startups. Une liste vide veut dire que la dernière collecte n'en a trouvé aucune. Elle reste dans l'incubateur : l'en sortir sur ce seul constat reviendrait à conclure d'une collecte peut-être tronquée."
              />
            ) : null}
          </>
        ) : (
          <>
            <Table
              caption={`Startups de ${personne.fullname} et phase de chacune`}
              noCaption
              headers={["Startup", "Phase", "Depuis", "Justifie des accès", "Origine", ""]}
              data={lignesStartups.map((ligne) => [
                <span key="s">
                  {ligne.nom ?? ligne.ghid}
                  <br />
                  <span className={fr.cx("fr-text--sm")}>{ligne.ghid}</span>
                </span>,
                ligne.phase === null ? (
                  <Absent key="p" mention="non collectée" />
                ) : (
                  (LIBELLE_PHASE[ligne.phase] ?? ligne.phase)
                ),
                ligne.phaseStart ? dateFr.format(ligne.phaseStart) : <Absent key="d" />,
                ligne.connue ? (
                  <Badge key="j" severity={ligne.terminale ? "error" : "success"} noIcon>
                    {ligne.terminale ? "Non, phase terminale" : "Oui"}
                  </Badge>
                ) : (
                  <Badge key="j" severity="info" noIcon>
                    On ne sait pas
                  </Badge>
                ),
                <span key="o">
                  {ligne.collectee ? "Collecté" : null}
                  {ligne.collectee && ligne.manuel ? <br /> : null}
                  {ligne.manuel ? (
                    <>
                      Manuel, jusqu'au {dateFr.format(ligne.manuel.until)}
                      <br />
                      <span className={fr.cx("fr-text--sm")}>
                        posé par {ligne.manuel.createdBy}
                      </span>
                    </>
                  ) : null}
                </span>,
                ligne.manuel ? (
                  <RetirerRattachement
                    key="r"
                    id={ligne.manuel.id}
                    startup={ligne.nom ?? ligne.ghid}
                  />
                ) : (
                  <span key="r" />
                ),
              ])}
            />

            {toutesTerminees ? (
              <Alert
                className={fr.cx("fr-mt-2w")}
                severity="warning"
                small
                description="Toutes ses startups sont dans une phase terminale : elle ne travaille plus sur rien au sein de l'incubateur, quelle que soit son échéance."
              />
            ) : null}

            {inconnues > 0 ? (
              <Alert
                className={fr.cx("fr-mt-2w")}
                severity="info"
                small
                description={`La phase de ${inconnues} startup${inconnues > 1 ? "s" : ""} n'a pas été collectée. Tant qu'elle reste inconnue, on ne peut rien conclure sur l'activité réelle de cette personne.`}
              />
            ) : null}
          </>
        )}

        {/* Sans eux, un constat levé la veille deviendrait inexplicable. */}
        {rattachementsClos.length > 0 ? (
          <div className={fr.cx("fr-mt-4w", "fr-text--sm")}>
            <h3 className={fr.cx("fr-h6")}>Rattachements manuels clos ou expirés</h3>
            <Table
              caption={`Rattachements manuels passés de ${personne.fullname}`}
              noCaption
              headers={["Startup", "Jusqu'au", "Posé par", "Fin", "Motif"]}
              data={rattachementsClos.map((rattachement) => [
                parGhid.get(rattachement.startupGhid)?.name ?? rattachement.startupGhid,
                dateFr.format(rattachement.until),
                rattachement.createdBy,
                rattachement.endedAt ? (
                  `retiré le ${dateFr.format(rattachement.endedAt)} par ${rattachement.endedBy ?? "?"}`
                ) : (
                  <span key="f">expiré</span>
                ),
                rattachement.reason ?? <Absent key="m" />,
              ])}
            />
          </div>
        ) : null}

        <div className={fr.cx("fr-mt-4w")}>
          <h3 className={fr.cx("fr-h6")}>Rattacher à une startup</h3>
          <p className={fr.cx("fr-text--sm")}>
            Un rattachement manuel porte obligatoirement une date de fin et le nom de qui l'a posé.
            Il survit aux collectes, contrairement à la liste ci-dessus, que l'espace-membre réécrit
            à chaque passage.
          </p>
          <RattacherStartup
            username={personne.username}
            missionEnd={personne.missionEnd?.toISOString().slice(0, 10) ?? null}
            startups={startupsConnues.map((startup) => ({
              ghid: startup.ghid,
              name: startup.name,
              disparue: startup.vanishedAt !== null,
            }))}
          />
        </div>
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Constats</h2>

        {personne.findings.length === 0 ? (
          <p>Aucun constat n'a jamais été levé sur cette personne.</p>
        ) : (
          <>
            {ouverts.length === 0 ? (
              <p>Aucun constat ouvert.</p>
            ) : (
              <Table
                caption={`Constats ouverts sur ${personne.fullname}`}
                noCaption
                headers={["Gravité", "Constat", "Ouvert le"]}
                data={ouverts.map((constat) => {
                  const libelle = LIBELLE_CONSTAT[constat.kind as ConstatKind];
                  return [
                    <Badge key="g" severity={SEVERITE_CONSTAT[constat.severity]} noIcon>
                      {LIBELLE_SEVERITE[constat.severity]}
                    </Badge>,
                    <span key="c">
                      <strong>{libelle?.titre ?? constat.kind}</strong>
                      <br />
                      <span className={fr.cx("fr-text--sm")}>{libelle?.action ?? ""}</span>
                    </span>,
                    dateFr.format(constat.openedAt),
                  ];
                })}
              />
            )}

            {fermes.length > 0 ? (
              <>
                <h3 className={fr.cx("fr-h6", "fr-mt-4w")}>Constats fermés</h3>
                <Table
                  caption={`Constats fermés sur ${personne.fullname}`}
                  noCaption
                  headers={["Constat", "Ouvert le", "Fermé le", "Raison"]}
                  data={fermes.map((constat) => {
                    const libelle = LIBELLE_CONSTAT[constat.kind as ConstatKind];
                    return [
                      libelle?.titre ?? constat.kind,
                      dateFr.format(constat.openedAt),
                      constat.closedAt ? dateFr.format(constat.closedAt) : <Absent key="f" />,
                      constat.closeReason ?? (
                        <Absent key="r" mention="réconcilié par une collecte" />
                      ),
                    ];
                  })}
                />
              </>
            ) : null}
          </>
        )}
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Comptes externes</h2>

        {personne.identities.length === 0 ? (
          <Alert
            severity="info"
            title="On ne sait pas quels comptes cette personne possède"
            description={
              systemesCollectes.length === 0
                ? "Aucun connecteur n'a encore lu de système cible. Cette liste est vide faute d'observation, ce qui ne dit rien des accès réellement détenus."
                : `Aucun compte ne lui est rattaché sur les systèmes déjà collectés (${systemesCollectes.join(", ")}). Tout système absent de cette liste n'a jamais été lu : son état reste inconnu.`
            }
          />
        ) : (
          <>
            <Table
              caption={`Comptes externes rattachés à ${personne.fullname}`}
              noCaption
              headers={["Système", "Compte", "Rattachement", "Vu pour la dernière fois", ""]}
              data={personne.identities.map((identite) => {
                const methode = RATTACHEMENT_IDENTITE[identite.matchMethod];
                return [
                  identite.provider,
                  <span key="c">
                    {identite.handle}
                    {identite.vanishedAt ? (
                      <>
                        <br />
                        <Badge severity="info" small noIcon>
                          Disparu le {dateFr.format(identite.vanishedAt)}
                        </Badge>
                      </>
                    ) : null}
                  </span>,
                  <Badge key="r" severity={methode.sur ? "success" : "warning"} noIcon>
                    {methode.libelle}
                  </Badge>,
                  dateFr.format(identite.lastSeenAt),
                  <Detacher key="d" id={identite.id} compte={identite.handle} />,
                ];
              })}
            />
            <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
              Systèmes collectés à ce jour :{" "}
              {systemesCollectes.length === 0 ? "aucun" : systemesCollectes.join(", ")}. Tout
              système absent de cette liste n'a jamais été lu. Un rattachement heuristique ou absent
              ne peut jamais produire de révocation.
            </p>
          </>
        )}
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Observation</h2>

        <dl className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
          <Champ libelle="Première observation">{dateFr.format(personne.firstSeenAt)}</Champ>
          <Champ libelle="Dernière observation">{dateFr.format(personne.lastSeenAt)}</Champ>
          <Champ libelle="Sortie du référentiel">
            {personne.vanishedAt ? (
              dateFr.format(personne.vanishedAt)
            ) : (
              <Absent mention="toujours présente" />
            )}
          </Champ>
        </dl>
      </section>
    </main>
  );
}

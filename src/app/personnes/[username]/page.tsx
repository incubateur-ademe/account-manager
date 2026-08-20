import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
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
import { ficheEditable } from "@/core/fiche-manuelle";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { echeanceEffective, enCours, startupsEffectives } from "@/core/rattachement-startup";
import { LIBELLE_STATUT, type Statut, statutDePersonne } from "@/core/statut";
import type { MatchMethod, PersonSource } from "@/generated/prisma/enums";
import { appartenanceDeLaLigne } from "@/lib/appartenance";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { ActionsDePage } from "./ActionsDePage";
import {
  CeQuiAppelleUneAction,
  type MotifDAction,
  motifsDesConstats,
} from "./CeQuiAppelleUneAction";
import { Detacher } from "./Detacher";
import { ModaleRattacherStartup } from "./ModaleRattacherStartup";
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

/**
 * Les seuls statuts qui appellent un geste, et la gravité de ce geste.
 *
 * Les autres décrivent une situation dont il n'y a rien à faire : les porter dans le
 * bloc d'action le ferait paraître sur chaque fiche, et un bloc qui paraît partout ne
 * signale plus rien.
 */
const STATUT_A_TRAITER: Partial<Record<Statut, "error" | "warning" | "info">> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "info",
};

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
      return "Elle a quitté le référentiel de l'incubateur, et rien ici ne dit ce que ses accès sont devenus.";
    case "A_TRAITER":
      return `Son échéance est dépassée au-delà du délai de grâce de ${graceDays} jours.`;
    case "EN_SURSIS":
      return `Son échéance est dépassée, mais le délai de grâce de ${graceDays} jours court encore : un renouvellement signé en retard est encore possible.`;
    case "BIENTOT":
      return `Son échéance tombe dans les ${soonDays} prochains jours.`;
    case "ACTIF":
      return "Son échéance est lointaine : rien ne la signale de ce côté.";
    case "SANS_ECHEANCE":
      return "Aucune date de fin de mission n'est connue : aucune échéance ne la fera remonter.";
    case "ANCIEN":
      return `Son échéance est dépassée depuis plus de ${staleDays} jours : elle relève désormais de l'historique.`;
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

  // Un titre d'appartenance qui ne passe par aucune startup : la même exception que
  // celle du calcul des constats, sans quoi l'écran lèverait ici ce que la file
  // refuse de lever.
  const parEquipe = personne.attachment === "DECLARED" || personne.attachment === "BOTH";
  const surchargeContredite = appartenance.surcharge !== null && !surchargeSuperflue(appartenance);
  const sortieContreEquipe =
    appartenance.surcharge?.sens === "EXCLUDE" &&
    (appartenance.sansSurcharge === "EQUIPE" || appartenance.sansSurcharge === "EQUIPE_ET_STARTUP");

  const graviteStatut = STATUT_A_TRAITER[statut];
  const motifs: MotifDAction[] = [];

  if (graviteStatut) {
    motifs.push({
      cle: "statut",
      severite: graviteStatut,
      titre: LIBELLE_STATUT[statut],
      description: expliquerStatut(statut, thresholds),
    });
  }

  motifs.push(...motifsDesConstats(ouverts));

  if (fraicheur.perimee) {
    motifs.push({
      cle: "fraicheur",
      severite: "warning",
      titre: "Ce que montre cette fiche n'est plus frais",
      description:
        fraicheur.heures === null
          ? "Aucune collecte n'a jamais eu lieu : cette fiche ne reflète aucune observation."
          : `Dernière collecte lancée il y a ${fraicheur.heures} heures. Sa situation a pu changer depuis.`,
    });
  }

  // Doublon écarté : quand le constat est déjà levé, il porte la même chose et la
  // porte mieux, avec sa gravité et sa date.
  if (
    toutesTerminees &&
    !parEquipe &&
    !ouverts.some((constat) => constat.kind === "INACTIVE_STARTUP")
  ) {
    motifs.push({
      cle: "startups-terminees",
      severite: "warning",
      titre: "Toutes ses startups sont dans une phase terminale",
      description:
        "Plus aucune startup vivante de l'incubateur ne porte son rattachement. Confirmer son rattachement réel, ou retirer les accès devenus sans objet.",
    });
  }

  if (surchargeContredite) {
    motifs.push({
      cle: "surcharge",
      severite: "warning",
      titre:
        appartenance.surcharge?.sens === "EXCLUDE"
          ? "Déclarée hors incubateur, contre ce que portent ses rattachements"
          : "Forcée dans l'incubateur, faute de rattachement qui l'y place",
      description: `Décidée par ${appartenance.surcharge?.par ?? "?"}. Sans cette décision, elle serait « ${
        titre.libelle
      } » d'après ses rattachements en cours.`,
    });
  }

  if (sortieContreEquipe) {
    motifs.push({
      cle: "sortie-contre-equipe",
      severite: "warning",
      titre: "Deux autorités se contredisent",
      description:
        "Elle relève pourtant d'une équipe de l'incubateur, et la collecte le réécrira à chaque passage. Pour que la sortie soit portée des deux côtés, il reste à la retirer de scope.transverse dans la politique.",
    });
  }

  if (appartenance.sansStartupConnue) {
    motifs.push({
      cle: "sans-startup",
      severite: "warning",
      titre: "Un rattachement par startup, mais aucune startup connue",
      description:
        "La dernière collecte n'en a trouvé aucune. Conclure d'une collecte peut-être tronquée reviendrait à la sortir sur du vide : c'est la collecte qu'il faut regarder avant elle.",
    });
  }

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel={personne.fullname}
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Personnes suivies", linkProps: { href: "/personnes" } }]}
      />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--top")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-7")}>
          <h1 className={fr.cx("fr-mb-1v")}>{personne.fullname}</h1>
          <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{personne.username}</p>
          <Badge severity={SEVERITE_STATUT[statut]} noIcon>
            {LIBELLE_STATUT[statut]}
          </Badge>
          {graviteStatut ? null : (
            <p className={fr.cx("fr-text--sm", "fr-mt-1w", "fr-mb-0")}>
              {expliquerStatut(statut, thresholds)}
            </p>
          )}
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-5")}>
          <ActionsDePage
            username={personne.username}
            editable={editabilite.editable}
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
        </div>
      </div>

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

      <CeQuiAppelleUneAction motifs={motifs} />

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

        {appartenance.surcharge ? (
          <Alert
            className={fr.cx("fr-mt-2w")}
            severity={surchargeSuperflue(appartenance) ? "info" : "warning"}
            small
            description={
              <>
                <strong>
                  {appartenance.surcharge.sens === "EXCLUDE"
                    ? "Hors incubateur, forcé"
                    : "Dans l'incubateur, forcé"}
                </strong>{" "}
                Décidée par {appartenance.surcharge.par} le{" "}
                {dateFr.format(appartenance.surcharge.depuis)} : « {appartenance.surcharge.raison}{" "}
                ».{" "}
                {surchargeSuperflue(appartenance)
                  ? "Ses rattachements en cours disent désormais la même chose : cette décision est devenue superflue et peut être retirée. Elle ne se retire pas d'elle-même, une décision nominative ne s'annule pas par une collecte anonyme."
                  : "Elle dit l'appartenance et n'ordonne rien : aucun accès n'est coupé, ses comptes continuent d'être examinés, et un départ reste à instruire par un dossier."}
              </>
            }
          />
        ) : null}
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <div className={fr.cx("fr-grid-row", "fr-grid-row--middle")}>
          <div className={fr.cx("fr-col")}>
            <h2 className={fr.cx("fr-h5", "fr-mb-0")}>Startups</h2>
          </div>
          <ModaleRattacherStartup
            username={personne.username}
            missionEnd={personne.missionEnd?.toISOString().slice(0, 10) ?? null}
            startups={startupsConnues.map((startup) => ({
              ghid: startup.ghid,
              name: startup.name,
              disparue: startup.vanishedAt !== null,
            }))}
          />
        </div>

        {lignesStartups.length === 0 ? (
          <p className={fr.cx("fr-mt-2w")}>Aucune startup ne lui est rattachée.</p>
        ) : (
          <>
            <Table
              className={fr.cx("fr-mt-2w")}
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
                  <Absent key="p" mention="phase inconnue" />
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

            {/* Le constat de startups terminées épargne les rattachés par équipe :
                la fiche doit dire la même chose que la file, sans quoi elle lèverait
                ici ce que la file refuse de lever. */}
            {toutesTerminees && parEquipe ? (
              <Alert
                className={fr.cx("fr-mt-2w")}
                severity="info"
                small
                description="Toutes ses startups sont dans une phase terminale. Son rattachement à l'incubateur passe par une équipe : il ne dépend d'aucune d'elles."
              />
            ) : null}

            {inconnues > 0 ? (
              <Alert
                className={fr.cx("fr-mt-2w")}
                severity="info"
                small
                description={`La phase de ${inconnues} startup${inconnues > 1 ? "s" : ""} n'est pas connue. Tant qu'elle le reste, on ne peut pas conclure que toutes ses startups sont terminées.`}
              />
            ) : null}
          </>
        )}

        {/* Sans eux, un constat levé la veille deviendrait inexplicable. */}
        {rattachementsClos.length > 0 ? (
          <Accordion
            className={fr.cx("fr-mt-2w")}
            titleAs="h3"
            label={`Rattachements manuels clos ou expirés (${rattachementsClos.length})`}
          >
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
          </Accordion>
        ) : null}
      </section>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Comptes externes</h2>

        {personne.identities.length === 0 ? (
          <Alert
            severity="info"
            small
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

      {fermes.length > 0 ? (
        <Accordion
          className={fr.cx("fr-mt-4w")}
          titleAs="h2"
          label={`Constats fermés (${fermes.length})`}
        >
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
                constat.closeReason ?? <Absent key="r" mention="réconcilié par une collecte" />,
              ];
            })}
          />
        </Accordion>
      ) : null}

      <p className={fr.cx("fr-text--sm", "fr-mt-4w")}>
        Observée du {dateFr.format(personne.firstSeenAt)} au {dateFr.format(personne.lastSeenAt)},{" "}
        {personne.vanishedAt
          ? `sortie du référentiel le ${dateFr.format(personne.vanishedAt)}`
          : "toujours présente"}
        .
      </p>
    </main>
  );
}

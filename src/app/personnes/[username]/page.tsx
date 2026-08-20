import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LIBELLE_APPARTENANCE, libelleAppartenance, surchargeSuperflue } from "@/core/appartenance";
import { fraicheurDe } from "@/core/collecte";
import type { ConstatKind } from "@/core/constat";
import { ficheEditable } from "@/core/fiche-manuelle";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { echeanceEffective, enCours, startupsEffectives } from "@/core/rattachement-startup";
import { LIBELLE_STATUT, statutDePersonne } from "@/core/statut";
import { appartenanceDeLaLigne } from "@/lib/appartenance";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { ActionsDePage } from "./ActionsDePage";
import { CeQuiAppelleUneAction } from "./CeQuiAppelleUneAction";
import { Absent, Champ } from "./Champs";
import { dateFr, expliquerStatut, SEVERITE_STATUT, SOURCE, STATUT_A_TRAITER } from "./libelles";
import { motifsDAction } from "./motifs";
import { SectionComptesExternes } from "./SectionComptesExternes";
import { SectionStartups } from "./SectionStartups";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

/**
 * L'ingestion du périmètre passe par ce fournisseur : ses runs disent qu'on connaît
 * les personnes, jamais qu'on a lu un système cible. Les compter comme une collecte
 * de comptes ferait passer une absence d'observation pour une absence d'accès.
 */
const FOURNISSEUR_PERIMETRE = "espace-membre";

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
    thresholds,
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

  const motifs = motifsDAction({
    statut,
    seuils: thresholds,
    appartenance,
    libelleSansSurcharge: LIBELLE_APPARTENANCE[appartenance.sansSurcharge].libelle,
    ouverts,
    fraicheur,
    toutesStartupsTerminees: toutesTerminees,
    parEquipe,
  });

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
          {STATUT_A_TRAITER[statut] ? null : (
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
                {/* La précision du motif dit déjà ce qu'une décision emporte : ne
                    reste ici que ce qu'elle seule sait, qui l'a prise et quand, plus
                    l'invitation à la retirer le jour où elle ne sert plus. */}
                {surchargeSuperflue(appartenance)
                  ? "Ses rattachements en cours disent désormais la même chose : cette décision est devenue superflue et peut être retirée. Elle ne se retire pas d'elle-même, une décision nominative ne s'annule pas par une collecte anonyme."
                  : null}
              </>
            }
          />
        ) : null}
      </section>

      <SectionStartups
        personne={personne}
        lignes={lignesStartups}
        clos={rattachementsClos.map((rattachement) => ({
          ...rattachement,
          startup: parGhid.get(rattachement.startupGhid)?.name ?? rattachement.startupGhid,
        }))}
        startupsProposables={startupsConnues.map((startup) => ({
          ghid: startup.ghid,
          name: startup.name,
          disparue: startup.vanishedAt !== null,
        }))}
        toutesTerminees={toutesTerminees}
        parEquipe={parEquipe}
        inconnues={inconnues}
      />

      <SectionComptesExternes
        fullname={personne.fullname}
        comptes={personne.identities}
        systemesCollectes={systemesCollectes}
      />

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

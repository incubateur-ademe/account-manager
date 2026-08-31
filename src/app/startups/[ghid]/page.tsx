import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { estPhaseTerminale } from "@/core/appartenance";
import { FOURNISSEUR_PERIMETRE, fraicheurDe } from "@/core/collecte";
import { ETATS_VIVANTS } from "@/core/dossier";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { LIBELLE_PHASE } from "@/core/libelle-startup";
import { type RattachementManuel, startupsEffectives } from "@/core/rattachement-startup";
import { assemblerMembres, type MembreATraiter, repartirLeLot } from "@/core/startups";
import type { MatchMethod } from "@/generated/prisma/enums";
import { phasesDesStartups } from "@/lib/appartenance";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";
import { RATTACHEMENT_IDENTITE } from "@/ui/severites";

import type { PersonneProposable } from "./RattacherPersonne";
import { type ComptesParFournisseur, type LigneMembre, SectionMembres } from "./SectionMembres";
import { TraitementDuLot } from "./TraitementDuLot";

export const dynamic = "force-dynamic";

/**
 * Une table indexée par chaîne plutôt qu'un transtypage vers l'union des constats
 * traités : l'enum de la base en porte davantage, et affirmer au compilateur que
 * l'un est l'autre le rendrait muet le jour où un type non traité arrive ici.
 */
const TITRE_CONSTAT: ReadonlyMap<string, string> = new Map(
  Object.entries(LIBELLE_CONSTAT).map(([kind, libelle]) => [kind, libelle.titre]),
);

interface Props {
  params: Promise<{ ghid: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireOperateur();

  const { ghid } = await params;
  const startup = await prisma.startup.findUnique({ where: { ghid }, select: { name: true } });

  return { title: startup ? startup.name : "Startup introuvable" };
}

function Champ({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className={fr.cx("fr-col-12", "fr-col-md-3")}>
      <dt className={fr.cx("fr-text--sm", "fr-mb-0")}>{libelle}</dt>
      <dd className={fr.cx("fr-text--bold", "fr-ml-0")}>{children}</dd>
    </div>
  );
}

function agregerComptes(
  identites: readonly { provider: string; matchMethod: MatchMethod }[],
): ComptesParFournisseur[] {
  const parFournisseur = new Map<string, { total: number; incertains: Map<MatchMethod, number> }>();

  for (const identite of identites) {
    const compte = parFournisseur.get(identite.provider) ?? { total: 0, incertains: new Map() };
    compte.total += 1;
    if (!RATTACHEMENT_IDENTITE[identite.matchMethod].sur) {
      compte.incertains.set(
        identite.matchMethod,
        (compte.incertains.get(identite.matchMethod) ?? 0) + 1,
      );
    }
    parFournisseur.set(identite.provider, compte);
  }

  return [...parFournisseur]
    .map(([provider, compte]) => ({
      provider,
      total: compte.total,
      incertains: [...compte.incertains].map(([methode, nombre]) => ({ methode, nombre })),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider, "fr"));
}

export default async function FicheStartupPage({ params }: Props) {
  await requireOperateur();

  const { ghid } = await params;
  const { thresholds, startups: reglesStartups } = policy();
  const today = new Date();

  const [startup, dernierePasse, systemesLus, personnes, proposables, phases] = await Promise.all([
    prisma.startup.findUnique({
      where: { ghid },
      select: {
        ghid: true,
        name: true,
        currentPhase: true,
        phaseStart: true,
        firstSeenAt: true,
        lastSeenAt: true,
        vanishedAt: true,
      },
    }),
    prisma.syncRun.findFirst({
      where: { provider: FOURNISSEUR_PERIMETRE },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    // La colonne des comptes affirme un nombre par système : sans savoir lesquels ont
    // été lus, un système jamais collecté s'y lit exactement comme un système sans
    // compte, et l'écran d'où l'on part couper des accès conclurait qu'il n'y a rien à
    // couper.
    prisma.syncRun.findMany({
      where: { capability: "list", status: { in: ["OK", "PARTIAL"] } },
      distinct: ["provider"],
      select: { provider: true },
    }),
    // Ni `until` ni la date du jour ne bornent cette lecture : les rattachements
    // qu'une échéance a rattrapés sont précisément ceux dont le noyau tire la liste
    // des expirés, et les écarter ici la viderait sans que rien ne le dise.
    prisma.person.findMany({
      where: {
        OR: [
          { startups: { has: ghid } },
          { startupAssignments: { some: { startupGhid: ghid, endedAt: null } } },
        ],
      },
      select: {
        username: true,
        fullname: true,
        missionEnd: true,
        vanishedAt: true,
        attachment: true,
        startups: true,
        startupAssignments: {
          where: { endedAt: null },
          select: { id: true, startupGhid: true, until: true, endedAt: true },
        },
        identities: {
          where: { vanishedAt: null },
          select: { provider: true, matchMethod: true },
        },
        scopeOverride: { select: { decision: true } },
        // Un départ déjà ouvert désigne un geste en cours : la ligne reste cochable,
        // mais elle n'est pas proposée d'avance. Borné au départ : le motif qui la
        // consomme annonce un départ en cours, et une arrivée remontée ici le ferait
        // mentir.
        accessCases: {
          where: { kind: "OFFBOARDING", state: { in: [...ETATS_VIVANTS] } },
          select: { id: true },
        },
      },
    }),
    // Quatre-vingt-quinze personnes : une lecture complète coûte moins qu'une
    // recherche par frappe, et le champ propose alors les mêmes que l'écran des
    // personnes, y compris celles qui ne sont pas encore rattachées ici.
    prisma.person.findMany({
      select: { username: true, fullname: true, missionEnd: true, vanishedAt: true },
      orderBy: { fullname: "asc" },
    }),
    phasesDesStartups(),
  ]);

  if (!startup) {
    notFound();
  }

  const systemesCollectes = systemesLus
    .map((releve) => releve.provider)
    .filter((provider) => provider !== FOURNISSEUR_PERIMETRE)
    .sort((a, b) => a.localeCompare(b, "fr"));

  const comptesParPersonne = new Map(
    personnes.map((personne) => [personne.username, agregerComptes(personne.identities)]),
  );
  // Le noyau rend le rattachement qu'on lui a passé et non une copie : son identité
  // d'objet relie la ligne à son identifiant sans redire ici la règle qui, de deux
  // rattachements ouverts sur le même couple, désigne celui qui s'affiche.
  const identifiants = new Map<RattachementManuel, string>();
  const rattachables = personnes.map(({ startupAssignments, ...personne }) => {
    for (const rattachement of startupAssignments) {
      identifiants.set(rattachement, rattachement.id);
    }
    return { ...personne, rattachementsManuels: startupAssignments };
  });

  const { membres, echus } = assemblerMembres(ghid, rattachables, today, thresholds);
  const lignes: LigneMembre[] = membres.map((membre) => ({
    ...membre,
    comptes: comptesParPersonne.get(membre.username) ?? [],
    idManuel: membre.manuel === null ? null : (identifiants.get(membre.manuel) ?? null),
  }));

  const personnesProposables: PersonneProposable[] = proposables.map((personne) => ({
    username: personne.username,
    fullname: personne.fullname,
    missionEnd: personne.missionEnd?.toISOString().slice(0, 10) ?? null,
    disparue: personne.vanishedAt !== null,
  }));

  const usernames = membres.map((membre) => membre.username);
  const constats =
    usernames.length === 0
      ? []
      : await prisma.finding.findMany({
          where: { closedAt: null, person: { username: { in: usernames } } },
          select: {
            id: true,
            kind: true,
            dedupKey: true,
            person: { select: { username: true } },
          },
        });

  const constatsInactifs = new Map(
    constats.flatMap((constat) =>
      constat.kind === "INACTIVE_STARTUP" && constat.person
        ? [[constat.person.username, constat.dedupKey] as const]
        : [],
    ),
  );

  const fiches = new Map(personnes.map((personne) => [personne.username, personne]));
  const aTraiter: MembreATraiter[] = membres.map((membre) => {
    const fiche = fiches.get(membre.username);
    return {
      ...membre,
      startupsEffectives:
        fiche === undefined
          ? []
          : startupsEffectives(fiche.startups, fiche.startupAssignments, today),
      dossierVivant: (fiche?.accessCases.length ?? 0) > 0,
      surcharge: fiche?.scopeOverride != null,
      constatOuvert: constatsInactifs.get(membre.username) ?? null,
      disparue: fiche?.vanishedAt != null,
    };
  });
  const candidats = repartirLeLot(startup.ghid, aTraiter, phases, reglesStartups.terminalPhases);

  const parType = new Map<string, number>();
  for (const constat of constats) {
    parType.set(constat.kind, (parType.get(constat.kind) ?? 0) + 1);
  }
  const typesDeConstat = [...parType]
    .map(([kind, nombre]) => ({ titre: TITRE_CONSTAT.get(kind) ?? kind, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.titre.localeCompare(b.titre, "fr"));
  const personnesConstatees = new Set(
    constats.flatMap((constat) => (constat.person ? [constat.person.username] : [])),
  ).size;

  const phase = startup.currentPhase;
  const libellePhase = phase === null ? null : (LIBELLE_PHASE[phase] ?? phase);
  const terminale = estPhaseTerminale(phase, new Set(reglesStartups.terminalPhases));
  const fraicheur = fraicheurDe(
    dernierePasse?.startedAt ?? null,
    today,
    thresholds.collectStaleHours,
  );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel={startup.name}
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Startups", linkProps: { href: "/startups" } }]}
      />

      <h1 className={fr.cx("fr-mb-1v")}>{startup.name}</h1>
      <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>{startup.ghid}</p>
      {libellePhase === null ? (
        <Badge severity="info" noIcon>
          Phase inconnue
        </Badge>
      ) : (
        <Badge severity={terminale ? "error" : "success"} noIcon>
          {libellePhase}
        </Badge>
      )}
      {startup.vanishedAt ? (
        <Badge className={fr.cx("fr-ml-1w")} severity="warning" noIcon>
          Sortie de l'incubateur
        </Badge>
      ) : null}

      {fraicheur.perimee ? (
        <Alert
          className={fr.cx("fr-mt-3w")}
          severity="warning"
          title="Ce que montre cet écran n'est plus à jour"
          description={
            fraicheur.heures === null
              ? "Aucune collecte n'a jamais eu lieu : ce que cette page affiche ne vient d'aucune observation."
              : `La dernière collecte remonte à ${fraicheur.heures} heures, au-delà des ${thresholds.collectStaleHours} heures admises. La phase, les membres et leurs échéances sont gelés ensemble : rien ici ne signale ce qui a pu changer depuis.`
          }
        />
      ) : null}

      {/* La collecte des startups est enveloppée dans un try/catch qui ne dégrade pas
          le run du périmètre : elle peut échouer toutes les nuits pendant que
          l'indicateur de fraîcheur reste au vert. Cette date est le seul endroit d'où
          le trou se voit. */}
      <p className={fr.cx("fr-text--sm", "fr-mt-3w")}>
        Sa phase a été constatée le {dateFr.format(startup.lastSeenAt)}, la dernière fois que la
        liste de l'incubateur a rendu cette startup. Le référentiel des startups peut cesser d'être
        collecté sans faire échouer le reste de la collecte : quand cette date n'avance plus alors
        que le reste de l'écran paraît frais, c'est ici que ça se voit.
      </p>

      {startup.vanishedAt ? (
        <Alert
          className={fr.cx("fr-mt-2w")}
          severity="warning"
          title="Cette startup n'est plus rendue par l'incubateur"
          // Deux dates et non une : la disparition se constate au passage qui ne revoit
          // plus la startup, et une collecte partielle interdit de la dater, si bien que
          // le constat peut tomber des mois après le fait. Les confondre ferait croire
          // que les accès ne survivent que depuis le jour du constat.
          description={`La liste de l'incubateur l'a rendue pour la dernière fois le ${dateFr.format(startup.lastSeenAt)}, et la collecte a constaté sa disparition le ${dateFr.format(startup.vanishedAt)}. La phase affichée est la dernière connue, pas un fait d'aujourd'hui : une co-incubation retirée, un ghid renommé et un abandon donnent ici le même symptôme.${lignes.length > 0 ? " Les personnes ci-dessous, elles, gardent leurs accès." : ""}`}
        />
      ) : null}

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Situation</h2>
        <dl className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
          <Champ libelle="Phase">
            {libellePhase ?? <span className={fr.cx("fr-hint-text")}>inconnue</span>}
          </Champ>
          <Champ libelle="Depuis">
            {startup.phaseStart ? (
              dateFr.format(startup.phaseStart)
            ) : (
              <span className={fr.cx("fr-hint-text")}>inconnu</span>
            )}
          </Champ>
          <Champ libelle="Première observation">{dateFr.format(startup.firstSeenAt)}</Champ>
          <Champ libelle="Dernière observation">{dateFr.format(startup.lastSeenAt)}</Champ>
          {startup.vanishedAt ? (
            <Champ libelle="Disparition constatée le">{dateFr.format(startup.vanishedAt)}</Champ>
          ) : null}
        </dl>

        <p className={fr.cx("fr-mb-0")}>
          <Link
            className={fr.cx("fr-link")}
            href={`/modeles/startup/${encodeURIComponent(startup.ghid)}`}
          >
            Le modèle de plan de cette startup
          </Link>
        </p>
        <p className={fr.cx("fr-text--sm")}>
          Ce qu'elle demande en propre à l'arrivée et au départ de ses membres, en plus de ce que
          l'incubateur demande à tout le monde.
        </p>
      </section>

      <SectionMembres
        ghid={startup.ghid}
        nomStartup={startup.name}
        membres={lignes}
        echus={echus}
        collecteJamaisFaite={dernierePasse === null}
        sortieLe={startup.vanishedAt}
        systemesCollectes={systemesCollectes}
        personnesProposables={personnesProposables}
      />

      {/* Sur une startup qui tourne, il n'y a rien à traiter en lot : le bloc n'existe
          que là où la question se pose, une phase terminale ou une sortie de
          l'incubateur, et seulement s'il reste quelqu'un dessus. */}
      {(terminale || startup.vanishedAt !== null) && candidats.length > 0 ? (
        <TraitementDuLot ghid={startup.ghid} nomStartup={startup.name} candidats={candidats} />
      ) : null}

      {/* Rien à dire quand il n'y a rien à faire : un titre suivi d'une phrase qui
          annonce le vide s'afficherait sur toutes les startups saines. Le cas sans
          membre, lui, se dit, parce qu'aucune requête n'a été émise et qu'un silence
          passerait alors pour un résultat. */}
      {constats.length === 0 && lignes.length > 0 ? null : (
        <section className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h5")}>Constats ouverts sur ses membres</h2>

          {lignes.length === 0 ? (
            <p>
              Aucun membre à interroger : la question n'a pas été posée, et ce silence n'est pas une
              absence de constat.{" "}
              <Link className={fr.cx("fr-link")} href="/constats">
                Voir la file des constats
              </Link>
            </p>
          ) : (
            <>
              <p>
                {constats.length} constat{constats.length > 1 ? "s" : ""} ouvert
                {constats.length > 1 ? "s" : ""} sur {personnesConstatees} de ses membres.
              </p>
              <ul>
                {typesDeConstat.map((type) => (
                  <li key={type.titre}>
                    {type.titre} ({type.nombre})
                  </li>
                ))}
              </ul>
              {/* Cet écran ne fait que lire : le geste, lui, vit dans la file. */}
              <p>
                <Link className={fr.cx("fr-link")} href="/constats">
                  Les traiter dans la file des constats
                </Link>
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}

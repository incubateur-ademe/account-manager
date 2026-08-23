import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Tile } from "@codegouvfr/react-dsfr/Tile";
import type { Metadata } from "next";
import Link from "next/link";

import { FOURNISSEUR_PERIMETRE, fraicheurDe } from "@/core/collecte";
import { LIBELLE_PHASE } from "@/core/libelle-startup";
import {
  assemblerIndex,
  compteurs,
  estVueStartups,
  filtrerStartups,
  type VueStartups,
} from "@/core/startups";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";
import { TableCustom } from "@/ui/TableCustom";

import { Filtres } from "./Filtres";

export const metadata: Metadata = { title: "Startups" };

export const dynamic = "force-dynamic";

export default async function StartupsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperateur();

  const searchParams = await props.searchParams;
  const premier = (cle: string): string | undefined => {
    const valeur = searchParams[cle];
    return Array.isArray(valeur) ? valeur[0] : valeur;
  };

  const vueBrute = premier("vue");
  const vue: VueStartups = estVueStartups(vueBrute) ? vueBrute : "actives";
  const recherche = premier("q") ?? "";

  const { thresholds, startups: reglesStartups } = policy();
  const today = new Date();

  const [startups, personnes, dernierRun] = await Promise.all([
    prisma.startup.findMany({
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
    // Toutes les personnes en une requête plutôt qu'une par startup : à cette
    // échelle le coût est négligeable, et les compteurs restent calculés sur les
    // mêmes lignes que le tableau.
    prisma.person.findMany({
      select: {
        username: true,
        fullname: true,
        missionEnd: true,
        vanishedAt: true,
        attachment: true,
        startups: true,
        startupAssignments: {
          where: { endedAt: null },
          select: { startupGhid: true, until: true, endedAt: true },
        },
      },
    }),
    prisma.syncRun.findFirst({
      where: { provider: FOURNISSEUR_PERIMETRE },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  const rattachables = personnes.map(({ startupAssignments, ...personne }) => ({
    ...personne,
    rattachementsManuels: startupAssignments,
  }));

  const { lignes, ghidsInconnus } = assemblerIndex(
    startups,
    rattachables,
    reglesStartups.terminalPhases,
    today,
  );
  const { actives, terminalesPeuplees, sortiesPeuplees } = compteurs(lignes);
  const visibles = filtrerStartups(lignes, vue, recherche);
  const masquees = lignes.length - visibles.length;
  const peupleesVisibles = visibles.filter((ligne) => ligne.membres > 0).length;

  const fraicheur = fraicheurDe(dernierRun?.startedAt ?? null, today, thresholds.collectStaleHours);

  const inconnus =
    ghidsInconnus.length === 0 ? null : (
      <Alert
        severity="info"
        className={fr.cx("fr-mt-4w")}
        title={
          ghidsInconnus.length === 1
            ? "Un identifiant de startup est inconnu du référentiel"
            : `${ghidsInconnus.length} identifiants de startups sont inconnus du référentiel`
        }
        description={
          <>
            <p className={fr.cx("fr-mb-1w")}>
              Des personnes portent ces identifiants, mais aucune startup observée ne les porte :
              ils n'ont aucune ligne où se dire, et sans cette liste ils seraient invisibles.
            </p>
            <ul className={fr.cx("fr-mb-0")}>
              {ghidsInconnus.map((inconnu) => (
                <li key={inconnu.ghid}>
                  <strong>{inconnu.ghid}</strong>, {inconnu.membres} personne
                  {inconnu.membres > 1 ? "s" : ""} rattachée{inconnu.membres > 1 ? "s" : ""}
                </li>
              ))}
            </ul>
          </>
        }
      />
    );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Startups</h1>

      {fraicheur.perimee ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce que montre cet écran n'est plus à jour"
          description={
            fraicheur.heures === null
              ? "Aucune collecte n'a jamais eu lieu : le référentiel des startups est vide faute d'observation, ce qui ne dit rien des startups réellement en cours."
              : `La dernière collecte remonte à ${fraicheur.heures} heures, au-delà des ${thresholds.collectStaleHours} heures admises. Le référentiel des startups est gelé en même temps que le périmètre : une phase a pu changer, une startup sortir de l'incubateur, sans que rien ici ne le signale.`
          }
        />
      ) : null}

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-mb-4w")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${actives} active${actives > 1 ? "s" : ""}`}
            desc="Ni en phase terminale, ni sorties de l'incubateur. Une phase inconnue reste comptée ici."
            linkProps={{ href: "/startups?vue=actives" }}
            orientation="horizontal"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${terminalesPeuplees} en phase terminale`}
            desc="Seulement celles qui ont encore des membres : une startup terminée sans personne dessus est un fait d'archive, pas un travail à faire."
            linkProps={{ href: "/startups?vue=terminales" }}
            orientation="horizontal"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${sortiesPeuplees} sortie${sortiesPeuplees > 1 ? "s" : ""}`}
            desc="Plus rendues par l'incubateur, et portant encore quelqu'un. La collecte ayant cessé de leur rattacher personne, il ne peut s'agir que de personnes elles-mêmes sorties du référentiel ou rattachées à la main."
            linkProps={{ href: "/startups?vue=sorties" }}
            orientation="horizontal"
          />
        </div>
      </div>

      <Filtres vue={vue} recherche={recherche} />

      {/* Une collecte a-t-elle eu lieu ? La réponse change ce qu'il faut aller regarder,
          et l'écran la connaît. Accuser la collecte alors qu'elle a tourné une heure plus
          tôt envoie chercher un cron qui fonctionne, quand le défaut est dans la
          sous-collecte des startups, la seule à pouvoir échouer sans dégrader son run. */}
      {lignes.length === 0 ? (
        <p className={fr.cx("fr-text--lead")}>
          {dernierRun === null
            ? "Aucune collecte n'a jamais eu lieu : la liste est vide faute d'observation, ce qui ne dit rien des startups réellement en cours."
            : `La dernière collecte remonte au ${dateFr.format(dernierRun.startedAt)} et n'a rendu aucune startup pour cet incubateur. C'est le référentiel des startups qu'il faut regarder, pas le déclenchement de la collecte.`}
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            {visibles.length} startup{visibles.length > 1 ? "s" : ""} affichée
            {visibles.length > 1 ? "s" : ""}
            {masquees > 0 ? `, ${masquees} masquée${masquees > 1 ? "s" : ""} par le filtre.` : "."}
            {/* Les deux tuiles ne comptent que ce qui porte encore des membres, mais la
                vue qu'elles ouvrent montre tout : sans cette phrase, le nombre annoncé
                et le nombre affiché se contredisent sans que rien n'explique lequel
                désigne le travail à faire. */}
            {vue === "terminales" || vue === "sorties" ? (
              <>
                {" "}
                {peupleesVisibles} d'entre elles porte{peupleesVisibles > 1 ? "nt" : ""} encore des
                membres, et ce sont les seules que compte la tuile.
              </>
            ) : null}
          </p>

          {visibles.length === 0 ? (
            <p className={fr.cx("fr-text--lead")}>Aucune startup ne correspond à ces critères.</p>
          ) : (
            <TableCustom
              header={[
                { children: "Startup" },
                { children: "Phase" },
                { children: "Depuis" },
                { children: "Membres" },
                { children: "Dernière observation" },
              ]}
              body={visibles.map((ligne) => ({
                key: ligne.ghid,
                row: [
                  {
                    children: (
                      <span>
                        <Link href={`/startups/${encodeURIComponent(ligne.ghid)}`}>
                          {ligne.name}
                        </Link>
                        <br />
                        <span className={fr.cx("fr-text--sm")}>{ligne.ghid}</span>
                      </span>
                    ),
                  },
                  {
                    children:
                      ligne.currentPhase === null ? (
                        <span className={fr.cx("fr-hint-text")}>inconnue</span>
                      ) : (
                        (LIBELLE_PHASE[ligne.currentPhase] ?? ligne.currentPhase)
                      ),
                  },
                  {
                    children: ligne.phaseStart ? (
                      dateFr.format(ligne.phaseStart)
                    ) : (
                      <span className={fr.cx("fr-hint-text")}>inconnue</span>
                    ),
                  },
                  {
                    children: (
                      <span>
                        {ligne.membres}
                        {ligne.membresSortis > 0 ? (
                          <>
                            <br />
                            <span className={fr.cx("fr-text--sm")}>
                              dont {ligne.membresSortis} sortie{ligne.membresSortis > 1 ? "s" : ""}{" "}
                              du référentiel
                            </span>
                          </>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    children: (
                      <span>
                        {dateFr.format(ligne.lastSeenAt)}
                        {ligne.sortie ? (
                          <>
                            <br />
                            <span className={fr.cx("fr-text--sm")}>
                              plus rendue par l'incubateur depuis
                            </span>
                          </>
                        ) : null}
                      </span>
                    ),
                  },
                ],
              }))}
            />
          )}
        </>
      )}

      {inconnus}
    </main>
  );
}

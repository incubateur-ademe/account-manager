import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Tile } from "@codegouvfr/react-dsfr/Tile";
import { CONNECTEURS } from "@/connectors";
import { fraicheurDe, systemesMuets } from "@/core/collecte";
import { statutDePersonne } from "@/core/statut";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

export default async function AccueilPage() {
  await requireOperateur();

  const { thresholds } = policy();
  const today = new Date();

  const [personnes, dernierRun, constatsOuverts, sortiesSansTraitement, relevesSystemes] =
    await Promise.all([
      prisma.person.findMany({
        select: { missionEnd: true, vanishedAt: true },
      }),
      prisma.syncRun.findFirst({
        where: { provider: "espace-membre" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true, itemsSeen: true },
      }),
      prisma.finding.count({ where: { closedAt: null } }),
      prisma.finding.count({ where: { closedAt: null, kind: "SCOPE_EXIT" } }),
      prisma.syncRun.findMany({
        where: { capability: "list", provider: { not: "espace-membre" } },
        distinct: ["provider"],
        orderBy: { startedAt: "desc" },
        select: { provider: true, startedAt: true, status: true },
      }),
    ]);

  const statuts = personnes.map((personne) =>
    statutDePersonne(personne, today, {
      graceDays: thresholds.graceDays,
      soonDays: thresholds.soonDays,
      staleDays: thresholds.staleDays,
    }),
  );
  const aTraiter = statuts.filter((statut) => statut === "A_TRAITER").length;
  const enSursis = statuts.filter((statut) => statut === "EN_SURSIS").length;
  const bientot = statuts.filter((statut) => statut === "BIENTOT").length;

  const fraicheur = fraicheurDe(dernierRun?.startedAt ?? null, today, thresholds.collectStaleHours);

  const muets = systemesMuets(
    relevesSystemes,
    CONNECTEURS.map((connecteur) => connecteur.contract.key),
    today,
    thresholds.collectStaleHours,
  );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Gestionnaire de comptes</h1>

      {fraicheur.perimee ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce que montre cet outil n'est plus à jour"
          description={
            fraicheur.heures === null
              ? "Aucune collecte n'a jamais eu lieu : les écrans sont vides faute d'observation, ce qui ne dit rien de l'état réel des accès."
              : `La dernière collecte remonte à ${fraicheur.heures} heures, au-delà des ${thresholds.collectStaleHours} heures admises. Les échéances et les constats affichés sont ceux de ce moment-là : quelqu'un a pu partir depuis sans que rien ici ne le signale.`
          }
        />
      ) : null}

      {muets.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title={
            muets.length === 1
              ? "Un système cible n'est plus observé"
              : `${muets.length} systèmes cibles ne sont plus observés`
          }
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Une fiche qui ne montre aucun compte sur ces systèmes ne dit pas qu'il n'y en a pas
                : elle dit qu'on n'a pas regardé.
              </p>
              <ul className={fr.cx("fr-mb-0")}>
                {muets.map((muet) => (
                  <li key={muet.provider}>
                    <strong>{muet.provider}</strong>{" "}
                    {muet.raison === "echec"
                      ? "a échoué à la dernière collecte"
                      : muet.raison === "non-lu"
                        ? "n'a jamais été lu, ou l'a été sans credential"
                        : `n'a pas été lu depuis ${muet.heures} heures`}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      ) : null}

      {dernierRun ? (
        <p className={fr.cx("fr-text--sm")}>
          Dernière collecte du référentiel le {dateFr.format(dernierRun.startedAt)},{" "}
          {dernierRun.itemsSeen} personnes, état {dernierRun.status}.
        </p>
      ) : (
        <p className={fr.cx("fr-text--sm")}>
          Aucune collecte n'a encore été faite : les écrans se rempliront au premier passage du
          traitement quotidien.
        </p>
      )}

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-mt-4w")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${constatsOuverts} constat${constatsOuverts > 1 ? "s" : ""}`}
            desc={`Dont ${sortiesSansTraitement} sortie${sortiesSansTraitement > 1 ? "s" : ""} du référentiel sans traitement.`}
            linkProps={{ href: "/constats" }}
            orientation="horizontal"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${aTraiter} à traiter`}
            desc="Échéance dépassée au-delà du délai de grâce."
            linkProps={{ href: "/personnes?vue=a-traiter" }}
            orientation="horizontal"
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Tile
            title={`${enSursis + bientot} à surveiller`}
            desc={`Échéance dans les ${thresholds.soonDays} jours, ou dépassée depuis peu.`}
            linkProps={{ href: "/personnes?vue=a-surveiller" }}
            orientation="horizontal"
          />
        </div>
      </div>
    </main>
  );
}

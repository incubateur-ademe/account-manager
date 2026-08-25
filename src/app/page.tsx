import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Table } from "@codegouvfr/react-dsfr/Table";
import { Tile } from "@codegouvfr/react-dsfr/Tile";
import { CONNECTEURS } from "@/connectors";
import { FOURNISSEUR_PERIMETRE, fraicheurDe, refusDArrivees, systemesMuets } from "@/core/collecte";
import type { LigneDInventaire } from "@/core/inventaire";
import { echeanceEffective, startupsEffectives } from "@/core/rattachement-startup";
import { statutDePersonne } from "@/core/statut";
import { prisma } from "@/lib/db";
import { chargerInventaire, FENETRE_JOURNAL_JOURS } from "@/lib/inventaire";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { TuilesDeConnecteurs } from "@/ui/connecteurs/Tuiles";
import { dateFr } from "@/ui/dates";

export const dynamic = "force-dynamic";

/**
 * Ce qui empêche de lire une ligne comme l'état du jour, dit à la place du chiffre
 * quand il n'y a pas de chiffre. Un système muet n'affiche aucun nombre : « 0 compte »
 * et « pas regardé » se ressemblent trait pour trait, et un tableau de nombres est
 * précisément une machine à produire cette confusion.
 */
function observation(ligne: LigneDInventaire): string {
  if (ligne.observation.etat === "frais") {
    return "Lu dans les délais";
  }
  if (ligne.observation.etat === "partiel") {
    return "Lu partiellement : des erreurs ont été avalées, aucune disparition datée";
  }

  const { raison, heures } = ligne.observation;
  if (raison === "echec") {
    return "En échec à la dernière collecte";
  }
  if (raison === "non-lu") {
    return "Jamais lu, ou lu sans credential";
  }
  return `Plus lu depuis ${heures} heure${heures !== null && heures > 1 ? "s" : ""}`;
}

function nombre(ligne: LigneDInventaire, valeur: number): string {
  return ligne.comptes === null ? "non observé" : String(valeur);
}

export default async function AccueilPage() {
  await requireOperateur();

  const { thresholds, startups } = policy();
  const today = new Date();

  const [personnes, dernierRun, constatsOuverts, sorties, arrivees, relevesSystemes] =
    await Promise.all([
      prisma.person.findMany({
        select: {
          missionEnd: true,
          vanishedAt: true,
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
        select: { startedAt: true, status: true, itemsSeen: true, error: true },
      }),
      prisma.finding.count({ where: { closedAt: null } }),
      prisma.finding.count({ where: { closedAt: null, kind: "SCOPE_EXIT" } }),
      prisma.finding.count({ where: { closedAt: null, kind: "SCOPE_ENTRY" } }),
      prisma.syncRun.findMany({
        where: { capability: "list", provider: { not: FOURNISSEUR_PERIMETRE } },
        distinct: ["provider"],
        orderBy: { startedAt: "desc" },
        select: { provider: true, startedAt: true, status: true },
      }),
    ]);

  // Les mêmes lignes que l'écran des startups, pliées de la même façon : une startup
  // terminale qui ne porte plus personne n'appelle aucun geste, et les deux écrans
  // afficheraient sinon deux nombres sous le même intitulé.
  const ghidsPeuples = new Set(
    personnes.flatMap((personne) =>
      startupsEffectives(personne.startups, personne.startupAssignments, today),
    ),
  );

  const echeances = personnes.map((personne) => ({
    vanishedAt: personne.vanishedAt,
    missionEnd: echeanceEffective(personne.missionEnd, personne.startupAssignments, today),
  }));

  const statuts = echeances.map((personne) =>
    statutDePersonne(personne, today, {
      graceDays: thresholds.graceDays,
      soonDays: thresholds.soonDays,
      staleDays: thresholds.staleDays,
    }),
  );
  const aTraiter = statuts.filter((statut) => statut === "A_TRAITER").length;
  const enSursis = statuts.filter((statut) => statut === "EN_SURSIS").length;
  const bientot = statuts.filter((statut) => statut === "BIENTOT").length;

  const suivies = echeances.filter((personne) => personne.vanishedAt === null);
  const sansEcheance = suivies.filter((personne) => personne.missionEnd === null).length;

  const fraicheur = fraicheurDe(dernierRun?.startedAt ?? null, today, thresholds.collectStaleHours);

  // Le nombre d'arrivées à acter est celui de la dernière conclusion, pas celui du
  // jour : un passage tronqué ou qui a refusé une vague n'en lève ni n'en ferme
  // aucune, et « rien à acter » se dirait alors exactement comme « on n'a pas
  // regardé ». Une instance qui n'a jamais collecté n'a pas non plus de passage à
  // mettre en cause, et le lui reprocher ferait chercher un incident inexistant.
  const reserveSurLesArrivees =
    dernierRun === null
      ? ", aucune collecte n'ayant encore eu lieu."
      : dernierRun.status === "OK" && !refusDArrivees(dernierRun.error)
        ? "."
        : `, non revue${arrivees > 1 ? "s" : ""} au dernier passage.`;

  const attendus = CONNECTEURS.map((connecteur) => connecteur.contract.key);
  const muets = systemesMuets(relevesSystemes, attendus, today, thresholds.collectStaleHours);

  // Une seconde salve, et non une requête de plus par système : le pliage a besoin de
  // savoir quels systèmes sont muets, ce que la première salve vient seulement
  // d'établir. Le nombre de requêtes reste le même quel que soit le nombre de
  // connecteurs déclarés.
  const inventaire = await chargerInventaire(today, {
    phasesTerminales: startups.terminalPhases,
    ghidsPeuples,
    attendus,
    releves: relevesSystemes,
    muets,
  });

  const lus = attendus.length - muets.length;

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
              : `La dernière collecte lancée remonte à ${fraicheur.heures} heures, au-delà des ${thresholds.collectStaleHours} heures admises. Les échéances et les constats affichés sont ceux de ce moment-là : quelqu'un a pu partir depuis sans que rien ici ne le signale.`
          }
        />
      ) : null}

      {muets.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title={
            muets.length === 1
              ? "Un système cible n'est pas observé"
              : `${muets.length} systèmes cibles ne sont pas observés`
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
            desc={
              `Dont ${sorties} sortie${sorties > 1 ? "s" : ""} du référentiel ` +
              `et ${arrivees} arrivée${arrivees > 1 ? "s" : ""} à acter` +
              reserveSurLesArrivees
            }
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
      <section className={fr.cx("fr-mt-6w")}>
        <h2>Inventaire</h2>

        <p className={fr.cx("fr-text--sm")}>
          Le tableau et les chiffres qui suivent sortent de la base, donc de la dernière collecte :
          ils disent le dernier état constaté, jamais l'état du jour, et aucun n'est demandé à un
          système au moment où vous lisez cette page. Les tuiles du bas, elles, appartiennent aux
          connecteurs et disent chacune d'où elles tiennent leur chiffre.
        </p>

        <p className={fr.cx("fr-text--sm")}>
          {muets.length === 0
            ? `${lus} système${lus > 1 ? "s" : ""} sur ${attendus.length} lu${lus > 1 ? "s" : ""} dans les délais.`
            : `${lus} système${lus > 1 ? "s" : ""} sur ${attendus.length} lu${lus > 1 ? "s" : ""} dans les délais, ${muets.length} non observé${muets.length > 1 ? "s" : ""}.`}{" "}
          <a href="/collectes">Le détail des collectes</a>.
        </p>

        <Table
          caption="Comptes observés sur chaque système"
          headers={[
            "Système",
            "Comptes",
            "Dont administrateurs",
            "Dont membres",
            "Invitations en attente",
            "Ce que vaut cette ligne",
          ]}
          data={inventaire.systemes.map((ligne) => [
            <code key="s">{ligne.provider}</code>,
            ligne.comptes === null ? "non observé" : ligne.comptes,
            nombre(ligne, ligne.administrateurs),
            nombre(ligne, ligne.membres),
            ligne.comptes === null
              ? "non observé"
              : ligne.invitationObserveeDepuis
                ? `${ligne.invitations}, la plus ancienne observée depuis le ${dateFr.format(ligne.invitationObserveeDepuis)}`
                : String(ligne.invitations),
            observation(ligne),
          ])}
        />

        <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters", "fr-mt-2w")}>
          <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
            <Tile
              title={`${suivies.length} personne${suivies.length > 1 ? "s" : ""} suivie${suivies.length > 1 ? "s" : ""}`}
              desc={`Dont ${sansEcheance} sans échéance connue.`}
              linkProps={{ href: "/personnes" }}
              orientation="horizontal"
            />
          </div>
          <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
            <Tile
              title={`${inventaire.nonRevocables.total} compte${inventaire.nonRevocables.total > 1 ? "s" : ""} non révocable${inventaire.nonRevocables.total > 1 ? "s" : ""}`}
              desc={`${inventaire.nonRevocables.sansDetenteur} sans détenteur, ${inventaire.nonRevocables.ressemblance} rattaché${inventaire.nonRevocables.ressemblance > 1 ? "s" : ""} par ressemblance à confirmer.`}
              linkProps={{ href: "/comptes-isoles" }}
              orientation="horizontal"
            />
          </div>
          <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
            <Tile
              title={`${inventaire.comptesDeService.suivis} compte${inventaire.comptesDeService.suivis > 1 ? "s" : ""} de service`}
              desc={`Dont ${inventaire.comptesDeService.enRetard} en retard de revue.`}
              linkProps={{ href: "/comptes-de-service" }}
              orientation="horizontal"
            />
          </div>
          <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
            <Tile
              title={`${inventaire.startups.suivies} startup${inventaire.startups.suivies > 1 ? "s" : ""}`}
              desc={`Dont ${inventaire.startups.terminales} en phase terminale et portant encore quelqu'un, ce qui ne justifie plus aucun accès.`}
              linkProps={{ href: "/startups" }}
              orientation="horizontal"
            />
          </div>
          <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
            <Tile
              title={`${inventaire.operationsTracees} opération${inventaire.operationsTracees > 1 ? "s" : ""} tracée${inventaire.operationsTracees > 1 ? "s" : ""}`}
              desc={`Sur ${FENETRE_JOURNAL_JOURS} jours. Compteur approximatif : le journal s'écrit sans attendre, donc une panne d'écriture ne se voit pas. C'est une preuve d'activité, pas une mesure de couverture. L'écran, lui, montre tout l'historique.`}
              linkProps={{ href: "/journal" }}
              orientation="horizontal"
            />
          </div>
        </div>

        <TuilesDeConnecteurs maintenant={today} />
      </section>
    </main>
  );
}

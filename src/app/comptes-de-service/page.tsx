import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";

import { type EtatRevue, LIBELLE_REVUE, revueDe } from "@/core/revue";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";

import { BoutonRevue } from "./BoutonRevue";

export const metadata: Metadata = { title: "Comptes de service" };

export const dynamic = "force-dynamic";

const SEVERITE: Record<EtatRevue, "success" | "warning" | "error"> = {
  A_JOUR: "success",
  BIENTOT: "warning",
  EN_RETARD: "error",
};

const ORDRE: Record<EtatRevue, number> = { EN_RETARD: 0, BIENTOT: 1, A_JOUR: 2 };

export default async function ComptesDeServicePage() {
  await requireOperateur();

  const today = new Date();

  const comptes = await prisma.serviceAccount.findMany({
    select: {
      key: true,
      label: true,
      purpose: true,
      ownerUsername: true,
      reviewEveryDays: true,
      lastReviewedAt: true,
      createdAt: true,
    },
  });

  const declarees = new Set(policy().serviceAccounts.map((compte) => compte.key));

  const avecRevue = comptes
    .map((compte) => ({
      ...compte,
      revue: revueDe(compte, today),
      declare: declarees.has(compte.key),
    }))
    .sort(
      (a, b) =>
        ORDRE[a.revue.etat] - ORDRE[b.revue.etat] ||
        a.revue.echeance.getTime() - b.revue.echeance.getTime() ||
        a.key.localeCompare(b.key),
    );

  const enRetard = avecRevue.filter((compte) => compte.revue.etat === "EN_RETARD").length;
  const retires = avecRevue.filter((compte) => !compte.declare).length;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Comptes de service</h1>

      <p className={fr.cx("fr-text--lead")}>
        Bots, jetons d'intégration continue et clés d'API. Ils n'ont pas de fin de mission : la
        revue périodique est le seul signal qu'ils puissent émettre, et une revue en retard est un
        constat au même titre qu'un accès expiré.
      </p>

      {avecRevue.length === 0 ? (
        <p>
          Aucun compte de service. Ces comptes sont déclarés dans <code>config/accounts.yaml</code>{" "}
          et la synchronisation les reporte ici : ils ne se découvrent pas.
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            {avecRevue.length} compte{avecRevue.length > 1 ? "s" : ""} suivi
            {avecRevue.length > 1 ? "s" : ""},{" "}
            {enRetard === 0 ? "aucune revue en retard." : `${enRetard} en retard de revue.`}
          </p>

          <Table
            headers={[
              "Compte",
              "Objet",
              "Propriétaire",
              "Périodicité",
              "Dernière revue",
              "Revue",
              "",
            ]}
            data={avecRevue.map((compte) => [
              <span key="c">
                {compte.label}
                <br />
                <span className={fr.cx("fr-text--sm")}>{compte.key}</span>
                {compte.declare ? null : (
                  <>
                    <br />
                    <Badge severity="warning" small noIcon>
                      Retiré de la politique
                    </Badge>
                  </>
                )}
              </span>,
              compte.purpose,
              compte.ownerUsername,
              `tous les ${compte.reviewEveryDays} jours`,
              compte.lastReviewedAt ? dateFr.format(compte.lastReviewedAt) : "jamais revu",
              <span key="r">
                <Badge severity={SEVERITE[compte.revue.etat]} noIcon>
                  {LIBELLE_REVUE[compte.revue.etat]}
                </Badge>
                <br />
                <span className={fr.cx("fr-text--sm")}>
                  {compte.revue.etat === "EN_RETARD"
                    ? `depuis ${compte.revue.joursDeRetard} jour${compte.revue.joursDeRetard > 1 ? "s" : ""}`
                    : `attendue le ${dateFr.format(compte.revue.echeance)}`}
                </span>
              </span>,
              <BoutonRevue key="a" compteKey={compte.key} />,
            ])}
          />

          {retires > 0 ? (
            <section className={fr.cx("fr-mt-4w")}>
              <h2 className={fr.cx("fr-h5")}>Comptes retirés de la politique</h2>
              <p>
                {retires} compte{retires > 1 ? "s" : ""} ne figure{retires > 1 ? "nt" : ""} plus
                dans <code>config/accounts.yaml</code> mais reste{retires > 1 ? "nt" : ""} en base.
                La synchronisation ne supprime rien : les accès du compte existent toujours sur les
                systèmes cibles, et effacer la ligne ferait perdre son propriétaire et le
                rattachement de ses identités, qui reviendraient dès la collecte suivante comme
                comptes isolés. Le retrait se traite en coupant les accès, puis en supprimant la
                ligne à la main.
              </p>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

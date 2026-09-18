import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";

import { systemesQuiAccueillentUnCompteMachine } from "@/connectors";
import { type EtatRevue, LIBELLE_REVUE, revueDe } from "@/core/revue";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";

import { BoutonRevue } from "./BoutonRevue";
import { Declarer } from "./Declarer";

export const metadata: Metadata = { title: "Comptes de service" };

export const dynamic = "force-dynamic";

const SEVERITE: Record<EtatRevue, "success" | "warning" | "error" | "info"> = {
  A_JOUR: "success",
  BIENTOT: "warning",
  EN_RETARD: "error",
  // Éteint, et non en faute : un jeton dont le terme est passé n'ouvre plus rien, et il
  // n'y a rien à demander à personne.
  EXPIRE: "info",
};

const ORDRE: Record<EtatRevue, number> = { EN_RETARD: 0, BIENTOT: 1, A_JOUR: 2, EXPIRE: 3 };

export default async function ComptesDeServicePage() {
  await requireOperateur();

  const today = new Date();

  const comptes = await prisma.serviceAccount.findMany({
    select: {
      key: true,
      label: true,
      provider: true,
      purpose: true,
      ownerUsername: true,
      reviewEveryDays: true,
      lastReviewedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  const avecRevue = comptes
    .map((compte) => ({ ...compte, revue: revueDe(compte, today) }))
    .sort(
      (a, b) =>
        ORDRE[a.revue.etat] - ORDRE[b.revue.etat] ||
        a.revue.echeance.getTime() - b.revue.echeance.getTime() ||
        a.key.localeCompare(b.key),
    );

  const enRetard = avecRevue.filter((compte) => compte.revue.etat === "EN_RETARD").length;

  const systemes = systemesQuiAccueillentUnCompteMachine();
  const libelleDuSysteme = new Map(systemes.map(({ key, label }) => [key, label]));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Comptes de service</h1>

      <p className={fr.cx("fr-text--lead")}>
        Bots, jetons d'intégration continue et clés d'API. Ils n'ont pas de fin de mission : c'est
        la revue périodique qui les remet en question, et une revue en retard est un constat au même
        titre qu'un accès expiré.
      </p>

      <div className={fr.cx("fr-mb-4w")}>
        <Declarer systemes={systemes} />
      </div>

      {avecRevue.length === 0 ? (
        <p>
          Aucun compte de service. Un compte machine ne se découvre pas : il se déclare ici, et son
          compte constaté s'y rattache depuis la file des comptes isolés.
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
              "Système",
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
              </span>,
              // Le libellé du registre quand il existe, et la clé brute sinon : un système
              // retiré du registre laisse ses comptes derrière lui, et les afficher sans
              // système donnerait à croire qu'ils n'en ont jamais eu.
              libelleDuSysteme.get(compte.provider) ?? compte.provider,
              compte.purpose,
              compte.ownerUsername,
              // La périodicité ne dit rien d'un compte dont un terme porte la péremption :
              // elle vaut la durée de ce terme, et l'afficher ferait lire une cadence là où
              // il n'y a qu'une date de mort.
              compte.revue.reclamee ? `tous les ${compte.reviewEveryDays} jours` : "sans revue",
              compte.lastReviewedAt ? dateFr.format(compte.lastReviewedAt) : "jamais revu",
              <span key="r">
                <Badge severity={SEVERITE[compte.revue.etat]} noIcon>
                  {LIBELLE_REVUE[compte.revue.etat]}
                </Badge>
                <br />
                <span className={fr.cx("fr-text--sm")}>
                  {compte.revue.etat === "EN_RETARD"
                    ? `depuis ${compte.revue.joursDeRetard} jour${compte.revue.joursDeRetard > 1 ? "s" : ""}`
                    : compte.revue.etat === "EXPIRE"
                      ? "plus rien à revoir"
                      : compte.expiresAt
                        ? `meurt de lui-même le ${dateFr.format(compte.expiresAt)}`
                        : `attendue le ${dateFr.format(compte.revue.echeance)}`}
                </span>
              </span>,
              // Aucun bouton là où il ne changerait rien : le terme reprend la main au calcul
              // suivant, et un bouton qui ne fait rien apprend à ne plus lire la colonne.
              compte.revue.reclamee ? <BoutonRevue key="a" compteKey={compte.key} /> : null,
            ])}
          />
        </>
      )}
    </main>
  );
}

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";
import { collecteEnCours } from "@/lib/sync/executer";
import { BoutonCollecte } from "./BoutonCollecte";

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

const SEVERITE = {
  OK: "success",
  PARTIAL: "warning",
  FAILED: "error",
  SKIPPED: "info",
} as const;

const EXPLICATION = {
  OK: "Relevé complet, les disparitions ont pu être datées.",
  PARTIAL: "Relevé incomplet : aucune disparition n'a été datée.",
  FAILED: "Le système n'a pas répondu.",
  SKIPPED: "Système non lu, ce qui n'est pas la même chose que sans écart.",
} as const;

function duree(debut: Date, fin: Date | null): string {
  if (!fin) {
    return "en cours";
  }
  const secondes = Math.round((fin.getTime() - debut.getTime()) / 1000);
  return secondes < 60 ? `${secondes} s` : `${Math.floor(secondes / 60)} min ${secondes % 60} s`;
}

function messages(error: unknown): string[] {
  if (error && typeof error === "object" && "messages" in error) {
    const brut = (error as { messages: unknown }).messages;
    return Array.isArray(brut) ? brut.map(String) : [];
  }
  return [];
}

export default async function CollectesPage() {
  await requireOperateur();

  const maintenant = new Date();
  const [runs, enCours] = await Promise.all([
    prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 60,
      select: {
        id: true,
        provider: true,
        capability: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        itemsSeen: true,
        error: true,
      },
    }),
    collecteEnCours(maintenant),
  ]);

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Collectes</h1>

      <p className={fr.cx("fr-text--sm")}>
        Une collecte lit les systèmes cibles et le référentiel des personnes, puis en tire des
        constats. Elle ne modifie aucun accès. Le traitement quotidien la lance chaque nuit ; ce
        bouton sert quand on ne veut pas attendre la nuit.
      </p>

      {enCours ? (
        <Alert
          severity="info"
          className={fr.cx("fr-mb-3w")}
          title="Une collecte est en cours"
          description={`Démarrée à ${dateFr.format(enCours.depuis)} sur ${enCours.provider}. Rafraîchissez cette page pour voir où elle en est.`}
        />
      ) : null}

      <div className={fr.cx("fr-mb-4w")}>
        <BoutonCollecte enCours={enCours !== null} />
      </div>

      {runs.length === 0 ? (
        <p>Aucune collecte n'a encore eu lieu.</p>
      ) : (
        <Table
          fixed
          caption="Dernières exécutions, du plus récent au plus ancien"
          headers={["Système", "Début", "Durée", "État", "Éléments", "Ce qui a été dit"]}
          data={runs.map((run) => [
            <strong key="s">{run.provider}</strong>,
            dateFr.format(run.startedAt),
            duree(run.startedAt, run.finishedAt),
            <Badge key="e" severity={SEVERITE[run.status]} small noIcon>
              {run.status}
            </Badge>,
            run.status === "SKIPPED" ? "sans objet" : run.itemsSeen,
            <span key="m" className={fr.cx("fr-text--sm")}>
              {messages(run.error).join(" / ") || EXPLICATION[run.status]}
            </span>,
          ])}
        />
      )}
    </main>
  );
}

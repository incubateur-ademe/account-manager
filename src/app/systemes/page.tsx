import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import { CONNECTEURS } from "@/connectors";
import { type Capability, resolveCapability, type Tier } from "@/core/connector";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

const CAPACITES: { cle: Capability; libelle: string; quoi: string }[] = [
  { cle: "list", libelle: "Lire", quoi: "relever les comptes et leurs accès" },
  { cle: "revoke", libelle: "Retirer", quoi: "couper un accès" },
  { cle: "grant", libelle: "Donner", quoi: "ouvrir un accès" },
  { cle: "verify", libelle: "Vérifier", quoi: "confirmer l'état après coup" },
];

const TIER: Record<Tier, { libelle: string; severite: "success" | "warning" | "info" | "error" }> =
  {
    auto: { libelle: "automatique", severite: "success" },
    assisted: { libelle: "assisté", severite: "info" },
    manual: { libelle: "manuel", severite: "warning" },
    none: { libelle: "indisponible", severite: "error" },
  };

export default async function SystemesPage() {
  await requireOperateur();

  const systemes = await Promise.all(
    CONNECTEURS.map(async (connecteur) => {
      const contrat = connecteur.contract;
      const sondes = await connecteur.probe();

      return {
        contrat,
        sondes,
        capacites: CAPACITES.map((capacite) => ({
          ...capacite,
          resolue: resolveCapability(
            capacite.cle,
            contrat.capabilities[capacite.cle],
            sondes,
            contrat.runbook,
          ),
        })),
        dernierReleve: await prisma.syncRun.findFirst({
          where: { provider: contrat.key, capability: "list" },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, status: true, itemsSeen: true },
        }),
      };
    }),
  );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Systèmes couverts</h1>

      <p className={fr.cx("fr-text--sm")}>
        Ce que l'outil sait faire sur chaque système, tel que ses credentials le permettent
        aujourd'hui et non tel que le code l'espère. Un chemin automatique qui tombe redevient un
        chemin manuel : la marche à suivre est donc toujours affichée, même là où tout est
        automatique.
      </p>

      {systemes.map(({ contrat, sondes, capacites, dernierReleve }) => (
        <section key={contrat.key} className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h4", "fr-mb-1v")}>
            {contrat.label}{" "}
            <span className={fr.cx("fr-text--sm")}>
              <code>{contrat.key}</code>
            </span>
          </h2>

          <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>
            {dernierReleve
              ? `Dernier relevé le ${dateFr.format(dernierReleve.startedAt)}, état ${dernierReleve.status}, ${dernierReleve.itemsSeen} comptes.`
              : "Jamais relevé."}
          </p>

          <Table
            fixed
            caption={`Capacités sur ${contrat.label}`}
            headers={[
              "Capacité",
              "Aujourd'hui",
              "Ce qui manque pour faire mieux",
              "Marche à suivre",
            ]}
            data={capacites.map(({ libelle, quoi, resolue }) => [
              <span key="c">
                <strong>{libelle}</strong>
                <br />
                <span className={fr.cx("fr-text--sm")}>{quoi}</span>
              </span>,
              <Badge key="t" severity={TIER[resolue.tier].severite} small noIcon>
                {TIER[resolue.tier].libelle}
              </Badge>,
              resolue.degradedFrom ? (
                <span key="m" className={fr.cx("fr-text--sm")}>
                  {TIER[resolue.degradedFrom.tier].libelle} si :{" "}
                  {resolue.degradedFrom.missing.join(", ")}
                </span>
              ) : (
                <span key="m" className={fr.cx("fr-text--sm")}>
                  —
                </span>
              ),
              <span key="r" className={fr.cx("fr-text--sm")}>
                {resolue.tier === "auto" ? "" : resolue.runbook}
              </span>,
            ])}
          />

          <p className={fr.cx("fr-text--sm", "fr-mt-1w")}>
            Credentials :{" "}
            {sondes.length === 0
              ? "aucun requis"
              : sondes
                  .map(
                    (sonde) =>
                      `${sonde.id} ${sonde.available ? "présent" : `absent (${sonde.unavailableReason ?? "raison non précisée"})`}`,
                  )
                  .join(" / ")}
          </p>
        </section>
      ))}

      <Alert
        severity="info"
        className={fr.cx("fr-mt-4w")}
        small
        description="Un système absent de cette page n'est pas couvert : ni relevé, ni signalé. Le catalogue de la politique, lui, ne sert encore à rien, aucun code ne le lit."
      />
    </main>
  );
}

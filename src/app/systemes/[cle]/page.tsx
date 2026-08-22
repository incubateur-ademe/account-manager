import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { Table } from "@codegouvfr/react-dsfr/Table";
import { notFound } from "next/navigation";

import { connecteur } from "@/connectors";
import { resolveFeatures } from "@/core/connector";
import { configurationDe } from "@/lib/configuration-connecteur";
import { requireOperateur } from "@/lib/session";
import { aUnePage, ecranDe } from "@/ui/connecteurs/registre";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ cle: string }>;
}

export default async function ConnecteurPage({ params }: Props) {
  await requireOperateur();

  const { cle } = await params;
  const systeme = connecteur(cle);

  if (!systeme || !aUnePage(systeme.contract)) {
    notFound();
  }

  const contrat = systeme.contract;
  const sondes = await systeme.probe();
  const fonctionnalites = resolveFeatures(contrat.features, sondes);
  const configuration = contrat.configSchema ? configurationDe<unknown>(contrat) : undefined;

  const chargeur = ecranDe(cle);
  const Ecran = chargeur ? (await chargeur()).default : undefined;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel={contrat.label}
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Systèmes couverts", linkProps: { href: "/systemes" } }]}
      />

      <h1>{contrat.label}</h1>

      <p className={fr.cx("fr-text--sm")}>
        Ce que ce connecteur regarde, et ce qu'il sait faire en dehors du socle. Les capacités
        elles-mêmes, communes à tous les systèmes, restent sur l'écran Systèmes.
      </p>

      <h2 className={fr.cx("fr-h5", "fr-mt-4w")}>Credentials</h2>

      <p className={fr.cx("fr-text--sm")}>
        {sondes.length === 0
          ? "Aucun requis."
          : sondes
              .map(
                (sonde) =>
                  `${sonde.id} ${sonde.available ? "présent" : `absent (${sonde.unavailableReason ?? "raison non précisée"})`}`,
              )
              .join(" / ")}
      </p>

      {contrat.credentials.map((credential) => (
        <p key={credential.id} className={fr.cx("fr-text--sm")}>
          <code>{credential.id}</code> {credential.nominative ? "nominatif" : "non nominatif"},
          depuis {credential.source === "env" ? "l'environnement" : "fine-grained-proxy"}.{" "}
          {credential.scopeNote}
        </p>
      ))}

      <h2 className={fr.cx("fr-h5", "fr-mt-4w")}>Configuration</h2>

      {configuration === undefined ? (
        <p className={fr.cx("fr-text--sm")}>Ce connecteur ne se règle pas.</p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            Telle qu'elle est résolue, défauts compris, et non telle que le fichier l'écrit : c'est
            ce que le connecteur va vraiment faire. Elle s'édite dans la clé{" "}
            <code>connectors.{contrat.key}</code> du fichier <code>config.yaml</code> de la
            politique.
          </p>
          <pre
            className={fr.cx("fr-text--xs")}
            style={{
              margin: 0,
              maxHeight: "18rem",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(configuration, null, 2)}
          </pre>
        </>
      )}

      <h2 className={fr.cx("fr-h5", "fr-mt-4w")}>Fonctionnalités hors socle</h2>

      {fonctionnalites.length === 0 ? (
        <p className={fr.cx("fr-text--sm")}>
          Aucune. Ce connecteur ne fait que ce que le socle sait faire.
        </p>
      ) : (
        <Table
          fixed
          caption={`Fonctionnalités propres à ${contrat.label}`}
          headers={["Fonctionnalité", "Disponibilité", "Ce qui manque"]}
          data={fonctionnalites.map(({ feature, available, missing }) => [
            <span key="f">
              <strong>{feature.label}</strong>
              <br />
              <span className={fr.cx("fr-text--sm")}>
                <code>{feature.key}</code>
              </span>
            </span>,
            <Badge key="d" severity={available ? "success" : "warning"} small noIcon>
              {available ? "disponible" : "indisponible"}
            </Badge>,
            <span key="m" className={fr.cx("fr-text--sm")}>
              {missing.length === 0 ? "sans objet" : missing.join(", ")}
            </span>,
          ])}
        />
      )}

      {Ecran ? <Ecran contrat={contrat} configuration={configuration} /> : null}

      <Alert
        severity="info"
        className={fr.cx("fr-mt-4w")}
        small
        description="Cet écran ne modifie rien. Ce qui s'y règle vit dans le dépôt de configuration, où le changement se relit avant d'être appliqué."
      />
    </main>
  );
}

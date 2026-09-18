import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { connecteur } from "@/connectors";
import { resolveFeatures } from "@/core/connector";
import { type EtatRevue, LIBELLE_REVUE, revueDe } from "@/core/revue";
import { configurationDe } from "@/lib/configuration-connecteur";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";
import { aUnePage, ecranDe } from "@/ui/connecteurs/registre";
import { dateFr } from "@/ui/dates";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ cle: string }>;
}

const SEVERITE: Record<EtatRevue, "success" | "warning" | "error"> = {
  A_JOUR: "success",
  BIENTOT: "warning",
  EN_RETARD: "error",
};

const ORDRE: Record<EtatRevue, number> = { EN_RETARD: 0, BIENTOT: 1, A_JOUR: 2 };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireOperateur();

  const { cle } = await params;
  const systeme = connecteur(cle);

  return {
    title: systeme && aUnePage(systeme.contract) ? systeme.contract.label : "Système introuvable",
  };
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

  // Les comptes machine de ce système, y compris ceux qu'aucune collecte n'a jamais vus :
  // un système en tier manuel n'en constate aucun, et c'est justement là que la liste
  // manquait le plus. Ils portent le système en colonne plutôt que par leurs identités,
  // dont ils n'ont pas forcément.
  const comptesMachine = await prisma.serviceAccount.findMany({
    where: { provider: cle },
    select: {
      key: true,
      label: true,
      ownerUsername: true,
      reviewEveryDays: true,
      lastReviewedAt: true,
      createdAt: true,
    },
    orderBy: { key: "asc" },
  });

  const maintenant = new Date();
  const avecRevue = comptesMachine
    .map((compte) => ({ ...compte, revue: revueDe(compte, maintenant) }))
    .sort((a, b) => ORDRE[a.revue.etat] - ORDRE[b.revue.etat] || a.key.localeCompare(b.key));

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

      <h2 className={fr.cx("fr-h5", "fr-mt-4w")}>Comptes de service</h2>

      {avecRevue.length === 0 ? (
        <p className={fr.cx("fr-text--sm")}>
          Aucun compte machine déclaré sur ce système. Ils ne se découvrent pas : un compte constaté
          se déclare depuis la file des comptes isolés, et un jeton que rien ne relève depuis
          l'écran « Comptes de service ».
        </p>
      ) : (
        <Table
          fixed
          caption={`Comptes machine déclarés sur ${contrat.label}`}
          headers={["Compte", "Propriétaire", "Revue"]}
          data={avecRevue.map((compte) => [
            <span key="c">
              <strong>{compte.label}</strong>
              <br />
              <span className={fr.cx("fr-text--sm")}>
                <code>{compte.key}</code>
              </span>
            </span>,
            compte.ownerUsername,
            <span key="r">
              <Badge severity={SEVERITE[compte.revue.etat]} small noIcon>
                {LIBELLE_REVUE[compte.revue.etat]}
              </Badge>
              <br />
              <span className={fr.cx("fr-text--sm")}>
                {compte.revue.etat === "EN_RETARD"
                  ? `depuis ${compte.revue.joursDeRetard} jour${compte.revue.joursDeRetard > 1 ? "s" : ""}`
                  : `attendue le ${dateFr.format(compte.revue.echeance)}`}
              </span>
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

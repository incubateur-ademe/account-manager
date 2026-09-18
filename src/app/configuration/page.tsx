import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import { cheminsConnus, lire, type Niveau } from "@/core/configuration";
import { policySchema } from "@/core/policy";
import {
  policy,
  politiqueEntierementParDefaut,
  provenancesDeLaPolitique,
  variablesInconnues,
} from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { Reglage } from "./Reglage";

export const metadata = { title: "Configuration" };

const LIBELLE: Record<
  Niveau | "defaut",
  { libelle: string; severite: "info" | "success" | "new" }
> = {
  defaut: { libelle: "défaut", severite: "info" },
  environnement: { libelle: "environnement", severite: "info" },
  fichier: { libelle: "fichier", severite: "new" },
  base: { libelle: "réglé ici", severite: "success" },
};

/**
 * Les garde-fous, nommés parce qu'ils sont absents. Quelqu'un qui cherche à couper les
 * écritures ou à s'ajouter aux opérateurs doit trouver ici pourquoi il ne peut pas, plutôt
 * que de conclure que l'écran est incomplet.
 */
const GARDE_FOUS = [
  ["ACTIONS_ENABLED", "autorise ou interdit toute écriture sur un système tiers"],
  ["OPERATORS", "qui peut ouvrir l'outil et exécuter un plan"],
  ["BREAK_GLASS_USERNAMES", "qui peut entrer hors de cette liste, et le voit tracé"],
  ["DATABASE_URL", "la base elle-même"],
  ["AUTH_SECRET", "la signature des sessions"],
  ["les credentials des connecteurs", "ce qui ouvre un système tiers"],
] as const;

function affiche(valeur: unknown): string {
  if (valeur === undefined) {
    return "";
  }
  return Array.isArray(valeur) ? valeur.join(", ") : String(valeur);
}

export default async function Configuration() {
  await requireOperateur();

  const reglages = policy() as unknown as Record<string, unknown>;
  const provenances = new Map(
    provenancesDeLaPolitique().map((provenance) => [provenance.chemin, provenance.niveau]),
  );
  const inconnues = variablesInconnues();

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Configuration</h1>

      <p className={fr.cx("fr-text--sm")}>
        Ce que l'outil applique aujourd'hui, et d'où il le tient. Une valeur réglée ici l'emporte
        sur le fichier de politique, qui l'emporte lui-même sur l'environnement. La lever rend la
        main à qui la portait avant, et non au défaut.
      </p>

      {politiqueEntierementParDefaut() ? (
        <Alert
          as="h2"
          severity="warning"
          title="Aucune politique nulle part"
          description="Ni fichier, ni variable CONFIG_, ni réglage ici. Tout ce qui suit vient des défauts du schéma, et le périmètre ne suit personne. C'est ce qu'un POLICY_DIR mal pointé produit."
          className={fr.cx("fr-mb-4w")}
        />
      ) : null}

      {inconnues.length > 0 ? (
        <Alert
          as="h2"
          severity="warning"
          title="Des variables d'environnement ne règlent rien"
          description={`${inconnues.join(", ")} : aucun réglage ne porte ce nom.`}
          className={fr.cx("fr-mb-4w")}
        />
      ) : null}

      <Table
        fixed
        caption="Réglages"
        headers={["Réglage", "Aujourd'hui", "D'où", "Régler"]}
        data={cheminsConnus(policySchema).map((connu) => {
          const niveau = provenances.get(connu.chemin) ?? "defaut";

          return [
            <span key="c">
              <strong>{connu.chemin}</strong>
              <br />
              <span className={fr.cx("fr-text--sm")}>{connu.variable}</span>
            </span>,
            <span key="v" className={fr.cx("fr-text--sm")}>
              {affiche(lire(reglages, connu.chemin))}
            </span>,
            <Badge key="p" severity={LIBELLE[niveau].severite} small noIcon>
              {LIBELLE[niveau].libelle}
            </Badge>,
            <Reglage
              key="r"
              chemin={connu.chemin}
              forme={connu.forme}
              valeur={affiche(lire(reglages, connu.chemin))}
              regle={niveau === "base"}
            />,
          ];
        })}
      />

      <h2 className={fr.cx("fr-h4", "fr-mt-6w")}>Ce qui ne se règle pas ici</h2>

      <p className={fr.cx("fr-text--sm")}>
        Ces valeurs vivent dans l'environnement du déploiement et rien ne peut les y surcharger. Un
        interrupteur général qu'une interface peut rouvrir n'est pas un interrupteur.
      </p>

      <Table
        fixed
        caption="Garde-fous et branchement"
        headers={["Nom", "Ce qu'il tient"]}
        data={GARDE_FOUS.map(([nom, quoi]) => [
          <code key="n">{nom}</code>,
          <span key="q" className={fr.cx("fr-text--sm")}>
            {quoi}
          </span>,
        ])}
      />
    </main>
  );
}

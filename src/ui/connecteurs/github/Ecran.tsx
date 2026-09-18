import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";

import type { ConfigGithub } from "@/connectors/github";
import type { ProprietesEcran } from "@/ui/connecteurs/registre";

export default function EcranGithub({ configuration }: ProprietesEcran) {
  // La valeur sort du `configSchema` de ce contrat, appliqué juste avant par le socle
  // de configuration : elle a déjà la forme que ce cast affirme.
  const { organisations } = configuration as ConfigGithub;

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Organisations suivies</h2>

      <ul className={fr.cx("fr-mb-2w")}>
        {organisations.map((organisation) => (
          <li key={organisation}>
            <a
              href={`https://github.com/orgs/${organisation}/people`}
              target="_blank"
              rel="noreferrer"
              title={`Membres de ${organisation} sur GitHub, nouvelle fenêtre`}
            >
              {organisation}
            </a>
          </li>
        ))}
      </ul>

      <Alert
        severity="warning"
        small
        description="Retirer une organisation d'ici n'est pas un réglage d'affichage. La collecte suivante datera la disparition des comptes qui n'y sont plus vus, et le départ de leurs titulaires s'ensuivra. En ajouter une fait entrer ses membres dans le suivi, à la collecte suivante."
      />
    </section>
  );
}

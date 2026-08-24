import { fr } from "@codegouvfr/react-dsfr";

import { CONTRAT_GITHUB, type ConfigGithub } from "@/connectors/github";
import { configurationDe } from "@/lib/configuration-connecteur";
import { env } from "@/lib/env";

import type { ContexteTuile, TuileDeConnecteur } from "../contrat";

const API = "https://api.github.com";
const PAR_PAGE = 100;
const PAGES_MAX = 50;

/**
 * Ce que l'API GitHub répond quand le jeton n'a pas de quoi lire les membres d'une
 * organisation. Le filtre `2fa_disabled` demande un droit de propriétaire, que le
 * jeton de collecte, restreint à la lecture, n'a aucune raison de porter. Le
 * distinguer d'une liste vide n'est pas un détail : « aucun compte sans double
 * authentification » et « je n'ai pas le droit de regarder » se ressemblent trait pour
 * trait, et la seconde ne rassure pas.
 */
class NonLisible extends Error {}

/**
 * GitHub pagine à cent et ne dit jamais combien il reste : lire la première page et
 * prendre sa longueur plafonne le chiffre à cent en silence. On demande donc la page
 * suivante jusqu'à ce qu'elle soit incomplète, comme le fait la collecte.
 */
async function compterSansDeuxFacteurs(
  organisation: string,
  jeton: string,
  signal: AbortSignal,
): Promise<number> {
  let total = 0;

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const url = `${API}/orgs/${encodeURIComponent(organisation)}/members?filter=2fa_disabled&per_page=${PAR_PAGE}&page=${page}`;
    const reponse = await fetch(url, {
      headers: { authorization: `Bearer ${jeton}`, accept: "application/vnd.github+json" },
      signal,
    });

    if (reponse.status === 403 || reponse.status === 404) {
      throw new NonLisible(organisation);
    }
    if (!reponse.ok) {
      throw new Error(`GitHub a répondu ${reponse.status}`);
    }

    const lot: unknown = await reponse.json();
    if (!Array.isArray(lot)) {
      throw new Error("réponse inattendue");
    }

    total += lot.length;
    if (lot.length < PAR_PAGE) {
      return total;
    }
  }

  return total;
}

async function deuxFacteurs(contexte: ContexteTuile) {
  const jeton = env.GITHUB_TOKEN;
  if (!jeton) {
    return (
      <p className={fr.cx("fr-mb-0")}>
        Jeton GitHub absent de l'environnement : ce chiffre ne peut pas être demandé.
      </p>
    );
  }

  const { organisations } = configurationDe<ConfigGithub>(CONTRAT_GITHUB);

  const comptes = await Promise.all(
    organisations.map(async (organisation) => {
      try {
        return {
          organisation,
          sans: await compterSansDeuxFacteurs(organisation, jeton, contexte.signal),
        };
      } catch (erreur) {
        if (erreur instanceof NonLisible) {
          return { organisation, sans: null };
        }
        throw erreur;
      }
    }),
  );

  const lisibles = comptes.filter((compte) => compte.sans !== null);
  const interdites = comptes.filter((compte) => compte.sans === null);

  const total = lisibles.reduce((somme, compte) => somme + (compte.sans ?? 0), 0);

  return (
    <>
      {lisibles.length > 0 ? (
        <>
          <p className={fr.cx("fr-h4", "fr-mb-0")}>{total}</p>
          <p className={fr.cx("fr-mb-0")}>
            {total > 1 ? "comptes membres" : "compte membre"} sans double authentification sur{" "}
            {lisibles.map((compte) => compte.organisation).join(", ")}.
          </p>
        </>
      ) : null}
      {interdites.length > 0 ? (
        <p className={fr.cx("fr-mb-0", "fr-mt-1w")}>
          Non lisible avec ce jeton sur {interdites.map((compte) => compte.organisation).join(", ")}{" "}
          : le filtre demande un droit de propriétaire de l'organisation. Ce n'est pas un zéro.
        </p>
      ) : null}
    </>
  );
}

export const tuiles: readonly TuileDeConnecteur[] = [
  {
    cle: "deux-facteurs",
    titre: "GitHub sans double authentification",
    provenance: "systeme",
    charger: deuxFacteurs,
  },
];

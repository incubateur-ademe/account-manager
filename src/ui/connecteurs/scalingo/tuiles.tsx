import { fr } from "@codegouvfr/react-dsfr";

import { env } from "@/lib/env";

import type { ContexteTuile, TuileDeConnecteur } from "../contrat";

const AUTH = "https://auth.scalingo.com";

interface Collaboration {
  email?: unknown;
  tfa_status?: unknown;
}

async function lire(url: string, porteur: string, signal: AbortSignal): Promise<unknown> {
  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${porteur}`, accept: "application/json" },
    signal,
  });

  if (!reponse.ok) {
    throw new Error(`Scalingo a répondu ${reponse.status}`);
  }
  return reponse.json();
}

/**
 * La tuile refait son propre chemin plutôt que d'emprunter celui de la collecte, comme
 * celle de GitHub : ce qu'elle affiche ne fonde aucune décision de coupure, et son
 * contexte ne lui donne ni journal ni identifiant de run pour qu'elle ne puisse rien
 * laisser derrière elle.
 */
async function sansDeuxFacteurs(contexte: ContexteTuile) {
  const jeton = env.SCALINGO_API_TOKEN;
  if (!jeton) {
    return (
      <p className={fr.cx("fr-mb-0")}>
        Jeton Scalingo absent de l'environnement : ce chiffre ne peut pas être demandé.
      </p>
    );
  }

  const echange = await fetch(`${AUTH}/v1/tokens/exchange`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`:${jeton}`).toString("base64")}` },
    signal: contexte.signal,
  });

  if (!echange.ok) {
    throw new Error(`l'échange du jeton a répondu ${echange.status}`);
  }

  const porteur = ((await echange.json()) as { token: string }).token;
  const regions = (
    (await lire(`${AUTH}/v1/regions`, porteur, contexte.signal)) as {
      regions: { api: string }[];
    }
  ).regions;

  // La vue consolidée suffit ici, et c'est le seul endroit où sa limite devient une
  // qualité : elle ne rend que les applications que le compte possède, c'est-à-dire
  // exactement le périmètre de l'incubateur.
  const collaborations = (
    await Promise.all(
      regions.map(
        async (region) =>
          (
            (await lire(`${region.api}/v1/collaborators`, porteur, contexte.signal)) as {
              collaborators: Collaboration[];
            }
          ).collaborators,
      ),
    )
  ).flat();

  const adresses = new Map<string, unknown>();
  for (const collaboration of collaborations) {
    const adresse = String(collaboration.email ?? "").toLowerCase();
    // Une personne peut collaborer à dix applications : ce qu'on compte est elle, et non
    // ses accès, faute de quoi un seul compte pèserait dix fois dans le chiffre.
    if (adresse.length > 0 && !adresses.has(adresse)) {
      adresses.set(adresse, collaboration.tfa_status);
    }
  }

  const etats = [...adresses.values()];
  const sans = etats.filter((etat) => etat === false).length;
  const inconnus = etats.filter((etat) => etat !== true && etat !== false).length;

  return (
    <>
      <p className={fr.cx("fr-h4", "fr-mb-0")}>{sans}</p>
      <p className={fr.cx("fr-mb-0")}>
        {sans > 1 ? "collaborateurs déclarés sans" : "collaborateur déclaré sans"} double
        authentification, sur {etats.length} {etats.length > 1 ? "comptes" : "compte"}.
      </p>
      {inconnus > 0 ? (
        <p className={fr.cx("fr-mb-0", "fr-mt-1w")}>
          {inconnus} {inconnus > 1 ? "comptes ne le déclarent" : "compte ne le déclare"} pas :
          Scalingo laisse le champ vide sans dire pourquoi. Ce ne sont pas des comptes protégés.
        </p>
      ) : null}
    </>
  );
}

export const tuiles: readonly TuileDeConnecteur[] = [
  {
    cle: "deux-facteurs",
    titre: "Scalingo sans double authentification",
    provenance: "systeme",
    charger: sansDeuxFacteurs,
  },
];

import { unstable_rethrow } from "next/navigation";

import type { ResultatTuile, TuileDeConnecteur } from "./contrat";

/**
 * Une tuile qui n'aboutit pas est le pire des échecs : elle ne lève rien, ne s'affiche
 * pas, et laisse la réponse en flux ouverte, si bien que la page semble seulement ne
 * jamais finir de charger. C'est aussi le seul cas qu'on ne voit pas en local, où le
 * système répond. D'où une échéance, qui n'est pas un réglage de politique : il n'y a
 * aucune décision métier là-dedans, seulement le refus de laisser une page ouverte
 * indéfiniment.
 *
 * Dix secondes, et non trois. Le `Suspense` sert la page avant que la tuile ait
 * répondu, si bien qu'attendre plus longtemps ne retarde personne, alors qu'attendre
 * trop peu rend toute tuile qui interroge un vrai système inutilisable : trois secondes
 * ne suffisent pas à un appel paginé vers GitHub. La borne reste sous les quinze
 * secondes que le connecteur s'accorde par requête, pour abandonner avant lui.
 */
export const ECHEANCE_TUILE_MS = 10_000;

class DelaiDepasse extends Error {}

/**
 * Rend une tuile sans jamais jeter vers l'appelant.
 *
 * Deux échecs différents sont couverts ici, le rejet et l'absence de réponse. Le
 * troisième, un noeud rendu par la tuile qui lève pendant son propre rendu, échappe à
 * ce helper et demande la frontière d'erreur client.
 */
export async function rendreTuile(
  tuile: TuileDeConnecteur,
  maintenant: Date,
  echeanceMs: number = ECHEANCE_TUILE_MS,
): Promise<ResultatTuile> {
  const abandon = new AbortController();
  let minuteur: ReturnType<typeof setTimeout> | undefined;

  const echeance = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => {
      abandon.abort();
      rejeter(new DelaiDepasse());
    }, echeanceMs);
  });

  try {
    const contenu = await Promise.race([
      tuile.charger({ maintenant, signal: abandon.signal }),
      echeance,
    ]);
    return { etat: "ok", contenu };
  } catch (erreur) {
    // Ce qui remonte ici est le contrôle de flux de Next, jamais l'échec de la tuile :
    // l'avaler casserait le rendu d'une façon que rien ne permettrait de diagnostiquer.
    unstable_rethrow(erreur);

    const reference = crypto.randomUUID().slice(0, 8);
    console.error(`[tuile ${tuile.cle}] échec, référence ${reference}`, erreur);

    return erreur instanceof DelaiDepasse
      ? {
          etat: "echec",
          raison: "delai",
          message: `Ce système n'a pas répondu en moins de ${Math.round(echeanceMs / 1000)} secondes.`,
          reference,
        }
      : {
          etat: "echec",
          raison: "erreur",
          message: "Ce chiffre n'a pas pu être obtenu.",
          reference,
        };
  } finally {
    clearTimeout(minuteur);
    // Aussi au succès : sans cela, une tuile qui a répondu laisserait derrière elle un
    // `fetch` concurrent que plus personne n'attend. La raison est nommée pour que la
    // trace désigne le socle, et non le système interrogé, le jour où une tuile laisse
    // courir une lecture au delà de son propre rendu.
    abandon.abort(new Error("tuile déjà rendue, le socle a fermé son signal"));
  }
}

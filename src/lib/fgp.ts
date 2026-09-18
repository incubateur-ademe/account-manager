import { z } from "zod";

import type { NonEmptyArray } from "@/core/connector";
import { env } from "@/lib/env";

/**
 * Le client du proxy à jetons restreints, à côté de l'autre client HTTP du dépôt et pas
 * dans un connecteur : `docs/architecture.md` pose `fgp` comme la réponse à tout credential
 * à portée large que le fournisseur ne sait pas cloisonner, et nomme le triplet OVH comme
 * cas d'école. Le second client de ce module est déjà identifié.
 *
 * La génération n'existe pas hors ligne, le sel du serveur n'étant exposé par aucune route :
 * il faut appeler `POST /api/generate`, et il n'y a rien d'autre à appeler. Il n'existe ni
 * route de révocation ni route d'introspection, ce qui rend l'échéance obligatoire et fait
 * de la base de cet outil le seul registre de ce qui a été émis.
 */
export class ErreurFgp extends Error {
  constructor(
    readonly statut: number | null,
    /** Vrai quand le refus exclut qu'un blob ait été créé là-bas. */
    readonly aucunBlob: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ErreurFgp";
  }
}

export interface DemandeDeJeton {
  jeton: string;
  cible: string;
  scopes: NonEmptyArray<string>;
  secondes: number;
  /** Ce que le blob portera pour se nommer lui-même une fois décodé. */
  nom: string;
}

export interface JetonEmis {
  blob: string;
  cle: string;
}

const reponseSchema = z.object({ blob: z.string().min(1), key: z.string().min(1) });

/**
 * `fetch` n'a aucun délai par défaut, et sans borne une réponse qui ne vient jamais gèlerait
 * l'exécution du plan. Calé sur celui du connecteur Scalingo, qui appelle le même parc.
 */
const DELAI_MS = 15_000;

export type EmissionDeJeton = (demande: DemandeDeJeton) => Promise<JetonEmis>;

/**
 * Aucune reprise automatique, à la différence de la lecture Scalingo : retenter une émission
 * dont on ignore si elle a abouti, c'est émettre un second jeton que rien ne listera et que
 * rien ne révoquera.
 *
 * Le mode d'authentification est `scalingo-exchange`, qui fait faire l'échange au proxy et
 * met le porteur en cache : l'échange n'est donc jamais un scope à demander, et le porteur
 * du blob n'a aucun échange à faire lui-même.
 */
export const emettreUnJeton: EmissionDeJeton = async (demande) => {
  const base = env.FGP_URL;
  if (base === undefined) {
    throw new ErreurFgp(null, true, "FGP_URL absent de l'environnement");
  }

  // Le proxy traite 0 comme « pas d'expiration », et rien ne saurait reprendre un jeton qui
  // n'expire pas : le refus est ici et pas seulement chez l'appelant, pour qu'aucun appelant
  // n'ait à s'en souvenir.
  if (!Number.isInteger(demande.secondes) || demande.secondes < 1) {
    throw new ErreurFgp(null, true, "un jeton sans terme ne se reprend par aucun moyen");
  }

  // Le slash final est la coquille qu'un champ de formulaire invite à faire, et
  // `//api/generate` rend 404 sur un routeur qui ne normalise pas, sans que le message le
  // nomme. Coupé plutôt que remplacé par `new URL("/api/generate", base)`, qui avalerait en
  // silence un chemin configuré dans la variable.
  const racine = base.replace(/\/+$/, "");

  let reponse: Response;
  try {
    reponse = await fetch(`${racine}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        token: demande.jeton,
        target: demande.cible,
        auth: "scalingo-exchange",
        scopes: demande.scopes,
        ttl: demande.secondes,
        name: demande.nom,
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (cause: unknown) {
    // Une coupure réseau n'exclut pas qu'un blob soit né là-bas, et faute de route
    // d'introspection personne ne pourra jamais lever le doute.
    throw new ErreurFgp(null, false, cause instanceof Error ? cause.message : String(cause));
  }

  if (!reponse.ok) {
    // Un refus du corps précède le chiffrement, une panne serveur non.
    throw new ErreurFgp(
      reponse.status,
      reponse.status < 500,
      `${reponse.status} ${reponse.statusText}`,
    );
  }

  const lu = reponseSchema.safeParse(await reponse.json().catch(() => undefined));
  if (!lu.success) {
    throw new ErreurFgp(reponse.status, false, "la réponse ne porte ni blob ni clé");
  }

  return { blob: lu.data.blob, cle: lu.data.key };
};

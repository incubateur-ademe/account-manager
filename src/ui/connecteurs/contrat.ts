import type { ReactNode } from "react";

/**
 * Ce que le socle donne à une tuile, et rien de plus.
 *
 * Ce que ce contexte ne contient pas est aussi délibéré que ce qu'il contient : ni
 * journal d'audit, ni identifiant de run, ni drapeau de simulation. Une tuile n'a donc
 * pas de quoi laisser une trace même par inadvertance, et ce qu'elle affiche ne peut
 * fonder aucune décision de coupure. Ce qui décide passe par la collecte.
 */
export interface ContexteTuile {
  maintenant: Date;
  /** Abandonné dès que l'échéance tombe. Une tuile qui appelle son système le passe à `fetch`. */
  signal: AbortSignal;
}

export interface TuileDeConnecteur {
  cle: string;
  titre: string;
  /**
   * Ce que la tuile a lu pour répondre, affiché sous la valeur parce que cela change
   * ce qu'on peut en conclure : un chiffre lu en base date de la dernière collecte,
   * un chiffre lu sur le système est de l'instant mais n'a laissé aucune trace.
   */
  provenance: "base" | "systeme";
  /**
   * Doit avoir fini tout ce qu'elle avait à lire avant de rendre son noeud : le signal
   * est abandonné dès qu'elle a répondu, et un appel qu'elle laisserait courir derrière
   * elle serait interrompu sans que rien ne l'explique.
   */
  charger: (contexte: ContexteTuile) => Promise<ReactNode>;
}

export interface EchecDeTuile {
  etat: "echec";
  raison: "delai" | "erreur";
  /**
   * Toujours une phrase du socle. Rien de ce que la tuile a levé ne passe par ici :
   * le message brut d'un appel échoué contient parfois l'URL complète, jeton compris.
   */
  message: string;
  /** De quoi retrouver le détail dans les journaux du serveur, où il est seul consigné. */
  reference: string;
}

export type ResultatTuile = { etat: "ok"; contenu: ReactNode } | EchecDeTuile;

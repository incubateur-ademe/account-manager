/** Ce qu'un accès de profil ouvre, dit en une ligne au moment de choisir. */
export interface AccesOffert {
  systeme: string;
  /** Le scope tel que le fichier le porte, rendu tel quel : c'est lui qu'on corrige. */
  scope: string;
  echeance: string;
}

/**
 * Un profil tel qu'il se choisit à l'ouverture d'une arrivée.
 *
 * Rendu par le serveur plutôt que lu par l'écran : la politique vit dans un fichier,
 * et un composant client n'y a aucun accès. Les types vivent ici, hors de `lib`, pour
 * que le formulaire les importe sans faire entrer la base de données dans son paquet.
 */
export interface ProfilOffert {
  cle: string;
  libelle: string;
  ouvre: readonly AccesOffert[];
  /** Ce qui empêche ce profil de produire un plan. Non vide, il ne se choisit pas. */
  refus: readonly string[];
}

/**
 * Les profils, ou l'aveu qu'on n'a pas pu les lire.
 *
 * Une politique illisible ne fait pas tomber l'ouverture d'un dossier : une arrivée
 * sans profil reste licite, elle n'ouvre simplement aucun accès sur les systèmes
 * couverts. Le taire ferait chercher un choix qui n'apparaît pas.
 */
export type ChoixDeProfils =
  | { etat: "lus"; offerts: readonly ProfilOffert[]; refuses: readonly ProfilOffert[] }
  | { etat: "illisible" };

import type { ScopeCollaboration } from "@/connectors/scalingo";

/**
 * Les rôles que la collecte écrit, dits en français.
 *
 * Les deux rôles qui s'accordent viennent du connecteur par son type, et non par une
 * copie : c'est lui qui décide ce qu'un octroi peut demander, et une copie resterait
 * muette le jour où il change. La propriété s'ajoute à la main parce qu'aucun octroi ne
 * la demande, Scalingo ne sachant pas l'accorder, alors que la collecte l'écrit.
 *
 * `import type` seul : ce module est chargé par un composant client, et le connecteur
 * porte `fetch`, Zod et un catalogue de chemins qui n'ont rien à faire dans un paquet
 * d'interface.
 */
export type RoleScalingo = ScopeCollaboration["role"] | "owner";

/**
 * La table est exhaustive et sa clé est l'union elle-même : sous `@tsconfig/strictest`,
 * une union de littéraux n'est pas une signature d'index, si bien qu'un rôle ajouté casse
 * le typecheck au lieu de tomber dans un repli qui afficherait `limited` à qui décide
 * d'une coupure.
 */
export const LIBELLE_ROLE_SCALINGO: Record<RoleScalingo, string> = {
  owner: "Propriétaire",
  collaborator: "Collaborateur",
  limited: "Collaborateur limité",
};

/** Les deux rôles qu'un geste peut demander, dans l'ordre du moindre pouvoir. */
export const ROLES_DEMANDABLES: readonly Exclude<RoleScalingo, "owner">[] = [
  "limited",
  "collaborator",
];

export function libelleDuRole(role: string): string {
  // `Object.hasOwn` et non un accès direct, pour la raison de `registre.ts:45-48` : un
  // rôle nommé « constructor » rendrait un membre du prototype.
  return Object.hasOwn(LIBELLE_ROLE_SCALINGO, role)
    ? LIBELLE_ROLE_SCALINGO[role as RoleScalingo]
    : role;
}

/**
 * Ce que l'écran Scalingo dit, sorti de l'écran pour être relu.
 *
 * Un projet Scalingo n'a pas de membres : le fournisseur laisse la gestion des
 * utilisateurs au niveau de l'application. L'écran présente donc un regroupement et
 * jamais une appartenance, et c'est la promesse la plus facile à trahir de tout ce lot,
 * parce qu'un titre de groupe suivi d'une liste de personnes ressemble trait pour trait à
 * une liste de membres, et que la personne qui lit cet écran est celle qui décide d'une
 * coupure.
 *
 * La règle de rédaction n'est pas celle des commentaires du dépôt : un texte d'écran dit
 * ce qui peut se faire et ce qui ne peut pas, jamais par quel rouage.
 */
export const MOTS_DE_SCALINGO = {
  parc: {
    titre: "Le parc, projet par projet",
    regroupement:
      "Un projet Scalingo ne fait que regrouper des applications. Il n'a pas de membres, personne n'y détient d'accès, et rien ne s'y retire. Ce qui s'ouvre et ce qui se coupe se lit sur la ligne d'une application.",
    horsProjetTitre: "Sans projet",
    horsProjet: "Sans projet. Ces applications se lisent comme les autres, et leurs accès aussi.",
    vide: "Aucune application constatée sur ce système. La liste est vide faute de collecte, et ne dit rien du parc réel.",
    datation:
      "Tout ce qui suit vient de la dernière collecte, et non d'une lecture faite à l'instant. Une date est celle du dernier constat.",
    /**
     * Ce que l'écran dit quand rien de vivant ne porte de date, et rien de plus.
     *
     * Elle ne prétend pas qu'aucune collecte n'a tourné : l'écran ne lit que ce sur quoi
     * une coupure se décide, et la trace d'un run ne dirait pas que ce qui s'affiche en
     * vient, un run non `ok` ne datant rien et un run tronqué laissant le dernier état
     * constaté. Elle ne prétend pas non plus le contraire, et dit laquelle des deux
     * ignorances est la sienne.
     */
    rienDeVivant:
      "Aucun accès ni aucun compte vivant ici, donc aucune date à afficher. Cet écran ne distingue pas une collecte qui n'a jamais tourné d'une collecte qui n'y a plus rien vu, et ne dit rien du parc réel.",
    sansAcces: "Aucun accès vivant constaté sur cette application.",
    collaborateurs: "Voir ses collaborateurs sur Scalingo, nouvelle fenêtre",
  },
  comptes: {
    titre: "Qui détient un accès, et où",
    isole: "Ce compte n'est rattaché à personne. Il se traite dans la file des comptes isolés.",
    /**
     * Le refus opposé à une identité déclarée machine, et il n'est pas celui de
     * l'isolement : la file des comptes isolés exclut par construction ce qui porte un
     * compte de service, et l'y envoyer serait envoyer vers une liste où ce compte ne
     * figure pas.
     */
    machine:
      "Ce compte est déclaré comme compte de service. Aucun rôle ne se change en son nom depuis ici. Son détenteur, son terme et sa revue se tiennent sur l'écran des comptes de service.",
    invitation: "Invitation en attente",
    vide: "Aucun compte Scalingo constaté. Rien ne dit pour autant que personne n'entre, cette liste étant celle du dernier constat.",
    sansAcces:
      "Aucun accès vivant à son nom. Le compte existe, et c'est tout ce que le dernier constat dit de lui.",
  },
  role: {
    bouton: "Changer son rôle",
    titreModale: "Changer le rôle sur une application",
    plein:
      "Un collaborateur plein lit les variables d'environnement de l'application, donc les secrets qu'elles portent et les identifiants de ses bases.",
    limite:
      "Un collaborateur limité voit les journaux, les métriques et le redéploiement, et rien des variables d'environnement.",
    proprietaire:
      "Le propriétaire d'une application ne se change pas ici. Il ne figure dans aucune liste de collaborateurs, et Scalingo ne sait pas l'en retirer.",
    ressemblance:
      "Ce compte est rattaché sur une ressemblance de nom. Baisser un rôle coupe une partie de son accès, et aucun geste ne part d'ici tant que personne n'a confirmé le rattachement. Il se tranche dans la file des comptes isolés.",
    // Le refus opposé à un départ ouvert n'a pas de phrase ici : l'action le rend, le
    // formulaire le rend tel quel, et une seconde rédaction du même refus dériverait de
    // celle qui décide.
    choix: "Le rôle demandé",
    terme: "Échéance, en jours",
    termeAide:
      "Le rôle plein est un accès à risque élevé, et il exige une échéance, faute de quoi rien ne le referme.",
    justification: "Pourquoi ce rôle, et pour quel travail",
    justificationAide:
      "Elle restera quand plus personne ne se souviendra de la demande, et elle est journalisée avec votre nom.",
    envoi: "Écrire le brouillon",
    attente: "Écriture…",
    /**
     * La phrase renvoie vers la fiche de la personne sans poser de lien. Ce formulaire
     * vit dans une modale, et un lien qui la quitte perdrait la saisie de qui ne voulait
     * que lire la suite.
     */
    brouillon:
      "Le brouillon est écrit, et rien n'est parti sur Scalingo. Confirmez-le sur la fiche de la personne.",
  },
} as const;

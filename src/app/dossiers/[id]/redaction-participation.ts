import { DUREE_MAX_JOURS } from "@/core/participation";

/**
 * Les phrases de l'écran des droits, sorties du composant pour être relues.
 *
 * Rien ne rend cet écran dans les tests, et trois phrases fausses y sont déjà parties :
 * une table se relit, un JSX non. Ce qui se pose ici est ce qui porterait une garantie
 * ou une conséquence, pas chaque mot de l'écran.
 *
 * La règle de rédaction n'est pas celle des commentaires du dépôt : un texte d'aide dit
 * ce qu'il y a à saisir et ce qui va se passer, jamais pourquoi l'outil est fait ainsi.
 * Le pourquoi reste dans le code, où il est déjà.
 *
 * Deux phrases sont des fonctions et non des chaînes, et c'est le même défaut dans les
 * deux cas : elles promettaient une issue que le code ne tient pas toujours. Ce que le
 * paramètre porte est la condition qui décide, et non un mot à insérer.
 */

/** « beta.gouv.fr » et « ademe.fr » se lisent « beta.gouv.fr ou ademe.fr ». */
function enumeration(mots: readonly string[]): string {
  return new Intl.ListFormat("fr", { type: "disjunction" }).format(mots);
}

export const LIBELLE_DROITS = {
  titre: "Qui d'autre agit sur ce dossier",
  aucun: "Personne pour l'instant. Seule l'équipe transverse voit ce dossier.",
  /**
   * Le sens du dossier vient de `LIBELLE_DOSSIER` : le genre du mot change la phrase,
   * et un dossier d'arrivée lisait ici qu'un droit se donne sur un départ.
   */
  ferme: (possibleSur: string) =>
    `Ce dossier ne s'ouvre plus à personne : un droit ne se donne que sur ${possibleSur}.`,
  retrait: {
    raison: "Pourquoi ce retrait (facultatif)",
    lecteurDEcran: "Raison du retrait",
    soumettre: "Retirer ce droit",
    enCours: "Retrait…",
  },
  canal: {
    absent: "Aucune adresse où envoyer le lien.",
    /**
     * Un identifiant fabriqué ici n'est connu d'aucun espace-membre, si bien que la
     * seconde issue n'existe pas pour son titulaire : la lui proposer l'envoie dans un
     * mur, et c'est justement la personne pour qui rien d'autre ne marche.
     */
    absentIssue: (identifiantFabrique: boolean) =>
      identifiantFabrique
        ? "Son identifiant n'existe que dans cet outil : redonnez ce droit en déclarant une adresse."
        : "Redonnez ce droit en déclarant une adresse, ou dites-lui de se connecter avec son identifiant beta.gouv.",
    menace: "Cette boîte se ferme au départ de son titulaire.",
    menaceEffet: "Le lien cessera d'y arriver, sans doute avant le terme du droit.",
    declare: (adresse: string) =>
      `Le lien de connexion part sur ${adresse}, déclarée avec ce droit.`,
    deduit: (adresse: string) =>
      `Le lien de connexion part sur ${adresse}, lue sur sa fiche : personne ne l'a choisie pour ce dossier, et une collecte peut la remplacer.`,
  },
} as const;

export const LIBELLE_OCTROI = {
  declencheur: "Laisser quelqu'un d'autre agir",
  titre: "Laisser quelqu'un d'autre agir sur ce dossier",
  /**
   * L'écran du participant nomme la personne concernée et le sens du dossier dès son
   * titre, listes vides comprises : promettre qu'elle ne verra que ses étapes serait
   * promettre ce que cette page ne tient pas. Elle se borne donc à ce que la page dit
   * d'elle-même, et dans les mêmes mots.
   */
  effet:
    "Elle verra de quel dossier il s'agit et qui il concerne, les étapes qui lui reviennent et celles qu'elle doit signer. Le reste ne lui est pas montré.",
  soumettre: "Accorder ce droit",
  enCours: "Enregistrement…",
  identifiant: {
    label: "Identifiant de la personne",
    aide: "Son identifiant beta.gouv, ou celui que sa fiche porte ici. Un identifiant d'opérateur sera refusé.",
    manquant: "Indiquez qui reçoit ce droit.",
  },
  motif: {
    label: "Pourquoi ce droit est accordé",
    aide: "En une phrase. Elle s'affichera ici et restera au journal, avec votre nom.",
    exemple: "Doit valider la restitution du matériel",
    manquant: "Dites pourquoi ce droit est accordé.",
  },
  duree: {
    label: "Pour combien de jours",
    aide: `${DUREE_MAX_JOURS} jours au maximum. Passé ce terme, l'accès s'arrête de lui-même, et vous pourrez le redonner.`,
    /**
     * Le navigateur sert ce message sur toutes les violations du champ, dépassement du
     * plafond compris : « Indiquez une durée » répondait à qui venait d'en indiquer
     * une, sous une aide qui nomme le plafond juste au-dessus.
     */
    manquant: `Indiquez une durée de 1 à ${DUREE_MAX_JOURS} jours.`,
  },
  canal: {
    label: "Adresse pour se connecter (facultatif)",
    /**
     * L'adresse de la fiche ne sert que si l'outil peut l'entretenir, ce qu'aucune
     * fiche venue de l'espace-membre ne permet : affirmer que le lien part dessus
     * envoyait laisser le champ vide en confiance pour la majorité des fiches, dont
     * celles que l'aide du champ voisin désigne en premier.
     */
    manquante:
      "Renseignez-la pour qui n'a pas de compte beta.gouv. Sans elle, le lien part sur l'adresse de contact de sa fiche, quand l'outil peut la servir.",
    aEviter: (domainesMenaces: readonly string[]) =>
      `Évitez une adresse en ${enumeration(domainesMenaces)} : ces boîtes se ferment au départ de leur titulaire.`,
  },
  /**
   * Rendues à côté des champs, l'accord fait : ce sont les phrases qui retiennent la
   * modale ouverte, et elles disent d'abord que le droit est posé, sans quoi l'opérateur
   * lirait un refus.
   */
  canalMenace:
    "Le droit est accordé. Le lien part sur une boîte que l'incubateur ferme au départ de son titulaire : elle cessera de répondre, sans doute avant le terme du droit. Redonnez ce droit avec une autre adresse dès qu'elle est connue.",
  /**
   * Le droit qui n'atteint personne, qui est un succès dont il ne se dit rien : ni
   * adresse déclarée, ni adresse servable sur la fiche, et un identifiant qu'aucune
   * connexion n'accepte. Il ne se lève pas pour un identifiant beta.gouv réel, dont le
   * titulaire entre par sa propre porte et n'a besoin d'aucun lien.
   */
  sansCanal:
    "Le droit est accordé, mais personne ne peut lui envoyer de lien de connexion : sa fiche n'offre aucune adresse que l'outil puisse servir, et son identifiant n'existe que dans cet outil. Redonnez ce droit en déclarant une adresse.",
} as const;

/** L'aide du champ d'adresse, la phrase des domaines en moins quand aucun n'est déclaré. */
export function aideDuCanal(domainesMenaces: readonly string[]): string {
  const debut = LIBELLE_OCTROI.canal.manquante;
  return domainesMenaces.length === 0
    ? debut
    : `${debut} ${LIBELLE_OCTROI.canal.aEviter(domainesMenaces)}`;
}

/**
 * Ce qui retient la modale d'octroi ouverte après le geste, ou rien quand elle peut se
 * fermer.
 *
 * Un avertissement retient autant qu'un refus, et c'est tout l'enjeu : il naît d'un
 * succès, il est le seul moment où l'adresse se corrige encore, et une modale qui se
 * fermerait dessus l'emporterait avec elle sans que personne ne le voie.
 */
export function retientLaModale(
  etat: { erreur?: string | undefined; avertissement?: string | undefined } | null,
): string | undefined {
  return etat?.erreur ?? etat?.avertissement;
}

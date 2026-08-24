import type { EtatDossier, SensDossier } from "@/core/dossier";

/**
 * Ce qu'un dossier dit de lui-même selon son sens.
 *
 * Un seul mécanisme porte l'arrivée et le départ, mais les mots ne se réutilisent
 * pas : « déjà absent » proposé sous une étape d'octroi, ou « aucun accès n'a été
 * coupé » sur une arrivée annulée, feraient dire à l'écran le contraire de ce que le
 * dossier prépare. Les phrases vivent ici plutôt qu'en ternaires dispersés, parce que
 * cinq fichiers les partagent et qu'une seule oubliée suffit à mentir.
 */
export interface LibelleDossier {
  /** Le nom du sens, en tête de l'écran de dossier et dans les listes. */
  nom: string;
  /** Le geste qui ouvre le dossier depuis une fiche, et le titre de sa modale. */
  ouvrir: string;
  aideOuverture: string;
  ouvertureExplication: string;
  /** Quand on retombe sur un dossier déjà ouvert plutôt que d'en créer un second. */
  dejaOuvert: string;
  /** L'encart qui rappelle qu'un pointage ne déclenche rien. */
  cocher: string;
  /** Titre de la liste des étapes, selon ce que le plan est devenu. */
  aFaire: string;
  restant: string;
  propose: string;
  /** Pourquoi un plan sans étape n'en porte aucune. */
  planVide: string;
  /** La suite de la phrase quand aucun plan n'a pu être enregistré. */
  sansPlanIssue: string;
  /** La dérive d'un brouillon que le calcul du jour dément. */
  derive: string;
  /** Ce qu'une étape en échec a laissé derrière elle. */
  echecTitre: string;
  /**
   * Le pointage qui constate que quelqu'un est passé avant. Il n'a de sens que dans
   * un sens : proposer « déjà absent » sur une arrivée reviendrait à faire signer
   * l'inverse de ce qui a été fait.
   */
  constat: { valeur: string; libelle: string };
  annule: string;
  annuler: string;
  annulationTitre: string;
  annulationConsequence: string;
  annulationEffet: string;
  annulationSuite: string;
  motif: string;
  motifExemple: string;
  motifAttendu: string;
}

export const LIBELLE_DOSSIER: Record<SensDossier, LibelleDossier> = {
  ONBOARDING: {
    nom: "Arrivée",
    ouvrir: "Préparer l'arrivée",
    aideOuverture:
      "Ouvrir un dossier d'arrivée et calculer la liste de ce qu'il faudra donner, système par système. Rien n'est exécuté et aucun accès n'est ouvert.",
    ouvertureExplication:
      "Un dossier est ouvert et la liste de ce qu'il faut donner est calculée. Aucun système ne sait encore ouvrir un accès depuis cet outil : le plan sortira vide tant que les octrois et les modèles d'arrivée n'existent pas. Rien n'est exécuté et aucun accès n'est ouvert.",
    dejaOuvert:
      "Ce dossier était déjà ouvert : vous êtes revenu dessus, aucun second dossier n'a été créé. Une arrivée ne s'ouvre qu'une fois par personne tant qu'elle n'est pas close.",
    cocher:
      "Cocher une étape n'exécute rien : l'outil consigne ce que vous déclarez avoir fait, il n'ouvre aucun accès lui-même. La collecte suivante dira si le compte est réellement apparu.",
    aFaire: "Ce qu'il faudra donner",
    restant: "Ce qu'il reste à donner",
    propose: "Ce que ce plan proposait de donner",
    planVide:
      "Aucune étape : aucun connecteur ne sait encore ouvrir un accès, et aucun modèle d'arrivée n'est déclaré. Le dossier est bien ouvert, sa liste viendra quand l'un ou l'autre existera.",
    sansPlanIssue: " L'annuler est la seule issue, une nouvelle arrivée restant ouvrable ensuite.",
    derive:
      "Ce que les systèmes savent donner a changé depuis son calcul : il ne peut plus être confirmé en l'état.",
    echecTitre: "Des accès n'ont pas été donnés",
    constat: { valeur: "deja-present", libelle: "Déjà présent" },
    annule: "arrivée annulée",
    annuler: "Annuler cette arrivée",
    annulationTitre: "Cette arrivée a été annulée",
    annulationConsequence:
      "Aucun accès n'a été ouvert par ce dossier, et une nouvelle arrivée reste ouvrable.",
    annulationEffet:
      "Aucun accès n'est ouvert ni retiré par ce geste : l'outil n'a rien exécuté, il a seulement dit ce qu'il faudrait faire.",
    annulationSuite:
      "Une nouvelle arrivée restera ouvrable ensuite, et la fiche de la personne cessera d'annoncer celle-ci.",
    motif: "Pourquoi cette arrivée n'aura pas lieu",
    motifExemple: "Recrutement abandonné",
    motifAttendu: "Dites pourquoi cette arrivée n'aura pas lieu.",
  },
  OFFBOARDING: {
    nom: "Départ",
    ouvrir: "Préparer le départ",
    aideOuverture:
      "Ouvrir un dossier de départ et calculer la liste de ce qu'il faudra retirer, système par système. Rien n'est exécuté et aucun accès n'est coupé.",
    ouvertureExplication:
      "Un dossier est ouvert et la liste de ce qu'il faut retirer est calculée à partir des comptes observés, système par système. Rien n'est exécuté et aucun accès n'est coupé : le plan reste à confirmer, puis à pointer à la main.",
    dejaOuvert:
      "Ce dossier était déjà ouvert : vous êtes revenu dessus, aucun second dossier n'a été créé. Un départ ne s'ouvre qu'une fois par personne tant qu'il n'est pas clos.",
    cocher:
      "Cocher une étape n'exécute rien : l'outil consigne ce que vous déclarez avoir fait, il ne coupe aucun accès lui-même. La collecte suivante dira si le compte a réellement disparu.",
    aFaire: "Ce qu'il faudra retirer",
    restant: "Ce qu'il reste à retirer",
    propose: "Ce que ce plan proposait de retirer",
    planVide:
      "Aucune étape : aucun compte rattaché de façon sûre n'a été trouvé sur les systèmes que l'outil sait traiter.",
    sansPlanIssue: " L'annuler est la seule issue, un nouveau départ restant ouvrable ensuite.",
    derive:
      "Les accès observés ont changé depuis son calcul : il ne peut plus être confirmé en l'état.",
    echecTitre: "Des accès sont restés ouverts",
    constat: { valeur: "deja-absent", libelle: "Déjà absent" },
    annule: "départ annulé",
    annuler: "Annuler ce départ",
    annulationTitre: "Ce départ a été annulé",
    annulationConsequence:
      "Aucun accès n'a été coupé par ce dossier, et un nouveau départ reste ouvrable.",
    annulationEffet:
      "Aucun accès n'est coupé ni rouvert par ce geste : l'outil n'a rien exécuté, il a seulement dit ce qu'il faudrait faire.",
    annulationSuite:
      "Un nouveau départ restera ouvrable ensuite, et la fiche de la personne cessera d'annoncer celui-ci.",
    motif: "Pourquoi ce départ n'aura pas lieu",
    motifExemple: "Mission prolongée jusqu'en…",
    motifAttendu: "Dites pourquoi ce départ n'aura pas lieu.",
  },
};

/**
 * L'état d'un dossier, dit en français. Table exhaustive : ajouter une valeur à
 * l'énum fera tomber le typecheck plutôt que d'afficher la constante brute.
 */
export const LIBELLE_ETAT_DOSSIER: Record<EtatDossier, string> = {
  WATCH: "en veille",
  CANDIDATE: "à instruire",
  CONFIRMED: "confirmé",
  CANCELLED: "annulé",
  DONE: "clos",
};

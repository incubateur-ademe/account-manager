import { type Acteur, dossierVivant, type EtatDossier, type EtatValidation } from "./dossier";
import { type FicheManuelle, ficheEditable } from "./fiche-manuelle";
import { estOperateur } from "./identite";

/**
 * Deux durées, et l'écart entre elles est la règle plutôt qu'un réglage.
 *
 * Un plafond qui est aussi le défaut n'est pas un plafond, c'est une durée unique
 * déguisée : le formulaire proposerait le maximum, personne ne le baisserait, et
 * l'échéance obligatoire d'un droit ne serrerait plus rien.
 *
 * Trente jours est l'horizon que l'outil appelle lui-même « proche » pour une fin de
 * mission, si bien qu'un droit ne survit jamais à la fenêtre pendant laquelle le
 * départ est dit imminent. La coïncidence avec `thresholds.soonDays` s'arrête à ce
 * commentaire et ne se code pas : lire le seuil ferait qu'un réglage de politique
 * déplacerait une règle d'autorisation, et ce sont deux choses distinctes.
 */
export const DUREE_DEFAUT_JOURS = 14;
export const DUREE_MAX_JOURS = 30;

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * L'échéance d'un octroi, ou rien quand la durée demandée n'en est pas une.
 *
 * Les deux bornes se jugent ici et pas dans le seul formulaire : une action serveur
 * reçoit ce qu'on lui envoie, pas ce que l'écran proposait. Zéro et les valeurs
 * négatives comptent autant que le dépassement du plafond, une durée nulle ou négative
 * posant une échéance déjà atteinte, c'est-à-dire un octroi que la garde du droit
 * vivant refusera ensuite sans que rien n'ait prévenu à l'écriture.
 *
 * Juger et calculer d'un seul geste est ce qui empêche d'oublier l'un des deux :
 * aucune contrainte en base ne double cette règle, le calcul ne pouvant pas s'y
 * intercaler.
 */
export function echeanceDOctroi(depart: Date, jours: number): Date | null {
  if (!Number.isInteger(jours) || jours <= 0 || jours > DUREE_MAX_JOURS) {
    return null;
  }
  return new Date(depart.getTime() + jours * MS_PAR_JOUR);
}

export interface ParticipationSuivie {
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Ce qui ouvre un dossier à un non-opérateur : un droit ni révoqué ni périmé, sur un
 * dossier qui vit encore.
 *
 * L'état du dossier se lit par `dossierVivant` et jamais par une liste écrite ici :
 * un droit oublié sur un dossier annulé ouvrirait autant qu'un droit posé la veille.
 * Rien n'écrit de révocation quand un dossier se clôt, la mort du droit se déduit,
 * parce qu'une lecture ne peut pas échouer là où une écriture le peut.
 */
export function participationVivante(
  participation: ParticipationSuivie,
  etatDossier: EtatDossier,
  maintenant: Date,
): boolean {
  if (participation.revokedAt !== null) {
    return false;
  }
  if (participation.expiresAt.getTime() <= maintenant.getTime()) {
    return false;
  }
  return dossierVivant(etatDossier);
}

/** Par quelle porte quelqu'un prouve son identité. */
export type Voie = "ESPACE_MEMBRE" | "ADRESSE";

/**
 * Ce qu'une saisie de l'écran de connexion désigne, sans jamais laisser le choix.
 *
 * L'arobase route, comme elle route déjà dans l'adaptateur du paquet et dans les
 * candidats d'identité : demander à quelqu'un de choisir sa voie, ce serait lui
 * demander de savoir comment l'outil est construit.
 *
 * Les formes qui font lever le normalisateur du paquet sont refusées ici, avant lui :
 * une exception remontée du paquet vaut un message distinct, donc un oracle sur ce
 * que l'outil connaît. La normalisation reproduit la sienne, `NFKC` compris, sans
 * quoi un homoglyphe d'arobase passerait pour un identifiant.
 */
export function voieDeConnexion(saisie: string): Voie | null {
  const valeur = saisie.normalize("NFKC").toLowerCase().trim();
  if (valeur.length === 0 || valeur.includes('"')) {
    return null;
  }

  const morceaux = valeur.split("@");
  if (morceaux.length === 1) {
    return "ESPACE_MEMBRE";
  }
  if (morceaux.length !== 2) {
    return null;
  }

  const [local, domaine] = morceaux;
  // La partie locale peut porter une virgule, le domaine non : le paquet coupe
  // dessus, et ce qui reste doit encore être un domaine.
  if (!local || !domaine?.split(",")[0]) {
    return null;
  }
  return "ADRESSE";
}

/**
 * D'où vient l'adresse qui a résolu un candidat.
 *
 * Les deux origines n'ouvrent pas aux mêmes conditions : l'adresse portée par une
 * fiche est celle que personne n'a choisie pour ce dossier-là, le canal déclaré à
 * l'octroi est une porte nominative que quelqu'un a décidé d'ouvrir.
 */
export type OrigineCanal = "FICHE" | "OCTROI";

export interface CandidatAdresse {
  personId: string;
  fiche: FicheManuelle;
  origine: OrigineCanal;
  /** L'adresse par laquelle ce candidat a été résolu, telle qu'elle est en base. */
  adresse: string;
}

/** La ligne `User` que l'adaptateur trouve sur l'adresse saisie, quand il en trouve une. */
export interface LigneUser {
  email: string;
  username: string | null;
}

export interface Allowlists {
  operateurs: readonly string[];
  breakGlass: readonly string[];
}

export type RefusAdresse =
  | "INCONNUE"
  | "PLURALITE"
  | "FICHE_FERMEE"
  | "ALLOWLIST"
  | "LIGNE_ETRANGERE";

export type RecevabiliteAdresse =
  | { recevable: true; candidat: CandidatAdresse }
  | { recevable: false; refus: RefusAdresse };

function memeAdresse(une: string, autre: string): boolean {
  return une.trim().toLowerCase() === autre.trim().toLowerCase();
}

function partieLocale(adresse: string): string {
  return adresse.trim().toLowerCase().split("@")[0] ?? "";
}

/**
 * À qui une adresse saisie donne le droit de recevoir un lien, et pour qui elle ne
 * doit rien ouvrir du tout.
 *
 * Quatre refus, et leur ordre porte : c'est le premier qui rend le dernier sûr.
 *
 * 1. Une adresse qui désigne plus d'une personne n'identifie personne. Aucun index ne
 *    peut le garantir sur les canaux d'octroi, une même personne portant légitimement
 *    le même canal sur deux dossiers : la garde vit donc ici, et elle compte des
 *    personnes et non des lignes.
 * 2. Une adresse portée par une fiche que la collecte réécrit n'ouvre rien : ce serait
 *    la porte faible vers quelqu'un qui doit entrer par la forte. Un canal déclaré à
 *    l'octroi échappe à ce refus, et c'est sa raison d'être, une fiche collectée
 *    n'ayant aucune adresse que l'outil puisse corriger quand la boîte meurt.
 * 3. Une partie locale qui est un identifiant d'allowlist ne prouve rien mais
 *    ressemble à tout : c'est le seul garde-fou contre un opérateur qui ne s'est
 *    jamais connecté et dont l'adresse atterrit sur une fiche. L'identifiant de la
 *    fiche se refuse avec elle, et pas seulement l'adresse : l'octroi tient déjà cette
 *    règle sur le `username`, et deux portes d'une même règle qui ne disent pas la
 *    même phrase font dépendre la sûreté de l'ordre dans lequel une allowlist se
 *    remplit, un droit octroyé avant l'entrée d'un identifiant dans `OPERATORS`
 *    survivant à cette entrée.
 * 4. Une ligne `User` déjà munie d'un `username` est celle de quelqu'un qui est entré
 *    par la voie espace-membre : l'adopter donnerait une session assise sur elle. La
 *    règle ne peut pas être « toute ligne `User` », qui enfermerait dehors le
 *    participant lui-même dès sa deuxième visite, la première ayant fait naître une
 *    ligne sans `username` sur son adresse. C'est donc ce `username` qui mord, et lui
 *    seul : l'égalité des deux adresses est de la défense en profondeur, les deux
 *    appelants d'aujourd'hui résolvant la ligne et le candidat sur la même chaîne.
 */
export function adresseRecevable(
  candidats: readonly CandidatAdresse[],
  ligneUser: LigneUser | null,
  allowlists: Allowlists,
  declaresLocaux: readonly string[],
): RecevabiliteAdresse {
  if (new Set(candidats.map((candidat) => candidat.personId)).size > 1) {
    return { recevable: false, refus: "PLURALITE" };
  }

  // Une même personne peut être atteinte par les deux origines à la fois : c'est le
  // canal qui tranche, puisque c'est lui qu'un opérateur a nommément ouvert.
  const candidat = candidats.find(({ origine }) => origine === "OCTROI") ?? candidats[0];
  if (candidat === undefined) {
    return { recevable: false, refus: "INCONNUE" };
  }

  if (candidat.origine === "FICHE" && !ficheEditable(candidat.fiche, declaresLocaux).editable) {
    return { recevable: false, refus: "FICHE_FERMEE" };
  }

  const nomsARefuser = [partieLocale(candidat.adresse), candidat.fiche.username];
  if (nomsARefuser.some((nom) => estOperateur(nom, allowlists.operateurs, allowlists.breakGlass))) {
    return { recevable: false, refus: "ALLOWLIST" };
  }

  const ligneAdoptable =
    ligneUser === null ||
    (ligneUser.username === null && memeAdresse(ligneUser.email, candidat.adresse));
  if (!ligneAdoptable) {
    return { recevable: false, refus: "LIGNE_ETRANGERE" };
  }

  return { recevable: true, candidat };
}

/** Ce qu'il faut savoir d'une fiche pour dire où son lien de connexion partirait. */
export interface CanalDeFiche {
  communicationEmail: string | null;
}

export type CanalDuDroit =
  | { vivant: true; adresse: string; origine: OrigineCanal }
  | { vivant: false };

/**
 * Où le lien de connexion de ce droit partirait aujourd'hui, ou nulle part.
 *
 * Les deux origines ne valent pas la même chose et l'écran ne les rend pas de la même
 * façon : un canal déclaré à l'octroi est certain, l'outil l'ayant lui-même écrit et le
 * servant tel quel ; une adresse déduite de la fiche est une approximation, la collecte
 * la réécrivant sans condition et pouvant se périmer en silence.
 *
 * Un droit sans canal sur une fiche que la collecte a adoptée n'ouvre plus rien : c'est
 * le « canal mort », et il arrive sans qu'aucun geste humain n'ait eu lieu, la collecte
 * pouvant faire basculer une fiche fabriquée au milieu d'un dossier. Il se dit plutôt
 * que de se découvrir au lien qui ne marche pas, et il a deux sorties : ré-octroyer en
 * déclarant une adresse, ou entrer par l'identifiant beta.gouv.
 *
 * Elle dit où le lien partirait, jamais si l'adresse serait reçue : ce jugement-là
 * demande la base et vit dans `adresseRecevable`.
 */
export function canalDuDroit(
  fiche: FicheManuelle & CanalDeFiche,
  canal: string | null,
  declaresLocaux: readonly string[],
): CanalDuDroit {
  if (canal !== null) {
    return { vivant: true, adresse: canal, origine: "OCTROI" };
  }
  if (fiche.communicationEmail !== null && ficheEditable(fiche, declaresLocaux).editable) {
    return { vivant: true, adresse: fiche.communicationEmail, origine: "FICHE" };
  }
  return { vivant: false };
}

/**
 * Le lien de connexion partira-t-il sur une boîte que ce départ va couper ?
 *
 * La question se juge sur le domaine, et non sur l'égalité des deux adresses de la
 * fiche : cette égalité rate une adresse secondaire qui est elle aussi une boîte
 * fournie par l'employeur, et crie au loup sur une fiche qui n'en porte qu'une. Quels
 * domaines un départ coupe est une déclaration de politique et pas une propriété du
 * code, d'où la liste en argument.
 */
export function canalMenace(
  fiche: CanalDeFiche,
  canal: string | null,
  domainesMenaces: readonly string[],
): boolean {
  const adresse = canal ?? fiche.communicationEmail;
  if (adresse === null) {
    return false;
  }
  const domaine = adresse.trim().toLowerCase().split("@")[1];
  if (domaine === undefined) {
    return false;
  }
  return domainesMenaces.some((menace) => menace.trim().toLowerCase() === domaine);
}

/** Une étape lue par ce qu'elle attend de qui. */
export interface EtapeAttribuee {
  expectedActor: Acteur;
}

/**
 * Ce qu'un rôle voit d'un plan : les étapes qui l'attendent, et rien d'autre.
 *
 * Elle prend un rôle et non un nom, et ce n'est pas un oubli : l'acteur attendu est
 * une énumération de rôles, aucune étape ne sait dire « ce délégué-ci ». Deux délégués
 * d'un même dossier voient donc les mêmes étapes et les pointent l'un pour l'autre,
 * exactement comme deux opérateurs le font. Faire autrement demanderait une
 * désignation nominative sur l'étape, que le modèle ne porte pas : le droit se lit par
 * dossier et par personne, la visibilité par rôle, et les deux ne se confondent pas.
 */
export function etapesVisiblesPour<T extends EtapeAttribuee>(
  role: Acteur,
  etapes: readonly T[],
): T[] {
  return etapes.filter((etape) => etape.expectedActor === role);
}

/** Une étape lue par le second regard qu'elle attend, et par ce qu'il en est advenu. */
export interface EtapeSoumiseAuControle extends EtapeAttribuee {
  validationBy: Acteur | null;
  validation: EtatValidation;
}

/**
 * Ce qu'un rôle contrôle d'un plan : les déclarations qui attendent son regard.
 *
 * Seconde projection parce que la première ne peut pas la rendre : un délégué ne
 * contrôle que le porteur (`combinaisonValide`), si bien que l'étape qu'il signe porte
 * `expectedActor: "SUBJECT"` et qu'aucune projection sur l'acteur attendu ne la lui
 * montrera jamais. Sans elle, `validerEtape` reste ouverte à un rôle qui n'a nulle part
 * où l'exercer.
 *
 * Elle s'arrête à ce qui attend vraiment un regard, et pas à tout ce que ce rôle
 * contrôlera un jour : tant que personne n'a déclaré, il n'y a rien à contrôler, et
 * montrer ces étapes-là ouvrirait le plan entier à qui n'y signe encore rien.
 *
 * L'acteur attendu est écarté parce que la première projection le rend déjà : un
 * opérateur qui détient un droit contrôle aussi des étapes qui l'attendent, et les deux
 * listes les montreraient deux fois.
 */
export function etapesAControlerPar<T extends EtapeSoumiseAuControle>(
  role: Acteur,
  etapes: readonly T[],
): T[] {
  return etapes.filter(
    (etape) =>
      etape.validation === "AWAITING" &&
      etape.validationBy === role &&
      etape.expectedActor !== role,
  );
}

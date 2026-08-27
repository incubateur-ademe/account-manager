import type { Peremption } from "@/core/plan";
import { autoriseUneRevocation } from "@/core/rapprochement";

export type EtatEtape =
  | "PENDING"
  | "SKIPPED"
  | "SUCCEEDED"
  | "ALREADY_ABSENT"
  | "ALREADY_PRESENT"
  | "STALE"
  | "FAILED";

export type EtatDossier = "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";

/** Le sens d'un dossier : ce qu'il faudra donner, ou ce qu'il faudra retirer. */
export type SensDossier = "ONBOARDING" | "OFFBOARDING";

/**
 * Qui agit sur une étape, et qui contrôle ce qui y a été déclaré.
 *
 * `DELEGATE` existe sans qu'aucun chemin de code ne le produise : `roleSurDossier` ne
 * le rend jamais tant qu'un droit par objet n'existe pas. Une valeur inerte coûte
 * zéro, une valeur ajoutée après coup coûte un incident.
 */
export type Acteur = "OPERATOR" | "SUBJECT" | "DELEGATE";

/**
 * Où en est le contrôle d'une déclaration.
 *
 * Dimension orthogonale à `EtatEtape`, qui dit ce qui a été déclaré : une case « j'ai
 * signé la charte » se croit sur parole, un « j'ai retiré l'accès administrateur » ne
 * se croit pas. Les fusionner obligerait à décliner chaque déclaration validable en
 * deux valeurs, et l'énumération dirait deux choses à la fois.
 */
export type EtatValidation = "NONE" | "AWAITING" | "ACCEPTED" | "REFUSED";

/** Une étape lue sur ses deux dimensions : ce qui a été déclaré, et où en est son contrôle. */
export interface EtapeSuivie {
  etat: EtatEtape;
  validation: EtatValidation;
}

/** Ce qu'il faut savoir d'un dossier pour dire qui est qui devant lui. */
export interface DossierConcerne {
  /** Le username beta.gouv de la personne dont le dossier parle. */
  porteur: string;
}

export type EtatPlan =
  | "DRAFT"
  | "CONFIRMABLE"
  | "EXECUTING"
  | "EXECUTED"
  | "PARTIALLY_EXECUTED"
  | "CANCELLED"
  | "EXPIRED"
  | "STALE";

export interface Refus {
  possible: false;
  raison: string;
}

export type Verdict = { possible: true } | Refus;

/**
 * Confirmer, c'est dire « j'ai lu cette liste et j'en réponds ». Le sens de ce geste
 * tient à ce que la liste ne bouge plus après : on ne confirme donc ni un plan trop
 * vieux, ni un plan que la réalité a déjà démenti, ni un plan déjà confirmé.
 */
export function peutConfirmer(etat: EtatPlan, peremption: Peremption, etapes: number): Verdict {
  if (etat !== "DRAFT") {
    return { possible: false, raison: "Ce plan n'est plus un brouillon." };
  }
  if (etapes === 0) {
    return { possible: false, raison: "Ce plan ne demande aucune action." };
  }
  if (peremption.perime) {
    return {
      possible: false,
      raison:
        "Ce plan a dépassé sa date de validité : ce qu'il décrit a été constaté il y a trop longtemps.",
    };
  }
  if (peremption.obsolete) {
    return {
      possible: false,
      raison: "Les accès observés ont changé depuis le calcul : ce plan ne les décrit plus.",
    };
  }
  return { possible: true };
}

/**
 * Ce que l'état du plan autorise, sans regarder qui demande.
 *
 * Séparé de `peutPointer` parce que l'écran a besoin de la réponse avant de connaître
 * la moindre étape : il annonce d'un mot qu'un dossier se pointe ou non, là où la
 * garde d'écriture juge une étape précise pour une personne précise.
 */
export function planPointable(etat: EtatPlan): Verdict {
  // `PARTIALLY_EXECUTED` autant qu'`EXECUTING` : c'est l'état d'un plan dont une
  // étape a échoué, et le refuser murait le dossier. Plus rien ne se pointait, donc
  // plus rien ne se soldait, donc la clôture restait hors d'atteinte, l'annulation
  // aussi puisque le plan porte des pointages, et le dossier restait vivant pour
  // toujours en bloquant jusqu'à la fusion des fiches de la personne.
  if (etat === "EXECUTING" || etat === "PARTIALLY_EXECUTED") {
    return { possible: true };
  }
  if (etat === "DRAFT") {
    return { possible: false, raison: "Ce plan doit d'abord être confirmé." };
  }
  return { possible: false, raison: "Ce plan est clos." };
}

/**
 * Pointer une étape est une déclaration humaine, pas une exécution : l'outil ne
 * touche à aucun système ici. On ne pointe donc que ce qui a été confirmé, sans quoi
 * on consignerait des gestes faits d'après un brouillon que personne n'a approuvé.
 *
 * L'état du plan d'abord, la personne ensuite : un refus qui parlerait du rôle sur un
 * plan encore en brouillon désignerait le mauvais obstacle.
 *
 * Un opérateur pointe n'importe quelle étape, y compris celle d'un délégué : sans
 * cette substitution, une étape confiée à quelqu'un qui s'évapore murerait le dossier,
 * et aucun délégué n'existe encore.
 */
export function peutPointer(etat: EtatPlan, acteurAttendu: Acteur, role: Acteur | null): Verdict {
  const plan = planPointable(etat);
  if (!plan.possible) {
    return plan;
  }
  if (role === null) {
    return { possible: false, raison: "Ce dossier ne vous concerne pas." };
  }
  if (role !== acteurAttendu && role !== "OPERATOR") {
    return {
      possible: false,
      raison: "Cette étape ne vous revient pas : elle attend quelqu'un d'autre.",
    };
  }
  return { possible: true };
}

/**
 * Ce que quelqu'un est devant un dossier donné.
 *
 * Le porteur passe avant l'opérateur, et cette priorité est la règle : sans elle,
 * quelqu'un instruirait son propre départ et validerait ses propres cases. La
 * conséquence est assumée, un opérateur qui part a besoin d'un autre opérateur pour
 * valider ses étapes sensibles, et c'est exactement le but.
 *
 * `DELEGATE` n'en sort jamais : il n'existe aucun droit par objet à lire. Une étape
 * confiée à un délégué reste donc pointable par un opérateur en substitution, si bien
 * qu'aucun dossier ne se bloque en attendant ce droit.
 */
export function roleSurDossier(
  username: string,
  dossier: DossierConcerne,
  estOperateur: boolean,
): Acteur | null {
  if (username === dossier.porteur) {
    return "SUBJECT";
  }
  return estOperateur ? "OPERATOR" : null;
}

/**
 * Les quatre répartitions de rôles qu'une étape peut porter, et elles seules : un
 * opérateur contrôle le porteur, un opérateur contrôle le délégué, un délégué contrôle
 * le porteur, un opérateur contrôle un opérateur.
 *
 * Cette dernière est l'exemple qui a fait naître tout ceci : « j'ai retiré l'accès
 * administrateur » est un geste d'opérateur, et c'est justement celui qui ne se croit
 * pas sur parole. Ce n'est pas une déclaration que son auteur redirait une seconde
 * fois : la règle qui l'interdit porte sur le username et non sur le rôle, et c'est
 * `peutValider` qui la tient. Deux opérateurs sont deux personnes.
 *
 * Trois répartitions restent refusées, chacune pour sa raison. La personne concernée
 * ne contrôle jamais, quel que soit l'acteur : c'est elle qu'on contrôle. Un délégué
 * ne contrôle jamais un opérateur : faire relire l'équipe transverse par quelqu'un
 * d'extérieur au dossier inverse la responsabilité. Un délégué ne contrôle pas non
 * plus un délégué, faute de quoi que ce soit qui sache aujourd'hui distinguer deux
 * délégués l'un de l'autre : `roleSurDossier` ne rend jamais `DELEGATE`, là où
 * `OPERATOR` sort d'une liste nommée. Elle s'ouvrira le jour où un droit par objet
 * existe, et l'ordre des choses est celui-là : ouvrir une répartition ne coûte rien,
 * en fermer une après coup demande de reprendre les lignes déjà écrites.
 *
 * Une étape sans contrôle est valide quel que soit son acteur, c'est le cas de tout ce
 * qui se croit sur parole.
 *
 * Cette fonction tient l'invariant à elle seule : aucune contrainte en base ne le
 * double, la combinaison n'étant écrite qu'ici, au moment de figer les étapes, et
 * aucune course ne pouvant donc en produire une invalide.
 */
export function combinaisonValide(acteurAttendu: Acteur, validationBy: Acteur | null): boolean {
  if (validationBy === null) {
    return true;
  }
  if (validationBy === "SUBJECT") {
    return false;
  }
  if (validationBy === "OPERATOR") {
    return true;
  }
  // Reste le délégué au contrôle, et il ne relit que le porteur.
  return acteurAttendu === "SUBJECT";
}

/**
 * Où en est le contrôle juste après qu'une déclaration a été faite.
 *
 * Le contrôleur attendu qui pointe à la place de quelqu'un d'autre vaut validation :
 * il a vu la chose, et exiger qu'un second opérateur le confirme bloquerait un outil à
 * un seul mainteneur, qui est le cas nominal ici. Le journal montre alors les deux
 * gestes d'une seule main.
 *
 * Encore faut-il qu'il y ait eu substitution, et c'est là que le rôle attendu compte :
 * sur une étape dont l'acteur et le contrôleur portent le même rôle, personne ne se
 * substitue à personne, et un opérateur qui pointe son propre geste n'a rien contrôlé
 * du tout. Le second regard reste à venir, et il viendra d'un autre nom.
 */
export function validationApresPointage(
  acteurAttendu: Acteur,
  validationBy: Acteur | null,
  roleDuDeclarant: Acteur,
): "NONE" | "AWAITING" | "ACCEPTED" {
  if (validationBy === null) {
    return "NONE";
  }
  return roleDuDeclarant === validationBy && roleDuDeclarant !== acteurAttendu
    ? "ACCEPTED"
    : "AWAITING";
}

/** Une étape telle que la garde de validation a besoin de la lire. */
export interface EtapeAValider {
  validationBy: Acteur | null;
  validation: EtatValidation;
  /** Qui a déclaré, par son nom : la règle se compare sur le username, pas sur le rôle. */
  declaredBy: string | null;
}

/** Qui prétend contrôler, par son nom et par son rôle sur ce dossier. */
export interface Valideur {
  username: string;
  role: Acteur | null;
}

/**
 * Contrôler une déclaration, c'est porter un second regard sur elle. Il n'y a donc
 * rien à contrôler tant que personne n'a parlé, et le regard doit venir d'ailleurs.
 *
 * La règle porte sur le nom et non sur le rôle : c'est la raison d'être de
 * `declaredBy`, sans laquelle « personne ne valide sa propre déclaration » serait
 * déclarative et fausse, un opérateur pouvant pointer puis valider la même étape.
 *
 * Un opérateur valide ce qu'un délégué aurait dû valider, l'inverse n'étant pas vrai :
 * le contraire coincerait un dossier dès que le délégué s'évapore, au moment précis où
 * l'outil sert.
 */
export function peutValider(etape: EtapeAValider, valideur: Valideur): Verdict {
  if (etape.validation !== "AWAITING" || etape.validationBy === null) {
    return { possible: false, raison: "Cette étape n'attend aucune validation." };
  }
  if (valideur.role === null) {
    return { possible: false, raison: "Ce dossier ne vous concerne pas." };
  }
  if (valideur.role === "SUBJECT") {
    return {
      possible: false,
      raison: "La personne concernée ne contrôle pas ce qu'on déclare sur son propre dossier.",
    };
  }
  if (valideur.role === "DELEGATE" && etape.validationBy === "OPERATOR") {
    return { possible: false, raison: "Cette étape attend le regard d'un opérateur." };
  }
  // Sans nom de déclarant, la règle qui interdit de valider sa propre déclaration n'a
  // rien à comparer : valider serait alors approuver une parole que personne ne porte.
  if (etape.declaredBy === null) {
    return {
      possible: false,
      raison:
        "Cette déclaration ne porte le nom de personne : elle est à refaire avant d'être validée.",
    };
  }
  if (etape.declaredBy === valideur.username) {
    return {
      possible: false,
      raison: "Personne ne valide sa propre déclaration : cette étape attend un autre regard.",
    };
  }
  return { possible: true };
}

/**
 * Une étape qu'on ne reverra plus : elle a été traitée, ou écartée en connaissance de
 * cause, et rien n'attend plus sur ce qui en a été dit.
 *
 * Une déclaration suspendue n'est ni soldée ni en échec : elle a été faite, et son
 * contrôle n'a pas eu lieu. Un refus non plus : il dit que la preuve n'est pas faite,
 * donc que l'étape est de nouveau à faire.
 */
export function estSoldee(etape: EtapeSuivie): boolean {
  if (etape.validation === "AWAITING" || etape.validation === "REFUSED") {
    return false;
  }
  return (
    etape.etat === "SUCCEEDED" ||
    etape.etat === "ALREADY_ABSENT" ||
    etape.etat === "ALREADY_PRESENT" ||
    etape.etat === "SKIPPED"
  );
}

/**
 * Où en est un plan, déduit de ses étapes et jamais posé à la main : un plan dont
 * l'état ne se lit pas dans ses étapes finit par affirmer une chose que le détail
 * dément.
 *
 * « Déjà absent » et « déjà présent » valent réussite, c'est le cas nominal quand
 * quelqu'un d'autre est passé avant. « Ignorée » aussi, à la différence près qu'elle
 * porte une raison.
 */
export function etatApresPointage(etapes: readonly EtapeSuivie[]): EtatPlan {
  if (etapes.length === 0) {
    return "EXECUTED";
  }
  // Une attente de validation compte comme une étape à faire, et non comme un échec :
  // une étape en échec et une étape en attente donnent `EXECUTING`, jamais
  // `PARTIALLY_EXECUTED`, parce que quelque chose bouge encore.
  if (etapes.some((etape) => etape.etat === "PENDING" || etape.validation === "AWAITING")) {
    return "EXECUTING";
  }
  return etapes.every((etape) => estSoldee(etape)) ? "EXECUTED" : "PARTIALLY_EXECUTED";
}

/**
 * Un dossier ne se clôt pas parce que les cases sont cochées, mais parce que plus
 * rien n'attend : un plan partiellement exécuté laisse des accès ouverts, et le
 * dossier doit continuer de le dire.
 */
export function dossierSoldable(etatPlan: EtatPlan): boolean {
  return etatPlan === "EXECUTED";
}

/**
 * Les états qu'un dossier de ce sens peut prendre.
 *
 * Une arrivée est une décision, jamais une veille ni un soupçon : elle n'admet ni
 * `WATCH`, réservé à ce qu'une collecte lèvera un jour toute seule, ni `CANDIDATE`,
 * qui dit qu'on soupçonne un départ sans l'avoir tranché. Personne ne soupçonne une
 * arrivée : ou bien on la prépare, ou bien il n'y a pas de dossier.
 */
const ADMIS: Record<SensDossier, readonly EtatDossier[]> = {
  ONBOARDING: ["CONFIRMED", "CANCELLED", "DONE"],
  OFFBOARDING: ["WATCH", "CANDIDATE", "CONFIRMED", "CANCELLED", "DONE"],
};

export function etatsAdmis(sens: SensDossier): readonly EtatDossier[] {
  return ADMIS[sens];
}

/**
 * L'état de naissance d'un dossier ouvert à la main. Une arrivée naît confirmée,
 * puisque l'ouvrir est déjà la décision. Un départ naît candidat : l'ouvrir dit
 * qu'on s'en occupe, le confirmer dit qu'on répond de la liste.
 */
const NAISSANCE: Record<SensDossier, EtatDossier> = {
  ONBOARDING: "CONFIRMED",
  OFFBOARDING: "CANDIDATE",
};

export function etatDeNaissance(sens: SensDossier): EtatDossier {
  return NAISSANCE[sens];
}

export function peutOuvrir(sens: SensDossier, etat: EtatDossier): Verdict {
  if (!etatsAdmis(sens).includes(etat)) {
    return {
      possible: false,
      raison:
        sens === "ONBOARDING"
          ? "Une arrivée ne se met ni en veille ni en soupçon : elle se prépare ou elle n'existe pas."
          : "Cet état n'existe pas pour un départ.",
    };
  }
  if (!dossierVivant(etat)) {
    return { possible: false, raison: "Un dossier ne s'ouvre pas déjà clos." };
  }
  return { possible: true };
}

/**
 * Ce qu'est un dossier vivant, dit une fois. La règle vivait en deux exemplaires
 * littéraux, dans l'ouverture d'un dossier et dans le blocage de la fusion : un
 * dictionnaire exhaustif fait tomber le typecheck le jour où une valeur s'ajoute à
 * l'énum, là où un tableau littéral aurait continué de mentir en silence.
 */
const VIVANT: Record<EtatDossier, boolean> = {
  WATCH: true,
  CANDIDATE: true,
  CONFIRMED: true,
  CANCELLED: false,
  DONE: false,
};

export function dossierVivant(etat: EtatDossier): boolean {
  return VIVANT[etat];
}

export const ETATS_VIVANTS: readonly EtatDossier[] = (Object.keys(VIVANT) as EtatDossier[]).filter(
  dossierVivant,
);

/**
 * Un plan qui tombe avec son dossier. Un brouillon n'engage personne, et un plan
 * qui attend d'être confirmé pas davantage. Un plan remplacé garde en revanche ce
 * qui l'a écarté : `EXPIRED` et `STALE` disent pourquoi il ne vaut plus, et les
 * écraser perdrait cette raison.
 */
export function planAAnnuler(plan: EtatPlan | null): boolean {
  return plan === "DRAFT" || plan === "CONFIRMABLE";
}

/**
 * Un plan que quelqu'un a confirmé, et dont les étapes ont pu être pointées. Un plan
 * remplacé n'en est pas : `EXPIRED` et `STALE` disent qu'il a cessé de valoir avant
 * que personne n'en réponde.
 */
function planEngage(plan: EtatPlan): boolean {
  return plan === "EXECUTING" || plan === "EXECUTED" || plan === "PARTIALLY_EXECUTED";
}

/**
 * Annuler, c'est dire que ce dossier n'aura pas lieu. Le geste s'arrête là où
 * commence l'engagement : dès qu'un plan est confirmé, des étapes ont pu être
 * pointées, et défaire le dossier ferait disparaître des paroles que la collecte
 * doit encore vérifier. Il n'y a pas de fenêtre de rétractation ici, il y a la
 * clôture.
 */
export function peutAnnuler(dossier: EtatDossier, plan: EtatPlan | null): Verdict {
  if (dossier === "CANCELLED") {
    return { possible: false, raison: "Ce dossier est déjà annulé." };
  }
  if (dossier === "DONE") {
    return { possible: false, raison: "Ce dossier est clos : il ne s'annule plus." };
  }
  if (plan !== null && planEngage(plan)) {
    // La phrase dit ce que l'annulation ne fait pas, et n'envoie nulle part : la
    // sortie d'un plan engagé est de reprendre ses étapes puis de clore le dossier,
    // ce que l'écran offre, et le redire ici en ferait la deuxième fois.
    return {
      possible: false,
      raison: "Ce plan est engagé : l'annulation ne défait pas ce qui a été déclaré fait.",
    };
  }
  return { possible: true };
}

/**
 * Clore, c'est constater que tout est soldé. Les trois refus vivaient en dur dans
 * l'action, dont celui qui parlait d'accès restés ouverts sur un dossier annulé, où
 * il n'y en avait aucun.
 */
const ETAPES_NON_SOLDEES: Record<SensDossier, string> = {
  ONBOARDING: "Toutes les étapes ne sont pas soldées : des accès n'ont pas été donnés.",
  OFFBOARDING: "Toutes les étapes ne sont pas soldées : des accès restent ouverts.",
};

export function peutClore(
  sens: SensDossier,
  dossier: EtatDossier,
  plan: EtatPlan | null,
  etapes: number,
): Verdict {
  if (dossier === "DONE") {
    return { possible: false, raison: "Ce dossier est déjà clos." };
  }
  if (dossier === "CANCELLED") {
    return { possible: false, raison: "Ce dossier est annulé : il n'y a rien à clore." };
  }
  if (plan === null) {
    return {
      possible: false,
      raison: "Aucun plan n'a été enregistré pour ce dossier : il n'y a rien à solder.",
    };
  }

  // Un plan qui ne demande rien est soldé par construction, et il faut le dire :
  // la confirmation refuse une liste vide, à raison, si bien que ce plan n'atteindra
  // jamais l'état exécuté. Sans cette ligne, la seule sortie restait l'annulation,
  // qui inscrit que le dossier n'aura pas lieu alors qu'il a bien lieu et que l'outil
  // n'avait simplement rien à faire.
  if (etapes === 0) {
    return { possible: true };
  }

  if (!dossierSoldable(plan)) {
    return { possible: false, raison: ETAPES_NON_SOLDEES[sens] };
  }
  return { possible: true };
}

export interface CompteConstate {
  provider: string;
  methode: string;
}

export interface SystemesDuDepart {
  /** Systèmes où un geste est possible : un compte y est rattaché de façon sûre. */
  revocables: readonly string[];
  /** Tous les systèmes où un compte est observé, quelle que soit la solidité du rattachement. */
  observes: readonly string[];
  /** Systèmes où un compte n'est rattaché que sur une ressemblance : aucune étape ne peut le viser. */
  nonConfirmes: readonly string[];
}

/**
 * Répartit les systèmes selon ce qu'on a le droit d'y faire.
 *
 * Un compte rattaché sur une ressemblance ne produit aucune étape, et c'est une règle
 * dure : couper sur cette base reviendrait à couper l'accès d'un homonyme. Mais son
 * système doit se dire quand même, sans quoi un plan muet laisserait croire qu'il n'y
 * a rien là, alors qu'il y a un compte que personne n'a encore tranché.
 */
export function systemesDuDepart(comptes: readonly CompteConstate[]): SystemesDuDepart {
  const revocables = new Set<string>();
  const observes = new Set<string>();
  const nonConfirmes = new Set<string>();

  for (const compte of comptes) {
    observes.add(compte.provider);
    if (autoriseUneRevocation(compte.methode)) {
      revocables.add(compte.provider);
    } else {
      nonConfirmes.add(compte.provider);
    }
  }

  const trier = (valeurs: ReadonlySet<string>) =>
    [...valeurs].sort((a, b) => a.localeCompare(b, "fr"));

  return {
    revocables: trier(revocables),
    observes: trier(observes),
    nonConfirmes: trier(nonConfirmes),
  };
}

/**
 * Recalculer remplace une liste que personne n'a approuvée. Un plan confirmé porte
 * des pointages : le refaire effacerait ce que quelqu'un a déclaré avoir fait.
 *
 * Sans ce geste, un dossier dont le plan a péri n'a plus d'issue. La confirmation le
 * refuse à juste titre, et rien d'autre ne permet d'en calculer un nouveau : le
 * dossier reste ouvert sur des accès dont personne ne s'occupe plus.
 */
export function peutRecalculer(etat: EtatPlan, peremption: Peremption): Verdict {
  if (etat !== "DRAFT") {
    return {
      possible: false,
      raison: "Seul un brouillon se recalcule : ce plan n'en est plus un.",
    };
  }
  if (!peremption.perime && !peremption.obsolete) {
    return {
      possible: false,
      raison: "Ce plan décrit encore la situation observée : il n'y a rien à recalculer.",
    };
  }
  return { possible: true };
}

/**
 * Ce que devient le plan qu'un recalcul remplace. La péremption prime sur
 * l'obsolescence : c'est un fait daté, là où l'autre est une comparaison qui dépend
 * de ce qu'on vient de lire.
 */
export function etatDUnPlanRemplace(peremption: Peremption): EtatPlan {
  return peremption.perime ? "EXPIRED" : "STALE";
}

import type { ObservedDetail, ObservedIdentity } from "@/core/connector";
import type { IdKind, PersonSource, SyncStatus } from "@/generated/prisma/enums";

/**
 * Une collecte qui rapporte beaucoup moins que la précédente n'est pas distinguable
 * d'un départ collectif : les deux se ressemblent trait pour trait, seule l'ampleur
 * les sépare. Dans le doute, on refuse d'en tirer des disparitions, car dater une
 * disparition finit par couper un accès.
 *
 * Sans point de comparaison, il n'y a rien à soupçonner : une première collecte n'est
 * pas une chute.
 */
/**
 * Le contrat parle en minuscules, la base en majuscules. La conversion est explicite
 * plutôt que castée : deux vocabulaires qui se ressemblent sont exactement ce qui
 * finit par diverger sans que rien ne le dise.
 */
const KIND: Record<ObservedIdentity["idKind"], IdKind> = {
  opaque: "OPAQUE",
  email: "EMAIL",
  upn: "UPN",
};

/**
 * Ce qu'une identité collectée laisse en base, et rien de plus.
 *
 * La liste est courte et elle est délibérée : ce qui sert de clé, ce qui sert au
 * rapprochement, ce qui déclenche, et ce qui sert à décider à qui un compte
 * appartient. `emails` et `lastActivityAt` sont collectés et ne sont pas persistés :
 * écrire `emails` changerait l'issue du rapprochement sur le parc existant, une
 * ressemblance devenant une correspondance d'adresse, donc une identité révocable.
 * Ce n'est pas un oubli, c'est un autre ticket.
 *
 * `details` suit le dernier état constaté, absence comprise : un connecteur qui
 * cesse de savoir quelque chose d'un compte doit cesser de l'afficher.
 */
export function champsConstates(
  identite: ObservedIdentity,
  now: Date,
): {
  handle: string;
  idKind: IdKind;
  details: readonly ObservedDetail[] | null;
  lastSeenAt: Date;
  vanishedAt: null;
} {
  return {
    handle: identite.handle,
    idKind: KIND[identite.idKind],
    details: identite.details ?? null,
    lastSeenAt: now,
    vanishedAt: null,
  };
}

export function chuteExcessive(reference: number, observe: number, partMax: number): boolean {
  if (reference <= 0) {
    return false;
  }
  return observe < Math.floor(reference * (1 - partMax));
}

/**
 * Un autre passage complet est-il venu depuis ce constat ?
 *
 * Une seule question sert deux règles, parce que c'est la même : ce qu'un passage a
 * constaté, seul un autre passage complet peut le confirmer. Lue sur la disparition
 * d'une fiche, elle dit qu'une absence a duré et vaut départ, donc que la revoir sera
 * un retour. Lue sur sa dernière vue, elle dit qu'un angle mort a duré, et que ce
 * qu'un passage a avoué ne pas savoir lire, il peut cesser de l'épargner.
 *
 * Les deux dates comparées sont des instants de passage : `vanishedAt` comme
 * `lastSeenAt` portent le `startedAt` du passage qui les a écrits. Une égalité dit
 * donc que le dernier passage complet est celui-là même, et qu'aucun autre n'est venu
 * depuis : la comparaison est stricte pour cette raison, et non par prudence.
 *
 * Ce qui se compte est un passage et non un délai : la période du traitement vit dans
 * l'orchestrateur et aucun code d'ici ne la lit, et une relance à la main met deux
 * passages à quelques minutes l'un de l'autre. Un passage complet est exigé par
 * symétrie avec le garde-fou du dessus : un passage qui ne date aucune disparition
 * n'en confirme aucune. Sans passage complet connu il n'y a rien à confirmer, comme
 * une première collecte n'est pas une chute.
 */
export function autrePassageCompletDepuis(
  constat: Date | null,
  dernierPassageComplet: Date | null,
): boolean {
  if (constat === null || dernierPassageComplet === null) {
    return false;
  }
  return constat.getTime() < dernierPassageComplet.getTime();
}

/**
 * Une fiche que le dernier passage complet n'a pas rendue, alors que rien ne dit
 * qu'elle est partie.
 *
 * C'est le seul état qu'un refus de disparition laisse en base : le passage n'écrit
 * rien, il s'abstient d'écrire. L'état se relit donc tel quel, sans compteur ni
 * colonne, et l'écran qui l'annonce lit exactement ce que la collecte a lu pour
 * décider.
 *
 * Bornée aux fiches que la collecte est censée lire. Une fiche fabriquée à la main
 * pour nommer un compte n'est réclamée par aucune source amont : sa dernière vue est
 * celle de sa création et ne bougera plus, si bien qu'elle serait annoncée non rendue
 * à chaque passage, pour toujours. Une fiche déjà datée disparue est passée sous
 * l'autorité du constat de sortie, qui dit la même chose en disant quoi faire.
 */
export function nonRendueAuDernierPassage(
  fiche: { source: PersonSource; lastSeenAt: Date; vanishedAt: Date | null },
  dernierPassageComplet: Date | null,
): boolean {
  if (fiche.source !== "BETA" || fiche.vanishedAt !== null) {
    return false;
  }
  return autrePassageCompletDepuis(fiche.lastSeenAt, dernierPassageComplet);
}

/**
 * En deçà, une vague n'en est pas une : sur un petit périmètre, une rentrée de
 * septembre ordinaire franchit la part sans que rien d'anormal ne se soit produit,
 * et refuser d'y conclure ferait taire la détection au moment précis où elle sert.
 */
export const PLANCHER_ARRIVEES = 5;

/**
 * La symétrie avec `chuteExcessive` n'est pas décorative : le périmètre arrive en un
 * seul appel, et une réponse anormale peut aussi bien enfler que fondre. Une source
 * qui rend d'un coup un périmètre plus large qu'il ne l'était n'est pas distinguable
 * d'une arrivée collective, et dans le doute on refuse d'en tirer des arrivées, car
 * constater une arrivée finit par ouvrir un dossier au nom de quelqu'un.
 *
 * La borne se dérive de l'expression de la chute plutôt que de `reference * partMax`,
 * qui s'en écarte d'une unité dès que la part ne tombe pas juste : deux garde-fous
 * qui se disent symétriques et ne retiennent pas le bras au même écart ne le sont
 * plus, et c'est le genre de divergence que personne ne vient relire.
 */
export function arriveeMassive(reference: number, observe: number, partMax: number): boolean {
  if (observe < PLANCHER_ARRIVEES || reference <= 0) {
    return false;
  }
  return observe > reference - Math.floor(reference * (1 - partMax));
}

export interface Fraicheur {
  /** Vrai quand ce qui est affiché ne peut plus être tenu pour l'état du jour. */
  perimee: boolean;
  /** Âge de la dernière collecte complète, nul quand il n'y en a jamais eu. */
  heures: number | null;
}

const HEURE = 60 * 60 * 1000;

/**
 * Une collecte qui a cessé de tourner ne se voit pas : les personnes gardent leur
 * échéance, les statuts restent au vert, et l'écran affiche un périmètre gelé avec
 * la même assurance qu'un périmètre frais. C'est la panne la plus discrète de ce
 * système, et la seule qui fasse mentir tous ses écrans à la fois.
 *
 * Le silence est donc traité comme un signal : passé le délai, on le dit.
 */
export function fraicheurDe(
  derniereCollecte: Date | null,
  maintenant: Date,
  seuilHeures: number,
): Fraicheur {
  if (derniereCollecte === null) {
    return { perimee: true, heures: null };
  }

  const heures = Math.max(
    0,
    Math.floor((maintenant.getTime() - derniereCollecte.getTime()) / HEURE),
  );
  return { perimee: heures >= seuilHeures, heures };
}

/**
 * L'ingestion du périmètre passe par ce fournisseur : ses runs disent qu'on connaît
 * les personnes, jamais qu'on a lu un système cible. Les compter comme une collecte
 * de comptes ferait passer une absence d'observation pour une absence d'accès.
 */
export const FOURNISSEUR_PERIMETRE = "espace-membre";

export interface ReleveSysteme {
  provider: string;
  startedAt: Date;
  status: "OK" | "PARTIAL" | "FAILED" | "SKIPPED";
}

export interface SystemeMuet {
  provider: string;
  /** Ce qui cloche : jamais lu, plus lu depuis trop longtemps, ou en échec. */
  raison: "perime" | "echec" | "non-lu";
  heures: number | null;
}

/**
 * La fraîcheur du périmètre ne dit rien des systèmes cibles. Une lecture GitHub qui
 * échoue toutes les nuits depuis un mois laisse pourtant les fiches affirmer que
 * personne n'y a de compte, sur l'écran précis où se décide une coupure : l'absence
 * d'observation s'y lit exactement comme une absence de compte.
 *
 * Cette fonction rend les systèmes dont on ne peut plus dire qu'on les regarde.
 */
export function systemesMuets(
  releves: readonly ReleveSysteme[],
  attendus: readonly string[],
  maintenant: Date,
  seuilHeures: number,
): SystemeMuet[] {
  const muets: SystemeMuet[] = [];

  for (const provider of attendus) {
    const releve = releves.find((candidat) => candidat.provider === provider);

    if (!releve) {
      muets.push({ provider, raison: "non-lu", heures: null });
      continue;
    }

    if (releve.status === "FAILED") {
      muets.push({ provider, raison: "echec", heures: null });
      continue;
    }

    // Un système annoncé comme non lu n'est pas une panne : la trace existe, elle
    // dit ce qu'il manque, et c'est déjà ce qu'on voulait savoir.
    if (releve.status === "SKIPPED") {
      muets.push({ provider, raison: "non-lu", heures: null });
      continue;
    }

    const { perimee, heures } = fraicheurDe(releve.startedAt, maintenant, seuilHeures);
    if (perimee) {
      muets.push({ provider, raison: "perime", heures });
    }
  }

  return muets;
}

/**
 * Ce qu'un garde-fou de chute a refusé de dater, dit assez précisément pour qu'un
 * passage suivant reconnaisse le même refus.
 *
 * Trois familles, trois verrous distincts. Une chute des identités interdit de conclure
 * sur qui a disparu, et donc aussi sur les accès qui en dépendent. Une chute des
 * ressources n'interdit que les accès : qu'un connecteur cesse d'émettre une famille
 * de ressources ne dit rien de la personne dont la fiche vient de s'éteindre. Une chute
 * du périmètre interdit les deux à la fois, et elle se distingue des autres par sa
 * référence : un décompte de lignes vivantes en base se corrige de lui-même dès qu'une
 * datation passe, alors que l'effectif du dernier passage complet ne bouge que si un
 * passage se dit complet, ce que le refus lui-même empêche.
 */
export type FamilleDeChute = "identites" | "ressources" | "perimetre";

export interface RefusDeDatation {
  famille: FamilleDeChute;
  observe: number;
  reference: number;
  /**
   * Combien de fiches la datation toucherait si elle avait lieu, compté avec la requête
   * même qui les daterait. Les deux nombres du dessus disent des tailles de listes,
   * celui-ci dit la conséquence, et les deux mondes ne coïncident pas : une nuit
   * dégradée fait naître des fiches sans toucher la référence, si bien qu'un écart
   * annoncé de quatre peut en dater onze.
   *
   * Propre au périmètre. Un système cible ne l'écrit pas : sa référence est déjà un
   * décompte de lignes tenues pour vivantes, donc déjà la conséquence. Absent aussi
   * quand le comptage n'a pas abouti, ce qui ne change rien au refus : sans ce nombre
   * il n'y a pas d'ampleur à mesurer, donc pas de décision qui lève.
   *
   * Hors de la comparaison des refus répétés, qui ne lit que les deux nombres du
   * dessus : ce compte bouge dès qu'une fiche naît, et un refus par ailleurs identique
   * cesserait de s'annoncer installé pour cette seule raison, refermant la sortie.
   */
  datables?: number;
}

const FAMILLES: readonly FamilleDeChute[] = ["identites", "ressources", "perimetre"];

/**
 * L'écran poste la famille d'un garde-fou dans un formulaire, donc en chaîne libre.
 * La reconnaître ici plutôt que chez l'action qui la reçoit est ce qui empêche une
 * famille de plus d'être annoncée par un écran et refusée par le seul chemin qui
 * permette d'en sortir.
 */
export function estFamilleDeChute(valeur: string): valeur is FamilleDeChute {
  return (FAMILLES as readonly string[]).includes(valeur);
}

/**
 * Les familles dont une décision se mesure à ce qu'une datation toucherait.
 *
 * Une table plutôt qu'une condition, comme partout où cette famille se décline : une
 * famille de plus qui ne dirait pas si son ampleur se mesure ne compilerait pas, là où
 * une condition l'enverrait sans bruit du côté de celles qui ne mesurent rien.
 */
const AMPLEUR_EXIGEE: Record<FamilleDeChute, boolean> = {
  identites: false,
  ressources: false,
  perimetre: true,
};

/**
 * Y a-t-il de quoi mesurer une décision contre ce refus ?
 *
 * Le nombre manque quand le comptage n'a pas abouti, et une décision posée là-dessus
 * est écartée sans rien dater. La question se pose donc au moment où quelqu'un tranche
 * et peut encore l'apprendre, et pas seulement au passage qui l'écarterait.
 */
export function ampleurMesurable(refus: RefusDeDatation): boolean {
  return !AMPLEUR_EXIGEE[refus.famille] || refus.datables !== undefined;
}

/**
 * Un garde-fou qui refuse la même chose, avec les mêmes nombres, passage après
 * passage, ne décrit plus un incident : il décrit un état, et un état que son propre
 * refus entretient. Les données périmées déclenchent le garde-fou, qui empêche de les
 * nettoyer, qui les maintient périmées.
 *
 * Compter les répétitions est ce qui permet de le dire. Sans ce compte, la ligne de
 * journal ressemble à un avertissement passager alors qu'elle annonce un blocage
 * définitif, et un opérateur qui lit le même avertissement tous les jours cesse de le
 * lire.
 */
export function refusRepete(
  refus: RefusDeDatation,
  precedents: readonly (RefusDeDatation | null)[],
): number {
  let repetitions = 1;

  for (const precedent of precedents) {
    if (
      precedent === null ||
      precedent.famille !== refus.famille ||
      precedent.observe !== refus.observe ||
      precedent.reference !== refus.reference
    ) {
      return repetitions;
    }
    repetitions += 1;
  }

  return repetitions;
}

/**
 * En deçà, on ne sait pas encore : une collecte peut échouer deux fois de suite pour
 * une raison qui passera. Au-delà, le doute n'est plus raisonnable, et c'est à
 * l'écran de le dire plutôt qu'à l'opérateur de le déduire d'une ligne de journal
 * qu'il relit chaque matin.
 */
export const REPETITIONS_AVANT_BLOCAGE = 3;

export function chuteInstallee(repetitions: number): boolean {
  return repetitions >= REPETITIONS_AVANT_BLOCAGE;
}

/**
 * Depuis combien de passages le relevé complet du périmètre n'a pas été renouvelé,
 * celui qui s'achève compris.
 *
 * Ce qui se compte ici est un effet et non une cause, et c'est tout l'objet de cette
 * fonction. Un passage cesse d'être complet pour cinq raisons qui n'ont rien à voir
 * entre elles : un élément de liste illisible, une écriture qui lève, une lecture des
 * listes qui n'aboutit pas, le plancher de chute qui refuse, et le plancher qui refuse
 * à nouveau parce que son propre refus a figé sa référence. Compter les répétitions
 * d'un refus nommé, comme on le fait sur les systèmes cibles, n'en verrait qu'une.
 * L'effet, lui, est le même pour les cinq : les règles adossées au dernier passage
 * complet continuent de décider contre un relevé qui n'est plus celui du jour, et
 * aucune ne peut le dire, chacune se taisant précisément parce que le relevé est vieux.
 *
 * En passages et jamais en heures, pour la raison qui vaut déjà plus haut : la période
 * du traitement vit dans l'orchestrateur, aucun code d'ici ne la lit, et deux relances
 * à la main placent deux passages à quelques minutes l'un de l'autre. La fraîcheur
 * d'une collecte se mesure en heures parce qu'elle parle du silence ; l'âge d'un relevé
 * se mesure en passages parce qu'il parle de ce qu'on s'est refusé à conclure.
 *
 * Les statuts arrivent du plus récent au plus ancien, et tout ce qui n'est pas `OK`
 * compte pour un passage de plus : c'est le statut qui borne la référence, pas la
 * gravité, et un `FAILED` ne la renouvelle pas mieux qu'un `PARTIAL`. La liste doit
 * porter le passage complet qui sert de référence, sans quoi le compte rendu est celui
 * de la fenêtre relue et non celui du relevé.
 */
export function ageDuReleve(statuts: readonly SyncStatus[]): number {
  const complet = statuts.indexOf("OK");
  return complet === -1 ? statuts.length : complet;
}

/**
 * Un relevé qu'assez de passages n'ont pas renouvelé pour qu'on cesse d'y voir un
 * incident. Le seuil est celui de la chute installée, et pour la même raison : en deçà
 * on ne sait pas encore, une nuit se rate pour un motif qui passera ; au-delà le doute
 * n'est plus raisonnable, et c'est à l'écran de le dire.
 */
export function releveFige(passages: number): boolean {
  return passages >= REPETITIONS_AVANT_BLOCAGE;
}

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il n'a pas renouvelé le
 * relevé contre lequel tout se décide.
 *
 * Elle ne dit pas un refus mais un état, et c'est pourquoi elle n'a pas la forme des
 * autres : les refus nomment quelqu'un, celle-ci ne nomme personne parce qu'un relevé
 * qui n'avance plus vaut pour tout le monde à la fois.
 */
export const RELEVE_NON_RENOUVELE = "relevé non renouvelé";

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il n'a pas pu compter ce
 * qu'une datation toucherait.
 *
 * Ce compte-là ne sert qu'à qui tranche, et un passage qui le rate refuse de toute
 * façon : la panne ne change donc rien à ce qu'il conclut, et rien n'en porterait
 * trace. Or elle décide de tout ce qu'une opératrice peut faire ensuite, chaque
 * décision posée sans ce nombre étant écartée par le passage suivant. Sans cette ligne,
 * trois nuits de refus se lisent comme trois nuits ordinaires, et ce qui coince
 * n'apparaît nulle part.
 */
export const AMPLEUR_NON_COMPTEE = "ampleur non comptée";

/**
 * L'âge du relevé tel qu'un passage l'a porté dans sa trace, quand il l'a porté.
 *
 * Le compte est relu et non recalculé par l'écran : le passage seul connaît son propre
 * statut au moment où il conclut, alors qu'un écran qui compterait les runs devrait
 * deviner celui du passage en cours. Nul quand la trace ne le porte pas, ce qui couvre
 * les passages complets, les traces d'avant ce mécanisme et un run encore ouvert.
 */
export function ageDuReleveDeLaTrace(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("ageDuReleve" in error)) {
    return null;
  }

  const brut = (error as { ageDuReleve: unknown }).ageDuReleve;
  return typeof brut === "number" ? brut : null;
}

/**
 * Le refus qu'une trace de run porte pour une famille donnée, s'il y en a un.
 *
 * La trace est du JSON libre côté base : la lire ici plutôt que chez chaque appelant
 * évite que l'écran et la collecte ne s'accordent plus sur ce qu'ils y cherchent.
 *
 * Recomposé champ par champ plutôt que rendu tel quel : ce qu'on n'a pas reconnu ne
 * doit pas voyager jusqu'au bandeau sous le nom d'une mesure, l'ampleur annoncée à qui
 * tranche étant exactement ce que sa décision emporte.
 */
export function refusDeLaTrace(error: unknown, famille: FamilleDeChute): RefusDeDatation | null {
  if (!error || typeof error !== "object" || !("refus" in error)) {
    return null;
  }

  const brut = (error as { refus: unknown }).refus;
  if (!Array.isArray(brut)) {
    return null;
  }

  for (const entree of brut) {
    if (
      entree &&
      typeof entree === "object" &&
      (entree as RefusDeDatation).famille === famille &&
      typeof (entree as RefusDeDatation).observe === "number" &&
      typeof (entree as RefusDeDatation).reference === "number"
    ) {
      const lu = entree as RefusDeDatation;
      return {
        famille,
        observe: lu.observe,
        reference: lu.reference,
        datables: typeof lu.datables === "number" ? lu.datables : undefined,
      };
    }
  }

  return null;
}

/** Ce par quoi commence la phrase qu'un passage laisse quand il refuse une vague. */
export const REFUS_DE_VAGUE = "vague d'arrivées";

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il refuse de faire
 * disparaître une fiche qu'il sait ne pas avoir lue.
 *
 * Comme le refus de vague, elle rejoint les messages du run sans basculer son statut :
 * le périmètre a bien été collecté, c'est d'une fiche nommée que rien n'a été conclu,
 * et dégrader le run pour autant le rendrait aveugle à tous les vrais départs de la
 * nuit. Sans cette ligne, une disparition non datée ressemblerait trait pour trait à
 * une fiche qui n'a pas bougé.
 */
export const REFUS_DE_DISPARITION = "fiches non lues";

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il revoit une fiche
 * disparue sans dater son retour.
 *
 * Ce refus-là efface ce qu'il refuse : le passage qui s'abstient d'écrire le retour
 * a effacé la disparition dans la même écriture, si bien que plus rien en base ne
 * distingue une absence réelle de trois semaines d'une fiche qui n'a jamais bougé.
 * La date de la disparition va donc dans la phrase, seule à séparer le battement
 * d'une nuit, qui est le comportement voulu et se lit à un jour d'écart, de
 * l'absence longue qu'aucun passage complet n'a traversée, qui en est le prix.
 */
export const REFUS_DE_RETOUR = "retours non datés";

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il n'écrit pas l'échéance
 * de quelqu'un, faute d'avoir obtenu la fiche qui la porte.
 *
 * Le plus discret des trois refus. Les deux autres portent sur une existence et
 * laissent en base de quoi les relire : une fiche retenue n'a pas vu sa dernière vue
 * bouger, un retour non daté a laissé la date de sa disparition dans la phrase. Une
 * échéance non écrite, elle, ne se distingue par rien d'une échéance fraîche, la
 * personne ayant bel et bien été rendue par la source et la plupart des échéances ne
 * bougeant pas d'une nuit à l'autre. Sans cette ligne, la nuit où les accès cessent
 * d'expirer ressemble à une nuit ordinaire.
 *
 * La phrase dit ce que le passage n'a pas fait et non ce qu'il a gardé, parce que les
 * deux ne coïncident pas : une fiche vue pour la première fois pendant la panne est
 * dans la même liste sans avoir la moindre échéance à conserver. Annoncer d'elle une
 * conservation ferait mentir la trace, et l'en retirer la rendrait invisible alors
 * qu'elle est le cas qui ne se rattrape pas.
 */
export const REFUS_D_ECHEANCE = "échéances non écrites";

/**
 * Ce par quoi commence la phrase qu'un passage laisse quand il retient une fiche dont
 * la lecture n'a pas répondu.
 *
 * Le pendant du refus de disparition, sur l'autre façon de ne pas lire une fiche, et
 * il n'a pas la même borne. Un 404 est une information : la source nomme la fiche
 * qu'elle ne connaît pas, et c'est ce qui permet au sursis de durer un passage sans
 * devenir une exemption, une fiche réellement supprimée en amont recevant son départ
 * avec un passage de retard. Une lecture qui jette n'informe de rien : elle ne dit pas
 * que la personne est absente, elle dit que la question n'a pas eu de réponse, et un
 * silence qui dure ne se mue donc pas en départ. La retenue court tant que la lecture
 * échoue, et elle n'exempte personne parce qu'une suppression en amont ne passe pas
 * par ce chemin : elle répond 404, elle nomme la fiche qu'elle a supprimée.
 */
export const REFUS_DE_LECTURE = "fiches sans réponse";

/**
 * Les fiches qu'un passage a retenues faute de réponse, telles que sa trace les porte.
 *
 * Cette retenue est la seule qui ne laisse rien de distinctif en base : une fiche
 * retenue sur un 404 et une fiche retenue faute de réponse ont toutes deux une
 * dernière vue restée derrière le dernier passage complet, et l'écran qui les
 * confondrait promettrait à la seconde une sortie qu'aucun passage suivant ne
 * constatera. La liste est donc écrite en clair dans la trace, à côté des phrases qui
 * la disent, et se relit ici plutôt que chez chaque appelant, comme les refus de
 * datation : une phrase dont les noms sont joints par des virgules ne se relit pas
 * sans prendre le morceau d'un identifiant pour un autre.
 */
export function fichesSansReponse(error: unknown): readonly string[] {
  if (!error || typeof error !== "object" || !("sansReponse" in error)) {
    return [];
  }

  const brut = (error as { sansReponse: unknown }).sansReponse;
  if (!Array.isArray(brut)) {
    return [];
  }
  return brut.filter((nom): nom is string => typeof nom === "string");
}

/**
 * Le refus d'arrivées qu'une trace de run porte, s'il y en a un.
 *
 * Ce refus ne bascule pas le statut du run, contrairement à celui des disparitions :
 * un passage qui s'est tu sur les arrivées ressemble donc trait pour trait à un
 * passage qui n'en a trouvé aucune, et un écran qui compte les arrivées à acter
 * afficherait zéro dans les deux cas. La trace est du JSON libre côté base : elle se
 * lit ici, comme les refus de datation, pour que l'écran et la collecte ne cessent
 * pas de s'accorder sur ce qu'ils y cherchent.
 */
export function refusDArrivees(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("messages" in error)) {
    return false;
  }

  const brut = (error as { messages: unknown }).messages;
  return (
    Array.isArray(brut) &&
    brut.some((message) => typeof message === "string" && message.startsWith(REFUS_DE_VAGUE))
  );
}

export interface TraceDeRun {
  provider: string;
  error: unknown;
}

export interface BlocageInstalle extends RefusDeDatation {
  provider: string;
  /**
   * Depuis combien de passages ce blocage tient, compté comme sa famille le compte :
   * les refus identiques pour un système cible, l'âge du relevé pour le plancher du
   * périmètre. Le nombre ne se lit donc que dans la phrase de sa famille, seule à dire
   * lequel des deux comptes il est.
   */
  passages: number;
}

/** Ce qu'un passage a laissé d'une famille de chute, tel que l'écran le relit. */
interface EtatDuBlocage {
  /** Le refus du dernier passage, c'est-à-dire celui que l'écran montre. */
  refus: RefusDeDatation;
  /** Ce que les passages d'avant ont refusé, du plus récent au plus ancien. */
  precedents: readonly (RefusDeDatation | null)[];
  /** La trace de ce dernier passage, où il porte l'âge du relevé s'il en a un. */
  trace: unknown;
}

function parRefusIdentiques({ refus, precedents }: EtatDuBlocage): number | null {
  const repetitions = refusRepete(refus, precedents);
  return chuteInstallee(repetitions) ? repetitions : null;
}

/**
 * Depuis combien de passages le blocage d'une famille tient, ou rien s'il ne tient pas
 * depuis assez de passages pour qu'on cesse d'y voir un incident.
 *
 * Une table plutôt qu'une condition, pour la raison qui vaut déjà chez la phrase des
 * chutes : une famille de plus qui ne dirait pas comment son blocage s'installe ne
 * compilerait pas, là où une condition l'enverrait sans bruit chez celle d'à côté.
 *
 * Les deux mesures ne comptent pas la même chose et ne s'échangent pas, parce que les
 * deux références ne se figent pas de la même façon. Un système cible compare ce qu'une
 * lecture vient de rendre à un décompte de lignes tenues pour vivantes en base : ce
 * décompte se corrige dès qu'une datation passe, si bien qu'un refus qui retombe avec
 * les mêmes nombres est exactement ce qui dit que rien n'avance, et que des nombres qui
 * bougent disent qu'il se passe encore quelque chose. Le plancher du périmètre, lui,
 * compare à l'effectif du dernier passage complet, que son propre refus empêche
 * d'avancer : ce qui dit que rien n'avance est l'âge de ce relevé, et rien d'autre.
 * Compter ses refus identiques ne verrait qu'une des cinq portes par lesquelles un
 * passage cesse d'être complet, si bien qu'une nuit dégradée pour un autre motif
 * casserait la série et refermerait la sortie précisément là où le gel dure le plus.
 *
 * L'âge ne suffit pourtant pas à lui seul, et le refus du soir reste exigé par la boucle
 * qui appelle ceci : c'est lui, et lui seul, qui dit que le plancher est bien l'obstacle.
 */
const INSTALLATION: Record<FamilleDeChute, (etat: EtatDuBlocage) => number | null> = {
  identites: parRefusIdentiques,
  ressources: parRefusIdentiques,
  perimetre: ({ trace }) => {
    const passages = ageDuReleveDeLaTrace(trace);
    return passages !== null && releveFige(passages) ? passages : null;
  },
};

/**
 * Les garde-fous dont le blocage tient depuis assez de passages pour qu'on cesse de
 * parler d'incident.
 *
 * L'écran en a besoin parce que le journal seul ne suffit pas : la ligne qui annonce
 * un blocage définitif ressemble mot pour mot à celle qui annonce un incident
 * passager, et c'est ainsi qu'un opérateur finit par ne plus la lire.
 *
 * Rien n'est annoncé d'une famille dont la trace du dernier passage ne porte aucun
 * refus, et ce n'est pas une économie de lecture : une sortie offerte la nuit où ce
 * garde-fou n'est pas l'obstacle ferait cliquer un opérateur pour rien, sa décision
 * attendant ensuite un refus que le passage suivant ne prononcera peut-être jamais.
 *
 * Les runs arrivent du plus récent au plus ancien, toutes capacités de lecture
 * confondues par fournisseur.
 */
export function blocagesInstalles(runs: readonly TraceDeRun[]): BlocageInstalle[] {
  const parProvider = new Map<string, TraceDeRun[]>();
  for (const run of runs) {
    const liste = parProvider.get(run.provider) ?? [];
    liste.push(run);
    parProvider.set(run.provider, liste);
  }

  const blocages: BlocageInstalle[] = [];

  for (const [provider, liste] of parProvider) {
    for (const famille of FAMILLES) {
      // Le refus et l'âge se relisent dans la même trace, et c'est ce que ce couple
      // tient : un âge pris ailleurs annoncerait un gel dont le refus montré à côté
      // ne répondrait pas.
      const lectures = liste.map((run) => ({
        refus: refusDeLaTrace(run.error, famille),
        trace: run.error,
      }));
      const dernier = lectures[0];
      if (!dernier?.refus) {
        continue;
      }

      const passages = INSTALLATION[famille]({
        refus: dernier.refus,
        precedents: lectures.slice(1).map((lecture) => lecture.refus),
        trace: dernier.trace,
      });

      if (passages !== null) {
        blocages.push({ ...dernier.refus, provider, passages });
      }
    }
  }

  return blocages.sort(
    (a, b) => a.provider.localeCompare(b.provider, "fr") || a.famille.localeCompare(b.famille),
  );
}

import type { BlocageInstalle, FamilleDeChute } from "@/core/collecte";

export interface Redaction {
  /** Ce dont plus aucune disparition n'est datée, dans le titre du bandeau. */
  quoi: string;
  /**
   * Les nombres du refus, depuis combien de passages il tient, et pourquoi il ne se
   * dénouera pas de lui-même. Le compte n'est pas le même d'une famille à l'autre, et
   * c'est ici que cela se dit : un système cible refuse à l'identique, le plancher du
   * périmètre laisse vieillir le relevé qui lui sert de référence. Une phrase qui
   * annoncerait l'un en donnant le nombre de l'autre serait juste sur le chiffre et
   * fausse sur ce qu'il compte.
   */
  constat: (blocage: BlocageInstalle) => string;
  /** Ce que cela coûte tant que cela dure. */
  consequence: string;
  /** Ce que la prochaine collecte fera de l'autorisation. */
  suite: string;
}

/**
 * Ce qu'une décision vaut sur le périmètre, dit à qui la prend : elle y est lue contre
 * les nombres du passage suivant, et écartée s'ils ne sont plus ceux qu'on annonce ici.
 *
 * Elle ne se dit que là parce qu'elle n'est vraie que là. Sur un système cible une
 * décision lève quelle que soit l'ampleur de la chute du soir, et rien ne l'écarte quand
 * aucune chute ne vient la lever : la promettre y ferait reprendre à l'opératrice une
 * décision qui l'attend toujours, et l'écran refuserait la seconde.
 *
 * Les deux motifs d'écart se disent séparément parce qu'ils ne laissent pas le même
 * monde derrière eux, et c'est le second qui a besoin d'être dit. Une chute plus
 * profonde écarte la décision sans que rien ne soit daté, et le travail reste entier.
 * Plus de chute du tout veut dire que ce garde-fou n'est plus l'obstacle : ce passage-là
 * date les disparitions du soir comme une nuit ordinaire, sans décision et sans que le
 * nombre annoncé ici le borne, celui-ci ne bornant que ce qu'une décision autorise. Les
 * confondre laisserait lire ce nombre comme un plafond sur la nuit, alors qu'il n'en est
 * un que sur le geste qu'elle emporte, et ferait attendre à qui a tranché un travail à
 * reprendre là où il a déjà eu lieu, plus large.
 */
const PORTEE =
  " Elle ne vaut que pour la chute annoncée ici, dont elle emporte les nombres. Si le passage suivant en trouve une plus profonde, elle est écartée sans que rien ne soit daté, et il faut la reprendre sur les nombres du jour. S'il n'en trouve plus du tout, ce garde-fou cesse d'être l'obstacle : ce passage date les disparitions du soir de lui-même, sans décision et sans que le nombre annoncé ici le borne, et la vôtre est écartée faute d'objet.";

/**
 * Les deux garde-fous d'un système cible comparent ce qu'une lecture vient de rendre à
 * un décompte de lignes tenues pour vivantes en base.
 */
const SYSTEME_CIBLE = {
  constat: (blocage: BlocageInstalle) =>
    `La dernière lecture en a rendu ${blocage.observe} là où ${blocage.reference} sont tenues pour vivantes, une chute que le garde-fou juge trop forte pour conclure. Il refuse à l'identique depuis ${blocage.passages} passages : ce n'est plus un incident, et il ne se dénouera pas seul, puisque ce qu'il refuse de dater est justement ce qui provoque la chute.`,
  consequence:
    "Tant que cela dure, une disparition réelle sur ce système ne sera pas constatée, et les accès qu'elle emporte resteront tenus pour vivants.",
  suite:
    "Recopié au journal avec votre nom. La prochaine collecte datera les disparitions de ce système, une fois, puis le garde-fou reprendra.",
} satisfies Omit<Redaction, "quoi">;

/**
 * Ce qu'une datation ferait ce soir à des personnes, dit en toutes lettres.
 *
 * L'écart entre les deux nombres du refus ne le donne pas, et c'est le défaut que cette
 * phrase ferme : ils comparent deux tailles de listes, celui-ci compte des fiches
 * encore tenues pour présentes, et une nuit dégradée en fait naître sans toucher au
 * relevé. Qui lisait « neuf contre treize » en déduisait quatre départs là où le geste
 * en datait onze. L'inférence était trop étroite, pas la phrase : le nombre manquait.
 *
 * Sans lui, l'écran ne promet rien qu'il ne tienne : la décision serait écartée faute
 * d'ampleur à mesurer, et le dire vaut mieux que laisser une opératrice l'apprendre
 * d'une nuit qui n'a rien daté.
 */
function ampleur(blocage: BlocageInstalle): string {
  if (blocage.datables === undefined) {
    return "Combien de personnes seraient constatées parties n'a pas pu être compté cette nuit-là : une décision posée maintenant sera écartée faute d'ampleur à mesurer, et c'est le passage suivant qui donnera ce nombre.";
  }

  return `Une datation constaterait aujourd'hui le départ de ${blocage.datables} ${blocage.datables > 1 ? "personnes" : "personne"}, et c'est cette ampleur-là que votre décision emporte. Elle ne se lit pas dans l'écart entre les deux nombres ci-dessus : ceux-là comparent deux tailles de listes, celle-ci compte les fiches encore tenues pour présentes qu'aucune source ne réclame plus, et une nuit dégradée en fait naître sans que le relevé bouge.`;
}

/**
 * Le plancher du périmètre, lui, ne compare pas à un décompte de lignes vivantes mais à
 * l'effectif d'un relevé, et ni sa boucle ni ce qu'il coûte ne se disent donc dans les
 * mêmes termes : la phrase des systèmes cibles serait fausse deux fois ici, sur ce
 * qu'est la référence et sur ce qui entretient le refus.
 */
export const REDACTION: Record<FamilleDeChute, Redaction> = {
  identites: { quoi: "des comptes", ...SYSTEME_CIBLE },
  ressources: { quoi: "des ressources", ...SYSTEME_CIBLE },
  perimetre: {
    quoi: "des personnes du périmètre",
    constat: (blocage) =>
      `Le dernier relevé complet du périmètre comptait ${blocage.reference} personnes, le dernier passage n'en a résolu que ${blocage.observe}, une chute que le garde-fou juge trop forte pour conclure. ${ampleur(blocage)} Ce relevé n'a pas été renouvelé depuis ${blocage.passages} passages, et il ne le sera pas seul : le refus dégrade le passage qui le prononce, un passage dégradé ne devient pas le relevé complet suivant, et c'est ce relevé-là qui sert de référence à la chute. Ce qui a dégradé les autres passages n'y change rien : aucun ne s'est dit complet, donc la référence n'a pas bougé d'un passage.`,
    consequence:
      "Tant que cela dure, un départ réel n'est pas constaté et les accès qu'il emporte restent tenus pour vivants. Et comme le relevé ne se renouvelle pas, tout ce qui s'y adosse continue de décider contre un relevé qui n'est plus celui du jour : la durée d'une absence, le sursis d'une fiche que la source n'a pas rendue, les sorties de startups, le verdict des arrivées.",
    suite: `Recopié au journal avec votre nom. La prochaine collecte datera les disparitions, une fois, et le relevé qu'elle laissera derrière elle servira de référence aux passages suivants.${PORTEE}`,
  },
};

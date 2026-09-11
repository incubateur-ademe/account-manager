import type { BlocageInstalle, CoteDeChute, FamilleDeChute } from "@/core/collecte";

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
 * Du côté du relevé, l'écart entre les deux nombres du refus ne le donne pas, et c'est
 * le défaut que cette phrase ferme : ils comparent deux tailles de listes, celui-ci
 * compte des fiches encore tenues pour présentes, et une nuit dégradée en fait naître
 * sans toucher au relevé. Qui lisait « neuf contre treize » en déduisait quatre départs
 * là où le geste en datait onze. L'inférence était trop étroite, pas la phrase : le
 * nombre manquait.
 *
 * Du côté de la population, l'écart est cette ampleur, et le dire autrement enverrait
 * chercher une différence entre deux nombres qui n'en ont aucune : ce déclencheur ne
 * mesure rien d'autre que le geste.
 *
 * Sans ce nombre, l'écran ne promet rien qu'il ne tienne : la décision serait écartée
 * faute d'ampleur à mesurer, et le dire vaut mieux que laisser une opératrice
 * l'apprendre d'une nuit qui n'a rien daté.
 */
function ampleur(blocage: BlocageInstalle): string {
  if (blocage.datables === undefined) {
    return "Combien de personnes seraient constatées parties n'a pas pu être compté cette nuit-là : une décision posée maintenant sera écartée faute d'ampleur à mesurer, et c'est le passage suivant qui donnera ce nombre.";
  }

  const personnes = `${blocage.datables} ${blocage.datables > 1 ? "personnes" : "personne"}`;

  if (blocage.cote === "population") {
    return `Une datation constaterait aujourd'hui le départ de ${personnes}, et c'est cette ampleur-là que votre décision emporte : c'est elle que ce déclencheur mesure, et l'écart entre les deux nombres ci-dessus ne dit rien d'autre.`;
  }

  return `Une datation constaterait aujourd'hui le départ de ${personnes}, et c'est cette ampleur-là que votre décision emporte. Elle ne se lit pas dans l'écart entre les deux nombres ci-dessus : ceux-là comparent deux tailles de listes, celle-ci compte les fiches encore tenues pour présentes qu'aucune source ne réclame plus, et une nuit dégradée en fait naître sans que le relevé bouge.`;
}

/**
 * Pourquoi le relevé ne se renouvellera pas de lui-même, dit une fois pour les deux
 * côtés : c'est le même gel, quel que soit le déclencheur qui l'a prononcé, parce que
 * c'est le refus lui-même qui dégrade le passage. C'est aussi ce que compte le nombre
 * de passages annoncé, des deux côtés.
 *
 * La boucle, elle, se dit à chaque appel : les deux références ne se figent pas de la
 * même façon, et une phrase qui prêterait à l'une la raison de l'autre serait juste sur
 * le gel et fausse sur ce qui l'entretient.
 *
 * Rien ici ne suppose qu'un relevé existe, et c'est le second déclencheur qui l'exige :
 * il refuse sans en lire aucun, donc avant le premier passage complet aussi, et une
 * phrase qui désignerait « ce relevé » ne désignerait alors rien du tout à l'écran même
 * où l'on tranche.
 */
const GEL_DU_RELEVE = (passages: number, boucle: string) =>
  `Aucun passage ne s'est dit complet depuis ${passages} passages, et aucun ne le deviendra de lui-même : le refus dégrade le passage qui le prononce, et un passage dégradé ne devient pas le relevé complet suivant. Ce qui a dégradé les autres passages n'y change rien, aucun d'eux ne s'est dit complet non plus. ${boucle}`;

/**
 * Les deux déclencheurs du plancher du périmètre, chacun dans les termes de son monde.
 *
 * Le constat du côté du relevé serait faux mot pour mot sur un refus venu de l'autre :
 * il annoncerait un dernier passage complet dont ni les nombres ni la comparaison n'ont
 * de rapport avec ce qui vient d'être refusé, et une opératrice tranchant là-dessus
 * chercherait un effondrement de la liste qui n'a pas eu lieu.
 *
 * Une table plutôt qu'une condition, pour la raison qui vaut déjà chez les familles : un
 * côté de plus qui ne dirait pas sa phrase ne compilerait pas.
 */
const COTE: Record<CoteDeChute, (blocage: BlocageInstalle) => string> = {
  releve: (blocage) =>
    `Le dernier relevé complet du périmètre comptait ${blocage.reference} personnes, le dernier passage n'en a résolu que ${blocage.observe}, une chute que le garde-fou juge trop forte pour conclure. ${ampleur(blocage)} ${GEL_DU_RELEVE(blocage.passages, "Or c'est le dernier relevé complet qui sert de référence à ce refus : le garde-fou compare donc chaque nuit au relevé d'avant la chute, et y retrouve la même chute.")}`,
  population: (blocage) =>
    `Ce n'est pas la liste rendue ce soir qui a fait parler le garde-fou, c'est la base : ${blocage.reference} personnes y sont tenues pour présentes, comptes de service exclus, et il n'en resterait que ${blocage.observe} après la datation de ce soir, une chute que le garde-fou juge trop forte pour conclure. ${ampleur(blocage)} Ce déclencheur-là ne compare pas deux passages, il compare ce qui est en base à ce qu'il en resterait, et c'est ce qui lui fait voir ce que l'autre ne voit pas : la résolution amont tourne avant qu'un passage ne sache s'il est complet, si bien qu'une nuit dégradée fait naître des fiches que plus aucune liste ne réclame, et le fossé se creuse là sans que la comparaison des relevés en dise rien. ${GEL_DU_RELEVE(blocage.passages, "La référence de ce refus-ci, elle, se corrigerait d'elle-même dès qu'un passage daterait, et c'est justement la datation que le refus retient.")}`,
};

/**
 * Le plancher du périmètre, lui, ne compare pas à un décompte de lignes vivantes mais à
 * l'effectif d'un relevé, et ni sa boucle ni ce qu'il coûte ne se disent donc dans les
 * mêmes termes : la phrase des systèmes cibles serait fausse deux fois ici, sur ce
 * qu'est la référence et sur ce qui entretient le refus. Il a deux déclencheurs, et son
 * constat dit lequel a parlé ; les traces d'avant le second n'en portent aucun, et elles
 * disent toutes le relevé.
 */
export const REDACTION: Record<FamilleDeChute, Redaction> = {
  identites: { quoi: "des comptes", ...SYSTEME_CIBLE },
  ressources: { quoi: "des ressources", ...SYSTEME_CIBLE },
  perimetre: {
    quoi: "des personnes du périmètre",
    constat: (blocage) => COTE[blocage.cote ?? "releve"](blocage),
    consequence:
      "Tant que cela dure, un départ réel n'est pas constaté et les accès qu'il emporte restent tenus pour vivants. Et comme aucun passage ne se dit complet, tout ce qui s'adosse au relevé continue de décider contre un état qui n'est pas celui du jour : la durée d'une absence, le sursis d'une fiche que la source n'a pas rendue, les sorties de startups, le verdict des arrivées.",
    suite: `Recopié au journal avec votre nom. La prochaine collecte datera les disparitions, une fois, et le relevé qu'elle laissera derrière elle servira de référence aux passages suivants.${PORTEE}`,
  },
};

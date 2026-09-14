import { describe, expect, it } from "vitest";

import { type Acteur, combinaisonValide } from "@/core/dossier";
import { LIBELLE_ACTEUR } from "@/core/libelle-dossier";

import { MODELE } from "./redaction";

const ROLES: readonly Acteur[] = ["OPERATOR", "SUBJECT", "DELEGATE"];

/**
 * Les mots que le modèle porte et que l'écran ne dit pas. Une aide qui les sert tels
 * quels explique la conception à qui voulait seulement savoir quoi saisir.
 */
const MOTS_DU_MODELE =
  /assemblage|précheck|empreinte|octroi|pointage|pointer|soldée?|solder|ghid|heuristique|surcharge|socle|\bvoies?\b|référentiel(?! des)/iu;

describe("ce que les écrans des modèles promettent", () => {
  it("dit ce qu'une modification fait aux plans qui existent déjà, et ce qu'elle ne leur fait pas", () => {
    // Given la phrase que les trois écrans servent, et qui s'en disait deux en termes
    // différents. Elle couvre les trois sorts qu'un plan peut connaître, et c'est le
    // seul endroit où un opérateur les apprend avant de toucher un modèle.
    const dit = MODELE.effetSurLesPlans;

    // Then elle affirme d'abord qu'aucun plan calculé ne bouge : les étapes d'un plan
    // sont recopiées à sa création, et la promesse inverse ferait croire qu'ajouter une
    // étape ce matin la fera apparaître dans un départ ouvert hier.
    expect(dit).toMatch(/ne change aucun plan déjà calculé/u);
    expect(dit).toMatch(/figées/u);

    // Then elle sépare le brouillon du plan confirmé, parce que le code les sépare : le
    // premier se recalcule, le second garde ses étapes et signale l'écart. Les
    // confondre ferait attendre d'un plan confirmé qu'il se répare tout seul.
    expect(dit).toMatch(/brouillon/u);
    expect(dit).toMatch(/recalcul/u);
    expect(dit).toMatch(/confirmé/u);
    expect(dit).toMatch(/gardera les siennes/u);

    // Then elle ne nomme ni le calcul du plan ni l'empreinte qui le garde : ce sont les
    // rouages, et personne n'a besoin de les connaître pour éditer un modèle.
    expect(dit).not.toMatch(MOTS_DU_MODELE);
  });

  it("ne laisse pas une étape neutralisée disparaître en silence, et le dit pareil des deux côtés", () => {
    // Given le même compte, annoncé depuis le modèle de l'incubateur qui referme et
    // depuis celui de la startup qui le subit. Les deux écrans disaient la phrase
    // séparément, à un mot près.
    const cote1 = MODELE.neutralisees(3, "par des startups");
    const cote2 = MODELE.neutralisees(3, "ici");

    // Then chacune donne le nombre, sans quoi des étapes déclarées cesseraient d'être
    // demandées sans que personne ne l'apprenne.
    for (const dit of [cote1, cote2]) {
      expect(dit).toContain("3 étapes");
      // Then chacune dit que rien n'est effacé, et que rouvrir les rend telles quelles :
      // refermer ne supprime rien, et promettre moins ferait sauvegarder ailleurs un
      // travail que la base garde déjà.
      expect(dit).toMatch(/restent en base/u);
      expect(dit).toMatch(/n'entrent dans aucun plan/u);
      expect(dit).toMatch(/à l'identique/u);
      expect(dit).not.toMatch(MOTS_DU_MODELE);
    }

    // Then les deux ne diffèrent que par l'endroit qu'elles désignent : c'est la même
    // promesse, et deux exemplaires finiraient par ne la tenir qu'à moitié.
    expect(cote1.replace("par des startups", "ici")).toBe(cote2);

    // Then une seule étape s'accorde au singulier : un compte n'est pas une phrase, et
    // « 1 étapes sont neutralisées » se lit comme un défaut d'affichage, ce qui ferait
    // douter du nombre au moment où il compte le plus.
    const seule = MODELE.neutralisees(1, "ici");
    expect(seule).toContain("1 étape déclarée ici est neutralisée");
    expect(seule).toMatch(/elle reste en base/u);
    expect(seule).toMatch(/la rend à l'identique/u);
  });

  it("dit à qui remplit le formulaire ce que chaque champ décidera, sans nommer un rouage", () => {
    // Given les aides des champs d'une étape déclarée.

    // Then le titre annonce sa conséquence, qui est un dédoublonnage entre modèles, et
    // non le fait qu'il serve de clé : deux startups qui demandent le même geste ne le
    // font faire qu'une fois, et c'est cela qu'on a besoin de savoir en le saisissant.
    expect(MODELE.champs.titre).toMatch(/même titre/u);
    expect(MODELE.champs.titre).toMatch(/qu'une fois/u);
    expect(MODELE.champs.titre).not.toMatch(/clé/u);

    // Then le choix de l'acteur promet qu'aucune étape ne devient impossible à cocher :
    // c'est la garantie du code, un opérateur pouvant toujours cocher en substitution.
    expect(MODELE.champs.acteur).toMatch(/opérateur/u);
    expect(MODELE.champs.acteur).toMatch(/cocher/u);

    // Then le contrôle dit, dans les deux cas, ce qu'il retient : tant qu'il n'a pas eu
    // lieu, l'étape n'est pas terminée et le dossier ne se clôt pas.
    for (const memeRole of [true, false]) {
      const dit = MODELE.champs.controleur(memeRole);
      expect(dit).toMatch(/n'est pas terminée/u);
      expect(dit).toMatch(/ne se clôt pas/u);
      expect(dit).not.toMatch(MOTS_DU_MODELE);
    }

    // Then le même rôle des deux côtés annonce en plus ce qu'il coûtera : deux
    // opérateurs différents, sur n'importe quel dossier. La règle se compare sur le nom
    // et non sur le rôle, si bien qu'un mainteneur seul ne terminera jamais cette
    // étape, et l'apprendre à l'édition vaut mieux que devant un dossier bloqué.
    expect(MODELE.champs.controleur(true)).toMatch(/deux opérateurs différents/u);
    expect(MODELE.champs.controleur(false)).not.toMatch(/deux opérateurs/u);

    // Then l'étape dont la valeur attendue est illisible se dit par sa conséquence sur
    // les plans du jour, et non par le geste que le calcul lui fait subir.
    expect(MODELE.saisieIllisible).toMatch(/ne retiendrait cette étape/u);
    expect(MODELE.saisieIllisible).toMatch(/Réécrivez-la|videz/u);
    expect(MODELE.saisieIllisible).not.toMatch(MOTS_DU_MODELE);

    // Then les deux alertes de modèle orphelin disent la même cause et ne divergent que
    // sur le geste : l'index renvoie vers l'écran qui les porte, la fiche d'un modèle
    // dit quoi en faire.
    expect(MODELE.orphelins.plusieurs).toMatch(/référentiel des startups/u);
    expect(MODELE.orphelins.seul).toMatch(/référentiel des startups/u);
    expect(MODELE.orphelins.seul).toMatch(/Redéclarez/u);

    // Then celle de l'index concède que les plans déjà calculés gardent leurs étapes.
    // Un modèle ne tient aucun plan confirmé : le nier ici contredirait la promesse
    // servie deux paragraphes plus haut sur le même écran, et l'écran d'un dossier
    // confirmé montre ces étapes-là. Le futur de l'autre phrase, lui, est juste : un
    // identifiant que le référentiel ne rend plus n'alimente aucun plan neuf.
    expect(MODELE.orphelins.plusieurs).toMatch(/déjà calculés gardent/u);
    expect(MODELE.effetSurLesPlans).toMatch(/gardera/u);
    for (const dit of [MODELE.orphelins.plusieurs, MODELE.orphelins.seul]) {
      expect(dit).not.toMatch(MOTS_DU_MODELE);
    }
  });

  it("dit qu'aucune valeur n'est attendue, là où la case « sans cette valeur » ne prendrait pas", () => {
    // Given une étape dont le libellé de saisie est vide. L'écriture d'un modèle ne
    // garde alors aucune saisie du tout, `obligatoire` compris : la case n'a rien à
    // régler. Offerte quand même, elle se décochait sous le doigt et revenait cochée au
    // rechargement, le défaut le plus déroutant qui soit puisque l'écran y dément un
    // geste que l'opérateur vient de faire.
    const dit = MODELE.champs.saisieSansValeur;

    // Then elle affirme le fait plutôt que le refus : rien n'est demandé, et cocher
    // suffit. Dire « ce réglage est sans effet » expliquerait le rouage au lieu de dire
    // ce qui va se passer.
    expect(dit).toMatch(/Aucune valeur n'est demandée/u);
    expect(dit).toMatch(/la case suffira/u);
    expect(dit).not.toMatch(/sans effet|ignoré|désactivé/u);

    // Then elle donne le geste qui change la situation, et il est localisé : sans lui,
    // il reste à deviner qu'une valeur s'obtient en remplissant un autre champ.
    expect(dit).toMatch(/Donnez un libellé/u);

    // Then elle ne contredit pas la case qu'elle remplace : celle-ci parle d'une valeur
    // qui manquerait, celle-là d'une valeur qu'on ne demande pas. Les deux ne
    // s'affichent jamais ensemble, et c'est le libellé qui décide laquelle.
    expect(dit).not.toContain("ne peut pas être déclarée faite");
    expect(dit).not.toMatch(MOTS_DU_MODELE);
  });

  it("nomme le contrôle qu'un changement d'acteur retire, pour chaque paire que la règle refuse", () => {
    // Given le formulaire d'étape, qui retire de lui-même un contrôle devenu impossible
    // quand on change l'acteur. Le retrait est voulu : laisser la paire ferait soumettre
    // une répartition que le serveur refuse. Mais retiré sans un mot, il se lit comme une
    // valeur qui bouge toute seule, et l'étape s'enregistre sans le regard qu'on croyait
    // lui avoir posé.
    const refusees = ROLES.flatMap((acteur) =>
      ROLES.filter((controleur) => !combinaisonValide(acteur, controleur)).map((controleur) => ({
        acteur,
        controleur,
      })),
    );

    // Then il y a bien des paires à annoncer : sans elles, cette phrase serait morte et
    // le test la déclarerait bonne en ne l'exerçant jamais.
    expect(refusees.length).toBeGreaterThan(0);

    for (const { acteur, controleur } of refusees) {
      const dit = MODELE.champs.controleurRetire(controleur, acteur);

      // Then elle nomme les deux rôles en jeu : celui qu'on perd, et celui qui le rend
      // impossible. Une phrase qui n'en nommerait qu'un laisserait chercher lequel des
      // deux choix vient d'annuler l'autre.
      expect(dit).toContain(LIBELLE_ACTEUR[controleur]);
      expect(dit).toContain(LIBELLE_ACTEUR[acteur]);

      // Then elle dit le fait accompli plutôt que la règle : le contrôle a été retiré,
      // au passé, parce que c'est déjà fait au moment où elle s'affiche.
      expect(dit).toMatch(/a été retiré/u);

      // Then elle donne les deux sorties, et elles sont exhaustives : en choisir un
      // autre, ou assumer une étape qui se croit sur parole. Sans elles, il reste à
      // deviner si l'étape est encore enregistrable.
      expect(dit).toMatch(/Choisissez-en un autre/u);
      expect(dit).toMatch(/sur parole/u);

      expect(dit).not.toMatch(MOTS_DU_MODELE);
    }

    // Then la phrase ne se compose que pour un contrôle réellement perdu : toute paire
    // que la règle admet reste à l'écran sans un mot, et c'est ce silence-là qui est
    // juste.
    expect(combinaisonValide("SUBJECT", "OPERATOR")).toBe(true);
    expect(combinaisonValide("OPERATOR", "DELEGATE")).toBe(false);
  });
});

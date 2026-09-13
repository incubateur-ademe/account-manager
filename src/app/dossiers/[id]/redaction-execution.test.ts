import { describe, expect, it } from "vitest";

import type { PlannedStep } from "@/core/connector";
import { masseDuPlan, refusDeMasse } from "@/core/plan";

import { compteRendu, LIBELLE_LANCEMENT } from "./redaction-execution";

/**
 * Le bloc de lancement n'est rendu par aucun harnais, et c'est celui qui promet le plus :
 * ce qui part, ce qui ne part pas, ce qui ne bougera pas et ce qui ne sera plus revérifié.
 * Ce qui est épinglé ici est ce qui porte une garantie pour qui s'apprête à cliquer, plus
 * les mots de modèle qui n'ont rien à faire sur un écran.
 */

/** Les phrases seules : un nom de champ n'est pas du texte que quelqu'un lit. */
function phrases(valeur: unknown): string[] {
  if (typeof valeur === "string") {
    return [valeur];
  }
  if (valeur === null || typeof valeur !== "object") {
    return [];
  }
  return Object.values(valeur).flatMap(phrases);
}

/** Les phrases composées entrent à la main : une fonction ne se parcourt pas. */
const TOUTE_LA_COPIE = [
  ...phrases(LIBELLE_LANCEMENT),
  LIBELLE_LANCEMENT.masse.quelques(1, 20),
  LIBELLE_LANCEMENT.masse.quelques(7, 20),
  LIBELLE_LANCEMENT.relecture(41),
  compteRendu({ simulation: true, executees: 0, soldees: 2, echecs: 0 }),
  compteRendu({ simulation: false, executees: 3, soldees: 5, echecs: 1 }),
  refusDeMasse(
    masseDuPlan(
      Array.from({ length: 41 }, () => etapeAuto()),
      20,
    ),
    false,
  ) ?? "",
].join(" ");

/** Une étape que l'outil ferait lui-même, seule chose que le plafond compte. */
function etapeAuto(): PlannedStep {
  return {
    systemKey: "notion",
    capability: "revoke",
    tier: "auto",
    action: "retirer-de-l-espace",
    label: "Retirer camille.exemple de l'espace",
    params: { handle: "camille.exemple" },
    riskLevel: "medium",
    expectedState: { membre: false },
    idempotencyKey: "notion:revoke:camille.exemple",
  };
}

describe("ce que le bloc de lancement dit à qui s'apprête à cliquer", () => {
  it("annonce ce que le clic fera, et ne promet jamais l'inverse de ce que le serveur tient", () => {
    // Given un serveur qui n'autorise aucune action, ce qui est le défaut du dépôt
    // Then le bandeau dit qu'aucune écriture ne partira, que les étapes prêtes ne
    // bougeront pas, et que le journal dira quand même ce qui aurait été appelé : sans
    // cette dernière phrase, un lancement en simulation passe pour un clic sans effet
    expect(LIBELLE_LANCEMENT.simulation.titre).toBe("Rien ne partira");
    expect(LIBELLE_LANCEMENT.simulation.description).toContain(
      "ce bouton n'écrira rien sur les systèmes couverts",
    );
    expect(LIBELLE_LANCEMENT.simulation.description).toContain(
      "Les étapes prêtes resteront à faire et leur état ne bougera pas",
    );
    expect(LIBELLE_LANCEMENT.simulation.description).toContain("ce qui aurait été appelé");

    // Then le bouton dit la même chose que le bandeau qu'il suit : un bouton qui
    // annoncerait une exécution sous un bandeau qui promet le contraire est le seul
    // mot que l'opérateur lit vraiment avant de cliquer
    expect(LIBELLE_LANCEMENT.bouton.simulation).toBe("Lancer la simulation");
    expect(LIBELLE_LANCEMENT.titre.simulation).toBe("Lancer une simulation");
    expect(LIBELLE_LANCEMENT.bouton.simulation).not.toContain("l'exécution");
    expect(LIBELLE_LANCEMENT.titre.simulation).not.toContain("l'exécution");

    // Given un serveur où les actions sont autorisées
    // Then le bandeau annonce une écriture réelle, et dit ce qu'une interruption
    // laisse derrière elle, qui est la seule chose à décider avant de lancer
    expect(LIBELLE_LANCEMENT.reel.titre).toBe("Les actions sont autorisées");
    expect(LIBELLE_LANCEMENT.reel.description).toContain(
      "écrira réellement sur les systèmes couverts",
    );
    expect(LIBELLE_LANCEMENT.reel.description).toContain(
      "ce qu'elle laisse derrière elle est ce qu'on sait le mieux reprendre",
    );
    expect(LIBELLE_LANCEMENT.reel.description).not.toContain("réversibilité");
  });

  it("ne range pas sous la vérification ce qu'un appel vient de faire", () => {
    // Given une simulation : aucun appel n'est parti, et les seules étapes terminées
    // sont celles que la vérification a trouvées déjà en place
    const simulee = compteRendu({ simulation: true, executees: 0, soldees: 2, echecs: 0 });

    // Then le compte rendu peut affirmer qu'aucune écriture n'a eu lieu, et le dit
    expect(simulee).toContain("rien n'a été écrit");
    expect(simulee).toContain(
      "2 étapes terminées par la vérification, sans aucun appel d'écriture",
    );
    expect(simulee).toContain("Les étapes prêtes restent à faire");

    // Given un lancement réel où trois appels sont partis et cinq étapes se sont
    // terminées : le décompte réunit celles que la vérification a soldées et celles
    // que ces appels viennent de faire, et rien ne les sépare
    const reelle = compteRendu({ simulation: false, executees: 3, soldees: 5, echecs: 1 });

    // Then il ne dit pas de ces cinq qu'aucune écriture ne les a faites, ce qui
    // démentait les trois appels annoncés dans la même phrase
    expect(reelle).toContain("3 appels partis vers les systèmes couverts");
    expect(reelle).toContain("5 étapes terminées en tout");
    expect(reelle).not.toContain("sans appel d'écriture");
    expect(reelle).not.toContain("sans aucun appel d'écriture");
    expect(reelle).toContain("celles que la vérification a trouvées déjà en place comprises");
    expect(reelle).toContain("1 étape en échec.");

    // Then les accords suivent les nombres des deux côtés, un compte rendu au pluriel
    // sous un seul appel se lisant comme une faute
    expect(compteRendu({ simulation: false, executees: 1, soldees: 1, echecs: 2 })).toBe(
      "1 appel parti vers les systèmes couverts. 1 étape terminée en tout, celles que la vérification a trouvées déjà en place comprises. 2 étapes en échec.",
    );
  });

  it("dit les bornes avant le clic, et sans un mot de modèle", () => {
    // Given ce qui précède chaque étape, qui part sur les deux serveurs
    // Then il se dit par ce qu'il fait et par ce qu'il refuse, jamais par son nom :
    // ce qui est déjà en place ne coûte aucun appel, et un état inattendu n'est jamais
    // exécuté, parce que redonner un accès déjà ouvert change le rôle en place
    expect(LIBELLE_LANCEMENT.verification).toContain("que le système concerné sait relire");
    expect(LIBELLE_LANCEMENT.verification).toContain("n'est jamais exécutée");
    expect(LIBELLE_LANCEMENT.verification).toContain("changerait le rôle en place");

    // Then elle ne promet la relecture ni de toutes les étapes ni de celles qui se font
    // à la main. Une étape qui vient d'un modèle ne relève d'aucun système : rien ne la
    // relit, et la promesse inverse enverrait quelqu'un vérifier à la place de l'outil
    // une charte que l'outil n'a jamais regardée.
    expect(LIBELLE_LANCEMENT.verification).not.toMatch(/[Cc]haque étape est vérifiée/u);
    expect(LIBELLE_LANCEMENT.verification).toContain("n'est relue par personne");
    expect(LIBELLE_LANCEMENT.verification).toContain("c'est à vous de constater");

    // Then « déjà en place » ne veut pas dire « terminée » quand un contrôleur est
    // nommé : l'étape attend son second regard comme les autres, et l'écran du dossier
    // dit déjà qu'un dossier ne se clôt pas tant qu'il n'a pas eu lieu. Deux écrans du
    // même produit qui se contredisent sur cet état-là, c'est celui-ci qui mentait.
    expect(LIBELLE_LANCEMENT.verification).toContain(
      "est terminée sans le moindre appel, sauf si quelqu'un doit la contrôler",
    );
    expect(LIBELLE_LANCEMENT.verification).toContain("second regard");

    // Given un plan qui pose des termes, que la confrontation du lancement ne regarde pas
    // Then la phrase dit quand les lire plutôt que ce qui les en tient hors
    expect(LIBELLE_LANCEMENT.termes).toBe(
      "Ce plan pose des termes. Ils ne seront pas revérifiés au lancement : lisez-les maintenant.",
    );

    // Given un plan dont aucune étape ne se fait toute seule
    // Then la phrase ne promet aucun geste, et borne ce qui reste au lancement à ce que
    // l'outil sait relire : promettre une utilité sans réserve en promettait une sur un
    // plan dont aucune étape n'est relisible, où le clic ne fait rien du tout.
    expect(LIBELLE_LANCEMENT.masse.aucune).toContain(
      "Aucune étape de ce plan ne peut être faite par l'outil lui-même",
    );
    expect(LIBELLE_LANCEMENT.masse.aucune).toContain("les relectures d'état qu'il sait faire");
    expect(LIBELLE_LANCEMENT.masse.aucune).not.toContain("ce qui reste utile");

    // Then le décompte s'accorde, et nomme le plafond sans nommer la mesure
    expect(LIBELLE_LANCEMENT.masse.quelques(1, 20)).toBe(
      "1 étape de ce plan porte un geste que l'outil fait lui-même, pour un plafond de 20.",
    );
    expect(LIBELLE_LANCEMENT.masse.quelques(7, 20)).toBe(
      "7 étapes de ce plan portent un geste que l'outil fait lui-même, pour un plafond de 20.",
    );

    // Then le refus du plafond nomme ses deux nombres et le geste attendu, sans
    // demander de confirmer une grandeur que l'écran ne nomme nulle part
    const refus = refusDeMasse(masseDuPlan(Array.from({ length: 41 }, etapeAuto), 20), false);
    expect(refus).toContain("41 étapes d'un coup");
    expect(refus).toContain("plafond de 20");
    expect(refus).toContain("confirmez explicitement");
    expect(refus).not.toContain("confirmez la masse");

    // Then aucun mot du modèle ne sort nulle part dans ce bloc : ce sont ceux que
    // l'inventaire a relevés ici, et chacun a sa phrase de remplacement au-dessus
    for (const mot of [
      "précheck",
      "empreinte",
      "boucle",
      "assemblage",
      "socle",
      "octroi",
      "idempotent",
      "connecteur",
    ]) {
      expect(TOUTE_LA_COPIE.toLowerCase()).not.toContain(mot);
    }
    expect(TOUTE_LA_COPIE).not.toMatch(/\bvoies?\b/u);
  });
});

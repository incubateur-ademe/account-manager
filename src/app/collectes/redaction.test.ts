import { describe, expect, it } from "vitest";

import type { BlocageInstalle, FamilleDeChute } from "@/core/collecte";

import { REDACTION } from "./redaction";

/**
 * Une phrase d'écran qui promet plus que le code ne tient est un défaut à part entière,
 * et celle-ci l'a déjà été : la portée d'une décision a été écrite pour le périmètre,
 * puis servie aux systèmes cibles où ni la borne d'ampleur ni la péremption n'existent.
 */
describe("ce que le bandeau promet à qui autorise une datation", () => {
  it("ne promet la portée d'une décision qu'à la famille qui la tient", () => {
    // Given trois familles de chute, dont une seule borne l'ampleur et périme ce qu'elle
    // n'a pas levé.
    const portee = /écartée/u;

    // Then le périmètre dit ce qu'il advient d'une décision que les nombres du jour ne
    // rejoignent plus, parce que lui seul l'écarte et lui seul en rend une autre posable.
    expect(REDACTION.perimetre.suite).toMatch(portee);

    // Then elle énumère les DEUX motifs d'écart, et pas un de plus. La décision emporte
    // les nombres qu'on lui a montrés, si bien que la chute du soir se compare toujours
    // à eux : rien ne la rend immesurable, et une chute identique à celle annoncée lève,
    // quel que soit le nombre de nuits dégradées qui se sont intercalées. Promettre un
    // troisième motif ferait reprendre une décision que rien n'aurait touchée.
    expect(REDACTION.perimetre.suite).toContain("plus profonde");
    expect(REDACTION.perimetre.suite).toContain("n'en trouve plus du tout");
    expect(REDACTION.perimetre.suite).not.toMatch(/passages dégradés/u);

    // Then elle dit ce que chacun des deux laisse derrière lui, et c'est le second qui
    // a besoin d'être dit : une chute plus profonde n'a rien daté et le travail reste
    // entier, alors que plus de chute du tout veut dire que le passage a daté le soir
    // même, de lui-même et sans que le nombre annoncé le borne. Les confondre ferait
    // lire ce nombre comme un plafond sur la nuit, alors qu'il n'en est un que sur le
    // geste qu'une décision emporte, et ferait attendre un travail à reprendre là où il
    // a déjà eu lieu, plus large.
    expect(REDACTION.perimetre.suite).toContain("sans que rien ne soit daté");
    expect(REDACTION.perimetre.suite).toMatch(/date les disparitions du soir de lui-même/u);
    expect(REDACTION.perimetre.suite).toContain("sans décision");

    // Then les systèmes cibles se taisent là-dessus : chez eux une décision lève quelle
    // que soit l'ampleur de la chute du soir, et rien ne l'écarte quand aucune chute ne
    // vient la lever. La leur promettre ferait reprendre une décision qui attend
    // toujours, et l'écran refuserait la seconde.
    expect(REDACTION.identites.suite).not.toMatch(portee);
    expect(REDACTION.ressources.suite).not.toMatch(portee);

    // Then chacune dit quand même ce que le geste coûte et sur quoi il porte.
    for (const famille of ["identites", "ressources", "perimetre"] as const) {
      expect(REDACTION[famille].suite).toContain("Recopié au journal avec votre nom");
      expect(REDACTION[famille].quoi.length).toBeGreaterThan(0);
    }
  });

  it("dit combien de personnes la datation constaterait parties, plutôt que de le laisser déduire", () => {
    // Given un bandeau où l'écart des deux listes se lit à quatre et où onze fiches
    // seraient datées : des nuits dégradées ont fait naître des fiches sans que le
    // relevé bouge, et les deux nombres du refus ne disent rien de ce fossé.
    const blocage: BlocageInstalle = {
      provider: "espace-membre",
      famille: "perimetre",
      observe: 9,
      reference: 13,
      datables: 11,
      passages: 4,
    };

    // Then la phrase donne le nombre du geste, et dit pourquoi il ne se déduit pas de
    // l'écart : c'est l'inférence de qui lit qui était plus étroite que la datation, et
    // c'est un nombre qui manquait, pas une phrase qui mentait.
    const constat = REDACTION.perimetre.constat(blocage);
    expect(constat).toContain("départ de 11 personnes");
    expect(constat).toContain("tailles de listes");

    // Then elle s'accorde en nombre, une personne n'étant pas un décompte.
    expect(REDACTION.perimetre.constat({ ...blocage, datables: 1 })).toContain(
      "départ de 1 personne,",
    );

    // Then sans ce nombre, elle ne promet rien qu'elle ne tienne : une décision posée
    // là-dessus sera écartée faute d'ampleur à mesurer, et l'apprendre ici vaut mieux
    // que de le découvrir d'une nuit qui n'a rien daté.
    const sansMesure = REDACTION.perimetre.constat({ ...blocage, datables: undefined });
    expect(sansMesure).toContain("n'a pas pu être compté");
    expect(sansMesure).toMatch(/écartée/u);
    expect(sansMesure).not.toMatch(/départ de/u);

    // Then les systèmes cibles se taisent là-dessus, et c'est juste : leur référence est
    // déjà un décompte de lignes tenues pour vivantes, donc déjà la conséquence, et il
    // n'y a chez eux aucun second nombre à montrer.
    for (const famille of ["identites", "ressources"] as const) {
      expect(REDACTION[famille].constat({ ...blocage, famille })).not.toMatch(/constaterait/u);
    }
  });

  it("annonce à chaque famille le compte de passages qui est le sien", () => {
    // Given un blocage installé depuis cinq passages. Le nombre est le même pour les
    // trois familles, ce qu'il compte ne l'est pas : un système cible a refusé à
    // l'identique cinq nuits d'affilée, le plancher du périmètre décide contre un relevé
    // que cinq passages n'ont pas renouvelé, quelles qu'aient été leurs cinq raisons.
    const blocage = (famille: FamilleDeChute): BlocageInstalle => ({
      provider: famille === "perimetre" ? "espace-membre" : "github",
      famille,
      observe: 9,
      reference: 13,
      passages: 5,
    });

    // Then le périmètre parle du relevé, et ne parle plus d'un refus répété : c'est
    // l'âge de ce relevé qui dit son installation, et une nuit dégradée pour un tout
    // autre motif le fait vieillir sans qu'aucun refus ne retombe.
    const perimetre = REDACTION.perimetre.constat(blocage("perimetre"));
    expect(perimetre).toContain("Ce relevé n'a pas été renouvelé depuis 5 passages");
    expect(perimetre).not.toMatch(/à l'identique/u);

    // Then les systèmes cibles disent l'inverse, parce que c'est l'inverse : leur
    // référence est un décompte de lignes vivantes que la moindre datation corrige, si
    // bien que ce qui dit que rien n'avance est bien que les mêmes nombres retombent.
    for (const famille of ["identites", "ressources"] as const) {
      const cible = REDACTION[famille].constat(blocage(famille));
      expect(cible).toContain("Il refuse à l'identique depuis 5 passages");
      expect(cible).not.toMatch(/relevé/u);
    }

    // Then aucune des trois ne se tait sur le compte : sans lui, la phrase qui annonce
    // un blocage que rien ne dénouera ressemble mot pour mot à celle d'un incident.
    for (const famille of ["identites", "ressources", "perimetre"] as const) {
      expect(REDACTION[famille].constat(blocage(famille))).toContain("5 passages");
    }
  });
});

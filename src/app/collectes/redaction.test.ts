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

    // Then elle énumère les TROIS motifs d'écart et pas deux. La borne échoue fermé,
    // donc une chute identique à celle annoncée est écartée elle aussi dès que trop de
    // passages dégradés s'intercalent pour qu'on puisse encore la comparer. En promettre
    // deux quand le code en écarte trois ferait disparaître une décision sans que rien
    // ne dise pourquoi, et c'est le seul de ces motifs qu'une opératrice ne peut pas
    // deviner en lisant les nombres du jour.
    expect(REDACTION.perimetre.suite).toContain("plus profonde");
    expect(REDACTION.perimetre.suite).toContain("n'en trouve plus du tout");
    expect(REDACTION.perimetre.suite).toContain("passages dégradés s'intercalent");

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

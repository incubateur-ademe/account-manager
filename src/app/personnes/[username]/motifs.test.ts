import { describe, expect, it } from "vitest";

import { LIBELLE_CONSTAT } from "@/core/libelle-constat";

import type { ConstatOuvert, EtatDeLaFiche, Geste } from "./motifs";
import { motifsDAction } from "./motifs";

const SEUILS = { graceDays: 15, soonDays: 30, staleDays: 365 };

function constat(over: Partial<ConstatOuvert> & { kind: string }): ConstatOuvert {
  return {
    id: `id-${over.kind}`,
    dedupKey: `${over.kind}:camille.rivet`,
    severity: "MEDIUM",
    compte: null,
    ...over,
  };
}

function fiche(over: Partial<EtatDeLaFiche> = {}): EtatDeLaFiche {
  return {
    statut: "ACTIF",
    seuils: SEUILS,
    appartenance: {
      dans: true,
      motif: "STARTUP",
      startups: ["produit-alpha"],
      sansStartupConnue: false,
      toutesStartupsTerminees: false,
      surcharge: null,
      sansSurcharge: "STARTUP",
    },
    libelleSansSurcharge: "Rattachée par une startup",
    ouverts: [],
    fermes: [],
    fraicheur: { perimee: false, heures: 2 },
    toutesStartupsTerminees: false,
    parEquipe: false,
    dossierVivant: null,
    ...over,
  };
}

function nomsDesGestes(gestes: readonly Geste[] | undefined): string[] {
  return (gestes ?? []).map((geste) => geste.nom);
}

describe("les gestes que porte le bloc d'action d'une fiche", () => {
  it("offre le geste que la consigne nomme, là où elle est lue", () => {
    const motifs = motifsDAction(fiche({ ouverts: [constat({ kind: "INACTIVE_STARTUP" })] }));

    expect(motifs).toHaveLength(1);
    expect(motifs[0]?.description).toBe(LIBELLE_CONSTAT.INACTIVE_STARTUP.action);
    expect(nomsDesGestes(motifs[0]?.gestes)).toEqual(["rattacher-startup", "clore"]);
    expect(motifs[0]?.lien).toBeUndefined();

    const cloture = motifs[0]?.gestes?.[1];
    expect(cloture).toEqual({
      nom: "clore",
      dedupKey: "INACTIVE_STARTUP:camille.rivet",
      titre: LIBELLE_CONSTAT.INACTIVE_STARTUP.titre,
      explication: LIBELLE_CONSTAT.INACTIVE_STARTUP.explication,
      consigne: LIBELLE_CONSTAT.INACTIVE_STARTUP.action,
    });

    const avecSortie = motifsDAction(
      fiche({
        statut: "SORTI",
        ouverts: [
          constat({ kind: "INACTIVE_STARTUP" }),
          constat({ kind: "SCOPE_EXIT", severity: "HIGH" }),
        ],
      }),
    );

    expect(avecSortie).toHaveLength(2);
    expect(nomsDesGestes(avecSortie[1]?.gestes)).toEqual(["clore"]);
    expect(avecSortie[1]?.severite).toBe("error");
    expect(
      avecSortie.flatMap((motif) => nomsDesGestes(motif.gestes)).filter((nom) => nom !== "clore"),
    ).toEqual(["rattacher-startup"]);

    const sortieClose = motifsDAction(
      fiche({
        statut: "SORTI",
        fermes: [{ kind: "SCOPE_EXIT", closedBy: "alex.dupuis" }],
      }),
    );

    expect(sortieClose).toHaveLength(0);

    const sortieRefermeeParLaCollecte = motifsDAction(
      fiche({ statut: "SORTI", fermes: [{ kind: "SCOPE_EXIT", closedBy: null }] }),
    );

    expect(sortieRefermeeParLaCollecte.map((motif) => motif.cle)).toEqual(["statut"]);
  });

  it("ne prétend pas couper un accès, et nomme le compte quand le constat en désigne un", () => {
    const motifs = motifsDAction(
      fiche({
        ouverts: [
          constat({
            kind: "ORPHAN",
            severity: "HIGH",
            compte: { provider: "github", handle: "alex.dupuis" },
          }),
          constat({ kind: "SCOPE_EXIT", severity: "HIGH" }),
        ],
      }),
    );

    expect(nomsDesGestes(motifs[0]?.gestes)).toEqual(["clore"]);
    expect(motifs[0]?.description).toBe(
      `${LIBELLE_CONSTAT.ORPHAN.action} Il s'agit du compte alex.dupuis sur github.`,
    );
    expect(motifs[1]?.description).toBe(LIBELLE_CONSTAT.SCOPE_EXIT.action);

    const sansCompte = motifsDAction(
      fiche({ ouverts: [constat({ kind: "ORPHAN", severity: "HIGH" })] }),
    );
    expect(sansCompte[0]?.description).toBe(LIBELLE_CONSTAT.ORPHAN.action);

    expect(new Set(motifs.flatMap((motif) => nomsDesGestes(motif.gestes)))).toEqual(
      new Set(["clore"]),
    );
  });

  it("mène au dossier de départ en cours, ou à nulle part", () => {
    const avecDossier = motifsDAction(
      fiche({
        ouverts: [constat({ kind: "OVERDUE_MANUAL_ACTION", severity: "HIGH" })],
        dossierVivant: "dossier-abc",
      }),
    );

    const constatAvecDossier = avecDossier.find((motif) => motif.cle.startsWith("constat-"));
    expect(nomsDesGestes(constatAvecDossier?.gestes)).toEqual(["clore"]);
    expect(constatAvecDossier?.lien).toEqual({
      href: "/departs/dossier-abc",
      libelle: "Ouvrir le dossier de départ en cours",
    });

    // Le dossier vivant se dit une fois de plus, en tête, et sans geste : il n'est pas
    // un écart, c'est un travail commencé.
    expect(avecDossier[0]?.cle).toBe("depart-en-cours");
    expect(avecDossier[0]?.gestes).toBeUndefined();

    const sansDossier = motifsDAction(
      fiche({ ouverts: [constat({ kind: "OVERDUE_MANUAL_ACTION", severity: "HIGH" })] }),
    );

    expect(nomsDesGestes(sansDossier[0]?.gestes)).toEqual(["clore"]);
    expect(sansDossier[0]?.lien).toBeUndefined();

    const liens = [...avecDossier, ...sansDossier].map((motif) => motif.lien?.href ?? "");
    expect(liens.some((href) => href.startsWith("/constats"))).toBe(false);
  });

  it("écarte le doublon de la consigne, et donne le même geste aux deux routes", () => {
    const avecConstat = motifsDAction(
      fiche({
        toutesStartupsTerminees: true,
        ouverts: [constat({ kind: "INACTIVE_STARTUP" })],
      }),
    );

    expect(avecConstat.map((motif) => motif.cle)).toEqual(["constat-id-INACTIVE_STARTUP"]);
    expect(
      avecConstat.filter((motif) => motif.description.includes("Confirmer son rattachement réel")),
    ).toHaveLength(1);

    const sansConstat = motifsDAction(fiche({ toutesStartupsTerminees: true }));
    const startupsTerminees = sansConstat.find((motif) => motif.cle === "startups-terminees");

    expect(nomsDesGestes(startupsTerminees?.gestes)).toEqual(["rattacher-startup"]);

    const parEquipe = motifsDAction(fiche({ toutesStartupsTerminees: true, parEquipe: true }));
    expect(parEquipe).toHaveLength(0);
  });

  it("ne pose aucun geste sur ce qui n'est pas un constat, et jamais plus de deux", () => {
    const sansConstat = motifsDAction(
      fiche({
        statut: "A_TRAITER",
        fraicheur: { perimee: true, heures: 96 },
        toutesStartupsTerminees: true,
        appartenance: {
          dans: false,
          motif: "EXCLUSION_FORCEE",
          startups: [],
          sansStartupConnue: true,
          toutesStartupsTerminees: true,
          surcharge: {
            sens: "EXCLUDE",
            par: "alex.dupuis",
            depuis: new Date("2026-08-01"),
            raison: "partie sans préavis",
          },
          sansSurcharge: "EQUIPE",
        },
      }),
    );

    expect(sansConstat.map((motif) => motif.cle)).toEqual([
      "statut",
      "fraicheur",
      "startups-terminees",
      "surcharge",
      "sortie-contre-equipe",
      "sans-startup",
    ]);
    expect(
      sansConstat
        .filter((motif) => motif.cle !== "startups-terminees")
        .every((motif) => motif.gestes === undefined && motif.lien === undefined),
    ).toBe(true);

    const complete = motifsDAction(
      fiche({
        statut: "SORTI",
        dossierVivant: "dossier-abc",
        ouverts: [
          constat({ kind: "SCOPE_EXIT", severity: "HIGH" }),
          constat({ kind: "INACTIVE_STARTUP" }),
          constat({ kind: "ORPHAN", severity: "HIGH" }),
          constat({ kind: "OVERDUE_MANUAL_ACTION", severity: "HIGH" }),
        ],
      }),
    );

    expect(complete.every((motif) => (motif.gestes ?? []).length <= 2)).toBe(true);
    expect(
      complete.flatMap((motif) => nomsDesGestes(motif.gestes)).filter((nom) => nom === "clore"),
    ).toHaveLength(4);
    // Deux noms de geste, et pas un de plus : aucun ne peut évoquer un retrait d'accès.
    expect(new Set(complete.flatMap((motif) => nomsDesGestes(motif.gestes)))).toEqual(
      new Set(["clore", "rattacher-startup"]),
    );
  });
});

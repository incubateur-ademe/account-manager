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
    ageDuReleve: null,
    nonRendue: false,
    sansReponse: false,
    toutesStartupsTerminees: false,
    parEquipe: false,
    departVivant: null,
    arriveeVivante: null,
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
        departVivant: "dossier-abc",
      }),
    );

    const constatAvecDossier = avecDossier.find((motif) => motif.cle.startsWith("constat-"));
    expect(nomsDesGestes(constatAvecDossier?.gestes)).toEqual(["clore"]);
    expect(constatAvecDossier?.lien).toEqual({
      href: "/dossiers/dossier-abc",
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

  it("annonce l'arrivée en cours, et ne propose de la préparer que tant qu'aucune ne l'est", () => {
    const sansDossier = motifsDAction(fiche({ ouverts: [constat({ kind: "SCOPE_ENTRY" })] }));

    expect(sansDossier.map((motif) => motif.cle)).toEqual(["constat-id-SCOPE_ENTRY"]);
    expect(sansDossier[0]?.description).toBe(LIBELLE_CONSTAT.SCOPE_ENTRY.action);
    expect(nomsDesGestes(sansDossier[0]?.gestes)).toEqual(["ouvrir-arrivee", "clore"]);
    expect(sansDossier[0]?.lien).toBeUndefined();

    const avecDossier = motifsDAction(
      fiche({ ouverts: [constat({ kind: "SCOPE_ENTRY" })], arriveeVivante: "dossier-arr" }),
    );

    expect(avecDossier.map((motif) => motif.cle)).toEqual([
      "arrivee-en-cours",
      "constat-id-SCOPE_ENTRY",
    ]);
    expect(avecDossier[0]?.lien).toEqual({
      href: "/dossiers/dossier-arr",
      libelle: "Ouvrir le dossier",
    });
    expect(avecDossier[0]?.gestes).toBeUndefined();
    expect(nomsDesGestes(avecDossier[1]?.gestes)).toEqual(["clore"]);

    // Les deux sens vivent côte à côte : un retour se prépare pendant que le départ
    // qui l'a précédé n'est pas encore soldé.
    const lesDeux = motifsDAction(
      fiche({ departVivant: "dossier-dep", arriveeVivante: "dossier-arr" }),
    );

    expect(lesDeux.map((motif) => motif.cle)).toEqual(["depart-en-cours", "arrivee-en-cours"]);
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
        // Deux voisins qui parlent tous les deux de ce que la fiche ne sait plus, et
        // qui ne disent pas la même chose : la fraîcheur date le dernier passage, ce
        // motif-ci dit que le dernier passage complet n'a pas rendu cette personne et
        // que rien n'en a été conclu.
        nonRendue: true,
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
      "non-rendue",
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

    // Le même angle mort, l'autre cause : la lecture de sa fiche n'a pas répondu, et
    // rien en base ne l'en distingue. Un seul motif prend la place de l'autre, parce
    // que deux lignes qui parlent du même silence en promettant deux suites opposées
    // laisseraient l'opérateur choisir laquelle croire. La suite change, et c'est tout
    // ce qui se joue ici : celle du dessus annonce une sortie au prochain passage
    // complet, celle-ci annonce qu'aucun passage ne conclura tant que la source ne
    // répondra pas, et dirige vers l'amont.
    const muette = motifsDAction(fiche({ nonRendue: true, sansReponse: true }));

    expect(muette.map((motif) => motif.cle)).toEqual(["sans-reponse"]);
    expect(muette[0]?.severite).toBe("warning");
    expect(muette[0]?.description).toContain("tant qu'elle échouera");
    expect(muette[0]?.description).toContain("espace-membre");
    expect(muette[0]?.description).not.toContain("sera constatée");
    expect(muette[0]?.gestes).toBeUndefined();

    const complete = motifsDAction(
      fiche({
        statut: "SORTI",
        departVivant: "dossier-abc",
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

  it("n'annonce un relevé qui n'avance plus qu'une fois que ce n'est plus un incident", () => {
    // Given une nuit ratée, puis deux. Le passage porte déjà le compte dans sa trace,
    // et cet écran-ci se tait : une lecture échoue une nuit pour une raison qui
    // passera, et le même avertissement posé sur les quatre-vingt-quinze fiches à
    // chaque incident d'une nuit cesse d'être lu, ce qui coûterait justement la seule
    // fois où il compte.
    expect(motifsDAction(fiche({ ageDuReleve: 1 }))).toEqual([]);
    expect(motifsDAction(fiche({ ageDuReleve: 2 }))).toEqual([]);

    // When la série s'installe. Rien n'a changé sur cette personne, et c'est le point :
    // ce que l'écran annonce n'est pas un fait sur elle, c'est le fait que plus rien
    // n'est conclu sur personne.
    const fige = motifsDAction(fiche({ ageDuReleve: 3 }));

    // Then il le dit avec son compte, dit que le silence ne la concerne pas
    // particulièrement, et n'offre aucun geste : il n'y a rien à faire d'ici, la
    // cause est dans le journal des collectes.
    expect(fige.map((motif) => motif.cle)).toEqual(["releve-fige"]);
    expect(fige[0]?.severite).toBe("warning");
    expect(fige[0]?.description).toContain("3 passages");
    expect(fige[0]?.description).toContain("pour personne");
    expect(fige[0]?.gestes).toBeUndefined();
    expect(fige[0]?.lien).toBeUndefined();

    // Then il voisine la fraîcheur au lieu de la remplacer, et les deux ne disent pas
    // la même chose : celle du dessus dit que la collecte n'a pas tourné, celui-ci dit
    // qu'elle tourne et qu'elle ne conclut rien. C'est le second cas qui est traître,
    // l'écran restant au vert de bout en bout.
    const avecFraicheur = motifsDAction(
      fiche({ ageDuReleve: 12, fraicheur: { perimee: true, heures: 96 } }),
    );

    expect(avecFraicheur.map((motif) => motif.cle)).toEqual(["fraicheur", "releve-fige"]);
    expect(avecFraicheur[1]?.description).toContain("12 passages");
  });
});

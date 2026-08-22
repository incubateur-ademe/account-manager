import { describe, expect, it } from "vitest";

import type { RattachementManuel } from "./rattachement-startup";
import {
  assemblerIndex,
  assemblerMembres,
  compteurs,
  estVueStartups,
  filtrerStartups,
  type PersonneRattachable,
  type StartupObservee,
} from "./startups";
import type { StatutOptions } from "./statut";

const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

// L'instant courant porte une heure, les dates de fin non : c'est exactement l'écart
// qui fait cesser un rattachement un jour trop tôt quand on compare deux `Date`.
const MAINTENANT = new Date(le("2026-08-20").getTime() + 15 * 60 * 60 * 1000);

const TERMINALES = ["abandon", "abandon-investigation", "transfere", "alumni"];

const SEUILS: StatutOptions = { graceDays: 7 };

const startup = (ghid: string, over: Partial<StartupObservee> = {}): StartupObservee => ({
  ghid,
  name: ghid,
  currentPhase: "construction",
  phaseStart: le("2026-01-15"),
  firstSeenAt: le("2025-06-01"),
  lastSeenAt: le("2026-08-20"),
  vanishedAt: null,
  ...over,
});

const personne = (
  username: string,
  over: Partial<PersonneRattachable> = {},
): PersonneRattachable => ({
  username,
  fullname: username,
  missionEnd: le("2027-03-31"),
  vanishedAt: null,
  attachment: "STARTUPS",
  startups: [],
  rattachementsManuels: [],
  ...over,
});

const rattachement = (
  startupGhid: string,
  over: Partial<RattachementManuel> = {},
): RattachementManuel => ({
  startupGhid,
  until: le("2026-11-30"),
  endedAt: null,
  ...over,
});

describe("l'index sépare ce qui vit, ce qui est fini, et ce qui a quitté l'incubateur", () => {
  it("range chaque startup dans une seule vue, et ne conclut pas sur une phase inconnue", () => {
    // Six startups observées : deux en construction, deux terminées, une dont la
    // phase n'a jamais été renseignée, et une qui a disparu de la liste de
    // l'incubateur alors qu'elle était en accélération.
    const startups = [
      startup("produit-alpha"),
      startup("produit-beta"),
      startup("service-gamma", { currentPhase: "alumni" }),
      startup("service-delta", { currentPhase: "transfere" }),
      startup("produit-epsilon", { currentPhase: null, phaseStart: null }),
      startup("service-zeta", { currentPhase: "acceleration", vanishedAt: le("2026-07-01") }),
    ];

    const { lignes, ghidsInconnus } = assemblerIndex(startups, [], TERMINALES, MAINTENANT);
    expect(lignes).toHaveLength(6);
    expect(ghidsInconnus).toEqual([]);

    const ghids = (vue: "actives" | "terminales" | "sorties" | "tout") =>
      filtrerStartups(lignes, vue, "").map((ligne) => ligne.ghid);

    expect(ghids("actives")).toEqual(["produit-alpha", "produit-beta", "produit-epsilon"]);
    expect(ghids("terminales")).toEqual(["service-delta", "service-gamma"]);
    expect(ghids("sorties")).toEqual(["service-zeta"]);
    expect(ghids("tout")).toHaveLength(6);

    // Une phase qu'on ne connaît pas reste active : la ranger dans les terminées
    // faute d'information reviendrait à conclure sur une supposition.
    const inconnue = lignes.find((ligne) => ligne.ghid === "produit-epsilon");
    expect(inconnue).toMatchObject({ terminale: false, phaseConnue: false, sortie: false });

    // Une startup sortie n'est pas une startup terminée : sa dernière phase connue
    // reste vivante, elle n'est simplement plus rendue par l'incubateur.
    const sortie = lignes.find((ligne) => ligne.ghid === "service-zeta");
    expect(sortie).toMatchObject({ terminale: false, phaseConnue: true, sortie: true });

    // La recherche porte sur le nom comme sur le ghid, et ne dépend pas de la casse.
    expect(filtrerStartups(lignes, "tout", "  GAMMA ").map((ligne) => ligne.ghid)).toEqual([
      "service-gamma",
    ]);

    expect(estVueStartups("actives")).toBe(true);
    expect(estVueStartups("terminees")).toBe(false);
    expect(estVueStartups(undefined)).toBe(false);
  });
});

describe("le compteur ne réclame l'attention que là où il reste des gens", () => {
  it("ne compte le terminé et le sorti que peuplés, et garde les membres sortis du référentiel", () => {
    const startups = [
      startup("produit-alpha"),
      startup("service-delta", { currentPhase: "alumni" }),
      startup("service-gamma", { currentPhase: "alumni" }),
      startup("service-omega", { currentPhase: "acceleration", vanishedAt: le("2026-06-15") }),
    ];

    const personnes = [
      personne("camille.exemple", { startups: ["service-delta"] }),
      // Plus aucune source ne la réclame, et pourtant ses accès survivent : c'est
      // le pire cas, pas une raison de la faire disparaître du décompte.
      personne("dominique.essai", {
        startups: ["service-delta"],
        vanishedAt: le("2026-08-01"),
      }),
      personne("gabriel.fictif", { startups: ["service-omega"] }),
    ];

    const { lignes } = assemblerIndex(startups, personnes, TERMINALES, MAINTENANT);

    expect(lignes.find((ligne) => ligne.ghid === "service-delta")).toMatchObject({
      membres: 2,
      membresSortis: 1,
    });
    expect(lignes.find((ligne) => ligne.ghid === "service-gamma")).toMatchObject({
      membres: 0,
      membresSortis: 0,
    });
    expect(lignes.find((ligne) => ligne.ghid === "service-omega")).toMatchObject({
      membres: 1,
      membresSortis: 0,
    });

    // service-gamma est terminée et déserte : un fait d'archive, pas un travail à
    // faire. La compter rendrait le compteur ignorable.
    expect(compteurs(lignes)).toEqual({
      actives: 1,
      terminalesPeuplees: 1,
      sortiesPeuplees: 1,
    });
  });
});

describe("les membres d'une startup se lisent en une seule liste", () => {
  it("ne double personne, n'invente personne, et ne dépend pas de l'ordre d'entrée", () => {
    // camille.exemple est collectée sur produit-alpha ET rattachée à la main dessus,
    // deux fois de surcroît, faute d'index unique partiel côté base.
    const camille = personne("camille.exemple", {
      fullname: "Camille Exemple",
      missionEnd: le("2026-09-30"),
      startups: ["produit-alpha"],
      rattachementsManuels: [
        rattachement("produit-alpha", { until: le("2026-09-30") }),
        rattachement("produit-alpha", { until: le("2026-11-30") }),
      ],
    });
    const dominique = personne("dominique.essai", {
      fullname: "Dominique Essai",
      startups: ["produit-alpha"],
    });
    // Rattachée par une équipe transverse : elle n'apparaîtra jamais dans
    // `Person.startups`, seule la décision manuelle la place sur cette startup.
    const gabriel = personne("gabriel.fictif", {
      fullname: "Gabriel Fictif",
      attachment: "DECLARED",
      rattachementsManuels: [rattachement("produit-alpha", { until: le("2026-10-31") })],
    });

    const { membres, echus } = assemblerMembres(
      "produit-alpha",
      [camille, dominique, gabriel],
      MAINTENANT,
      SEUILS,
    );

    expect(membres.map((membre) => membre.username)).toEqual([
      "camille.exemple",
      "dominique.essai",
      "gabriel.fictif",
    ]);
    expect(echus).toEqual([]);

    // Collectée et rattachée à la main sur la même startup : une seule ligne, qui le
    // dit, et le rattachement retenu est le plus lointain des deux.
    expect(membres[0]).toMatchObject({ origine: "les-deux", parEquipe: false });
    expect(membres[0]?.manuel?.until).toEqual(le("2026-11-30"));
    // Le rattachement repousse la fin de mission sans jamais la raccourcir.
    expect(membres[0]?.echeance).toEqual(le("2026-11-30"));
    expect(membres[0]?.statut).toBe("ACTIF");

    expect(membres[1]).toMatchObject({ origine: "collecte", manuel: null, parEquipe: false });

    expect(membres[2]).toMatchObject({ origine: "manuel", parEquipe: true });
    expect(membres[2]?.manuel?.until).toEqual(le("2026-10-31"));

    // Prisma ne garantit aucun ordre : le tri appartient au noyau.
    const inverse = assemblerMembres(
      "produit-alpha",
      [gabriel, dominique, camille],
      MAINTENANT,
      SEUILS,
    );
    expect(inverse.membres.map((membre) => membre.username)).toEqual([
      "camille.exemple",
      "dominique.essai",
      "gabriel.fictif",
    ]);
  });
});

describe("un rattachement manuel échu cesse de faire un membre, sans disparaître de l'écran", () => {
  it("distingue ce que le temps a rattrapé de ce que quelqu'un a retiré", () => {
    const camille = personne("camille.exemple", {
      fullname: "Camille Exemple",
      rattachementsManuels: [rattachement("service-beta", { until: le("2026-08-19") })],
    });
    const dominique = personne("dominique.essai", {
      fullname: "Dominique Essai",
      rattachementsManuels: [rattachement("service-beta", { until: le("2026-09-30") })],
    });
    // Dernier jour couvert aujourd'hui même : la fin est inclusive, au même titre
    // qu'une fin de mission.
    const ariane = personne("ariane.modele", {
      fullname: "Ariane Modele",
      rattachementsManuels: [rattachement("service-beta", { until: le("2026-08-20") })],
    });
    // Retiré à la main, bien avant sa date de fin.
    const gabriel = personne("gabriel.fictif", {
      fullname: "Gabriel Fictif",
      rattachementsManuels: [
        rattachement("service-beta", { until: le("2026-12-31"), endedAt: le("2026-08-10") }),
      ],
    });

    const { membres, echus } = assemblerMembres(
      "service-beta",
      [camille, dominique, ariane, gabriel],
      MAINTENANT,
      SEUILS,
    );

    expect(membres.map((membre) => membre.username)).toEqual(["ariane.modele", "dominique.essai"]);
    expect(membres[0]?.origine).toBe("manuel");

    // Le rattachement de camille a cessé de lui-même : le faire simplement
    // disparaître laisserait croire que quelqu'un l'a retiré.
    expect(echus.map((echu) => echu.username)).toEqual(["camille.exemple"]);
    expect(echus[0]?.rattachement.until).toEqual(le("2026-08-19"));

    // Celui de gabriel a été fermé par quelqu'un : ce n'est ni un membre, ni une
    // expiration à raconter.
    expect(echus.map((echu) => echu.username)).not.toContain("gabriel.fictif");
    expect(membres.map((membre) => membre.username)).not.toContain("gabriel.fictif");
  });
});

describe("une startup jamais observée ne se dit pas vide, et un ghid orphelin ne disparaît pas", () => {
  it("distingue l'absence de membre de l'absence d'observation", () => {
    // Référentiel de startups vide : rien n'a jamais été collecté, et deux personnes
    // portent pourtant le même ghid, l'une par la collecte, l'autre par décision.
    const orphelines = [
      personne("camille.exemple", { startups: ["produit-fantome"] }),
      personne("dominique.essai", {
        startups: ["produit-fantome"],
        rattachementsManuels: [rattachement("service-mirage")],
      }),
    ];

    const jamaisCollecte = assemblerIndex([], orphelines, TERMINALES, MAINTENANT);
    expect(jamaisCollecte.lignes).toEqual([]);
    expect(compteurs(jamaisCollecte.lignes)).toEqual({
      actives: 0,
      terminalesPeuplees: 0,
      sortiesPeuplees: 0,
    });
    // Sans cette sortie, ces ghids seraient invisibles de l'index, donc invisibles.
    expect(jamaisCollecte.ghidsInconnus).toEqual([
      { ghid: "produit-fantome", membres: 2 },
      { ghid: "service-mirage", membres: 1 },
    ]);

    // Une startup observée sans personne dessus rend bien une ligne : c'est un fait
    // constaté, et non une absence d'observation.
    const observee = assemblerIndex([startup("service-vide")], [], TERMINALES, MAINTENANT);
    expect(observee.lignes).toHaveLength(1);
    expect(observee.lignes[0]).toMatchObject({
      ghid: "service-vide",
      membres: 0,
      membresSortis: 0,
      phaseConnue: true,
      terminale: false,
      sortie: false,
    });
    expect(observee.ghidsInconnus).toEqual([]);
    expect(compteurs(observee.lignes)).toEqual({
      actives: 1,
      terminalesPeuplees: 0,
      sortiesPeuplees: 0,
    });

    expect(assemblerMembres("service-vide", [], MAINTENANT, SEUILS)).toEqual({
      membres: [],
      echus: [],
    });
  });
});

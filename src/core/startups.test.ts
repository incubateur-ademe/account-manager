import { describe, expect, it } from "vitest";

import type { RattachementManuel } from "./rattachement-startup";
import {
  assemblerIndex,
  assemblerMembres,
  compteurs,
  estVueStartups,
  filtrerStartups,
  LIBELLE_ECARTE,
  type MembreATraiter,
  type PersonneRattachable,
  type ResultatParPersonne,
  repartirLeLot,
  resumeDuLot,
  type StartupObservee,
  type VueStartups,
} from "./startups";
import type { StatutOptions } from "./statut";

const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

// L'instant courant porte une heure, les dates de fin non : c'est exactement l'écart
// qui fait cesser un rattachement un jour trop tôt quand on compare deux `Date`.
const MAINTENANT = new Date(le("2026-08-20").getTime() + 15 * 60 * 60 * 1000);

const TERMINALES = ["abandon", "abandon-investigation", "transfere", "alumni"];

const SEUILS: StatutOptions = { graceDays: 7 };

// Le nom rendu ne se confond jamais avec le ghid, faute de quoi aucun test ne
// distinguerait celui sur lequel on trie de celui sur lequel on cherche.
const nomLisible = (ghid: string): string =>
  ghid
    .split("-")
    .map((mot) => `${(mot[0] ?? "").toUpperCase()}${mot.slice(1)}`)
    .join(" ");

const startup = (ghid: string, over: Partial<StartupObservee> = {}): StartupObservee => ({
  ghid,
  name: nomLisible(ghid),
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

const alEnvers = (fiche: PersonneRattachable): PersonneRattachable => ({
  ...fiche,
  rattachementsManuels: [...fiche.rattachementsManuels].reverse(),
});

describe("l'index sépare ce qui vit, ce qui est fini, et ce qui a quitté l'incubateur", () => {
  it("range chaque startup dans une seule vue, se lit par nom, et ne conclut pas sur une phase inconnue", () => {
    // Huit startups observées, dont les noms ne suivent pas l'ordre des ghids : trois
    // en construction, deux terminées, une dont la phase n'a jamais été renseignée,
    // une disparue de la liste de l'incubateur alors qu'elle était en accélération,
    // et une passée alumni avant d'en disparaître, ce qui est le cas courant. Deux
    // portent le même nom, un ghid ayant été renommé sans que l'ancien cesse d'être
    // observé : à nom égal, seul le ghid départage.
    const startups = [
      startup("produit-alpha-v2", { name: "Boussole" }),
      startup("produit-alpha", { name: "Boussole" }),
      startup("produit-beta", { name: "Atlas" }),
      startup("service-gamma", { name: "Vigie", currentPhase: "alumni" }),
      startup("service-delta", { name: "Cartouche", currentPhase: "transfere" }),
      startup("produit-epsilon", { name: "Estuaire", currentPhase: null, phaseStart: null }),
      startup("service-zeta", {
        name: "Damier",
        currentPhase: "acceleration",
        vanishedAt: le("2026-07-01"),
      }),
      startup("service-eta", {
        name: "Fanal",
        currentPhase: "alumni",
        vanishedAt: le("2026-05-20"),
      }),
    ];

    const { lignes, ghidsInconnus } = assemblerIndex(startups, [], TERMINALES, MAINTENANT);
    expect(lignes).toHaveLength(8);
    expect(ghidsInconnus).toEqual([]);

    // L'index se lit dans l'ordre des noms, celui qu'on a sous les yeux, et non dans
    // celui des ghids : les deux diffèrent ici de bout en bout.
    expect(lignes.map((ligne) => ligne.ghid)).toEqual([
      "produit-beta",
      "produit-alpha",
      "produit-alpha-v2",
      "service-delta",
      "service-zeta",
      "produit-epsilon",
      "service-eta",
      "service-gamma",
    ]);

    const ghids = (vue: VueStartups, recherche = "") =>
      filtrerStartups(lignes, vue, recherche).map((ligne) => ligne.ghid);

    expect(ghids("actives")).toEqual([
      "produit-beta",
      "produit-alpha",
      "produit-alpha-v2",
      "produit-epsilon",
    ]);
    expect(ghids("terminales")).toEqual(["service-delta", "service-gamma"]);
    expect(ghids("sorties")).toEqual(["service-zeta", "service-eta"]);
    expect(ghids("tout")).toHaveLength(8);

    // Une phase qu'on ne connaît pas reste active : la ranger dans les terminées
    // faute d'information reviendrait à conclure sur une supposition.
    const inconnue = lignes.find((ligne) => ligne.ghid === "produit-epsilon");
    expect(inconnue).toMatchObject({ terminale: false, phaseConnue: false, sortie: false });

    // Une startup sortie n'est pas une startup terminée : sa dernière phase connue
    // reste vivante, elle n'est simplement plus rendue par l'incubateur.
    const sortie = lignes.find((ligne) => ligne.ghid === "service-zeta");
    expect(sortie).toMatchObject({ terminale: false, phaseConnue: true, sortie: true });

    // Elle peut aussi être les deux, et c'est le cas courant : passée alumni, puis
    // retirée de la liste. Les deux vues restent disjointes, la sortie l'emporte.
    const finieEtSortie = lignes.find((ligne) => ligne.ghid === "service-eta");
    expect(finieEtSortie).toMatchObject({ terminale: true, phaseConnue: true, sortie: true });
    expect(ghids("terminales")).not.toContain("service-eta");

    // La recherche porte sur le nom comme sur le ghid, sans dépendre de la casse ni
    // des espaces : « Vigie » ne se lit que dans le nom, « gamma » que dans le ghid,
    // et les deux désignent la même ligne.
    expect(ghids("tout", "  VIGIE ")).toEqual(["service-gamma"]);
    expect(ghids("tout", " gamma  ")).toEqual(["service-gamma"]);

    expect(estVueStartups("actives")).toBe(true);
    expect(estVueStartups("terminees")).toBe(false);
    expect(estVueStartups(undefined)).toBe(false);
  });
});

describe("le compteur ne réclame l'attention que là où il reste des gens", () => {
  it("ne compte le terminé et le sorti que peuplés, sans dédoubler ni perdre les sortis du référentiel", () => {
    const startups = [
      startup("produit-alpha"),
      startup("service-delta", { currentPhase: "alumni" }),
      startup("service-gamma", { currentPhase: "alumni" }),
      startup("service-omega", { currentPhase: "acceleration", vanishedAt: le("2026-06-15") }),
      // Passée alumni avant de quitter la liste de l'incubateur : elle relève des
      // sorties et d'elles seules, sinon le trou dangereux se perdrait dans le
      // compteur des terminées.
      startup("service-kappa", { currentPhase: "alumni", vanishedAt: le("2026-04-02") }),
      startup("service-desert", { currentPhase: "acceleration", vanishedAt: le("2026-05-10") }),
    ];

    const personnes = [
      // Collectée sur service-delta et rattachée à la main sur la même : une
      // personne, donc un membre, et non deux.
      personne("camille.exemple", {
        startups: ["service-delta"],
        rattachementsManuels: [rattachement("service-delta")],
      }),
      // Plus aucune source ne la réclame, et pourtant ses accès survivent : c'est
      // le pire cas, pas une raison de la faire disparaître du décompte.
      personne("dominique.essai", {
        startups: ["service-delta"],
        vanishedAt: le("2026-08-01"),
      }),
      personne("gabriel.fictif", { startups: ["service-omega"] }),
      personne("ariane.modele", { startups: ["service-kappa"] }),
    ];

    const { lignes } = assemblerIndex(startups, personnes, TERMINALES, MAINTENANT);
    const ligne = (ghid: string) => lignes.find((candidate) => candidate.ghid === ghid);

    expect(ligne("service-delta")).toMatchObject({ membres: 2, membresSortis: 1 });
    expect(ligne("service-gamma")).toMatchObject({ membres: 0, membresSortis: 0 });
    expect(ligne("service-omega")).toMatchObject({ membres: 1, membresSortis: 0 });
    expect(ligne("service-kappa")).toMatchObject({ membres: 1, terminale: true, sortie: true });
    expect(ligne("service-desert")).toMatchObject({ membres: 0, sortie: true });

    // service-gamma est terminée et déserte, service-desert est sortie et déserte :
    // deux faits d'archive, pas des travaux à faire, et les compter rendrait le
    // compteur ignorable. service-kappa est peuplée, elle compte, et elle compte
    // parmi les sorties.
    expect(compteurs(lignes)).toEqual({
      actives: 1,
      terminalesPeuplees: 1,
      sortiesPeuplees: 2,
    });
  });
});

describe("les membres d'une startup se lisent en une seule liste", () => {
  it("ne double personne, n'invente personne, et ne dépend d'aucun ordre d'entrée", () => {
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
    // Son homonyme sur la même startup : à nom rendu égal, seul l'identifiant
    // départage, sans quoi l'ordre dépendrait de ce que la base a renvoyé.
    const camilleBis = personne("camille.exemple2", {
      fullname: "Camille Exemple",
      startups: ["produit-alpha"],
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
    // Rattachée par son équipe ET par ses startups, c'est-à-dire le cas où
    // l'avertissement compte le plus. Son nom nous arrive à l'envers, comme le
    // référentiel en rend parfois : la liste se trie sur ce nom, pas sur
    // l'identifiant.
    const noe = personne("noe.brouillon", {
      fullname: "Brouillon Noe",
      attachment: "BOTH",
      startups: ["produit-alpha"],
    });

    const attendus = [
      "noe.brouillon",
      "camille.exemple",
      "camille.exemple2",
      "dominique.essai",
      "gabriel.fictif",
    ];

    const { membres, echus } = assemblerMembres(
      "produit-alpha",
      [camilleBis, camille, dominique, gabriel, noe],
      MAINTENANT,
      SEUILS,
    );

    expect(membres.map((membre) => membre.username)).toEqual(attendus);
    expect(echus).toEqual([]);

    const membreDe = (username: string) =>
      membres.find((candidate) => candidate.username === username);

    // Collectée et rattachée à la main sur la même startup : une seule ligne, qui le
    // dit, et le rattachement retenu est le plus lointain des deux.
    expect(membreDe("camille.exemple")).toMatchObject({ origine: "les-deux", parEquipe: false });
    expect(membreDe("camille.exemple")?.manuel?.until).toEqual(le("2026-11-30"));
    // Le rattachement repousse la fin de mission sans jamais la raccourcir.
    expect(membreDe("camille.exemple")?.echeance).toEqual(le("2026-11-30"));
    expect(membreDe("camille.exemple")?.statut).toBe("ACTIF");

    expect(membreDe("dominique.essai")).toMatchObject({
      origine: "collecte",
      manuel: null,
      parEquipe: false,
    });

    expect(membreDe("gabriel.fictif")).toMatchObject({ origine: "manuel", parEquipe: true });
    expect(membreDe("gabriel.fictif")?.manuel?.until).toEqual(le("2026-10-31"));

    expect(membreDe("noe.brouillon")).toMatchObject({ origine: "collecte", parEquipe: true });

    // Prisma ne garantit aucun ordre, ni entre les personnes ni entre les
    // rattachements d'une même personne : le tri comme le choix du plus lointain
    // appartiennent au noyau.
    const inverse = assemblerMembres(
      "produit-alpha",
      [noe, gabriel, dominique, alEnvers(camille), camilleBis],
      MAINTENANT,
      SEUILS,
    );
    expect(inverse.membres.map((membre) => membre.username)).toEqual(attendus);
    expect(
      inverse.membres.find((candidate) => candidate.username === "camille.exemple")?.manuel?.until,
    ).toEqual(le("2026-11-30"));
  });
});

describe("un rattachement manuel échu cesse de faire un membre, sans disparaître de l'écran", () => {
  it("ne raconte l'expiration que quand elle a réellement retiré un membre", () => {
    // Deux rattachements expirés sur la même startup, et plus rien d'autre : une
    // seule expiration à raconter, celle du dernier à avoir porté quelque chose.
    const camille = personne("camille.exemple", {
      fullname: "Camille Exemple",
      rattachementsManuels: [
        rattachement("service-beta", { until: le("2026-07-31") }),
        rattachement("service-beta", { until: le("2026-08-19") }),
      ],
    });
    // Sortie du référentiel, et son unique rattachement a expiré : plus rien ne la
    // rattache, et c'est là qu'il faut le dire.
    const noe = personne("noe.brouillon", {
      fullname: "Brouillon Noe",
      vanishedAt: le("2026-08-05"),
      rattachementsManuels: [rattachement("service-beta", { until: le("2026-08-15") })],
    });
    // Prolongée avant l'échéance du premier rattachement : celui-ci a été remplacé,
    // pas subi.
    const dominique = personne("dominique.essai", {
      fullname: "Dominique Essai",
      rattachementsManuels: [
        rattachement("service-beta", { until: le("2026-08-19") }),
        rattachement("service-beta", { until: le("2026-11-30") }),
      ],
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
    // Sortie du référentiel, collectée sur cette startup, et son rattachement manuel
    // a expiré : la collecte la porte toujours, donc rien n'a cessé.
    const elias = personne("elias.temoin", {
      fullname: "Elias Temoin",
      vanishedAt: le("2026-08-01"),
      startups: ["service-beta"],
      rattachementsManuels: [rattachement("service-beta", { until: le("2026-08-19") })],
    });

    const { membres, echus } = assemblerMembres(
      "service-beta",
      [camille, noe, dominique, ariane, gabriel, elias],
      MAINTENANT,
      SEUILS,
    );

    const membreDe = (username: string) =>
      membres.find((candidate) => candidate.username === username);

    expect(membres.map((membre) => membre.username)).toEqual([
      "ariane.modele",
      "dominique.essai",
      "elias.temoin",
    ]);
    expect(membreDe("ariane.modele")?.origine).toBe("manuel");
    expect(membreDe("dominique.essai")?.manuel?.until).toEqual(le("2026-11-30"));
    // Quitter le référentiel ne retire pas de la liste des membres : c'est l'écran
    // d'où l'on part couper des accès, et le statut le dit à la ligne.
    expect(membreDe("elias.temoin")).toMatchObject({ origine: "collecte", statut: "SORTI" });

    // Deux expirations, et deux seulement. Elles se lisent dans l'ordre des noms
    // rendus, qui n'est pas celui des identifiants.
    expect(echus.map((echu) => echu.username)).toEqual(["noe.brouillon", "camille.exemple"]);
    expect(echus[0]?.rattachement.until).toEqual(le("2026-08-15"));
    expect(echus[1]?.rattachement.until).toEqual(le("2026-08-19"));

    // Celui de gabriel a été fermé par quelqu'un : ce n'est ni un membre, ni une
    // expiration à raconter. Ceux de dominique et d'elias ont bien expiré, mais un
    // second rattachement pour l'une et la collecte pour l'autre les portent
    // toujours : annoncer une expiration à côté de leur ligne de membre laisserait
    // croire à un retrait que personne n'a décidé et que rien n'a produit.
    expect(membres.map((membre) => membre.username)).not.toContain("gabriel.fictif");
    for (const username of ["gabriel.fictif", "dominique.essai", "elias.temoin"]) {
      expect(echus.map((echu) => echu.username)).not.toContain(username);
    }

    // Prisma ne garantit pas plus l'ordre des rattachements que celui des personnes :
    // l'expiration retenue reste la plus lointaine, et la prolongation reste une
    // prolongation.
    const inverse = assemblerMembres(
      "service-beta",
      [alEnvers(dominique), alEnvers(camille)],
      MAINTENANT,
      SEUILS,
    );
    expect(inverse.echus.map((echu) => echu.username)).toEqual(["camille.exemple"]);
    expect(inverse.echus[0]?.rattachement.until).toEqual(le("2026-08-19"));
    expect(inverse.membres.map((membre) => membre.username)).toEqual(["dominique.essai"]);
    expect(inverse.membres[0]?.manuel?.until).toEqual(le("2026-11-30"));
  });
});

describe("une startup jamais observée ne se dit pas vide, et un ghid orphelin ne disparaît pas", () => {
  it("distingue l'absence de membre de l'absence d'observation", () => {
    // Référentiel de startups vide : rien n'a jamais été collecté, et trois personnes
    // portent pourtant deux ghids, l'un par décision, l'autre par la collecte. Ils
    // arrivent dans l'ordre inverse de celui où l'index doit les rendre.
    const orphelines = [
      personne("camille.exemple", {
        rattachementsManuels: [rattachement("service-mirage")],
      }),
      personne("dominique.essai", { startups: ["produit-fantome"] }),
      personne("ariane.modele", { startups: ["produit-fantome"] }),
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

const membreATraiter = (username: string, over: Partial<MembreATraiter> = {}): MembreATraiter => ({
  username,
  fullname: username,
  origine: "collecte",
  manuel: null,
  echeance: le("2026-06-30"),
  parEquipe: false,
  statut: "A_TRAITER",
  startupsEffectives: ["produit-alpha"],
  dossierVivant: false,
  surcharge: false,
  constatOuvert: null,
  disparue: false,
  ...over,
});

const PHASES = new Map<string, string | null>([
  ["produit-alpha", "abandon"],
  ["produit-beta", "acceleration"],
  ["service-gamma", "alumni"],
  ["service-opaque", null],
]);

describe("le lot propose ceux pour qui la question se pose, et dit pourquoi il écarte les autres", () => {
  it("n'en coche qu'un sur six, sans faire disparaître les cinq autres de l'écran", () => {
    // Given une startup abandonnée et six membres dont un seul n'a plus d'autre attache
    const candidats = repartirLeLot(
      "produit-alpha",
      [
        membreATraiter("camille.exemple", { constatOuvert: "INACTIVE_STARTUP:camille.exemple" }),
        membreATraiter("dominique.essai", { parEquipe: true }),
        membreATraiter("ariane.modele", {
          startupsEffectives: ["produit-alpha", "produit-beta"],
        }),
        membreATraiter("gabriel.fictif", {
          startupsEffectives: ["produit-alpha", "service-opaque"],
        }),
        membreATraiter("noe.brouillon", { dossierVivant: true }),
        membreATraiter("elias.temoin", { surcharge: true }),
      ],
      PHASES,
      TERMINALES,
    );

    // Then les six figurent, et un seul est proposé
    expect(candidats).toHaveLength(6);
    expect(candidats.filter((candidat) => candidat.proposeParDefaut)).toHaveLength(1);

    const par = (username: string) => candidats.find((candidat) => candidat.username === username);

    expect(par("camille.exemple")).toMatchObject({ proposeParDefaut: true, ecarte: null });
    expect(par("camille.exemple")?.constatOuvert).toBe("INACTIVE_STARTUP:camille.exemple");

    // Une équipe transverse ne dépend d'aucune startup : la sortir ici contredirait la
    // politique, qui la réclamera de nouveau à la collecte suivante.
    expect(par("dominique.essai")).toMatchObject({ ecarte: "EQUIPE_TRANSVERSE" });
    expect(par("ariane.modele")).toMatchObject({ ecarte: "AUTRE_STARTUP_VIVANTE" });
    expect(par("ariane.modele")?.autresStartupsVivantes).toEqual(["produit-beta"]);
    // Une phase qu'on ne connaît pas interdit de conclure, ici comme dans le moteur.
    expect(par("gabriel.fictif")).toMatchObject({ ecarte: "PHASE_INCONNUE_AILLEURS" });
    expect(par("gabriel.fictif")?.autresStartupsVivantes).toEqual([]);
    expect(par("noe.brouillon")).toMatchObject({ ecarte: "DOSSIER_DEJA_OUVERT" });
    expect(par("elias.temoin")).toMatchObject({ ecarte: "SURCHARGE_EXISTANTE" });

    for (const candidat of candidats) {
      expect(candidat.ecarte === null).toBe(candidat.proposeParDefaut);
      expect(candidat.ecarte === null || LIBELLE_ECARTE[candidat.ecarte].length > 0).toBe(true);
    }
  });

  it("écarte d'abord ce qui est le plus dirimant, et ne regarde jamais la startup traitée", () => {
    // Given quelqu'un qui cumule toutes les raisons d'être écarté
    const cumul = repartirLeLot(
      "produit-alpha",
      [
        membreATraiter("camille.exemple", {
          disparue: true,
          parEquipe: true,
          dossierVivant: true,
          surcharge: true,
          startupsEffectives: ["produit-alpha", "produit-beta"],
        }),
      ],
      PHASES,
      TERMINALES,
    );

    // Then c'est la disparition du référentiel qui est nommée, la première de la liste
    expect(cumul[0]).toMatchObject({ ecarte: "DEJA_SORTIE", proposeParDefaut: false });

    // Given quelqu'un dont la seule startup est celle qu'on traite, terminée
    const seul = repartirLeLot(
      "service-gamma",
      [membreATraiter("dominique.essai", { startupsEffectives: ["service-gamma"] })],
      PHASES,
      TERMINALES,
    );

    // Then la startup traitée ne compte jamais comme une autre attache, terminée ou non
    expect(seul[0]).toMatchObject({ ecarte: null, proposeParDefaut: true });
    expect(seul[0]?.autresStartupsVivantes).toEqual([]);
  });
});

describe("le récapitulatif d'un lot compte des personnes, jamais des événements", () => {
  it("range en trois blocs et ne fond jamais un dossier déjà ouvert dans les succès", () => {
    // Given quinze personnes soumises, dont deux avaient déjà un dossier et une échoue
    const resultats: ResultatParPersonne[] = [
      ...Array.from({ length: 12 }, (_, rang) => ({
        username: `camille.exemple${rang}`,
        fullname: `Camille Exemple ${rang}`,
        issue: "TRAITEE" as const,
        detail: null,
      })),
      {
        username: "ariane.modele",
        fullname: "Ariane Modèle",
        issue: "DEJA" as const,
        detail: "dossier-1",
      },
      {
        username: "gabriel.fictif",
        fullname: "Gabriel Fictif",
        issue: "DEJA" as const,
        detail: "dossier-2",
      },
      {
        username: "noe.brouillon",
        fullname: "Noé Brouillon",
        issue: "ECHEC" as const,
        detail: "Cette personne n'est plus en base.",
      },
    ];

    const resume = resumeDuLot(resultats);

    // Then chaque bloc porte les siennes, et leur somme vaut les personnes soumises
    expect(resume.traitees).toHaveLength(12);
    expect(resume.deja).toHaveLength(2);
    expect(resume.echecs).toHaveLength(1);
    expect(resume.total).toBe(15);
    expect(resume.traitees.length + resume.deja.length + resume.echecs.length).toBe(resume.total);

    // L'échec nomme la personne et sa raison : une alerte unique laisserait croire que
    // les quatorze autres ont échoué aussi.
    expect(resume.echecs[0]).toMatchObject({
      username: "noe.brouillon",
      detail: "Cette personne n'est plus en base.",
    });
    expect(resume.deja.map((resultat) => resultat.detail)).toEqual(["dossier-1", "dossier-2"]);

    // Un lot entièrement vain reste lisible, et son total ne ment pas.
    expect(resumeDuLot([])).toMatchObject({ total: 0 });
  });
});

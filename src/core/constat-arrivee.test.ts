import { describe, expect, it } from "vitest";

import {
  amorcageDesArrivees,
  type ConstatKind,
  constatsDe,
  MISE_EN_SERVICE_DES_ARRIVEES,
  type PersonneConstatable,
  type RegleArrivee,
  typesReconcilies,
  verrousDeCloture,
} from "./constat";

const TERMINALES = ["abandon", "abandon-investigation", "transfere", "alumni"];

const PHASES = new Map<string, string | null>([
  ["produit-alpha", "acceleration"],
  ["produit-omega", "abandon"],
  ["produit-beta", "transfere"],
]);

/**
 * Cette instance a vu son périmètre pour la première fois quinze jours avant que la
 * détection des arrivées n'entre en service : c'est la constante qui fait l'amorçage,
 * et non la première collecte.
 */
const PREMIERE_COLLECTE = new Date("2026-08-10T02:00:00Z");
const AMORCAGE = amorcageDesArrivees(PREMIERE_COLLECTE, MISE_EN_SERVICE_DES_ARRIVEES);
const REGLE: RegleArrivee = { amorcage: AMORCAGE ?? MISE_EN_SERVICE_DES_ARRIVEES };

const LE_JOUR_DE_LA_MISE_EN_SERVICE = new Date("2026-08-25T02:00:00Z");
const LE_LENDEMAIN = new Date("2026-08-26T02:00:00Z");

const personne = (over: Partial<PersonneConstatable> = {}): PersonneConstatable => ({
  username: "camille.rivet",
  fullname: "Camille Rivet",
  attachment: "STARTUPS",
  startups: ["produit-alpha"],
  rattachementsManuels: [],
  missionEnd: new Date("2027-06-30T00:00:00Z"),
  vanishedAt: null,
  firstSeenAt: PREMIERE_COLLECTE,
  returnedAt: null,
  source: "BETA",
  arriveeTraiteeLe: null,
  ...over,
});

const constats = (
  personnes: readonly PersonneConstatable[],
  today: Date,
  arrivees: RegleArrivee | null = REGLE,
) => constatsDe(personnes, PHASES, TERMINALES, today, arrivees);

describe("le premier déploiement ne noie pas la file", () => {
  // Dix personnes découvertes le même jour, celui de la première collecte : elles
  // étaient toutes en poste avant que l'outil n'ouvre les yeux.
  const DEJA_LA = Array.from({ length: 10 }, (_, rang) =>
    personne({ username: `deja.la.${rang}`, fullname: `Déjà Là ${rang}` }),
  );

  it("se tait sur le stock, parle sur la première vraie arrivée, puis se tait de nouveau", () => {
    expect(AMORCAGE).toEqual(MISE_EN_SERVICE_DES_ARRIVEES);

    // Le jour de la mise en service, la file doit être vide : quatre-vingt-quinze
    // constats d'un coup ne se lisent pas, ils se ferment, et l'outil ne s'en remet
    // pas.
    expect(constats(DEJA_LA, LE_JOUR_DE_LA_MISE_EN_SERVICE)).toEqual([]);

    // Le lendemain, quelqu'un apparaît que personne n'a accueilli.
    const camille = personne({ firstSeenAt: LE_LENDEMAIN });
    const levee = constats([...DEJA_LA, camille], LE_LENDEMAIN);

    expect(levee).toHaveLength(1);
    expect(levee[0]).toMatchObject({
      kind: "SCOPE_ENTRY",
      dedupKey: "SCOPE_ENTRY:camille.rivet",
      severity: "MEDIUM",
      username: "camille.rivet",
    });
    // Le constat porte sur une personne, jamais sur un compte : il ne peut donc
    // jamais fonder une coupure.
    expect(levee[0]?.identiteId).toBeUndefined();

    // Un plan d'arrivée exécuté pour elle, et la situation cesse d'être constatée.
    const accueillie = personne({
      firstSeenAt: LE_LENDEMAIN,
      arriveeTraiteeLe: new Date("2026-08-26T10:00:00Z"),
    });
    expect(constats([...DEJA_LA, accueillie], LE_LENDEMAIN)).toEqual([]);
  });

  it("bascule sur la première collecte quand l'instance est neuve, sans rien lever pour autant", () => {
    // Une instance installée bien après la mise en service : la constante ne protège
    // plus rien, c'est la première collecte qui fait l'amorçage.
    const premiere = new Date("2027-03-01T02:00:00Z");
    const amorcage = amorcageDesArrivees(premiere, MISE_EN_SERVICE_DES_ARRIVEES);
    expect(amorcage).toEqual(premiere);

    // Le piège : une fiche créée pendant cette première collecte porte la date du
    // run, celle-là même qui sert d'amorçage. C'est l'exclusion de l'égalité, et elle
    // seule, qui empêche tout le périmètre d'être constaté d'un coup.
    const decouvertes = Array.from({ length: 10 }, (_, rang) =>
      personne({ username: `neuve.${rang}`, fullname: `Neuve ${rang}`, firstSeenAt: premiere }),
    );
    expect(constats(decouvertes, premiere, { amorcage: premiere })).toEqual([]);

    // Et la collecte suivante retrouve la parole.
    const apres = personne({ firstSeenAt: new Date("2027-03-02T02:00:00Z") });
    expect(
      constats([...decouvertes, apres], new Date("2027-03-02T02:00:00Z"), {
        amorcage: premiere,
      }),
    ).toHaveLength(1);
  });

  it("ne conclut rien tant qu'aucune collecte n'a vu personne", () => {
    // Sans périmètre connu, une première vue ne dit pas que quelqu'un vient
    // d'arriver : elle dit que l'outil vient d'ouvrir les yeux.
    expect(amorcageDesArrivees(null, MISE_EN_SERVICE_DES_ARRIVEES)).toBeNull();
  });

  it("ne souhaite pas la bienvenue à un compte machine", () => {
    const robot = personne({
      username: "svc.sauvegarde",
      fullname: "Service de sauvegarde",
      source: "SERVICE",
      firstSeenAt: LE_LENDEMAIN,
    });

    expect(constats([robot], LE_LENDEMAIN)).toEqual([]);
  });
});

describe("un séjour recommence à la réapparition, jamais à la clôture d'un départ", () => {
  // Alex est arrivé bien avant la mise en service, et a été accueilli à l'époque.
  const ARRIVE_LE = new Date("2026-02-01T02:00:00Z");
  const ACCUEILLI_LE = new Date("2026-02-05T10:00:00Z");
  const DEPART_CLOS_LE = new Date("2026-09-15T16:00:00Z");
  const UN_MOIS_APRES_LA_CLOTURE = new Date("2026-10-15T02:00:00Z");
  const REVU_LE = new Date("2026-09-16T02:00:00Z");
  const APRES_LE_RETOUR = new Date("2026-09-20T02:00:00Z");

  const alex = (over: Partial<PersonneConstatable> = {}) =>
    personne({
      username: "alex.dupuis",
      fullname: "Alex Dupuis",
      firstSeenAt: ARRIVE_LE,
      arriveeTraiteeLe: ACCUEILLI_LE,
      ...over,
    });

  it("se tait sur la personne qu'on vient d'offboarder, le jour même comme un mois plus tard", () => {
    // Le cas nominal du produit, et le défaut que cette règle a déjà eu. Une mission
    // qui s'achève ne fait pas sortir du référentiel amont, dont la liste des membres
    // rend aussi les missions terminées : la fiche reste là, la collecte ne date
    // aucune disparition, et clore le départ est le chemin normal. Une règle qui lisait
    // cette clôture souhaitait donc la bienvenue à chaque personne correctement
    // offboardée, dès le premier départ soldé après déploiement.
    const soldee = alex({
      missionEnd: new Date("2026-09-15T00:00:00Z"),
      vanishedAt: null,
      returnedAt: null,
    });

    expect(constats([soldee], DEPART_CLOS_LE)).toEqual([]);
    expect(constats([soldee], UN_MOIS_APRES_LA_CLOTURE)).toEqual([]);
  });

  it("juge le retour sur la réapparition, et non sur une première vue qui ne bouge plus", () => {
    // Premier séjour : arrivé avant l'amorçage, et accueilli. Rien à dire.
    expect(constats([alex()], LE_LENDEMAIN)).toEqual([]);

    // Il a fini par quitter le référentiel, puis y réapparaît : c'est la collecte qui
    // date ce retour, et c'est le seul signe qu'un séjour recommence. `firstSeenAt`
    // n'a pas bougé, et ne bougera jamais : jugé sur elle seule, il resterait
    // inéligible pour toujours, alors que son retour est précisément une arrivée à
    // traiter, avec des accès à rouvrir.
    const revenu = alex({ returnedAt: REVU_LE });
    const levee = constats([revenu], APRES_LE_RETOUR);

    expect(levee).toHaveLength(1);
    expect(levee[0]).toMatchObject({
      kind: "SCOPE_ENTRY",
      dedupKey: "SCOPE_ENTRY:alex.dupuis",
      severity: "MEDIUM",
    });

    // Le second dossier d'arrivée exécuté referme la situation, et l'onboarding du
    // premier séjour n'y suffisait pas : il appartenait au séjour d'avant.
    const reaccueilli = alex({
      returnedAt: REVU_LE,
      arriveeTraiteeLe: new Date("2026-09-18T11:00:00Z"),
    });
    expect(constats([reaccueilli], APRES_LE_RETOUR)).toEqual([]);
  });

  it("ne remonte pas un retour antérieur à l'amorçage", () => {
    // Quelqu'un revenu avant que la détection n'existe n'est pas un arrivant : la date
    // de référence reste sous l'amorçage.
    const ancien = alex({ returnedAt: new Date("2026-08-01T16:00:00Z") });

    expect(constats([ancien], LE_LENDEMAIN)).toEqual([]);
  });
});

describe("un seul constat par personne, et dans cet ordre", () => {
  it("range la sortie avant l'arrivée, et l'arrivée avant les startups terminées", () => {
    const arriveeSurStartupsTerminees = personne({
      username: "camille.rivet",
      firstSeenAt: LE_LENDEMAIN,
      startups: ["produit-omega", "produit-beta"],
    });
    const arriveeEnRegle = personne({
      username: "alex.dupuis",
      fullname: "Alex Dupuis",
      firstSeenAt: LE_LENDEMAIN,
    });
    const ancienneSurStartupsTerminees = personne({
      username: "sacha.moreau",
      fullname: "Sacha Moreau",
      startups: ["produit-omega"],
    });
    const sortie = personne({
      username: "noe.vasseur",
      fullname: "Noé Vasseur",
      firstSeenAt: LE_LENDEMAIN,
      vanishedAt: LE_LENDEMAIN,
    });

    const levee = constats(
      [arriveeSurStartupsTerminees, arriveeEnRegle, ancienneSurStartupsTerminees, sortie],
      LE_LENDEMAIN,
    );

    expect(levee).toHaveLength(4);
    expect(new Set(levee.map((constat) => constat.username)).size).toBe(4);

    const parPersonne = new Map(levee.map((constat) => [constat.username, constat.kind]));
    // Proposer de retirer les accès de quelqu'un dont on n'a même pas acté l'arrivée
    // serait absurde.
    expect(parPersonne.get("camille.rivet")).toBe("SCOPE_ENTRY");
    expect(parPersonne.get("alex.dupuis")).toBe("SCOPE_ENTRY");
    expect(parPersonne.get("sacha.moreau")).toBe("INACTIVE_STARTUP");
    // Quelqu'un qui a quitté le référentiel n'a pas besoin qu'on lui souhaite la
    // bienvenue.
    expect(parPersonne.get("noe.vasseur")).toBe("SCOPE_EXIT");
  });
});

describe("une collecte qui ne conclut pas sur les arrivées ferme les trois portes", () => {
  // Les deux requêtes de la réconciliation, telles que la collecte les pose : l'une
  // sur les constats ouverts qu'elle a le droit de fermer, l'autre sur ceux qu'un
  // opérateur a clos à la main.
  const filtrer = <T extends { kind: ConstatKind }>(
    lignes: readonly T[],
    reconcilies: ConstatKind[],
  ) => lignes.filter((ligne) => reconcilies.includes(ligne.kind));

  const OUVERTS = [
    { id: "f1", dedupKey: "SCOPE_ENTRY:camille.rivet", kind: "SCOPE_ENTRY" as ConstatKind },
    { id: "f2", dedupKey: "SCOPE_EXIT:noe.vasseur", kind: "SCOPE_EXIT" as ConstatKind },
  ];
  const CLOS_A_LA_MAIN = [
    { id: "f3", dedupKey: "SCOPE_ENTRY:alex.dupuis", kind: "SCOPE_ENTRY" as ConstatKind },
  ];

  it("ne lève rien, ne ferme rien, et ne relève aucun verrou", () => {
    // Une arrivante éligible, et un périmètre dont on ne peut pas conclure : lecture
    // partielle, ou vague d'arrivées.
    const arrivante = personne({ firstSeenAt: LE_LENDEMAIN });

    // Première porte : rien n'est calculé.
    const levee = constats([arrivante], LE_LENDEMAIN, null);
    expect(levee.filter((constat) => constat.kind === "SCOPE_ENTRY")).toEqual([]);

    const reconcilies = typesReconcilies({ arriveesConcluantes: false });
    expect(reconcilies).not.toContain("SCOPE_ENTRY");
    expect(reconcilies).toContain("SCOPE_EXIT");

    // Deuxième porte : le constat ouvert n'entre pas dans la fournée à refermer, donc
    // il n'est pas fermé à tort par une collecte qui ne l'a pas calculé.
    expect(filtrer(OUVERTS, reconcilies).map((ligne) => ligne.dedupKey)).toEqual([
      "SCOPE_EXIT:noe.vasseur",
    ]);

    // Troisième porte : la clôture manuelle n'est pas relue, donc son verrou tient.
    const constatesMaintenant = new Set(levee.map((constat) => constat.dedupKey));
    const protege = verrousDeCloture(filtrer(CLOS_A_LA_MAIN, reconcilies), constatesMaintenant);
    expect(protege.aRearmer).toEqual([]);

    // Et voici la panne muette que les trois portes évitent : si le type restait
    // réconciliable, le verrou qu'un opérateur a posé sauterait sur une collecte qui
    // n'a rien su dire des arrivées.
    const tous = typesReconcilies({ arriveesConcluantes: true });
    const rearme = verrousDeCloture(filtrer(CLOS_A_LA_MAIN, tous), constatesMaintenant);
    expect(rearme.aRearmer.map((ligne) => ligne.dedupKey)).toEqual(["SCOPE_ENTRY:alex.dupuis"]);
  });
});

describe("le verrou d'une clôture manuelle tient tant que la situation dure", () => {
  const CLOS_A_LA_MAIN = [{ id: "f1", dedupKey: "SCOPE_ENTRY:camille.rivet" }];
  const RECONCILIES = typesReconcilies({ arriveesConcluantes: true });

  it("tient sur une arrivée non traitée, se lève au départ, et laisse le retour constater un nouvel épisode", () => {
    expect(RECONCILIES).toContain("SCOPE_ENTRY");

    // La personne est toujours là, sans plan d'arrivée exécuté : la situation dure,
    // et lui resservir chaque nuit un travail qu'elle a déjà jugé fait est ce qui
    // fait cesser de lire une file.
    const toujoursLa = personne({ firstSeenAt: LE_LENDEMAIN });
    const dure = verrousDeCloture(
      CLOS_A_LA_MAIN,
      new Set(constats([toujoursLa], LE_LENDEMAIN).map((constat) => constat.dedupKey)),
    );
    expect(dure.verrouilles).toEqual(new Set(["SCOPE_ENTRY:camille.rivet"]));
    expect(dure.aRearmer).toEqual([]);

    // Elle quitte le référentiel : la situation d'arrivée cesse d'être constatée, le
    // verrou se lève, et c'est une sortie qui la concerne désormais.
    const partie = personne({ firstSeenAt: LE_LENDEMAIN, vanishedAt: LE_LENDEMAIN });
    const desormais = constats([partie], LE_LENDEMAIN);
    expect(desormais.map((constat) => constat.kind)).toEqual(["SCOPE_EXIT"]);

    const cesse = verrousDeCloture(
      CLOS_A_LA_MAIN,
      new Set(desormais.map((constat) => constat.dedupKey)),
    );
    expect(cesse.verrouilles).toEqual(new Set());
    expect(cesse.aRearmer.map((ligne) => ligne.dedupKey)).toEqual(["SCOPE_ENTRY:camille.rivet"]);

    // Elle réapparaît au référentiel, et la collecte date ce retour : un séjour
    // recommence, avec des accès à rouvrir. L'accueil du séjour d'avant lui est
    // antérieur et n'y suffit pas, si bien qu'un nouvel épisode se constate. Le verrou
    // ne l'en empêche pas, ayant été réarmé au départ, et c'est ce qu'on veut : sans
    // cela, un second séjour ne serait plus jamais signalé.
    const REVUE_LE = new Date("2026-08-28T02:00:00Z");
    const APRES_LE_RETOUR = new Date("2026-09-01T02:00:00Z");
    const revenue = personne({
      firstSeenAt: LE_LENDEMAIN,
      returnedAt: REVUE_LE,
      arriveeTraiteeLe: new Date("2026-08-27T09:00:00Z"),
    });
    expect(constats([revenue], APRES_LE_RETOUR).map((constat) => constat.kind)).toEqual([
      "SCOPE_ENTRY",
    ]);

    // Et c'est le second accueil, celui qui suit le retour, qui referme la situation.
    const reaccueillie = personne({
      firstSeenAt: LE_LENDEMAIN,
      returnedAt: REVUE_LE,
      arriveeTraiteeLe: new Date("2026-08-29T09:00:00Z"),
    });
    expect(constats([reaccueillie], APRES_LE_RETOUR)).toEqual([]);
  });
});

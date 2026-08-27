import { describe, expect, it } from "vitest";

import {
  arriveeMassive,
  autrePassageCompletDepuis,
  blocagesInstalles,
  champsConstates,
  chuteExcessive,
  chuteInstallee,
  fraicheurDe,
  nonRendueAuDernierPassage,
  PLANCHER_ARRIVEES,
  type RefusDeDatation,
  type ReleveSysteme,
  refusRepete,
  systemesMuets,
} from "./collecte";

const SEUIL = 48;
const MAINTENANT = new Date("2026-08-11T09:00:00.000Z");

describe("fraîcheur de la collecte", () => {
  it("se tait tant que le traitement quotidien a tourné", () => {
    // Une nuit sautée arrive : tant qu'on reste sous le seuil, rien à dire, sinon
    // l'avertissement deviendrait le fond d'écran et ne serait plus lu.
    const hier = new Date("2026-08-10T04:30:00.000Z");

    expect(fraicheurDe(hier, MAINTENANT, SEUIL)).toEqual({ perimee: false, heures: 28 });
  });

  it("prévient dès que le silence dure plus que le seuil", () => {
    // Deux nuits de suite sans collecte : ce n'est plus un aléa, et les écrans
    // continueraient d'afficher des échéances tenues pour celles du jour.
    const avantHier = new Date("2026-08-09T04:30:00.000Z");

    const fraicheur = fraicheurDe(avantHier, MAINTENANT, SEUIL);
    expect(fraicheur.perimee).toBe(true);
    expect(fraicheur.heures).toBe(52);
  });

  it("traite l'absence totale de collecte comme le pire des cas", () => {
    // Rien n'a jamais été observé : l'outil ne sait rien, ce qui ne veut surtout pas
    // dire qu'il n'y a rien à couper.
    expect(fraicheurDe(null, MAINTENANT, SEUIL)).toEqual({ perimee: true, heures: null });
  });

  it("ne rend jamais un âge négatif si l'horloge du serveur a bougé", () => {
    const futur = new Date("2026-08-11T10:00:00.000Z");

    expect(fraicheurDe(futur, MAINTENANT, SEUIL)).toEqual({ perimee: false, heures: 0 });
  });
});

describe("chute d'une collecte d'un relevé à l'autre", () => {
  const PART_MAX = 0.2;

  it("laisse passer les départs ordinaires", () => {
    // Quelques personnes s'en vont d'un mois sur l'autre : c'est la vie normale de
    // l'incubateur, et refuser de la constater rendrait l'outil muet. Le plancher
    // lui-même passe, le doute ne commence qu'en dessous.
    expect(chuteExcessive(208, 200, PART_MAX)).toBe(false);
    expect(chuteExcessive(208, 166, PART_MAX)).toBe(false);
  });

  it("retient le bras quand la collecte perd plus d'un cinquième d'un coup", () => {
    // Une réponse tronquée mais valide ressemble trait pour trait à un départ
    // collectif. Les dater reviendrait à couper les accès de gens en poste.
    expect(chuteExcessive(208, 165, PART_MAX)).toBe(true);
    expect(chuteExcessive(208, 0, PART_MAX)).toBe(true);
  });

  it("ne soupçonne rien faute de point de comparaison", () => {
    // La référence est ce que la base tient pour vivant, non ce qu'un run passé a
    // vu : zéro ne veut donc plus dire « pas d'historique », mais « rien à perdre ».
    // Premier relevé : tout est nouveau, rien n'a disparu.
    expect(chuteExcessive(0, 0, PART_MAX)).toBe(false);
    expect(chuteExcessive(0, 208, PART_MAX)).toBe(false);
  });

  it("ne bronche pas quand la collecte grossit", () => {
    expect(chuteExcessive(100, 500, PART_MAX)).toBe(false);
  });
});

/**
 * Deux règles lisent ce prédicat, et c'est la même question : ce qu'un passage a
 * constaté, seul un autre passage complet peut le confirmer. Lu sur la disparition
 * d'une fiche, il dit qu'une absence a duré et vaut départ. Lu sur sa dernière vue, il
 * dit qu'un angle mort a duré et que le passage peut cesser de l'épargner.
 */
describe("ce qu'un autre passage complet vient confirmer", () => {
  const NOCTURNE = new Date("2026-09-02T04:30:00.000Z");
  const VEILLE = new Date("2026-09-01T04:30:00.000Z");

  it("exige un autre passage complet, et ne se fie à aucun délai", () => {
    // Un constat égal au dernier passage complet dit que ce passage-là vient de
    // l'écrire, et qu'aucun autre n'est venu depuis. La comparaison est stricte pour
    // cette raison : une fiche disparue au dernier passage n'est pas confirmée partie,
    // et une fiche non lue au dernier passage n'est pas confirmée absente.
    expect(autrePassageCompletDepuis(NOCTURNE, NOCTURNE)).toBe(false);

    // Un passage complet postérieur au constat l'a confirmé : il aurait effacé la
    // disparition en revoyant la fiche, ou rendu la fiche lisible en la lisant.
    expect(autrePassageCompletDepuis(VEILLE, NOCTURNE)).toBe(true);

    // Une seconde d'écart suffit : ce qui se compte est un passage, pas un délai. Une
    // relance à la main met deux passages à quelques minutes l'un de l'autre, et un
    // seuil en heures les tiendrait alors pour un seul.
    expect(autrePassageCompletDepuis(NOCTURNE, new Date("2026-09-02T04:30:01.000Z"))).toBe(true);

    // Sans constat il n'y a rien à confirmer, et sans passage complet connu personne
    // pour le confirmer : dans les deux cas on ne conclut pas.
    expect(autrePassageCompletDepuis(null, NOCTURNE)).toBe(false);
    expect(autrePassageCompletDepuis(NOCTURNE, null)).toBe(false);
  });

  it("relit sur une fiche l'angle mort dont la collecte n'a rien conclu", () => {
    // Un refus de disparition n'écrit rien : il s'abstient d'écrire, et son seul
    // témoin en base est une dernière vue restée derrière le dernier passage complet.
    // C'est ce que l'écran relit pour dire, au nom d'une personne, ce que la collecte
    // s'est refusée à conclure sur elle.
    const retenue = { source: "BETA" as const, lastSeenAt: VEILLE, vanishedAt: null };
    expect(nonRendueAuDernierPassage(retenue, NOCTURNE)).toBe(true);
    expect(nonRendueAuDernierPassage({ ...retenue, lastSeenAt: NOCTURNE }, NOCTURNE)).toBe(false);

    // Deux exclusions, deux raisons. Une fiche fabriquée à la main n'est réclamée par
    // aucune source amont : sa dernière vue ne bougera plus jamais, et l'annoncer non
    // rendue à chaque passage ferait de l'alerte un décor. Une fiche déjà datée
    // disparue relève du constat de sortie, qui dit la même chose en disant quoi faire.
    expect(nonRendueAuDernierPassage({ ...retenue, source: "LOCAL" }, NOCTURNE)).toBe(false);
    expect(nonRendueAuDernierPassage({ ...retenue, vanishedAt: VEILLE }, NOCTURNE)).toBe(false);
  });
});

describe("vague d'arrivées d'un relevé à l'autre", () => {
  const PART_MAX = 0.2;

  it("laisse passer une rentrée ordinaire, et retient le bras devant une vague", () => {
    // Trois arrivées sur douze personnes franchissent la part sans rien signifier :
    // sur un périmètre étroit, une rentrée de septembre y suffit, et refuser d'en
    // conclure ferait taire la détection au moment précis où elle sert.
    expect(arriveeMassive(12, 3, PART_MAX)).toBe(false);
    expect(arriveeMassive(12, PLANCHER_ARRIVEES - 1, PART_MAX)).toBe(false);

    // Vingt-cinq arrivées d'un coup sur quatre-vingt-quinze ne ressemblent à aucune
    // rentrée : une source qui rend d'un coup un périmètre plus large ressemble trait
    // pour trait à une arrivée collective, et ouvrir vingt-cinq dossiers au nom de
    // gens en poste depuis des mois coûte la crédibilité de la file.
    expect(arriveeMassive(95, 25, PART_MAX)).toBe(true);

    // Le plancher franchi, c'est la part qui décide, à l'unité près.
    expect(arriveeMassive(95, 19, PART_MAX)).toBe(false);
    expect(arriveeMassive(95, 20, PART_MAX)).toBe(true);
  });

  it("ne soupçonne rien faute de périmètre connu", () => {
    // Première collecte : tout est nouveau, et rien de tout cela n'est une vague.
    expect(arriveeMassive(0, 1, PART_MAX)).toBe(false);
    expect(arriveeMassive(0, 208, PART_MAX)).toBe(false);
  });

  it("reste la symétrique exacte de la chute sur les mêmes nombres", () => {
    // Les deux garde-fous se lisent ensemble ou ne se lisent pas : l'un refuse de
    // conclure quand le périmètre fond, l'autre quand il enfle, et un périmètre
    // stable ne déclenche ni l'un ni l'autre.
    expect(chuteExcessive(95, 70, PART_MAX)).toBe(true);
    expect(arriveeMassive(95, 70, PART_MAX)).toBe(true);

    expect(chuteExcessive(95, 90, PART_MAX)).toBe(false);
    expect(arriveeMassive(95, 6, PART_MAX)).toBe(false);

    expect(chuteExcessive(0, 12, PART_MAX)).toBe(false);
    expect(arriveeMassive(0, 12, PART_MAX)).toBe(false);
  });
});

/**
 * L'écran d'une personne ne distingue pas « aucun compte » de « pas regardé ». Un
 * système qui a cessé d'être lu laisse donc les fiches affirmer, sur l'écran même où
 * se décide une coupure, quelque chose que plus rien ne vérifie.
 */
describe("systèmes cibles dont on ne peut plus dire qu'on les regarde", () => {
  const MAINTENANT = new Date("2026-08-18T09:00:00Z");
  const SEUIL = 48;
  const ATTENDUS = ["github", "notion"];

  const releve = (over: Partial<ReleveSysteme> = {}): ReleveSysteme => ({
    provider: "github",
    startedAt: new Date("2026-08-18T03:00:00Z"),
    status: "OK",
    ...over,
  });

  it("se tait quand tous les systèmes ont été lus cette nuit", () => {
    const releves = [releve(), releve({ provider: "notion" })];

    expect(systemesMuets(releves, ATTENDUS, MAINTENANT, SEUIL)).toEqual([]);
  });

  it("signale l'échec, le silence prolongé, le jamais-lu et le non-lu, chacun pour ce qu'il est", () => {
    // Given github qui échoue, notion lu il y a cinq jours, et un troisième système
    // attendu dont aucune trace n'existe
    const releves = [
      releve({ status: "FAILED" }),
      releve({ provider: "notion", startedAt: new Date("2026-08-13T03:00:00Z") }),
    ];

    // When on demande l'état de trois systèmes attendus
    const muets = systemesMuets(releves, [...ATTENDUS, "ovh"], MAINTENANT, SEUIL);

    // Then chacun est signalé avec sa raison, sans être confondu avec les autres
    expect(muets).toEqual([
      { provider: "github", raison: "echec", heures: null },
      { provider: "notion", raison: "perime", heures: 126 },
      { provider: "ovh", raison: "non-lu", heures: null },
    ]);
  });

  it("compte un système annoncé comme non lu, plutôt que de le tenir pour sain", () => {
    // Un credential absent produit une trace SKIPPED : elle dit qu'on n'a pas
    // regardé, ce qui est précisément ce que l'écran doit reprendre. La taire
    // reviendrait à traiter l'absence d'observation comme une absence d'écart.
    const muets = systemesMuets([releve({ status: "SKIPPED" })], ["github"], MAINTENANT, SEUIL);

    expect(muets).toEqual([{ provider: "github", raison: "non-lu", heures: null }]);
  });

  it("tolère un relevé partiel récent, qui reste une observation", () => {
    // Un run partiel a vu quelque chose et l'a dit : il n'a simplement pas conclu
    // sur les disparitions. Le signaler ici doublerait un avertissement déjà donné.
    expect(systemesMuets([releve({ status: "PARTIAL" })], ["github"], MAINTENANT, SEUIL)).toEqual(
      [],
    );
  });
});

/**
 * Ce qu'une identité laisse en base est une liste courte et délibérée. Ce test la
 * fixe, y compris ce qu'elle ne contient pas : sans lui, un champ collecté puis jeté
 * se découvre le jour où quelqu'un compte dessus.
 */
describe("ce qu'une identité collectée laisse en base", () => {
  const MAINTENANT = new Date("2026-08-21T09:00:00Z");

  it("garde les métadonnées dans leur ordre, et laisse dehors ce qui n'est pas persisté", () => {
    const constates = champsConstates(
      {
        externalId: "42",
        idKind: "opaque",
        handle: "camille.rivet",
        emails: ["camille.rivet@exemple.org"],
        lastActivityAt: new Date("2026-08-01T00:00:00Z"),
        details: [
          { label: "Type de compte", value: "robot" },
          { label: "Invitée par", value: "alex.dupuis" },
        ],
      },
      MAINTENANT,
    );

    expect(constates.details).toEqual([
      { label: "Type de compte", value: "robot" },
      { label: "Invitée par", value: "alex.dupuis" },
    ]);
    expect(constates.handle).toBe("camille.rivet");
    expect(constates.idKind).toBe("OPAQUE");
    expect(constates.lastSeenAt).toBe(MAINTENANT);
    expect(constates.vanishedAt).toBeNull();

    // Collectés et non persistés, délibérément : écrire les adresses changerait
    // l'issue du rapprochement sur le parc, une ressemblance devenant une
    // correspondance, donc une identité révocable.
    expect(constates).not.toHaveProperty("emails");
    expect(constates).not.toHaveProperty("lastActivityAt");

    // Le dernier état constaté écrase, absence comprise : une métadonnée que le
    // connecteur ne sait plus écrire ne survit pas à la collecte qui l'a tue.
    const sansRien = champsConstates(
      { externalId: "42", idKind: "opaque", handle: "camille.rivet" },
      MAINTENANT,
    );

    expect(sansRien.details).toBeNull();
  });

  it("tient une chute de ressources pour aussi suspecte qu'une chute de comptes", () => {
    // Un accès porte sur une ressource : une liste d'équipes rendue vide par un
    // incident du fournisseur emporterait tous les accès qu'elles portaient, sur un
    // run par ailleurs vert, et le décompte des comptes ne verrait rien.
    expect(chuteExcessive(20, 1, 0.2)).toBe(true);
    expect(chuteExcessive(20, 0, 0.2)).toBe(true);
    expect(chuteExcessive(20, 19, 0.2)).toBe(false);

    // Une première collecte n'est pas une chute, ici comme pour les comptes.
    expect(chuteExcessive(0, 0, 0.2)).toBe(false);
  });
});

describe("un garde-fou qui refuse toujours la même chose n'annonce plus un incident", () => {
  it("compte les répétitions à l'identique, et s'arrête au premier passage qui diffère", () => {
    // Le cas réel : un connecteur a cessé d'émettre une famille de ressources, la
    // chute que leur absence provoque dépasse le seuil, et le refus de dater empêche
    // de nettoyer ce qui provoque la chute. Le même refus retombe donc chaque nuit,
    // avec exactement les mêmes nombres.
    const refus: RefusDeDatation = { famille: "ressources", observe: 33, reference: 65 };
    const memeRefus = { ...refus };

    expect(refusRepete(refus, [memeRefus, memeRefus, memeRefus])).toBe(4);
    expect(chuteInstallee(refusRepete(refus, [memeRefus, memeRefus]))).toBe(true);

    // Deux passages ne suffisent pas à conclure : une lecture peut échouer deux fois
    // pour une raison qui passera.
    expect(chuteInstallee(refusRepete(refus, []))).toBe(false);
    expect(chuteInstallee(refusRepete(refus, [memeRefus]))).toBe(false);

    // Un passage sans refus, et le compte repart : c'est ce qui distingue l'état
    // stable de la série d'incidents.
    expect(refusRepete(refus, [memeRefus, null, memeRefus])).toBe(2);
    expect(refusRepete(refus, [null])).toBe(1);
  });

  it("ne confond ni deux familles, ni deux chutes de tailles différentes", () => {
    const surLesRessources: RefusDeDatation = { famille: "ressources", observe: 33, reference: 65 };

    // Une chute des identités et une chute des ressources sont deux verrous distincts :
    // les additionner ferait passer pour installée une situation qui change de nature
    // d'un passage à l'autre.
    expect(
      refusRepete(surLesRessources, [{ famille: "identites", observe: 33, reference: 65 }]),
    ).toBe(1);

    // Des nombres qui bougent décrivent une situation qui bouge, donc un incident en
    // cours, pas un état que le refus entretient.
    expect(refusRepete(surLesRessources, [{ ...surLesRessources, observe: 34 }])).toBe(1);
    expect(refusRepete(surLesRessources, [{ ...surLesRessources, reference: 64 }])).toBe(1);

    // Et le seuil reste celui du noyau, jamais recopié chez l'appelant.
    expect(chuteInstallee(2)).toBe(false);
    expect(chuteInstallee(3)).toBe(true);
  });
});

describe("les blocages que l'écran doit annoncer plutôt que de les laisser au journal", () => {
  it("ne retient que ce qui refuse depuis assez longtemps, par système et par famille", () => {
    const refus = (famille: string, observe: number, reference: number) => ({
      messages: ["peu importe"],
      refus: [{ famille, observe, reference }],
    });

    // Given trois systèmes : l'un bloqué sur ses ressources depuis quatre passages,
    // l'un qui vient seulement de refuser, l'un qui a refusé puis s'est dénoué.
    const blocages = blocagesInstalles([
      { provider: "github", error: refus("ressources", 33, 65) },
      { provider: "github", error: refus("ressources", 33, 65) },
      { provider: "github", error: refus("ressources", 33, 65) },
      { provider: "github", error: refus("ressources", 33, 65) },
      { provider: "notion", error: refus("identites", 4, 40) },
      { provider: "notion", error: null },
      { provider: "ovh", error: null },
      { provider: "ovh", error: refus("identites", 2, 30) },
      { provider: "ovh", error: refus("identites", 2, 30) },
      { provider: "ovh", error: refus("identites", 2, 30) },
    ]);

    // Then seul le premier est annoncé : les deux autres sont un incident en cours et
    // une situation déjà passée.
    expect(blocages).toHaveLength(1);
    expect(blocages[0]).toMatchObject({
      provider: "github",
      famille: "ressources",
      observe: 33,
      reference: 65,
      repetitions: 4,
    });

    // Un système peut être bloqué sur les deux familles à la fois, et l'écran doit
    // alors le dire deux fois : les deux verrous se lèvent séparément.
    const deuxVerrous = blocagesInstalles([
      {
        provider: "github",
        error: {
          messages: [],
          refus: [
            { famille: "identites", observe: 5, reference: 60 },
            { famille: "ressources", observe: 33, reference: 65 },
          ],
        },
      },
      ...Array.from({ length: 3 }, () => ({
        provider: "github",
        error: {
          messages: [],
          refus: [
            { famille: "identites", observe: 5, reference: 60 },
            { famille: "ressources", observe: 33, reference: 65 },
          ],
        },
      })),
    ]);

    expect(deuxVerrous.map((blocage) => blocage.famille)).toEqual(["identites", "ressources"]);

    // Et une trace sans refus structuré, comme celles d'avant ce mécanisme, ne fait
    // rien croire : elle se lit comme une absence de blocage, pas comme un blocage.
    expect(
      blocagesInstalles([{ provider: "github", error: { messages: ["ancienne forme"] } }]),
    ).toEqual([]);
    expect(blocagesInstalles([])).toEqual([]);
  });
});

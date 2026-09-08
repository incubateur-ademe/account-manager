import { describe, expect, it } from "vitest";

import {
  ageDuReleve,
  ageDuReleveDeLaTrace,
  arriveeMassive,
  autrePassageCompletDepuis,
  blocagesInstalles,
  champsConstates,
  chuteExcessive,
  chuteInstallee,
  estFamilleDeChute,
  fichesSansReponse,
  fraicheurDe,
  nonRendueAuDernierPassage,
  PLANCHER_ARRIVEES,
  type RefusDeDatation,
  type ReleveSysteme,
  refusRepete,
  releveFige,
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

  it("sépare l'angle mort dont une sortie viendra de celui dont elle ne viendra pas", () => {
    // Le prédicat du dessus ne distingue pas les deux façons de ne pas lire une fiche,
    // et rien en base ne les distingue non plus : une dernière vue restée en arrière
    // vaut pour les deux. Or la suite n'est pas la même, un aveu d'ignorance finissant
    // par valoir départ quand une lecture qui échoue n'y mène jamais. Le passage écrit
    // donc les secondes en clair dans sa trace, et c'est ce que l'écran d'une personne
    // relit avant de lui promettre quoi que ce soit.
    const trace = {
      messages: ["fiches sans réponse : dominique.exemple ; aucune disparition datée"],
      sansReponse: ["dominique.exemple"],
    };

    expect(fichesSansReponse(trace)).toEqual(["dominique.exemple"]);
    expect(fichesSansReponse(trace).includes("camille.exemple")).toBe(false);

    // Une trace sans la clé est le cas de tous les passages ordinaires, et celui de
    // tous ceux d'avant cette règle : elle ne retient personne, elle ne se relit pas
    // comme un doute. Les formes que la colonne Json peut prendre sans que rien ne
    // l'ait promis sont traitées pareil, jusqu'au nom qui n'est pas une chaîne : la
    // lire ici plutôt que chez l'appelant est ce qui garantit qu'aucun écran ne
    // trébuche sur une trace écrite par une version antérieure.
    expect(fichesSansReponse({ messages: ["retours non datés : elias.exemple"] })).toEqual([]);
    expect(fichesSansReponse(null)).toEqual([]);
    expect(fichesSansReponse(undefined)).toEqual([]);
    expect(fichesSansReponse("fiches sans réponse : dominique.exemple")).toEqual([]);
    expect(fichesSansReponse({ sansReponse: "dominique.exemple" })).toEqual([]);
    expect(fichesSansReponse({ sansReponse: ["dominique.exemple", 42, null] })).toEqual([
      "dominique.exemple",
    ]);
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
      passages: 4,
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

    // Le plancher du périmètre est examiné comme les deux autres, mais son installation
    // ne se compte pas comme la leur : elle se lit sur l'âge du relevé, que le passage
    // porte dans la même trace que son refus. Le cas est repris en propre juste après.
    expect(
      blocagesInstalles(
        Array.from({ length: 3 }, (_, rang) => ({
          provider: "espace-membre",
          error: {
            messages: [],
            ageDuReleve: 3 - rang,
            refus: [{ famille: "perimetre", observe: 9, reference: 13 }],
          },
        })),
      ),
    ).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        observe: 9,
        reference: 13,
        passages: 3,
      },
    ]);

    // Et le seul chemin par lequel on en sorte reconnaît les mêmes familles que
    // l'écran qui les annonce : une famille annoncée en tête d'écran et refusée par
    // l'action qui la reçoit laisserait un bouton qui rend une erreur.
    expect(["identites", "ressources", "perimetre"].every(estFamilleDeChute)).toBe(true);
    expect(estFamilleDeChute("startups")).toBe(false);
    expect(estFamilleDeChute("")).toBe(false);

    // Et une trace sans refus structuré, comme celles d'avant ce mécanisme, ne fait
    // rien croire : elle se lit comme une absence de blocage, pas comme un blocage.
    expect(
      blocagesInstalles([{ provider: "github", error: { messages: ["ancienne forme"] } }]),
    ).toEqual([]);
    expect(blocagesInstalles([])).toEqual([]);
  });

  it("lit l'installation du plancher du périmètre sur l'âge du relevé, jamais sur ses refus identiques", () => {
    const CHUTE = { famille: "perimetre", observe: 9, reference: 13 } as const;
    /** Une nuit où le plancher a refusé : elle porte son refus et l'âge du relevé. */
    const refuse = (age: number) => ({ messages: [], ageDuReleve: age, refus: [CHUTE] });
    /** Une nuit dégradée par une autre porte : le plancher n'y a pas eu son tour. */
    const autrePorte = (age: number) => ({
      messages: ["membres de l'incubateur : élément 4 illisible (username requis)"],
      ageDuReleve: age,
    });

    // Given une chute réelle tenue toutes les nuits, et une nuit dégradée par une autre
    // porte au milieu de la série. Cette nuit-là n'écrit aucun refus : le compte des
    // refus identiques repart de zéro et n'atteindra jamais le seuil tant que le motif
    // dure, alors que rien de ce qui s'adosse au relevé n'a repris la main entre-temps.
    const casse = [
      { provider: "espace-membre", error: refuse(4) },
      { provider: "espace-membre", error: autrePorte(3) },
      { provider: "espace-membre", error: refuse(2) },
      { provider: "espace-membre", error: refuse(1) },
    ];
    expect(refusRepete(CHUTE, [null, CHUTE, CHUTE])).toBe(1);

    // Then la sortie s'offre quand même, et le nombre annoncé est celui du relevé : ce
    // qu'un opérateur doit trancher est que ce relevé-là ne reviendra pas seul, et non
    // qu'un refus s'est répété.
    expect(blocagesInstalles(casse)).toEqual([
      { provider: "espace-membre", famille: "perimetre", observe: 9, reference: 13, passages: 4 },
    ]);

    // Then un refus qui vient de retomber pour la première fois sur un relevé déjà vieux
    // est installé, parce que c'est le relevé qui l'est.
    expect(
      blocagesInstalles([
        { provider: "espace-membre", error: refuse(9) },
        { provider: "espace-membre", error: autrePorte(8) },
      ]),
    ).toMatchObject([{ passages: 9 }]);

    // Then en deçà du seuil, rien : le relevé d'hier n'est pas un gel, et un bandeau
    // posé au premier incident d'une nuit cesse d'être lu.
    expect(blocagesInstalles([{ provider: "espace-membre", error: refuse(2) }])).toEqual([]);

    // Then sans refus du soir, rien non plus, quel que soit l'âge : le plancher n'est
    // pas l'obstacle de cette nuit-là, lever le plancher ne renouvellerait pas le
    // relevé, et la décision attendrait un refus que personne n'a prononcé.
    expect(
      blocagesInstalles([
        { provider: "espace-membre", error: autrePorte(12) },
        { provider: "espace-membre", error: refuse(11) },
      ]),
    ).toEqual([]);

    // Then les systèmes cibles gardent la leur, et l'âge du relevé ne les regarde pas :
    // ce qu'ils comparent est un décompte de lignes vivantes en base, qui se corrige de
    // lui-même dès qu'une datation passe, et leur trace ne porte d'ailleurs aucun âge.
    expect(
      blocagesInstalles([
        {
          provider: "github",
          error: {
            messages: [],
            ageDuReleve: 12,
            refus: [{ famille: "ressources", observe: 33, reference: 65 }],
          },
        },
      ]),
    ).toEqual([]);

    // Then et une trace qui porterait un refus du périmètre sans âge ne se lit pas comme
    // un gel. Aucun passage n'en écrit : celui qui refuse porte les deux dans la même
    // trace, et les traces d'avant ce mécanisme ne portaient pas de refus du périmètre
    // du tout. C'est la règle de lecture qui se grave ici, pas un scénario.
    expect(
      blocagesInstalles(
        Array.from({ length: 4 }, () => ({
          provider: "espace-membre",
          error: { messages: [], refus: [CHUTE] },
        })),
      ),
    ).toEqual([]);
  });
});

describe("l'âge du relevé contre lequel le périmètre décide", () => {
  it("compte les passages qui ne l'ont pas renouvelé, sans regarder pourquoi", () => {
    // Given une nuit ratée sur un enregistrement illisible, puis une nuit ratée par le
    // plancher de chute, puis une panne qui porte le passage en échec. Trois causes qui
    // n'ont rien à voir, un seul effet : le dernier passage complet n'avance plus.
    // Compter les répétitions d'un refus nommé serait reparti de zéro à chaque
    // changement de cause, alors que rien de ce qui s'adosse au relevé n'a reprivilégié
    // l'état du jour entre-temps.
    expect(ageDuReleve(["FAILED", "PARTIAL", "PARTIAL", "OK", "PARTIAL", "OK"])).toBe(3);

    // Then un passage complet n'a pas d'âge à annoncer : il est le relevé.
    expect(ageDuReleve(["OK", "PARTIAL", "PARTIAL", "OK"])).toBe(0);

    // Then une seule nuit se compte comme une seule nuit, et c'est la distinction que
    // tout ce mécanisme existe pour rendre lisible.
    expect(ageDuReleve(["PARTIAL", "OK"])).toBe(1);

    // Then un système annoncé comme non lu ne renouvelle pas le relevé mieux qu'un
    // échec : c'est le statut qui borne la référence, pas la gravité.
    expect(ageDuReleve(["PARTIAL", "SKIPPED", "OK"])).toBe(2);

    // Then sans aucun passage complet dans ce qu'on a lu, le compte est celui de ce
    // qu'on a lu. L'appelant borne sa lecture par le relevé lui-même pour que ce cas
    // ne se produise pas, et il n'y a rien à annoncer avant le premier relevé.
    expect(ageDuReleve(["PARTIAL", "PARTIAL"])).toBe(2);
    expect(ageDuReleve([])).toBe(0);
  });

  it("ne parle d'un gel qu'au seuil où la chute cesse d'être un incident", () => {
    // Deux passages ne suffisent pas : une nuit se rate pour une raison qui passera, et
    // un avertissement posé sur toutes les fiches à chaque incident cesse d'être lu.
    expect(releveFige(1)).toBe(false);
    expect(releveFige(2)).toBe(false);

    // Le seuil est celui du noyau, le même que la chute installée, jamais recopié chez
    // un appelant : l'écran d'une personne et la trace d'un passage ne peuvent pas
    // cesser de s'accorder sur le moment où ce n'est plus un incident.
    expect(releveFige(3)).toBe(true);
    expect(chuteInstallee(3)).toBe(true);
    expect(releveFige(40)).toBe(true);
    expect(releveFige(0)).toBe(false);
  });

  it("relit dans la trace le compte que le passage y a porté, et rien d'autre", () => {
    // Le passage seul connaît son statut au moment où il conclut : l'écran relit son
    // compte plutôt que de le recalculer, faute de quoi il devrait deviner le sort du
    // passage en cours.
    expect(ageDuReleveDeLaTrace({ messages: ["peu importe"], ageDuReleve: 4 })).toBe(4);

    // Une trace d'avant ce mécanisme, une trace d'un passage complet, un run encore
    // ouvert et une forme inattendue se lisent tous comme une absence de compte, jamais
    // comme un gel : c'est l'écran d'une personne qui les relit, et il y annonce que
    // plus rien n'est constaté.
    expect(ageDuReleveDeLaTrace({ messages: ["ancienne forme"] })).toBeNull();
    expect(ageDuReleveDeLaTrace(null)).toBeNull();
    expect(ageDuReleveDeLaTrace(undefined)).toBeNull();
    expect(ageDuReleveDeLaTrace({ ageDuReleve: "4" })).toBeNull();
    expect(ageDuReleveDeLaTrace("relevé non renouvelé")).toBeNull();
  });
});

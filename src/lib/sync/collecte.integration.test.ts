import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { CollectResult, Connector } from "@/core/connector";
import { prisma } from "@/lib/db";
import { executerCollecte, nouvelleExecution } from "@/lib/sync/collecte";
import { politiqueJetable } from "@/test/politique-jetable";

/**
 * Le garde-fou de chute, exercé contre une vraie base.
 *
 * Il décide de la seule écriture irréversible de cet outil : poser une date de
 * disparition sur un compte, c'est déclarer que quelqu'un est parti.
 *
 * Ce qui ne se tient pas plus bas tient en une phrase. `ressourcesTenuesPourVivantes`
 * compte les ressources par les accès qu'elles portent encore, à travers la relation
 * `grants: { some: { vanishedAt: null } }`, et un double qui réimplémenterait cette
 * jointure vérifierait sa propre jointure. C'est l'assertion « référence de trois et
 * non de quatre » qui porte tout ce fichier : la quatrième équipe existe, mais son
 * dernier accès est daté, et la compter ferait grossir la référence à chaque équipe
 * supprimée jusqu'à déclencher le garde-fou sur une collecte parfaitement saine.
 *
 * Une seule histoire, deux nuits, parce que la garantie est une suite : ce qu'une nuit
 * refuse de conclure, la suivante doit pouvoir le conclure sans que le refus d'hier ne
 * gèle quoi que ce soit.
 */

politiqueJetable("collecte-integration");

const PROVIDER = "atelier";
/**
 * Un second système, que cette collecte ne lit pas et qu'elle ne doit pas toucher.
 *
 * Sans lui, retirer `provider` de n'importe laquelle des clauses de `collecte.ts`
 * laisse ce fichier entièrement vert : un semis à un seul système ne peut pas voir
 * une requête qui déborde. C'est pourtant la faute la plus chère que cet étage
 * puisse attraper, dix-neuf systèmes en production et une nuit qui daterait tout le
 * monde partout.
 */
const VOISIN = "atelier-voisin";
/** Les départs d'un autre âge, que rien de ce qui suit ne doit redater. */
const MARS = new Date("2026-03-01T02:00:00Z");
const NUIT_1 = new Date("2026-08-24T02:00:00Z");
const NUIT_2 = new Date("2026-08-25T02:00:00Z");

/** Un connecteur dont la lecture est décidée par le scénario, et rien d'autre. */
function connecteurQuiLit(releve: () => CollectResult): Connector {
  return {
    contract: {
      key: PROVIDER,
      label: "Atelier",
      criticality: "low",
      runbook: "Lire la console de l'atelier.",
      accountSlug: ({ handle }) => handle,
      credentials: [],
      capabilities: { list: [{ requires: [], tier: "auto" }] },
      scopeSchema: z.object({}),
    },
    probe: () => Promise.resolve([]),
    plan: () => Promise.resolve([]),
    list: () => Promise.resolve(releve()),
  };
}

function compte(externalId: string) {
  return { externalId, idKind: "opaque" as const, handle: externalId };
}

/**
 * Dix comptes, quatre équipes, et de quoi distinguer les deux façons de compter.
 *
 * Aucune fiche de personne : `personId` est nullable et aucune des trois tables ne
 * pointe vers `Person`, si bien que ce scénario n'a besoin d'inventer personne. C'est
 * ce qui le rend le moins cher de tous ceux que le relevé des doubles a proposés.
 *
 * La quatrième équipe est le cœur du semis : elle existe, mais son unique accès est
 * daté depuis mars. Comptée par son existence elle vaudrait un de plus, comptée par
 * les accès qu'elle porte encore elle ne vaut rien, et c'est toute la différence entre
 * un garde-fou qui se déclenche et un garde-fou qui dort.
 */
async function semer(): Promise<void> {
  for (const rang of [1, 2, 3, 4, 5, 6]) {
    await prisma.externalIdentity.create({
      data: {
        provider: PROVIDER,
        externalId: `parti-${rang}`,
        handle: `parti-${rang}`,
        vanishedAt: MARS,
      },
    });
  }
  for (const rang of [1, 2, 3, 4]) {
    await prisma.externalIdentity.create({
      data: { provider: PROVIDER, externalId: `compte-${rang}`, handle: `compte-${rang}` },
    });
    await prisma.resource.create({
      data: { provider: PROVIDER, externalId: `equipe-${rang}`, label: `Équipe ${rang}` },
    });
  }

  for (const rang of [1, 2, 3]) {
    await prisma.accessGrant.create({
      data: {
        role: "membre",
        externalIdentity: {
          connect: { provider_externalId: { provider: PROVIDER, externalId: `compte-${rang}` } },
        },
        resource: {
          connect: { provider_externalId: { provider: PROVIDER, externalId: `equipe-${rang}` } },
        },
      },
    });
  }
  await prisma.accessGrant.create({
    data: {
      role: "membre",
      vanishedAt: MARS,
      externalIdentity: {
        connect: { provider_externalId: { provider: PROVIDER, externalId: "compte-1" } },
      },
      resource: {
        connect: { provider_externalId: { provider: PROVIDER, externalId: "equipe-4" } },
      },
    },
  });

  // Le voisin : cinq comptes vivants et deux équipes qu'un accès porte encore. Les
  // nombres sont choisis pour que leur intrusion se voie. Sur la référence des comptes,
  // quatre deviendrait neuf ; sur celle des équipes, trois deviendrait cinq ; et la
  // datation du soir emporterait cinq comptes de plus, aucun d'eux n'étant dans ce que
  // la collecte a vu.
  for (const rang of [1, 2, 3, 4, 5]) {
    await prisma.externalIdentity.create({
      data: { provider: VOISIN, externalId: `voisin-${rang}`, handle: `voisin-${rang}` },
    });
  }
  for (const rang of [1, 2]) {
    await prisma.resource.create({
      data: { provider: VOISIN, externalId: `atelier-${rang}`, label: `Atelier ${rang}` },
    });
    await prisma.accessGrant.create({
      data: {
        role: "membre",
        externalIdentity: {
          connect: { provider_externalId: { provider: VOISIN, externalId: `voisin-${rang}` } },
        },
        resource: {
          connect: { provider_externalId: { provider: VOISIN, externalId: `atelier-${rang}` } },
        },
      },
    });
  }
}

const dateDe = async (externalId: string): Promise<Date | null> =>
  (
    await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_externalId: { provider: PROVIDER, externalId } },
      select: { vanishedAt: true },
    })
  ).vanishedAt;

/** Bornés au système collecté : le voisin a les siens, et ils se comptent à part. */
const accesVivants = () =>
  prisma.accessGrant.count({
    where: { vanishedAt: null, externalIdentity: { provider: PROVIDER } },
  });

describe("le garde-fou de chute, contre une vraie base", () => {
  beforeEach(semer);

  it("ne date personne la nuit où la moitié du parc manque, puis date les comptes sans toucher aux accès", async () => {
    // Given un système qui tient quatre comptes vivants et trois équipes encore
    // portées par un accès, plus six départs de mars et une équipe éteinte que
    // personne ne doit ressusciter.
    expect(
      await prisma.externalIdentity.count({ where: { provider: PROVIDER, vanishedAt: null } }),
    ).toBe(4);
    expect(await accesVivants()).toBe(3);

    // When une première nuit ne rend que deux des quatre comptes vivants. Le seuil de
    // chute vaut deux dixièmes, donc le plancher est à trois : deux passent dessous.
    const premiere = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: 2,
        identities: [compte("compte-1"), compte("compte-2")],
        resources: [1, 2, 3, 4].map((rang) => ({
          externalId: `equipe-${rang}`,
          label: `Équipe ${rang}`,
        })),
        grants: [1, 2].map((rang) => ({
          identityExternalId: `compte-${rang}`,
          resourceExternalId: `equipe-${rang}`,
          role: "membre",
        })),
      })),
      NUIT_1,
      nouvelleExecution(),
    );

    // Then elle refuse de conclure, et elle annonce la référence sur laquelle elle a
    // refusé : quatre, le nombre de comptes tenus pour vivants, et non dix, le nombre
    // de lignes du système. C'est cette lecture que le double voisin rejoue à la main.
    expect(premiere.status).toBe("PARTIAL");
    expect(premiere.refus).toEqual([{ famille: "identites", observe: 2, reference: 4 }]);

    // Then rien n'a été daté, ni les comptes ni les accès : un passage qui doute ne
    // conclut pas.
    expect(premiere.identites.disparues).toBe(0);
    expect(premiere.acces.disparus).toBe(0);
    expect(await dateDe("compte-3")).toBeNull();
    expect(await dateDe("compte-4")).toBeNull();

    // Then et il ne redate pas non plus ce qui l'était déjà : les six départs de mars
    // portent toujours mars. C'est la colonne qui dit depuis quand une personne est
    // partie, et l'écraser à chaque passage la rendrait muette.
    expect(await dateDe("parti-1")).toEqual(MARS);

    // Then le refus survit à l'aller-retour en base, sous la forme que le passage
    // suivant relit pour savoir si le même blocage retombe. Un double ne range qu'un
    // objet JavaScript : ici c'est du JSON, relu par Prisma.
    const traceDeLaPremiere = await prisma.syncRun.findFirstOrThrow({
      where: { provider: PROVIDER },
      orderBy: { startedAt: "desc" },
      select: { status: true, error: true },
    });
    expect(traceDeLaPremiere.status).toBe("PARTIAL");
    expect(traceDeLaPremiere.error).toMatchObject({
      refus: [{ famille: "identites", observe: 2, reference: 4 }],
    });

    // When la nuit suivante en rend trois sur quatre, ce qui touche le plancher sans
    // le franchir, mais ne rend plus qu'une équipe sur les trois encore portées.
    const seconde = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: 3,
        identities: [compte("compte-1"), compte("compte-2"), compte("compte-3")],
        resources: [{ externalId: "equipe-1", label: "Équipe 1" }],
        grants: [
          { identityExternalId: "compte-1", resourceExternalId: "equipe-1", role: "membre" },
        ],
      })),
      NUIT_2,
      nouvelleExecution(),
    );

    // Then les deux verrous se sont séparés, et c'est le comportement que rien
    // d'autre dans ce dépôt n'exerce. Celui des comptes s'ouvre, celui des accès se
    // ferme : une chute des équipes ne dit rien de la personne dont le compte vient de
    // s'éteindre, et les coupler laissait la seconde geler la première.
    expect(seconde.refus).toEqual([{ famille: "ressources", observe: 1, reference: 3 }]);

    // Then la référence des équipes vaut trois et non quatre : la quatrième existe
    // toujours, mais son dernier accès est daté depuis mars. Une ressource se compte
    // par ce qu'elle porte encore, sans quoi chaque équipe supprimée ferait grossir la
    // référence jusqu'à déclencher le garde-fou sur une collecte parfaitement saine.
    expect(seconde.status).toBe("PARTIAL");

    // Then le compte que la nuit n'a pas revu est daté, une fois, à la date de la nuit.
    expect(seconde.identites.disparues).toBe(1);
    expect(await dateDe("compte-4")).toEqual(NUIT_2);
    expect(await dateDe("compte-3")).toBeNull();

    // Then et aucun accès ne l'est, alors même que deux des trois n'ont pas été revus :
    // c'est le verrou des ressources qui les protège, et il tient.
    expect(seconde.acces.disparus).toBe(0);
    expect(await accesVivants()).toBe(3);

    // Then les six départs de mars portent toujours mars, après deux passages dont un
    // qui a daté. C'est la seule assertion qui tienne la clause de vie de l'écriture,
    // celle que le double voisin ajoute de son propre chef au lieu de la recevoir.
    const redates = await prisma.externalIdentity.count({
      where: {
        provider: PROVIDER,
        externalId: { startsWith: "parti-" },
        vanishedAt: { not: MARS },
      },
    });
    expect(redates).toBe(0);

    // Then le système voisin ressort intact, alors que rien de ce que la collecte a lu
    // ne le nomme : ses cinq comptes vivent toujours, et ses deux accès aussi. C'est la
    // seule assertion qui tienne la borne des requêtes au système collecté.
    const voisinsVivants = await prisma.externalIdentity.count({
      where: { provider: VOISIN, vanishedAt: null },
    });
    expect(voisinsVivants).toBe(5);
    const accesDuVoisin = await prisma.accessGrant.count({
      where: { vanishedAt: null, externalIdentity: { provider: VOISIN } },
    });
    expect(accesDuVoisin).toBe(2);
  });
});

/**
 * La contenance d'une ressource par une autre, exercée contre une vraie base.
 *
 * C'est la seule garantie de cette feature qui ne se tienne pas plus bas. Le refus d'une
 * contenance malformée se juge sur le relevé seul et vit dans l'unitaire. Ce qui reste
 * demande une table : `Resource.parentId` pointe vers `Resource.id`, donc vers une ligne
 * dont l'identifiant n'existe qu'une fois l'écriture faite, et un double écrit à la main
 * qui prétendrait poser cette clé étrangère vérifierait sa propre implémentation.
 *
 * Une seule histoire, quatre nuits, parce que la garantie est une suite : la contenance
 * se pose quel que soit l'ordre du relevé, elle ne bouge pas quand rien ne change, elle
 * se retire sans emporter ce qu'elle décorait, et le contenant reste invisible aux deux
 * plateaux du garde-fou de chute.
 */

const NUIT_A = new Date("2026-09-14T02:00:00Z");
const NUIT_B = new Date("2026-09-15T02:00:00Z");
const NUIT_C = new Date("2026-09-16T02:00:00Z");
const NUIT_D = new Date("2026-09-17T02:00:00Z");

/** Le contenant : un projet, qui regroupe des applications et n'ouvre aucun droit par lui-même. */
const PROJET = { externalId: "projet-produit-alpha", label: "Produit Alpha" };
const WEB = { externalId: "produit-alpha-web", label: "Produit Alpha (web)" };
const API = { externalId: "produit-alpha-api", label: "Produit Alpha (api)" };

/**
 * Trois applications qu'aucun projet ne contient.
 *
 * Sans elles, une écriture qui poserait le même contenant sur toute la table passerait
 * inaperçue, et la colonne ne distinguerait plus « contenue par » de « lue dans le même
 * relevé ».
 */
const HORS_PROJET = [
  { externalId: "produit-beta-web", label: "Produit Beta (web)" },
  { externalId: "service-annuaire", label: "Service annuaire" },
  { externalId: "service-paie", label: "Service paie" },
];

const DANS_LE_PROJET = [
  { ...WEB, parentExternalId: PROJET.externalId },
  { ...API, parentExternalId: PROJET.externalId },
];

const COMPTES = ["alpha-1", "alpha-2", "beta-1", "annuaire-1", "paie-1"];

/** Un accès par application, et aucun sur le projet : c'est ce qui rend les deux façons de compter distinguables. */
const TOUS_LES_ACCES = [
  { identityExternalId: "alpha-1", resourceExternalId: WEB.externalId, role: "collaborateur" },
  { identityExternalId: "alpha-2", resourceExternalId: API.externalId, role: "collaborateur" },
  { identityExternalId: "beta-1", resourceExternalId: "produit-beta-web", role: "collaborateur" },
  {
    identityExternalId: "annuaire-1",
    resourceExternalId: "service-annuaire",
    role: "collaborateur",
  },
  { identityExternalId: "paie-1", resourceExternalId: "service-paie", role: "collaborateur" },
];

const ligne = (externalId: string) =>
  prisma.resource.findUniqueOrThrow({
    where: { provider_externalId: { provider: PROVIDER, externalId } },
    select: { id: true, label: true, parentId: true },
  });

describe("la contenance d'une ressource, contre une vraie base", () => {
  it("un contenant et ce qu'il contient arrivent dans le même relevé, dans n'importe quel ordre", async () => {
    // Given un système qui rend six ressources : un projet, les deux applications qu'il
    // contient, et trois applications hors de tout projet. Le relevé annonce le projet en
    // dernier, après les applications qui le nomment, ce que le contrat autorise et que
    // rien ne peut ordonner : un connecteur pagine ce que l'API lui rend.
    const premiere = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: COMPTES.length,
        identities: COMPTES.map(compte),
        resources: [...DANS_LE_PROJET, ...HORS_PROJET, PROJET],
        grants: TOUS_LES_ACCES,
      })),
      NUIT_A,
      nouvelleExecution(),
    );

    // Then tout est passé, et rien n'a été perdu en chemin : six ressources écrites, cinq
    // comptes, cinq accès. Une contenance refusée aurait fait basculer le passage en
    // PARTIAL, et c'est la première chose à écarter avant de lire la colonne.
    expect(premiere.status).toBe("OK");
    expect(premiere.erreurs).toEqual([]);
    expect(premiere.ressources).toBe(6);
    expect(premiere.identites.creees).toBe(5);
    expect(premiere.acces.crees).toBe(5);

    // Then la ligne de chaque application pointe vers celle du projet, alors que le projet
    // n'existait pas encore en base quand son nom a été lu. C'est toute la raison d'être de
    // cette histoire : la clé étrangère se résout sur une table écrite, pas sur une table en
    // cours d'écriture.
    const projet = await ligne(PROJET.externalId);
    const web = await ligne(WEB.externalId);
    const api = await ligne(API.externalId);
    expect(web.parentId).toBe(projet.id);
    expect(api.parentId).toBe(projet.id);

    // Then le projet n'est contenu par rien, et les trois applications hors projet non plus :
    // la contenance suit ce que le connecteur a déclaré, ligne par ligne.
    expect(projet.parentId).toBeNull();
    const orphelines = await prisma.resource.findMany({
      where: { provider: PROVIDER, externalId: { in: HORS_PROJET.map((r) => r.externalId) } },
      select: { parentId: true },
    });
    expect(orphelines).toEqual([{ parentId: null }, { parentId: null }, { parentId: null }]);

    // When la nuit suivante rend le même relevé, mais le projet en premier. Rien n'a changé
    // chez le fournisseur, seul l'ordre de pagination a bougé.
    const seconde = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: COMPTES.length,
        identities: COMPTES.map(compte),
        resources: [PROJET, ...DANS_LE_PROJET, ...HORS_PROJET],
        grants: TOUS_LES_ACCES,
      })),
      NUIT_B,
      nouvelleExecution(),
    );

    // Then rien n'a changé en base : les mêmes lignes, sous les mêmes identifiants, avec la
    // même contenance. Une ligne recréée changerait d'identifiant et emporterait ses accès,
    // et un identifiant qui bouge d'une nuit à l'autre est ce qui fait qu'une décision prise
    // hier ne désigne plus rien aujourd'hui.
    expect(seconde.status).toBe("OK");
    expect(seconde.erreurs).toEqual([]);
    expect(seconde.acces.crees).toBe(0);
    expect(seconde.acces.revus).toBe(5);
    expect(await ligne(PROJET.externalId)).toEqual(projet);
    expect(await ligne(WEB.externalId)).toEqual(web);
    expect(await ligne(API.externalId)).toEqual(api);

    // When la troisième nuit cesse de déclarer la contenance : les six ressources sont
    // toujours là, mais plus aucune ne nomme de contenant. C'est ce qui arrive quand une
    // application sort de son projet, et c'est indiscernable d'un fournisseur qui cesse de
    // rendre le champ, donc ça doit se lire comme un fait constaté.
    const troisieme = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: COMPTES.length,
        identities: COMPTES.map(compte),
        resources: [PROJET, WEB, API, ...HORS_PROJET],
        grants: TOUS_LES_ACCES,
      })),
      NUIT_C,
      nouvelleExecution(),
    );

    // Then la colonne est revenue à nul, et rien d'autre n'a bougé : même identifiant, même
    // libellé, et les accès toujours vivants sur les mêmes lignes. Une contenance n'ouvre
    // aucun droit, la retirer ne doit donc rien coûter à ce qu'elle décorait.
    expect(troisieme.status).toBe("OK");
    expect(troisieme.erreurs).toEqual([]);
    expect(await ligne(WEB.externalId)).toEqual({ ...web, parentId: null });
    expect(await ligne(API.externalId)).toEqual({ ...api, parentId: null });
    expect(troisieme.acces.disparus).toBe(0);
    expect(await accesVivants()).toBe(5);

    // When la quatrième nuit ne rend plus que le projet et ses deux applications, contenance
    // rétablie, et plus aucune des trois autres. Les cinq comptes sont toujours lus : c'est
    // le plateau des ressources qu'on regarde, et une chute des comptes gèlerait tout en
    // amont.
    const quatrieme = await executerCollecte(
      connecteurQuiLit(() => ({
        status: "ok",
        itemsSeen: COMPTES.length,
        identities: COMPTES.map(compte),
        resources: [...DANS_LE_PROJET, PROJET],
        grants: TOUS_LES_ACCES.slice(0, 2),
      })),
      NUIT_D,
      nouvelleExecution(),
    );

    // Then le garde-fou refuse, et ce sont les deux nombres qu'il annonce qui portent la
    // garantie. Observé vaut deux, le relevé sans son contenant, et non trois : compter les
    // lignes du relevé ferait entrer le projet dans le plateau du soir. Référence vaut cinq,
    // les applications qui portent encore un accès, et non six : le projet n'en porte aucun,
    // et le compter gonflerait le plateau de la base. Un contenant qui pèserait d'un seul
    // côté masquerait une chute réelle, donc autoriserait une datation que le garde-fou
    // vient précisément de refuser.
    expect(quatrieme.status).toBe("PARTIAL");
    expect(quatrieme.refus).toEqual([{ famille: "ressources", observe: 2, reference: 5 }]);

    // Then le projet ne porte toujours aucun accès, ce qui est la prémisse de la lecture
    // ci-dessus : sans cette ligne, l'égalité à cinq se lirait comme une coïncidence.
    const accesDuProjet = await prisma.accessGrant.count({
      where: { resource: { provider: PROVIDER, externalId: PROJET.externalId } },
    });
    expect(accesDuProjet).toBe(0);

    // Then la contenance est de retour, sur les mêmes lignes qu'aux trois premières nuits.
    // Elle se repose donc après avoir été retirée, et toujours dans un relevé qui nomme le
    // contenant en dernier.
    expect(await ligne(WEB.externalId)).toEqual(web);
    expect(await ligne(API.externalId)).toEqual(api);

    // Then rien n'a été daté, ni les comptes, tous revus, ni les accès, que le refus
    // protège : trois des cinq n'ont pas été rendus cette nuit et vivent encore.
    expect(quatrieme.identites.disparues).toBe(0);
    expect(quatrieme.acces.disparus).toBe(0);
    expect(await accesVivants()).toBe(5);
  });
});

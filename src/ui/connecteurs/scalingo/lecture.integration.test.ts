import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { lireLeParc } from "./lecture";
import { assemblerLeParc } from "./parc";

/**
 * Ce que l'écran a le droit d'appeler « le parc du dernier constat », contre une vraie
 * base.
 *
 * `Resource` ne porte aucune date de disparition et ses lignes ne s'effacent jamais :
 * seule une relation dit si une application est encore là, et la clause qui la lit
 * traverse deux niveaux pour retenir un projet par ses contenues. Aucun double écrit à
 * la main n'honore cela sans réécrire un moteur, et c'est la seule raison pour laquelle
 * ce scénario descend d'un étage.
 *
 * Ce qui se tient plus haut ne se rejoue pas ici : les phrases sont épinglées sans base
 * dans `redaction.test.ts`, et le rendu de l'écran dans `ecran-scalingo.test.tsx`.
 */

const SYSTEME = "scalingo";
const VOISIN = "github";

const AVANT = new Date("2026-08-01T02:00:00Z");
const HIER = new Date("2026-09-11T02:00:00Z");
const NUIT = new Date("2026-09-12T02:00:00Z");

const PERSONNE = "alix.exemple";

interface Semis {
  externalId: string;
  label: string;
  parent?: string;
  provider?: string;
}

async function ressource({
  externalId,
  label,
  parent,
  provider = SYSTEME,
}: Semis): Promise<string> {
  const creee = await prisma.resource.create({
    data: {
      provider,
      externalId,
      label,
      url: `https://dashboard.exemple.invalid/${externalId}`,
      ...(parent
        ? { parent: { connect: { provider_externalId: { provider, externalId: parent } } } }
        : {}),
    },
    select: { id: true },
  });
  return creee.id;
}

async function acces(
  identite: string,
  ressourceExterne: string,
  role: string,
  vu: Date,
  disparu: Date | null = null,
): Promise<void> {
  await prisma.accessGrant.create({
    data: {
      role,
      lastSeenAt: vu,
      ...(disparu ? { vanishedAt: disparu } : {}),
      externalIdentity: {
        connect: { provider_externalId: { provider: SYSTEME, externalId: identite } },
      },
      resource: {
        connect: { provider_externalId: { provider: SYSTEME, externalId: ressourceExterne } },
      },
    },
  });
}

/**
 * Un parc qui porte les cinq cas d'un coup : une application vivante sous un projet, une
 * morte sous le même, un projet dont plus rien ne vit, une application sans projet de
 * chaque bord, et une dont le seul accès appartient à une identité datée disparue.
 */
async function semer(): Promise<void> {
  await prisma.person.create({
    data: { username: PERSONNE, fullname: "Alix Exemple", source: "BETA" },
  });
  const machine = await prisma.serviceAccount.create({
    data: {
      key: "scalingo-deploiement",
      label: "Déploiement continu",
      provider: SYSTEME,
      purpose: "pousser les mises en production",
      ownerUsername: PERSONNE,
    },
    select: { id: true },
  });

  await prisma.externalIdentity.create({
    data: {
      provider: SYSTEME,
      externalId: "compte-alix",
      handle: "alix.exemple@exemple.invalid",
      lastSeenAt: NUIT,
      matchMethod: "EMAIL_EXACT",
      person: { connect: { username: PERSONNE } },
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider: SYSTEME,
      externalId: "compte-machine",
      handle: "deploiement@exemple.invalid",
      lastSeenAt: HIER,
      matchMethod: "DECLARED",
      serviceAccountId: machine.id,
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider: SYSTEME,
      externalId: "compte-parti",
      handle: "parti@exemple.invalid",
      lastSeenAt: AVANT,
      vanishedAt: AVANT,
    },
  });

  await ressource({ externalId: "projet-vivant", label: "Radar des friches, osc-fr1" });
  await ressource({ externalId: "projet-eteint", label: "Veille des sols, osc-fr1" });
  await ressource({
    externalId: "app-vivante",
    label: "radar-api, osc-fr1",
    parent: "projet-vivant",
  });
  await ressource({
    externalId: "app-morte",
    label: "radar-vieux, osc-fr1",
    parent: "projet-vivant",
  });
  await ressource({
    externalId: "app-eteinte",
    label: "veille-web, osc-fr1",
    parent: "projet-eteint",
  });
  await ressource({ externalId: "app-seule", label: "atlas-web, osc-secnum1" });
  await ressource({ externalId: "app-seule-morte", label: "atlas-vieux, osc-secnum1" });
  await ressource({ externalId: "app-fantome", label: "banc-essai, osc-fr1" });
  await ressource({ externalId: "atelier", label: "Atelier voisin", provider: VOISIN });

  await acces("compte-alix", "app-vivante", "owner", NUIT);
  await acces("compte-machine", "app-vivante", "collaborator", HIER);
  await acces("compte-alix", "app-seule", "owner", NUIT);
  await acces("compte-alix", "app-morte", "owner", AVANT, AVANT);
  await acces("compte-alix", "app-eteinte", "owner", AVANT, AVANT);
  await acces("compte-alix", "app-seule-morte", "owner", AVANT, AVANT);
  // Vivant, mais son détenteur est daté disparu : la ressource reste tenue pour vivante,
  // et aucun accès ne s'y affiche. C'est le seul cas où « aucun accès vivant constaté sur
  // cette application » se lit encore.
  await acces("compte-parti", "app-fantome", "collaborator", AVANT);
}

describe("l'écran ne présente que ce que la dernière collecte a vu", () => {
  beforeEach(semer);

  it("écarte une application que Scalingo ne connaît plus, garde le projet qui en contient une vivante, et nomme le détenteur d'un compte de service", async () => {
    // When l'écran lit la base.
    const { ressources, comptes } = await lireLeParc();

    // Then les quatre applications mortes ne sont plus là, alors que leurs lignes de
    // ressource y sont toujours : rien ne les efface, et sans la clause de vivacité
    // l'écran les daterait de la dernière collecte, qui est justement celle qui ne les a
    // plus vues.
    expect(await prisma.resource.count({ where: { provider: SYSTEME } })).toBe(8);
    expect([...ressources].map((une) => une.label).sort()).toEqual([
      "Radar des friches, osc-fr1",
      "atlas-web, osc-secnum1",
      "banc-essai, osc-fr1",
      "radar-api, osc-fr1",
    ]);

    // And le projet dont plus aucune contenue ne vit s'en va avec elles : il n'ouvrirait
    // qu'un groupe vide.
    expect(ressources.some((une) => une.label.startsWith("Veille des sols"))).toBe(false);

    // And le voisin n'entre pas : la clause de vivacité ne remplace pas celle du système.
    expect(ressources.some((une) => une.label === "Atelier voisin")).toBe(false);

    // And un compte daté disparu n'est pas un détenteur à nommer, alors qu'un compte de
    // service en est un : sa fiche arrive avec lui, sans quoi l'écran ne saurait le
    // nommer que par son adresse.
    expect([...comptes].map((un) => un.handle).sort()).toEqual([
      "alix.exemple@exemple.invalid",
      "deploiement@exemple.invalid",
    ]);
    const machine = comptes.find((un) => un.handle === "deploiement@exemple.invalid");
    expect(machine?.serviceAccount).toEqual({
      key: "scalingo-deploiement",
      label: "Déploiement continu",
    });
    expect(machine?.person).toBeNull();
    expect(machine?.lastSeenAt).toEqual(HIER);

    // When les deux lectures se recollent.
    const { groupes, detenteurs, dernierConstat } = assemblerLeParc(ressources, comptes);

    // Then le projet retenu par sa contenue vivante reste un contenant, et ne contient
    // que ce qui vit : le regroupement tient, et l'application morte n'y figure pas.
    expect(groupes.map((groupe) => groupe.projet)).toEqual(["Radar des friches, osc-fr1", null]);
    expect(groupes[0]?.applications.map((une) => une.libelle)).toEqual(["radar-api, osc-fr1"]);
    expect(groupes[1]?.applications.map((une) => une.libelle)).toEqual([
      "atlas-web, osc-secnum1",
      "banc-essai, osc-fr1",
    ]);

    // And l'application dont le seul accès appartient à une identité disparue reste
    // visible sans détenteur : c'est ce que la phrase de l'absence d'accès dit.
    const fantome = groupes[1]?.applications.find((une) => une.libelle === "banc-essai, osc-fr1");
    expect(fantome?.acces).toEqual([]);

    // And le compte de service refuse le geste pour ce qu'il est, et non pour un
    // isolement : la file des comptes isolés l'exclut par construction.
    const surLApi = groupes[0]?.applications[0]?.acces ?? [];
    expect(surLApi.find((un) => un.handle === "deploiement@exemple.invalid")?.refus).toBe(
      "machine",
    );
    expect(surLApi.find((un) => un.handle === "deploiement@exemple.invalid")?.machine).toEqual({
      cle: "scalingo-deploiement",
      libelle: "Déploiement continu",
    });

    // And la date affichée est celle du plus récent constat de ce qui s'affiche.
    expect(dernierConstat).toEqual(NUIT);
    expect(detenteurs.map((un) => un.handle)).toEqual([
      "alix.exemple@exemple.invalid",
      "deploiement@exemple.invalid",
    ]);
  });

  it("garde un compte constaté quand plus aucun accès ne vit, et le date", async () => {
    // Given une collecte qui n'a plus vu aucun accès, alors que les comptes tiennent.
    await prisma.accessGrant.updateMany({ data: { vanishedAt: NUIT } });

    // When l'écran lit la base.
    const { ressources, comptes } = await lireLeParc();
    const { groupes, detenteurs, dernierConstat } = assemblerLeParc(ressources, comptes);

    // Then plus aucune application ne s'affiche, projets compris : rien n'est vivant.
    expect(ressources).toEqual([]);
    expect(groupes).toEqual([]);

    // And les comptes restent, avec ce que le dernier constat dit d'eux : sans accès à
    // leur nom.
    expect(detenteurs.map((un) => un.parProjet)).toEqual([[], []]);

    // Then l'écran a quand même une date à afficher, et il ne peut donc pas dire que
    // rien n'a jamais été daté ici, alors que deux comptes le sont.
    expect(dernierConstat).toEqual(NUIT);
  });
});

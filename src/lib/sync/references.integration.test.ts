import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CollectResult, Connector, ObservedReference } from "@/core/connector";
import { prisma } from "@/lib/db";
import { executerCollecte, nouvelleExecution } from "@/lib/sync/collecte";
import { politiqueJetable } from "@/test/politique-jetable";

/**
 * Les objets possédés, collectés contre une vraie base.
 *
 * Ce qui ne se tient pas plus bas est l'index qui ne laisse vivre qu'une référence par
 * objet et par compte, écrit à la main dans la migration et que le client Prisma ignore,
 * et la datation qui passe par lui : un double réécrirait l'index qu'il prétend vérifier.
 */

politiqueJetable("references-integration");

const PROVIDER = "atelier";
/** Un second système, dont les objets ne doivent jamais se dater par la collecte du premier. */
const VOISIN = "atelier-voisin";
const NUIT_1 = new Date("2026-10-01T02:00:00Z");
const NUIT_2 = new Date("2026-10-02T02:00:00Z");
const NUIT_3 = new Date("2026-10-03T02:00:00Z");

function connecteur(releve: () => CollectResult, recense = true): Connector {
  return {
    contract: {
      key: PROVIDER,
      label: "Atelier",
      criticality: "low",
      runbook: "Lire la console de l'atelier.",
      accountSlug: ({ handle }) => handle,
      credentials: [],
      capabilities: {
        list: [{ requires: [], tier: "auto" }],
        ...(recense ? { reference: [{ requires: [], tier: "auto" as const }] } : {}),
      },
      scopeSchema: z.object({}),
    },
    probe: () => Promise.resolve([]),
    plan: () => Promise.resolve([]),
    list: () => Promise.resolve(releve()),
  };
}

const COMPTES = ["cpt-a", "cpt-b"].map((externalId) => ({
  externalId,
  idKind: "opaque" as const,
  handle: externalId,
}));
const DEPOTS = Array.from({ length: 10 }, (_, i) => `dep-${i + 1}`);

function releve(
  references: readonly ObservedReference[] | undefined,
  partiel = false,
): CollectResult {
  const commun = {
    itemsSeen: COMPTES.length,
    identities: COMPTES,
    resources: DEPOTS.map((externalId) => ({ externalId, label: `Dépôt ${externalId}` })),
    grants: [],
    ...(references === undefined ? {} : { references }),
  };
  return partiel
    ? { status: "partial", errors: [{ scope: "list", message: "une page manque" }], ...commun }
    : { status: "ok", ...commun };
}

/** Huit dépôts transférés par cpt-a, un neuvième à deux propriétaires, un dixième sans. */
const PREMIERE_NUIT: ObservedReference[] = [
  ...DEPOTS.slice(0, 9).map((depot) => ({
    resourceExternalId: depot,
    ownerIdentityExternalId: "cpt-a",
    fate: "transfer" as const,
  })),
  { resourceExternalId: "dep-9", ownerIdentityExternalId: "cpt-b", fate: "transfer" },
  { resourceExternalId: "dep-10", ownerIdentityExternalId: "inconnu", fate: "keep" },
];

/** dep-1 change de destin, et cpt-b ne possède plus dep-9. */
const SUITE: ObservedReference[] = PREMIERE_NUIT.filter(
  (reference) =>
    !(reference.resourceExternalId === "dep-9" && reference.ownerIdentityExternalId === "cpt-b"),
).map((reference) =>
  reference.resourceExternalId === "dep-1" ? { ...reference, fate: "keep" } : reference,
);

const vivantes = () =>
  prisma.reference.findMany({
    where: { provider: PROVIDER, vanishedAt: null },
    select: {
      onOffboard: true,
      resource: { select: { externalId: true } },
      externalIdentity: { select: { externalId: true } },
    },
    orderBy: [{ resource: { externalId: "asc" } }, { onOffboard: "asc" }],
  });

describe("un objet possédé se collecte avec son destin, sur son compte", () => {
  it("écrit, ne date rien sur un passage partiel, puis date et rouvre sur un passage complet", async () => {
    // Given un objet du système voisin, que rien de ce qui suit ne doit dater
    const voisin = await prisma.resource.create({
      data: { provider: VOISIN, externalId: "dep-voisin", label: "Dépôt voisin" },
    });
    await prisma.reference.create({
      data: {
        provider: VOISIN,
        resourceId: voisin.id,
        onOffboard: "TRANSFER",
        firstSeenAt: NUIT_1,
        lastSeenAt: new Date("2026-09-01T02:00:00Z"),
      },
    });

    // When une première nuit relève onze objets possédés
    const premiere = await executerCollecte(
      connecteur(() => releve(PREMIERE_NUIT)),
      NUIT_1,
      nouvelleExecution(),
    );

    // Then chacun s'écrit sur son compte, deux comptes pour dep-9, aucun pour un auteur
    // qu'aucun compte ne porte, et le destin fixé par le connecteur
    expect(premiere.status).toBe("OK");
    expect(premiere.references).toEqual({ creees: 11, revues: 0, disparues: 0 });
    const ecrites = await vivantes();
    expect(ecrites).toHaveLength(11);
    expect(
      ecrites
        .filter(({ resource }) => resource.externalId === "dep-9")
        .map(({ externalIdentity }) => externalIdentity?.externalId),
    ).toEqual(expect.arrayContaining(["cpt-a", "cpt-b"]));
    expect(ecrites.find(({ resource }) => resource.externalId === "dep-10")).toMatchObject({
      onOffboard: "KEEP",
      externalIdentity: null,
    });

    // When une nuit partielle voit dep-1 changer de destin et cpt-b lâcher dep-9
    const partielle = await executerCollecte(
      connecteur(() => releve(SUITE, true)),
      NUIT_2,
      nouvelleExecution(),
    );

    // Then rien ne disparaît ni ne change : un passage partiel ne conclut sur rien
    expect(partielle.status).toBe("PARTIAL");
    expect(await vivantes()).toEqual(ecrites);

    // When une nuit complète relève la même chose
    const complete = await executerCollecte(
      connecteur(() => releve(SUITE)),
      NUIT_3,
      nouvelleExecution(),
    );

    // Then l'ancienne ligne de dep-1 et celle de cpt-b sur dep-9 se datent, une ligne neuve
    // porte le nouveau destin de dep-1, et l'objet voisin reste vivant
    expect(complete.status).toBe("OK");
    expect(complete.references?.disparues).toBe(2);
    const apres = await vivantes();
    expect(apres).toHaveLength(10);
    expect(apres.filter(({ resource }) => resource.externalId === "dep-1")).toEqual([
      expect.objectContaining({ onOffboard: "KEEP" }),
    ]);
    expect(
      await prisma.reference.count({ where: { provider: PROVIDER, vanishedAt: { not: null } } }),
    ).toBe(2);
    expect(await prisma.reference.count({ where: { provider: VOISIN, vanishedAt: null } })).toBe(1);

    // Then la base refuse une seconde référence vivante du même objet pour le même compte
    const [depot2] = await prisma.resource.findMany({
      where: { provider: PROVIDER, externalId: "dep-2" },
      select: { id: true },
    });
    const [compteA] = await prisma.externalIdentity.findMany({
      where: { provider: PROVIDER, externalId: "cpt-a" },
      select: { id: true },
    });
    await expect(
      prisma.reference.create({
        data: {
          provider: PROVIDER,
          resourceId: depot2?.id ?? "",
          externalIdentityId: compteA?.id ?? "",
          onOffboard: "TRANSFER",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuse un relevé qui contredit sa capacité, et une chute sous sa propre famille", async () => {
    // When un connecteur qui sait recenser ne rend aucun objet
    const muet = await executerCollecte(
      connecteur(() => releve(undefined)),
      NUIT_1,
      nouvelleExecution(),
    );

    // Then le passage est partiel, et rien ne s'écrit
    expect(muet.status).toBe("PARTIAL");
    expect(muet.erreurs).toContain(
      "objets possédés : la capacité de recenser est praticable, et le relevé n'en rend aucun",
    );
    expect(muet.references).toBeUndefined();

    // When un connecteur qui ne sait pas recenser en rend
    const bavard = await executerCollecte(
      connecteur(() => releve(PREMIERE_NUIT), false),
      NUIT_1,
      nouvelleExecution(),
    );

    // Then le passage est partiel, et rien ne s'écrit non plus
    expect(bavard.status).toBe("PARTIAL");
    expect(await prisma.reference.count()).toBe(0);

    // Given onze objets relevés par une nuit complète
    await executerCollecte(
      connecteur(() => releve(PREMIERE_NUIT)),
      NUIT_1,
      nouvelleExecution(),
    );

    // When la nuit suivante n'en rend plus que deux
    const effondree = await executerCollecte(
      connecteur(() => releve(PREMIERE_NUIT.slice(0, 2))),
      NUIT_2,
      nouvelleExecution(),
    );

    // Then le garde-fou des objets possédés refuse sous sa famille, sans rien dater, et
    // les comptes, eux, n'ont pas chuté
    expect(effondree.status).toBe("PARTIAL");
    expect(effondree.refus).toEqual([
      expect.objectContaining({ famille: "references", observe: 2, reference: 11 }),
    ]);
    expect(await prisma.reference.count({ where: { vanishedAt: null } })).toBe(11);

    // When un opérateur autorise une datation des objets possédés, et que la nuit repasse
    await prisma.scopeDropOverride.create({
      data: {
        provider: PROVIDER,
        famille: "references",
        reason: "dépôts transférés en masse à l'équipe",
        createdBy: "operatrice.exemple",
        createdAt: NUIT_2,
      },
    });
    const levee = await executerCollecte(
      connecteur(() => releve(PREMIERE_NUIT.slice(0, 2))),
      NUIT_3,
      nouvelleExecution(),
    );

    // Then elle date une fois, et l'autorisation est dépensée
    expect(levee.status).toBe("OK");
    expect(levee.references?.disparues).toBe(9);
    expect(
      await prisma.scopeDropOverride.count({ where: { famille: "references", consumedAt: null } }),
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  type CapabilityDecl,
  type ConnectorFeature,
  type CredentialProbe,
  resolveCapability,
  resolveFeatures,
} from "./connector";

const RUNBOOK = "docs/runbooks/notion.md";

const probe = (id: string, available: boolean): CredentialProbe => ({
  id,
  available,
  checkedAt: new Date("2026-08-07T09:00:00Z"),
});

/**
 * Reprend le cas réel de Notion, seul système du catalogue à exposer deux voies
 * de niveaux différents pour la même opération.
 */
const revokeDecls: CapabilityDecl[] = [
  { requires: ["notion:scim"], tier: "auto" },
  { requires: ["notion:session"], tier: "auto", fragile: true },
  { requires: [], tier: "manual", runbook: "docs/runbooks/notion-revoke-manuel.md" },
];

describe("résolution du tier effectif d'une capability", () => {
  it("retient la meilleure voie quand son credential répond", () => {
    const resolved = resolveCapability(
      "revoke",
      revokeDecls,
      [probe("notion:scim", true), probe("notion:session", true)],
      RUNBOOK,
    );

    expect(resolved.tier).toBe("auto");
    expect(resolved.decl?.fragile).toBeUndefined();
    expect(resolved.degradedFrom).toBeUndefined();
  });

  it("bascule sur la voie suivante et dit ce qui manque", () => {
    const resolved = resolveCapability(
      "revoke",
      revokeDecls,
      [probe("notion:scim", false), probe("notion:session", true)],
      RUNBOOK,
    );

    expect(resolved.tier).toBe("auto");
    expect(resolved.decl?.fragile).toBe(true);
    expect(resolved.degradedFrom).toEqual({ tier: "auto", missing: ["notion:scim"] });
  });

  it("tombe sur le chemin manuel avec son propre runbook quand aucun credential ne répond", () => {
    const resolved = resolveCapability("revoke", revokeDecls, [], RUNBOOK);

    expect(resolved.tier).toBe("manual");
    expect(resolved.runbook).toBe("docs/runbooks/notion-revoke-manuel.md");
    expect(resolved.degradedFrom).toEqual({ tier: "auto", missing: ["notion:scim"] });
  });

  it("vaut none, avec le runbook du connecteur, quand aucune voie n'est praticable", () => {
    const resolved = resolveCapability(
      "revoke",
      [{ requires: ["notion:scim"], tier: "auto" }],
      [probe("notion:scim", false)],
      RUNBOOK,
    );

    expect(resolved.tier).toBe("none");
    expect(resolved.runbook).toBe(RUNBOOK);
    expect(resolved.degradedFrom).toEqual({ tier: "auto", missing: ["notion:scim"] });
  });

  it("vaut none sans dégradation quand la capability n'est pas déclarée du tout", () => {
    const resolved = resolveCapability("grant", undefined, [], RUNBOOK);

    expect(resolved.tier).toBe("none");
    expect(resolved.degradedFrom).toBeUndefined();
  });

  it("traite un credential absent des sondes comme indisponible, jamais comme acquis", () => {
    const resolved = resolveCapability("revoke", revokeDecls, [], RUNBOOK);

    expect(resolved.tier).not.toBe("auto");
  });
});

/**
 * La gestion des invités Notion, hors socle parce qu'un invité n'est jamais rattaché
 * à une personne du périmètre, et dont le credential n'est pas celui de la collecte.
 */
const FONCTIONNALITES: ConnectorFeature[] = [
  {
    key: "invites",
    label: "Invités du workspace",
    requires: ["notion:session"],
    entrypoint: "invites",
  },
  { key: "sieges", label: "Sièges facturés", requires: [], entrypoint: "sieges" },
];

describe("résolution des fonctionnalités hors socle", () => {
  it("annonce ce qui manque plutôt que de faire disparaître la fonctionnalité", () => {
    const resolues = resolveFeatures(FONCTIONNALITES, [probe("notion:session", false)]);

    expect(resolues).toHaveLength(2);

    const invites = resolues.find((resolue) => resolue.feature.key === "invites");
    expect(invites?.available).toBe(false);
    expect(invites?.missing).toEqual(["notion:session"]);

    const sieges = resolues.find((resolue) => resolue.feature.key === "sieges");
    expect(sieges?.available).toBe(true);
    expect(sieges?.missing).toEqual([]);
  });

  it("traite un credential absent des sondes comme indisponible, jamais comme acquis", () => {
    const sansSondes = resolveFeatures(FONCTIONNALITES, []);
    expect(sansSondes.find((resolue) => resolue.feature.key === "invites")?.available).toBe(false);

    const avecSonde = resolveFeatures(FONCTIONNALITES, [probe("notion:session", true)]);
    expect(avecSonde.find((resolue) => resolue.feature.key === "invites")?.available).toBe(true);

    // Un connecteur qui n'en déclare aucune rend une liste vide, pas undefined :
    // l'écran boucle dessus sans avoir à connaître ce cas.
    expect(resolveFeatures(undefined, [])).toEqual([]);
  });
});

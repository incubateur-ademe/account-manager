import { describe, expect, it } from "vitest";

import { type CapabilityDecl, type CredentialProbe, resolveCapability } from "./connector";

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

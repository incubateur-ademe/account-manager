import { describe, expect, it } from "vitest";

import type { PlannedStep } from "./connector";
import { empreinteDuPlan, peremptionDuPlan } from "./plan";

const etape = (over: Partial<PlannedStep> = {}): PlannedStep => ({
  systemKey: "github",
  capability: "revoke",
  tier: "manual",
  action: "retirer-de-l-organisation",
  label: "Retirer jean.dupont de l'organisation incubateur-ademe",
  params: { organisation: "incubateur-ademe", username: "jean.dupont" },
  riskLevel: "high",
  expectedState: { membre: false },
  idempotencyKey: "github:incubateur-ademe:revoke:jean.dupont",
  ...over,
});

/**
 * L'empreinte sert à répondre à une seule question au moment d'agir : est-ce encore
 * ce qui a été approuvé ? Trop sensible, elle ferait rejouer une approbation pour un
 * libellé reformulé ; trop laxiste, elle laisserait exécuter autre chose.
 */
describe("empreinte d'un plan", () => {
  it("ne change pas quand seule la présentation change", () => {
    // Given un plan approuvé
    const reference = empreinteDuPlan([etape()]);

    // When le libellé est reformulé et le niveau de risque relu à la baisse
    const reformule = empreinteDuPlan([
      etape({ label: "Sortir jean.dupont de l'organisation", riskLevel: "medium" }),
    ]);

    // Then c'est le même plan : rien de ce qui engage n'a bougé
    expect(reformule).toBe(reference);
  });

  it("ne dépend pas de l'ordre des étapes", () => {
    const a = etape();
    const b = etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" });

    expect(empreinteDuPlan([a, b])).toBe(empreinteDuPlan([b, a]));
  });

  it("change dès qu'une étape vise autre chose", () => {
    // Le cas qui compte : une collecte est passée, la personne a un compte de plus.
    const initial = empreinteDuPlan([etape()]);
    const augmente = empreinteDuPlan([
      etape(),
      etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" }),
    ]);

    expect(augmente).not.toBe(initial);
  });

  it("change quand les paramètres d'une même action changent", () => {
    const initial = empreinteDuPlan([etape()]);
    const ailleurs = empreinteDuPlan([etape({ params: { organisation: "autre-org" } })]);

    expect(ailleurs).not.toBe(initial);
  });
});

/**
 * Un plan cesse d'être valide de deux façons, et les confondre ferait exécuter ce
 * que personne n'a approuvé sous cette forme.
 */
describe("péremption d'un plan", () => {
  const MAINTENANT = new Date("2026-08-18T12:00:00Z");
  const plan = { expiresAt: new Date("2026-08-25T12:00:00Z"), planDigest: "abcd1234" };

  it("laisse passer un plan récent que rien n'a démenti", () => {
    expect(peremptionDuPlan(plan, "abcd1234", MAINTENANT)).toEqual({
      perime: false,
      obsolete: false,
    });
  });

  it("distingue le plan trop vieux du plan démenti par une collecte", () => {
    // Deux raisons différentes de ne pas exécuter, qui appellent deux gestes
    // différents : recalculer d'un côté, faire reconfirmer de l'autre.
    const vieux = { ...plan, expiresAt: new Date("2026-08-17T12:00:00Z") };

    expect(peremptionDuPlan(vieux, "abcd1234", MAINTENANT).perime).toBe(true);
    expect(peremptionDuPlan(plan, "9999ffff", MAINTENANT).obsolete).toBe(true);
  });

  it("tient un plan pour périmé le jour même de son échéance", () => {
    const aLEcheance = { ...plan, expiresAt: MAINTENANT };
    expect(peremptionDuPlan(aLEcheance, "abcd1234", MAINTENANT).perime).toBe(true);
  });
});

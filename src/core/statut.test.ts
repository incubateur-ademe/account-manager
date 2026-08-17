import { describe, expect, it } from "vitest";

import { statutDe, statutDePersonne } from "./statut";

const AUJOURDHUI = new Date("2026-08-08T10:00:00Z");
const OPTIONS = { graceDays: 7, soonDays: 30, staleDays: 180 };

const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("statut d'une personne selon son échéance de mission", () => {
  it("reste actif tant que l'échéance est lointaine", () => {
    expect(statutDe(le("2026-12-31"), AUJOURDHUI, OPTIONS)).toBe("ACTIF");
  });

  it("signale l'échéance proche à l'entrée de la fenêtre d'anticipation", () => {
    expect(statutDe(le("2026-09-06"), AUJOURDHUI, OPTIONS)).toBe("BIENTOT");
    expect(statutDe(le("2026-09-07"), AUJOURDHUI, OPTIONS)).toBe("ACTIF");
  });

  it("considère le dernier jour travaillé comme encore travaillé", () => {
    // La fin de mission est inclusive : couper ce jour-là priverait la personne
    // de sa dernière journée de travail.
    expect(statutDe(le("2026-08-08"), AUJOURDHUI, OPTIONS)).toBe("BIENTOT");
    expect(statutDe(le("2026-08-07"), AUJOURDHUI, OPTIONS)).toBe("EN_SURSIS");
  });

  it("laisse le délai de grâce absorber un renouvellement signé en retard", () => {
    expect(statutDe(le("2026-08-01"), AUJOURDHUI, OPTIONS)).toBe("EN_SURSIS");
    expect(statutDe(le("2026-07-31"), AUJOURDHUI, OPTIONS)).toBe("A_TRAITER");
  });

  it("remonte les cas réels de l'équipe transverse", () => {
    // Deux situations constatées sur l'annuaire au 8 août 2026.
    expect(statutDe(le("2026-07-31"), AUJOURDHUI, OPTIONS)).toBe("A_TRAITER");
    expect(statutDe(le("2026-03-01"), AUJOURDHUI, OPTIONS)).toBe("A_TRAITER");
  });

  it("cesse de traiter un départ comme urgent au-delà du seuil d'ancienneté", () => {
    // Mesuré sur les données réelles : 74 personnes sont parties depuis plus d'un an.
    // Sans ce seuil, elles se retrouvent au même rang que celles dont la mission
    // vient de s'achever, et une liste où tout est urgent ne signale plus rien.
    expect(statutDe(le("2026-02-09"), AUJOURDHUI, OPTIONS)).toBe("A_TRAITER");
    expect(statutDe(le("2026-02-08"), AUJOURDHUI, OPTIONS)).toBe("ANCIEN");
    expect(statutDe(le("2023-01-01"), AUJOURDHUI, OPTIONS)).toBe("ANCIEN");
  });

  it("distingue l'absence d'échéance d'une échéance lointaine", () => {
    expect(statutDe(null, AUJOURDHUI, OPTIONS)).toBe("SANS_ECHEANCE");
  });
});

describe("personne sortie du référentiel amont", () => {
  it("prime sur toute échéance, même lointaine", () => {
    // Le cron de beta.gouv retire les expirés des équipes : la personne disparaît
    // de la source avant qu'on ait coupé ses accès. La masquer serait la perdre.
    const sortie = { missionEnd: le("2029-12-31"), vanishedAt: le("2026-08-08") };
    expect(statutDePersonne(sortie, AUJOURDHUI, OPTIONS)).toBe("SORTI");
  });

  it("laisse le calcul normal opérer tant que la personne est présente", () => {
    const presente = { missionEnd: le("2026-07-31"), vanishedAt: null };
    expect(statutDePersonne(presente, AUJOURDHUI, OPTIONS)).toBe("A_TRAITER");
  });
});

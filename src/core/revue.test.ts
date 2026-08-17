import { describe, expect, it } from "vitest";

import { revueDe } from "./revue";

const AUJOURDHUI = new Date("2026-08-09T10:00:00Z");
const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("revue périodique d'un compte de service", () => {
  it("ne signale que les comptes dont la revue est réellement dépassée", () => {
    // Étant donné une périodicité de 180 jours, la seule échéance qu'un compte
    // machine puisse porter.
    const tousLes180Jours = { reviewEveryDays: 180 };

    // Un compte jamais revu, déclaré la semaine dernière : la déclaration vaut
    // point de départ, sinon tout compte naîtrait en retard le jour de son ajout.
    const fraichementDeclare = revueDe(
      { ...tousLes180Jours, lastReviewedAt: null, createdAt: le("2026-08-02") },
      AUJOURDHUI,
    );
    expect(fraichementDeclare.etat).toBe("A_JOUR");
    expect(fraichementDeclare.jamaisRevu).toBe(true);
    expect(fraichementDeclare.joursDeRetard).toBe(0);
    expect(fraichementDeclare.echeance).toStrictEqual(le("2027-01-29"));

    // Le même compte jamais revu, déclaré il y a plus de 180 jours : personne ne
    // l'a jamais regardé depuis, c'est exactement ce que la revue doit attraper.
    const jamaisRevuDepuisLongtemps = revueDe(
      { ...tousLes180Jours, lastReviewedAt: null, createdAt: le("2025-06-01") },
      AUJOURDHUI,
    );
    expect(jamaisRevuDepuisLongtemps.etat).toBe("EN_RETARD");
    expect(jamaisRevuDepuisLongtemps.jamaisRevu).toBe(true);
    expect(jamaisRevuDepuisLongtemps.joursDeRetard).toBe(254);

    // Une revue récente met le compte à l'abri pour toute la période.
    const revuHier = revueDe(
      { ...tousLes180Jours, lastReviewedAt: le("2026-08-08"), createdAt: le("2024-01-01") },
      AUJOURDHUI,
    );
    expect(revuHier.etat).toBe("A_JOUR");
    expect(revuHier.jamaisRevu).toBe(false);

    // À l'approche de l'échéance, le compte se signale avant d'être en faute.
    const echeanceProche = revueDe(
      { ...tousLes180Jours, lastReviewedAt: le("2026-03-01"), createdAt: le("2024-01-01") },
      AUJOURDHUI,
    );
    expect(echeanceProche.etat).toBe("BIENTOT");
    expect(echeanceProche.joursDeRetard).toBe(0);

    // Le seuil exact : le jour de l'échéance, la revue est due mais pas en retard.
    // Le lendemain, elle l'est. Se tromper d'un jour ici, c'est soit crier un jour
    // trop tôt, soit laisser passer une période entière.
    const ancien = { ...tousLes180Jours, createdAt: le("2024-01-01") };
    const dueAujourdhui = revueDe({ ...ancien, lastReviewedAt: le("2026-02-10") }, AUJOURDHUI);
    expect(dueAujourdhui.echeance).toStrictEqual(le("2026-08-09"));
    expect(dueAujourdhui.etat).toBe("BIENTOT");
    const dueHier = revueDe({ ...ancien, lastReviewedAt: le("2026-02-09") }, AUJOURDHUI);
    expect(dueHier.etat).toBe("EN_RETARD");
    expect(dueHier.joursDeRetard).toBe(1);

    // Une revue oubliée depuis des mois compte ses jours de retard, pour qu'un
    // oubli ancien ne se confonde pas avec une échéance d'hier.
    const oubliee = revueDe(
      { ...tousLes180Jours, lastReviewedAt: le("2025-01-01"), createdAt: le("2024-01-01") },
      AUJOURDHUI,
    );
    expect(oubliee.etat).toBe("EN_RETARD");
    expect(oubliee.joursDeRetard).toBe(405);
  });
});

import { describe, expect, it } from "vitest";

import { periodiciteDUnTerme, revueDe } from "./revue";

const AUJOURDHUI = new Date("2026-08-09T10:00:00Z");
const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("revue périodique d'un compte de service", () => {
  it("ne signale que les comptes dont la revue est réellement dépassée", () => {
    // Étant donné une périodicité de 180 jours, la seule échéance qu'un compte
    // machine puisse porter.
    const tousLes180Jours = { reviewEveryDays: 180, expiresAt: null };

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
    const dueAujourdhui = revueDe(
      { ...ancien, expiresAt: null, lastReviewedAt: le("2026-02-10") },
      AUJOURDHUI,
    );
    expect(dueAujourdhui.echeance).toStrictEqual(le("2026-08-09"));
    expect(dueAujourdhui.etat).toBe("BIENTOT");
    const dueHier = revueDe(
      { ...ancien, expiresAt: null, lastReviewedAt: le("2026-02-09") },
      AUJOURDHUI,
    );
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

describe("le terme d'un credential émis, qui n'est pas sa revue", () => {
  it("éteint le signal au lieu de le laisser rouge pour toujours, et cale la revue sur le terme", () => {
    // Given un jeton émis il y a longtemps, dont la revue est largement dépassée et dont le
    // terme est passé lui aussi. Rien ne peut le reprendre : le proxy qui l'a produit
    // n'offre ni révocation ni introspection, et il n'y a donc aucun geste à demander
    const mort = revueDe(
      {
        reviewEveryDays: 7,
        lastReviewedAt: null,
        createdAt: le("2026-01-01"),
        expiresAt: le("2026-01-08"),
      },
      AUJOURDHUI,
    );

    // Then il sort éteint et non en retard : un signal rouge qui ne s'éteint jamais ne
    // signale plus rien, et c'est la panne que la revue existe pour éviter
    expect(mort.etat).toBe("EXPIRE");
    expect(mort.joursDeRetard).toBe(0);

    // Then le même compte, sans terme, reste en retard : le terme ne dispense de rien, il
    // dit seulement qu'il n'y a plus rien à décider
    expect(
      revueDe(
        { reviewEveryDays: 7, lastReviewedAt: null, createdAt: le("2026-01-01"), expiresAt: null },
        AUJOURDHUI,
      ).etat,
    ).toBe("EN_RETARD");

    // Then avant son terme, un compte qui en porte un est à jour, et la périodicité ne dit
    // plus rien par-dessus lui : le terme porte la péremption, et il n'existe aucun geste à
    // réclamer à personne, ni avant ni après
    expect(
      revueDe(
        {
          reviewEveryDays: 180,
          lastReviewedAt: le("2026-08-01"),
          createdAt: le("2026-01-01"),
          expiresAt: le("2026-12-31"),
        },
        AUJOURDHUI,
      ).etat,
    ).toBe("A_JOUR");

    // Then un jeton court l'est aussi, toute sa vie, et c'est là que l'ancienne règle
    // mentait : sa périodicité vaut la durée de son terme, donc elle tombe sous le seuil de
    // « bientôt » dès sa naissance. Un parc de jetons de sept jours affichait « Revue à
    // prévoir » en permanence, la colonne cessait de distinguer ce qui demande un geste, et
    // le bouton de revue qu'on proposait ne changeait rien, le terme reprenant la main au
    // calcul suivant
    const jeune = {
      reviewEveryDays: 7,
      lastReviewedAt: null,
      createdAt: le("2026-08-08"),
      expiresAt: le("2026-08-15"),
    };
    expect(revueDe(jeune, AUJOURDHUI).etat).toBe("A_JOUR");
    expect(revueDe(jeune, le("2026-08-14")).etat).toBe("A_JOUR");

    // Then il ne réclame aucune revue, avant son terme comme après : rien ne sait le
    // révoquer, rien ne sait le prolonger, et l'écran n'a donc aucun bouton à offrir. Le
    // proposer quand même offrirait un geste qui ne change rien, le terme reprenant la main
    // au calcul suivant, et un bouton qui ne fait rien apprend à ne plus lire la colonne
    expect(revueDe(jeune, AUJOURDHUI).reclamee).toBe(false);
    expect(revueDe(jeune, le("2026-08-15")).reclamee).toBe(false);
    expect(revueDe({ ...jeune, expiresAt: null }, AUJOURDHUI).reclamee).toBe(true);

    // Then le même compte, sans terme, se signale bien : c'est la présence du terme qui
    // éteint la revue périodique, jamais la brièveté de la périodicité
    expect(revueDe({ ...jeune, expiresAt: null }, AUJOURDHUI).etat).toBe("BIENTOT");

    // Then le jour du terme, il est éteint et non en retard : le seuil est le terme, pas la
    // périodicité qu'on en avait déduite
    expect(revueDe(jeune, le("2026-08-15")).etat).toBe("EXPIRE");

    // Then la périodicité d'un credential qui porte un terme vaut la durée qui reste,
    // arrondie au supérieur : aucune revue ne tombe avant qu'il ne meure, et demander de se
    // prononcer sur un jeton qu'on ne peut ni reprendre ni prolonger ne demande rien
    expect(periodiciteDUnTerme(le("2026-01-01"), le("2026-01-08"))).toBe(7);
    expect(
      periodiciteDUnTerme(new Date("2026-01-01T09:30:00Z"), new Date("2026-01-08T09:00:00Z")),
    ).toBe(7);

    // Then jamais zéro ni négatif : une périodicité nulle poserait une revue due chaque
    // jour, exactement ce que la saisie d'un compte machine refuse déjà
    expect(periodiciteDUnTerme(le("2026-01-08"), le("2026-01-08"))).toBe(1);
    expect(periodiciteDUnTerme(le("2026-01-08"), le("2026-01-01"))).toBe(1);
  });
});

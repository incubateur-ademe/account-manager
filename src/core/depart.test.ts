import { describe, expect, it } from "vitest";

import {
  dossierSoldable,
  dossierVivant,
  ETATS_VIVANTS,
  type EtatDossier,
  etatApresPointage,
  etatDUnPlanRemplace,
  peutAnnuler,
  peutClore,
  peutConfirmer,
  peutPointer,
  peutRecalculer,
  planAAnnuler,
  systemesDuDepart,
} from "./depart";

const FRAIS = { perime: false, obsolete: false };

/**
 * Confirmer engage : c'est le moment où quelqu'un dit qu'il répond de cette liste.
 * Tout ce qui rendrait la liste différente de ce qui sera fait doit donc bloquer.
 */
describe("confirmation d'un plan", () => {
  it("accepte un brouillon frais qui demande quelque chose", () => {
    expect(peutConfirmer("DRAFT", FRAIS, 3)).toEqual({ possible: true });
  });

  it("refuse un plan périmé et un plan démenti, avec deux raisons distinctes", () => {
    // Les deux appellent des gestes différents : recalculer d'un côté, repartir de
    // la situation réelle de l'autre. Une seule phrase pour les deux les rendrait
    // indiscernables au moment où il faut choisir quoi faire.
    const perime = peutConfirmer("DRAFT", { perime: true, obsolete: false }, 3);
    const obsolete = peutConfirmer("DRAFT", { perime: false, obsolete: true }, 3);

    expect(perime.possible).toBe(false);
    expect(obsolete.possible).toBe(false);
    expect(perime).not.toEqual(obsolete);
  });

  it("refuse de confirmer une liste vide", () => {
    // Confirmer « rien à faire » donnerait un dossier qui a l'air traité alors que
    // personne n'a rien constaté.
    expect(peutConfirmer("DRAFT", FRAIS, 0).possible).toBe(false);
  });

  it("refuse de confirmer deux fois", () => {
    expect(peutConfirmer("EXECUTING", FRAIS, 3).possible).toBe(false);
    expect(peutConfirmer("EXECUTED", FRAIS, 3).possible).toBe(false);
  });
});

describe("pointage des étapes", () => {
  it("n'est ouvert qu'une fois le plan confirmé", () => {
    expect(peutPointer("EXECUTING")).toEqual({ possible: true });
    expect(peutPointer("DRAFT").possible).toBe(false);
    expect(peutPointer("EXECUTED").possible).toBe(false);
  });
});

/**
 * L'état d'un plan se déduit de ses étapes, il ne se pose jamais à la main : sans
 * ça, un plan finirait par afficher « terminé » alors que son détail dit le
 * contraire, et c'est le détail qui a raison.
 */
describe("état d'un plan après pointage", () => {
  it("reste en cours tant qu'une étape attend", () => {
    expect(etatApresPointage(["SUCCEEDED", "PENDING"])).toBe("EXECUTING");
  });

  it("compte « déjà absent » comme un succès", () => {
    // Le cas nominal quand une autre automatisation, ou quelqu'un d'autre, est
    // passé avant : l'accès n'existe plus, ce qui est le but recherché.
    expect(etatApresPointage(["SUCCEEDED", "ALREADY_ABSENT"])).toBe("EXECUTED");
  });

  it("compte une étape ignorée comme soldée, elle porte sa raison", () => {
    expect(etatApresPointage(["SUCCEEDED", "SKIPPED"])).toBe("EXECUTED");
  });

  it("reste partiellement exécuté dès qu'une étape a échoué", () => {
    // Un accès est resté ouvert : le dossier doit continuer de le dire, même si
    // toutes les cases ont été touchées.
    expect(etatApresPointage(["SUCCEEDED", "FAILED"])).toBe("PARTIALLY_EXECUTED");
    expect(dossierSoldable(etatApresPointage(["SUCCEEDED", "FAILED"]))).toBe(false);
  });

  it("ne laisse clore un dossier que sur un plan entièrement soldé", () => {
    expect(dossierSoldable(etatApresPointage(["SUCCEEDED", "ALREADY_ABSENT"]))).toBe(true);
    expect(dossierSoldable(etatApresPointage(["PENDING"]))).toBe(false);
  });
});

/**
 * La règle la plus lourde de conséquences du dossier : ce qu'un plan a le droit de
 * viser. Un compte rattaché sur une ressemblance de nom appartient peut-être à
 * quelqu'un d'autre, et une coupure ne se rattrape pas.
 */
describe("ce qu'un plan de départ a le droit de viser", () => {
  it("écarte un compte rattaché sur une ressemblance, tout en disant qu'il existe", () => {
    // Le cas qui a motivé cette règle : deux personnes portent des noms voisins, le
    // rapprochement a deviné, et le plan proposait de couper l'accès sans que rien à
    // l'écran ne dise sur quoi reposait ce rattachement.
    const reparti = systemesDuDepart([
      { provider: "github", methode: "HEURISTIC" },
      { provider: "notion", methode: "GITHUB_LOGIN" },
    ]);

    expect(reparti.revocables).toEqual(["notion"]);
    expect(reparti.nonConfirmes).toEqual(["github"]);
    // Le silence serait pire que l'absence d'étape : il ferait croire qu'il n'y a
    // pas de compte là où il y en a un que personne n'a tranché.
    expect(reparti.observes).toEqual(["github", "notion"]);
  });

  it("retient un système dès qu'un seul de ses comptes est sûr, sans taire les autres", () => {
    // Une personne peut détenir deux comptes sur le même système : l'étape porte sur
    // celui qu'on lui connaît vraiment, et l'autre reste à trancher.
    const reparti = systemesDuDepart([
      { provider: "github", methode: "DECLARED" },
      { provider: "github", methode: "HEURISTIC" },
    ]);

    expect(reparti.revocables).toEqual(["github"]);
    expect(reparti.nonConfirmes).toEqual(["github"]);
  });

  it("traite les trois méthodes sûres de la même façon, et rejette les deux autres", () => {
    const sures = systemesDuDepart([
      { provider: "a", methode: "DECLARED" },
      { provider: "b", methode: "GITHUB_LOGIN" },
      { provider: "c", methode: "EMAIL_EXACT" },
    ]);
    const faibles = systemesDuDepart([
      { provider: "d", methode: "HEURISTIC" },
      { provider: "e", methode: "NONE" },
    ]);

    expect(sures.revocables).toEqual(["a", "b", "c"]);
    expect(sures.nonConfirmes).toEqual([]);
    expect(faibles.revocables).toEqual([]);
    expect(faibles.nonConfirmes).toEqual(["d", "e"]);
  });

  it("ne propose rien pour une personne sans aucun compte observé", () => {
    expect(systemesDuDepart([])).toEqual({ revocables: [], observes: [], nonConfirmes: [] });
  });
});

/**
 * Un plan qui a cessé de valoir doit pouvoir être remplacé, sans quoi son dossier
 * n'a plus d'issue : la confirmation le refuse, et rien d'autre n'en calcule un.
 */
describe("recalcul d'un plan", () => {
  it("remplace un brouillon périmé comme un brouillon démenti, et note la raison", () => {
    const perime = { perime: true, obsolete: false };
    const obsolete = { perime: false, obsolete: true };

    expect(peutRecalculer("DRAFT", perime)).toEqual({ possible: true });
    expect(peutRecalculer("DRAFT", obsolete)).toEqual({ possible: true });

    // L'ancien plan garde ce qui l'a écarté : une date dépassée est un fait, une
    // empreinte qui ne correspond plus est une comparaison.
    expect(etatDUnPlanRemplace(perime)).toBe("EXPIRED");
    expect(etatDUnPlanRemplace(obsolete)).toBe("STALE");
    expect(etatDUnPlanRemplace({ perime: true, obsolete: true })).toBe("EXPIRED");
  });

  it("refuse de recalculer un plan encore valable", () => {
    // Recalculer sans raison remplacerait une liste lisible par une liste identique,
    // et brouillerait la question de savoir laquelle a été approuvée.
    expect(peutRecalculer("DRAFT", FRAIS).possible).toBe(false);
  });

  it("refuse de recalculer un plan déjà engagé, quel qu'en soit l'état", () => {
    // Un plan confirmé porte des pointages : le refaire effacerait ce que quelqu'un a
    // déclaré avoir fait, et les accès resteraient ouverts sans que rien ne le dise.
    const perime = { perime: true, obsolete: false };

    expect(peutRecalculer("EXECUTING", perime).possible).toBe(false);
    expect(peutRecalculer("EXECUTED", perime).possible).toBe(false);
    expect(peutRecalculer("PARTIALLY_EXECUTED", perime).possible).toBe(false);
    expect(peutRecalculer("CANCELLED", perime).possible).toBe(false);
  });
});

/**
 * Annuler dit qu'un départ n'aura pas lieu. Ce qui compte ici est la frontière : le
 * geste s'arrête là où commence l'engagement, et ses refus doivent nommer chacun leur
 * propre sortie, sans quoi on cherche la mauvaise.
 */
describe("annulation d'un dossier de départ", () => {
  it("annule un départ que personne n'a confirmé, et rouvre la porte à un dossier neuf", () => {
    // Un brouillon n'engage personne : le dossier et son plan tombent ensemble, sans
    // quoi la confirmation resterait offerte sur un départ abandonné.
    expect(peutAnnuler("CANDIDATE", "DRAFT").possible).toBe(true);
    expect(planAAnnuler("DRAFT")).toBe(true);
    expect(dossierVivant("CANCELLED")).toBe(false);

    const surUnDossierAnnule = peutAnnuler("CANCELLED", "CANCELLED");

    expect(surUnDossierAnnule.possible).toBe(false);
    expect(surUnDossierAnnule.possible === false && surUnDossierAnnule.raison).toContain("annulé");
  });

  it("refuse d'annuler un plan engagé, et ne confond pas ses trois refus", () => {
    const engages = ["EXECUTING", "EXECUTED", "PARTIALLY_EXECUTED"] as const;

    for (const plan of engages) {
      const verdict = peutAnnuler("CANDIDATE", plan);
      expect(verdict.possible).toBe(false);
      expect(verdict.possible === false && verdict.raison).toContain("engagé");
      expect(planAAnnuler(plan)).toBe(false);
    }

    const raison = (dossier: EtatDossier, plan: "DRAFT" | "EXECUTING") => {
      const verdict = peutAnnuler(dossier, plan);
      return verdict.possible === false ? verdict.raison : "";
    };

    // Trois sorties différentes : reprendre les étapes, constater que c'est déjà fait,
    // ou constater que le dossier est clos. Une seule phrase pour les trois enverrait
    // chercher la mauvaise.
    const phrases = new Set([
      raison("CANDIDATE", "EXECUTING"),
      raison("CANCELLED", "DRAFT"),
      raison("DONE", "DRAFT"),
    ]);

    expect(phrases.size).toBe(3);

    // Ce qu'un plan annulé ne permet plus, et que rien de neuf ne doit défaire.
    expect(peutConfirmer("CANCELLED", FRAIS, 3).possible).toBe(false);
    expect(peutPointer("CANCELLED").possible).toBe(false);
  });

  it("annule un dossier sans plan, et laisse un plan remplacé porter ce qui l'a écarté", () => {
    // Un calcul interrompu laisse un dossier sans plan : l'annuler est sa seule issue.
    expect(peutAnnuler("CANDIDATE", null).possible).toBe(true);
    expect(planAAnnuler(null)).toBe(false);

    for (const remplace of ["EXPIRED", "STALE"] as const) {
      expect(peutAnnuler("CANDIDATE", remplace).possible).toBe(true);
      expect(planAAnnuler(remplace)).toBe(false);
    }

    // `CONFIRMABLE` n'est écrit par personne aujourd'hui, et rien d'autre ne le
    // couvrirait le jour où un plan naîtra en attente plutôt qu'en brouillon.
    expect(peutAnnuler("CANDIDATE", "CONFIRMABLE").possible).toBe(true);
    expect(planAAnnuler("CONFIRMABLE")).toBe(true);
  });

  it("range les cinq états de dossier en un seul endroit", () => {
    // La règle vivait en deux littéraux recopiés, dans l'ouverture d'un dossier et
    // dans le blocage de la fusion. Elle se lit désormais ici, et une seule fois.
    expect(dossierVivant("WATCH")).toBe(true);
    expect(dossierVivant("CANDIDATE")).toBe(true);
    expect(dossierVivant("CONFIRMED")).toBe(true);
    expect(dossierVivant("CANCELLED")).toBe(false);
    expect(dossierVivant("DONE")).toBe(false);

    expect([...ETATS_VIVANTS].sort()).toEqual(["CANDIDATE", "CONFIRMED", "WATCH"]);
  });

  it("fait nommer à la clôture ce qui la bloque, plutôt que d'inventer des accès ouverts", () => {
    expect(peutClore("CANDIDATE", "EXECUTED").possible).toBe(true);

    const surUnDossierAnnule = peutClore("CANCELLED", "CANCELLED");
    const surUnDossierClos = peutClore("DONE", "EXECUTED");

    expect(surUnDossierAnnule.possible).toBe(false);
    expect(surUnDossierAnnule.possible === false && surUnDossierAnnule.raison).toContain("annulé");
    expect(surUnDossierClos.possible).toBe(false);
    expect(surUnDossierClos.possible === false && surUnDossierClos.raison).toContain("clos");

    // Un dossier annulé n'a aucun accès resté ouvert : le lui dire était faux.
    const accesOuverts = "Toutes les étapes ne sont pas soldées : des accès restent ouverts.";

    for (const plan of ["EXECUTING", "PARTIALLY_EXECUTED", null] as const) {
      const verdict = peutClore("CANDIDATE", plan);
      expect(verdict.possible).toBe(false);
      expect(verdict.possible === false && verdict.raison).toBe(accesOuverts);
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  type Acteur,
  combinaisonValide,
  type Declarant,
  dossierSoldable,
  dossierVivant,
  ETATS_VIVANTS,
  type EtapeSuivie,
  type EtatDossier,
  type EtatEtape,
  type EtatValidation,
  estSoldee,
  etatApresPointage,
  etatDeNaissance,
  etatDUnPlanRemplace,
  etatsAdmis,
  peutAnnuler,
  peutClore,
  peutConfirmer,
  peutOuvrir,
  peutPointer,
  peutRecalculer,
  peutValider,
  planAAnnuler,
  planPointable,
  roleSurDossier,
  systemesDuDepart,
  validationApresPointage,
} from "./dossier";

const FRAIS = { perime: false, obsolete: false };

/**
 * Une étape lue sur ses deux dimensions. Sans contrôle attendu par défaut : c'est la
 * forme de toute étape que ce produit a écrite jusqu'ici.
 */
const suivie = (etat: EtatEtape, validation: EtatValidation = "NONE"): EtapeSuivie => ({
  etat,
  validation,
});

const suivies = (...etats: readonly EtatEtape[]): EtapeSuivie[] =>
  etats.map((etat) => suivie(etat));

/**
 * Les quatre façons d'arriver devant une étape. La quatrième est celle que le rôle
 * seul ne sait pas dire : le porteur qui est aussi de l'équipe transverse reste le
 * porteur, et son appartenance se lit à côté.
 */
const TIERS: Declarant = { role: "OPERATOR", operateur: true };
const PORTEUR_SEUL: Declarant = { role: "SUBJECT", operateur: false };
const PORTEUR_OPERATEUR: Declarant = { role: "SUBJECT", operateur: true };
const INCONNU: Declarant = { role: null, operateur: false };

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
    expect(peutPointer("EXECUTING", "OPERATOR", TIERS)).toEqual({ possible: true });
    expect(peutPointer("DRAFT", "OPERATOR", TIERS).possible).toBe(false);
    expect(peutPointer("EXECUTED", "OPERATOR", TIERS).possible).toBe(false);
  });

  it("laisse reprendre une étape qui a échoué, et rouvre la sortie du dossier", () => {
    // Un plan dont une étape a échoué n'avait plus aucune sortie : il ne se pointait
    // plus, donc ne se soldait plus, donc ne se clôturait pas, et son dossier restait
    // vivant pour toujours en bloquant jusqu'à la fusion des fiches de la personne.
    expect(peutPointer("PARTIALLY_EXECUTED", "OPERATOR", TIERS)).toEqual({ possible: true });

    const apresEchec = suivies("SUCCEEDED", "FAILED", "SKIPPED");
    expect(etatApresPointage(apresEchec)).toBe("PARTIALLY_EXECUTED");
    expect(peutClore("OFFBOARDING", "CANDIDATE", etatApresPointage(apresEchec), 3).possible).toBe(
      false,
    );

    // La reprise de la seule étape en échec suffit à tout solder, donc à rouvrir la
    // clôture : la sortie existe, elle passe par le geste que l'écran nommait déjà.
    const apresReprise = suivies("SUCCEEDED", "SUCCEEDED", "SKIPPED");
    expect(etatApresPointage(apresReprise)).toBe("EXECUTED");
    expect(peutClore("OFFBOARDING", "CANDIDATE", etatApresPointage(apresReprise), 3).possible).toBe(
      true,
    );

    // « Déjà absent » solde aussi, et c'est le cas nominal quand une autre
    // automatisation est passée entre-temps.
    expect(etatApresPointage(suivies("ALREADY_ABSENT", "SUCCEEDED"))).toBe("EXECUTED");

    // Ce qui reste fermé le reste : un plan annulé, remplacé ou soldé ne se pointe pas.
    for (const clos of ["CANCELLED", "EXPIRED", "STALE", "EXECUTED"] as const) {
      expect(peutPointer(clos, "OPERATOR", TIERS).possible).toBe(false);
    }
  });
});

/**
 * L'état d'un plan se déduit de ses étapes, il ne se pose jamais à la main : sans
 * ça, un plan finirait par afficher « terminé » alors que son détail dit le
 * contraire, et c'est le détail qui a raison.
 */
describe("état d'un plan après pointage", () => {
  it("reste en cours tant qu'une étape attend", () => {
    expect(etatApresPointage(suivies("SUCCEEDED", "PENDING"))).toBe("EXECUTING");
  });

  it("compte « déjà absent » et « déjà présent » comme des succès", () => {
    // Le cas nominal quand une autre automatisation, ou quelqu'un d'autre, est
    // passé avant : l'accès n'existe plus pour un départ, il existe déjà pour une
    // arrivée, et c'est le but recherché de part et d'autre.
    expect(etatApresPointage(suivies("SUCCEEDED", "ALREADY_ABSENT"))).toBe("EXECUTED");
    expect(etatApresPointage(suivies("SUCCEEDED", "ALREADY_PRESENT"))).toBe("EXECUTED");
    expect(estSoldee(suivie("ALREADY_ABSENT"))).toBe(true);
    expect(estSoldee(suivie("ALREADY_PRESENT"))).toBe(true);
    expect(etatApresPointage(suivies("ALREADY_PRESENT", "PENDING"))).toBe("EXECUTING");
  });

  it("compte une étape ignorée comme soldée, elle porte sa raison", () => {
    expect(etatApresPointage(suivies("SUCCEEDED", "SKIPPED"))).toBe("EXECUTED");
  });

  it("reste partiellement exécuté dès qu'une étape a échoué", () => {
    // Un accès est resté ouvert : le dossier doit continuer de le dire, même si
    // toutes les cases ont été touchées.
    expect(etatApresPointage(suivies("SUCCEEDED", "FAILED"))).toBe("PARTIALLY_EXECUTED");
    expect(dossierSoldable(etatApresPointage(suivies("SUCCEEDED", "FAILED")))).toBe(false);
  });

  it("ne laisse clore un dossier que sur un plan entièrement soldé", () => {
    expect(dossierSoldable(etatApresPointage(suivies("SUCCEEDED", "ALREADY_ABSENT")))).toBe(true);
    expect(dossierSoldable(etatApresPointage(suivies("PENDING")))).toBe(false);
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
    expect(peutPointer("CANCELLED", "OPERATOR", TIERS).possible).toBe(false);
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
    expect(peutClore("OFFBOARDING", "CANDIDATE", "EXECUTED", 3).possible).toBe(true);

    const surUnDossierAnnule = peutClore("OFFBOARDING", "CANCELLED", "CANCELLED", 3);
    const surUnDossierClos = peutClore("OFFBOARDING", "DONE", "EXECUTED", 3);

    expect(surUnDossierAnnule.possible).toBe(false);
    expect(surUnDossierAnnule.possible === false && surUnDossierAnnule.raison).toContain("annulé");
    expect(surUnDossierClos.possible).toBe(false);
    expect(surUnDossierClos.possible === false && surUnDossierClos.raison).toContain("clos");

    // Un dossier annulé n'a aucun accès resté ouvert : le lui dire était faux.
    const accesOuverts = "Toutes les étapes ne sont pas soldées : des accès restent ouverts.";

    for (const plan of ["EXECUTING", "PARTIALLY_EXECUTED"] as const) {
      const verdict = peutClore("OFFBOARDING", "CANDIDATE", plan, 3);
      expect(verdict.possible).toBe(false);
      expect(verdict.possible === false && verdict.raison).toBe(accesOuverts);
    }

    // Un dossier sans aucun plan n'a rien à solder, et le dire ainsi le distingue
    // d'un plan dont les étapes attendent : deux situations, deux issues.
    const sansPlan = peutClore("OFFBOARDING", "CANDIDATE", null, 0);
    expect(sansPlan.possible).toBe(false);
    expect(sansPlan.possible === false && sansPlan.raison).not.toBe(accesOuverts);
  });

  it("clôt un dossier dont le plan ne demande rien", () => {
    // La confirmation refuse une liste vide, à raison, si bien qu'un plan sans étape
    // n'atteint jamais l'état exécuté. Sans cette sortie, la seule restante était
    // l'annulation, qui inscrit « ce départ n'aura pas lieu » alors qu'il a bien lieu
    // et que l'outil n'avait rien à faire.
    expect(peutConfirmer("DRAFT", FRAIS, 0).possible).toBe(false);
    expect(peutClore("OFFBOARDING", "CANDIDATE", "DRAFT", 0).possible).toBe(true);

    // Le cas naît d'une personne dont aucun compte n'est rattaché de façon sûre :
    // le plan ne peut viser personne, et le dossier restait ouvert pour toujours.
    expect(systemesDuDepart([{ provider: "github", methode: "HEURISTIC" }]).revocables).toEqual([]);

    // Ce qui reste fermé le reste : un dossier clos ou annulé ne se clôt pas, même
    // avec un plan vide.
    expect(peutClore("OFFBOARDING", "DONE", "DRAFT", 0).possible).toBe(false);
    expect(peutClore("OFFBOARDING", "CANCELLED", "DRAFT", 0).possible).toBe(false);
  });
});

/**
 * Le sens est ce qui sépare les deux moments qui comptent, et il ne se déduit de
 * rien : un dossier qui l'oublierait ferait retirer ce qu'on voulait donner.
 */
describe("le sens d'un dossier", () => {
  it("refuse la veille et le soupçon à une arrivée, et les garde pour un départ", () => {
    // Given les deux sens possibles
    // When on demande à chacun les états qu'il admet
    const arrivee = etatsAdmis("ONBOARDING");
    const depart = etatsAdmis("OFFBOARDING");

    // Then une arrivée est une décision : personne ne la soupçonne, et aucune
    // collecte ne la lèvera toute seule.
    expect([...arrivee]).toEqual(["CONFIRMED", "CANCELLED", "DONE"]);
    expect(arrivee).not.toContain("WATCH");
    expect(arrivee).not.toContain("CANDIDATE");

    // Then un départ garde les cinq, WATCH compris.
    expect([...depart].sort()).toEqual(["CANCELLED", "CANDIDATE", "CONFIRMED", "DONE", "WATCH"]);
  });

  it("fait naître une arrivée confirmée et un départ candidat", () => {
    // Given un dossier ouvert à la main, dans un sens puis dans l'autre
    // When il naît
    expect(etatDeNaissance("ONBOARDING")).toBe("CONFIRMED");
    expect(etatDeNaissance("OFFBOARDING")).toBe("CANDIDATE");

    // Then son état de naissance est admis et vivant, quel que soit le sens.
    for (const sens of ["ONBOARDING", "OFFBOARDING"] as const) {
      const naissance = etatDeNaissance(sens);
      expect(peutOuvrir(sens, naissance)).toEqual({ possible: true });
      expect(etatsAdmis(sens)).toContain(naissance);
      expect(dossierVivant(naissance)).toBe(true);
    }

    // Ce qu'aucun sens n'ouvre : un dossier qui naîtrait déjà clos ou déjà annulé.
    expect(peutOuvrir("OFFBOARDING", "DONE").possible).toBe(false);
    expect(peutOuvrir("ONBOARDING", "CANCELLED").possible).toBe(false);

    // Ce que seul le départ ouvre, et le refus le dit dans les mots de l'arrivée.
    expect(peutOuvrir("OFFBOARDING", "WATCH").possible).toBe(true);
    expect(peutOuvrir("OFFBOARDING", "CANDIDATE").possible).toBe(true);

    const enVeille = peutOuvrir("ONBOARDING", "WATCH");
    expect(enVeille.possible).toBe(false);
    expect(enVeille.possible === false && enVeille.raison).toContain("arrivée");
    expect(peutOuvrir("ONBOARDING", "CANDIDATE").possible).toBe(false);
  });

  it("dit ce qui reste à faire dans les mots du sens, sans changer le verdict", () => {
    // Given un plan dont une étape a échoué, dans un sens puis dans l'autre
    const inacheve = etatApresPointage(suivies("SUCCEEDED", "FAILED"));

    // When on demande à clore le dossier
    const arrivee = peutClore("ONBOARDING", "CONFIRMED", inacheve, 3);
    const depart = peutClore("OFFBOARDING", "CANDIDATE", inacheve, 3);

    // Then le refus est le même, la phrase non : « des accès restent ouverts » sous
    // une arrivée dirait l'inverse de ce qui manque.
    expect(arrivee.possible).toBe(false);
    expect(depart.possible).toBe(false);
    expect(arrivee).not.toEqual(depart);
    expect(arrivee.possible === false && arrivee.raison).toContain("n'ont pas été donnés");
    expect(depart.possible === false && depart.raison).toContain("restent ouverts");

    // Et ce qui ne dépend pas du sens continue de n'en pas dépendre : un plan soldé
    // se clôt, un dossier clos ne se reclôt pas, un brouillon s'annule.
    expect(peutClore("ONBOARDING", "CONFIRMED", "EXECUTED", 3)).toEqual({ possible: true });
    expect(peutClore("ONBOARDING", "DONE", "EXECUTED", 3).possible).toBe(false);
    expect(peutClore("ONBOARDING", "CONFIRMED", "DRAFT", 0).possible).toBe(true);
    expect(peutAnnuler("CONFIRMED", "DRAFT").possible).toBe(true);
    expect(peutConfirmer("DRAFT", FRAIS, 3)).toEqual({ possible: true });
  });
});

const PORTEUR = "alix.durand";
const OPERATEUR = "camille.roy";
const AUTRE_OPERATEUR = "dominique.blin";
const DOSSIER = { porteur: PORTEUR };

/**
 * Ce qu'un pointage donne, du nom de celui qui pointe jusqu'à l'état du contrôle :
 * l'identité rend un rôle, la garde accepte ou refuse, la validation en découle.
 *
 * Rejoué ici parce que le défaut vivait dans l'enchaînement et non dans l'une des
 * trois fonctions prise à part : ce qui ouvre le pointage et ce qui juge une
 * substitution ne lisent pas la même chose de la même personne, et les confondre est
 * précisément le trou que ces scénarios gardent fermé.
 */
function pointage(
  username: string,
  estOperateur: boolean,
  acteurAttendu: Acteur,
  validationBy: Acteur | null,
): { permis: boolean; validation: EtatValidation } {
  const role = roleSurDossier(username, DOSSIER, estOperateur);
  const verdict = peutPointer("EXECUTING", acteurAttendu, { role, operateur: estOperateur });

  if (!verdict.possible || role === null) {
    return { permis: false, validation: "NONE" };
  }
  return {
    permis: true,
    validation: validationApresPointage(acteurAttendu, validationBy, role),
  };
}

/**
 * Deux dimensions et non une : ce qui a été déclaré d'un côté, où en est le contrôle
 * de cette déclaration de l'autre. Les confondre ferait passer pour réglée une étape
 * dont personne n'a encore vérifié la parole, et c'est exactement ce qu'un
 * offboarding ne peut pas se permettre : un accès administrateur reste ouvert
 * jusqu'à preuve du contraire.
 */
describe("acteur attendu et validation d'une étape", () => {
  it("suit une déclaration du porteur jusqu'à sa validation, refus compris", () => {
    // Given une étape confiée à la personne concernée et contrôlée par un opérateur,
    // sur un plan confirmé, à côté d'une étape d'opérateur qui se croit sur parole
    const autre = suivie("SUCCEEDED");

    // When elle la déclare faite
    const apresDeclaration = validationApresPointage("SUBJECT", "OPERATOR", "SUBJECT");
    const declaree = suivie("SUCCEEDED", apresDeclaration);

    // Then la déclaration attend un regard, l'étape n'est pas soldée, le plan reste
    // en cours et le dossier ne se clôt pas
    expect(apresDeclaration).toBe("AWAITING");
    expect(estSoldee(declaree)).toBe(false);
    expect(etatApresPointage([autre, declaree])).toBe("EXECUTING");
    expect(peutClore("OFFBOARDING", "CONFIRMED", "EXECUTING", 2).possible).toBe(false);

    // When l'opérateur refuse avec un motif
    const verdict = peutValider(
      { validationBy: "OPERATOR", validation: "AWAITING", declaredBy: PORTEUR },
      { username: OPERATEUR, role: "OPERATOR" },
    );
    expect(verdict).toEqual({ possible: true });

    // Then l'étape redevient à faire et le plan reste en cours, sans jamais passer
    // par « partiellement exécuté » : celui-là dit qu'un accès est resté ouvert après
    // une tentative, un refus dit que la preuve n'est pas faite.
    const refusee = suivie("PENDING", "REFUSED");
    expect(estSoldee(refusee)).toBe(false);
    expect(etatApresPointage([autre, refusee])).toBe("EXECUTING");

    // Et le refus vaut quel que soit ce qui a été déclaré : même sur une étape restée
    // à « fait », il interdit de la compter pour soldée.
    expect(estSoldee(suivie("SUCCEEDED", "REFUSED"))).toBe(false);

    // When elle redéclare et que l'opérateur accepte
    const acceptee = suivie("SUCCEEDED", "ACCEPTED");

    // Then l'étape est soldée, le plan est exécuté et le dossier se clôt
    expect(estSoldee(acceptee)).toBe(true);
    expect(etatApresPointage([autre, acceptee])).toBe("EXECUTED");
    expect(dossierSoldable(etatApresPointage([autre, acceptee]))).toBe(true);
    expect(peutClore("OFFBOARDING", "CONFIRMED", "EXECUTED", 2)).toEqual({ possible: true });
  });

  it("ne laisse personne valider sa propre déclaration, sans pour autant bloquer un seul mainteneur", () => {
    // Given une étape attendue du porteur et contrôlée par un opérateur
    // When l'opérateur la pointe lui-même en substitution
    // Then elle est acceptée d'emblée : il a vu la chose, et exiger qu'un second
    // opérateur le confirme bloquerait un outil qui n'en a qu'un.
    expect(validationApresPointage("SUBJECT", "OPERATOR", "OPERATOR")).toBe("ACCEPTED");

    // When le porteur déclare puis tente de valider lui-même
    const parLePorteur = peutValider(
      { validationBy: "OPERATOR", validation: "AWAITING", declaredBy: PORTEUR },
      { username: PORTEUR, role: "SUBJECT" },
    );

    // Then refus : sans quoi « j'ai retiré l'accès administrateur » vaudrait preuve
    // parce que son auteur le redit une seconde fois.
    expect(parLePorteur.possible).toBe(false);

    // Given une étape attendue du porteur mais confiée à un délégué pour contrôle,
    // qu'un opérateur pointe en substitution : personne d'attendu ne l'a vue.
    expect(validationApresPointage("SUBJECT", "DELEGATE", "OPERATOR")).toBe("AWAITING");

    const enAttente = {
      validationBy: "DELEGATE",
      validation: "AWAITING",
      declaredBy: OPERATEUR,
    } as const;

    // Then celui qui a déclaré ne valide pas, et la règle porte sur le nom et non sur
    // le rôle : deux opérateurs ne sont pas interchangeables ici.
    expect(peutValider(enAttente, { username: OPERATEUR, role: "OPERATOR" }).possible).toBe(false);
    expect(peutValider(enAttente, { username: AUTRE_OPERATEUR, role: "OPERATOR" })).toEqual({
      possible: true,
    });

    // Et un opérateur contrôle ce qu'un délégué aurait dû contrôler, l'inverse restant
    // faux : le contraire coincerait le dossier dès que le délégué s'évapore.
    expect(
      peutValider(
        { validationBy: "OPERATOR", validation: "AWAITING", declaredBy: PORTEUR },
        { username: AUTRE_OPERATEUR, role: "DELEGATE" },
      ).possible,
    ).toBe(false);

    // Et il n'y a rien à contrôler tant que personne n'a parlé.
    expect(
      peutValider(
        { validationBy: "OPERATOR", validation: "NONE", declaredBy: null },
        { username: OPERATEUR, role: "OPERATOR" },
      ).possible,
    ).toBe(false);
    expect(validationApresPointage("SUBJECT", null, "SUBJECT")).toBe("NONE");
  });

  it("ne laisse chacun toucher que ce qui le regarde, le porteur passant avant l'opérateur", () => {
    // Given un dossier dont le porteur est alix.durand
    // Then chacun est ce qu'il est devant ce dossier-là
    expect(roleSurDossier(PORTEUR, DOSSIER, false)).toBe("SUBJECT");
    expect(roleSurDossier(OPERATEUR, DOSSIER, true)).toBe("OPERATOR");
    expect(roleSurDossier("inconnu.exemple", DOSSIER, false)).toBeNull();

    // Et un opérateur porteur de son propre dossier est porteur, pas opérateur : sans
    // cette priorité, quelqu'un instruirait son propre départ et validerait ses
    // propres cases.
    expect(roleSurDossier(PORTEUR, DOSSIER, true)).toBe("SUBJECT");
    expect(
      peutValider(
        { validationBy: "OPERATOR", validation: "AWAITING", declaredBy: PORTEUR },
        { username: PORTEUR, role: roleSurDossier(PORTEUR, DOSSIER, true) },
      ).possible,
    ).toBe(false);

    // Then le porteur qui n'est pas de l'équipe pointe ce qui lui revient, et rien
    // d'autre
    expect(peutPointer("EXECUTING", "SUBJECT", PORTEUR_SEUL)).toEqual({ possible: true });
    expect(peutPointer("EXECUTING", "OPERATOR", PORTEUR_SEUL).possible).toBe(false);
    expect(peutPointer("EXECUTING", "DELEGATE", PORTEUR_SEUL).possible).toBe(false);

    // Then l'opérateur pointe les trois, la substitution étant ce qui évite qu'une
    // étape confiée à quelqu'un qui s'évapore mure le dossier
    for (const attendu of ["OPERATOR", "SUBJECT", "DELEGATE"] as const) {
      expect(peutPointer("EXECUTING", attendu, TIERS)).toEqual({ possible: true });

      // Et le porteur qui est aussi de l'équipe les pointe tout autant, sur son propre
      // dossier : la priorité du porteur lui retire la signature et non ses gestes. La
      // lire comme un retrait de tout le laissait sans une seule case à cocher sur son
      // propre départ, là où rien ne l'empêchait de confirmer ce dossier, de
      // l'exécuter, de l'annuler ni de le clore.
      expect(peutPointer("EXECUTING", attendu, PORTEUR_OPERATEUR)).toEqual({ possible: true });
    }

    // Then un inconnu ne pointe rien
    expect(peutPointer("EXECUTING", "SUBJECT", INCONNU).possible).toBe(false);

    // Et l'état du plan se juge avant les rôles : sur un brouillon, le refus parle du
    // plan et non de la personne, sans quoi il désignerait le mauvais obstacle.
    expect(peutPointer("DRAFT", "SUBJECT", PORTEUR_SEUL)).toEqual(planPointable("DRAFT"));
    expect(planPointable("EXECUTING")).toEqual({ possible: true });
  });

  it("rend au porteur opérateur les étapes de son propre dossier, sans lui rendre la signature", () => {
    // Given le départ de l'unique mainteneur, dont toutes les étapes attendent un
    // opérateur : c'est ce que ce dépôt produit aujourd'hui, la colonne valant
    // `OPERATOR` par défaut et aucune origine n'en posant d'autre.

    // When il pointe le geste d'opérateur que rien ne contrôle
    // Then il le solde, et le blocage qui le refusait n'avait aucun contrôle à
    // protéger : cette étape se croit sur parole par construction.
    expect(pointage(PORTEUR, true, "OPERATOR", null)).toEqual({
      permis: true,
      validation: "NONE",
    });
    expect(estSoldee(suivie("SUCCEEDED", "NONE"))).toBe(true);

    // When il pointe le geste d'opérateur qu'un opérateur contrôle
    // Then il déclare et ne signe pas : l'étape attend, le plan reste en cours, et le
    // dossier ne se clôt pas tant que personne d'autre n'a regardé.
    const controlee = pointage(PORTEUR, true, "OPERATOR", "OPERATOR");
    expect(controlee).toEqual({ permis: true, validation: "AWAITING" });
    expect(estSoldee(suivie("SUCCEEDED", controlee.validation))).toBe(false);
    expect(etatApresPointage([suivie("SUCCEEDED", controlee.validation)])).toBe("EXECUTING");
    expect(peutClore("OFFBOARDING", "CONFIRMED", "EXECUTING", 1).possible).toBe(false);

    // Then le second regard vient d'un autre nom, et le sien ne fait pas l'affaire
    const enAttente = {
      validationBy: "OPERATOR",
      validation: "AWAITING",
      declaredBy: PORTEUR,
    } as const;
    expect(
      peutValider(enAttente, { username: PORTEUR, role: roleSurDossier(PORTEUR, DOSSIER, true) })
        .possible,
    ).toBe(false);
    expect(peutValider(enAttente, { username: OPERATEUR, role: "OPERATOR" })).toEqual({
      possible: true,
    });

    // Then rien de tout cela ne s'ouvre au porteur qui n'est pas de l'équipe : c'est
    // l'appartenance qui ouvre le pointage, et non le fait de porter le dossier.
    expect(pointage(PORTEUR, false, "OPERATOR", null).permis).toBe(false);
    expect(pointage(PORTEUR, false, "OPERATOR", "OPERATOR").permis).toBe(false);
    expect(pointage("inconnu.exemple", false, "OPERATOR", null).permis).toBe(false);
  });

  it("n'accepte pas d'elle-même la déclaration du porteur qui se trouve être opérateur", () => {
    // Given l'étape que les modèles de plan produiront : le geste revient à la
    // personne concernée, et un opérateur en répond.
    expect(combinaisonValide("SUBJECT", "OPERATOR")).toBe(true);

    // When le porteur, opérateur de surcroît, la déclare faite sur son propre dossier
    const sienne = pointage(PORTEUR, true, "SUBJECT", "OPERATOR");

    // Then elle attend, exactement comme celle d'un porteur ordinaire, et c'est le
    // mur : le rôle du déclarant reste celui du porteur. Le lui faire rendre
    // « OPERATOR » pour lui ouvrir le pointage le ferait passer pour un opérateur
    // substitué à la personne concernée, `validationApresPointage` y lirait une
    // substitution, et il signerait sa propre déclaration sur son propre départ.
    expect(sienne).toEqual({ permis: true, validation: "AWAITING" });
    expect(pointage(PORTEUR, false, "SUBJECT", "OPERATOR")).toEqual(sienne);
    expect(estSoldee(suivie("SUCCEEDED", sienne.validation))).toBe(false);
    expect(etatApresPointage([suivie("SUCCEEDED", sienne.validation)])).toBe("EXECUTING");

    // Then il ne la signe pas davantage à la main : devant son propre dossier il est
    // la personne concernée, et elle ne contrôle pas ce qu'on déclare sur elle.
    expect(
      peutValider(
        { validationBy: "OPERATOR", validation: "AWAITING", declaredBy: PORTEUR },
        { username: PORTEUR, role: roleSurDossier(PORTEUR, DOSSIER, true) },
      ).possible,
    ).toBe(false);

    // Et la substitution reste ce qu'elle est pour l'opérateur qui ne porte pas le
    // dossier : lui a bien vu la chose à la place de quelqu'un d'autre.
    expect(pointage(OPERATEUR, true, "SUBJECT", "OPERATOR")).toEqual({
      permis: true,
      validation: "ACCEPTED",
    });

    // Et le contrôle confié à un délégué n'accepte personne d'emblée, faute que
    // quiconque puisse être ce délégué aujourd'hui.
    for (const qui of [PORTEUR, OPERATEUR]) {
      expect(pointage(qui, true, "SUBJECT", "DELEGATE").validation).toBe("AWAITING");
    }
  });

  it("garde en cours un plan dont tout est coché mais dont une étape attend", () => {
    // Given des étapes toutes déclarées, dont une qui attend un regard
    const enAttente = [suivie("SUCCEEDED"), suivie("SKIPPED"), suivie("SUCCEEDED", "AWAITING")];

    // Then une seule en attente suffit à garder le plan en cours et à interdire la
    // clôture : le compteur des restantes la voit sans autre modification.
    expect(etatApresPointage(enAttente)).toBe("EXECUTING");
    expect(dossierSoldable(etatApresPointage(enAttente))).toBe(false);
    expect(peutClore("OFFBOARDING", "CONFIRMED", etatApresPointage(enAttente), 3).possible).toBe(
      false,
    );
    expect(enAttente.filter((etape) => !estSoldee(etape))).toHaveLength(1);

    // Then une étape en échec et une étape en attente donnent « en cours » et non
    // « partiellement exécuté » : quelque chose bouge encore.
    const echecEtAttente = [suivie("FAILED"), suivie("SUCCEEDED", "AWAITING")];
    expect(etatApresPointage(echecEtAttente)).toBe("EXECUTING");

    // Then une fois la dernière validation rendue, le verdict retombe sur ce que
    // disent les déclarations.
    expect(etatApresPointage([suivie("FAILED"), suivie("SUCCEEDED", "ACCEPTED")])).toBe(
      "PARTIALLY_EXECUTED",
    );
    expect(etatApresPointage([suivie("SKIPPED"), suivie("SUCCEEDED", "ACCEPTED")])).toBe(
      "EXECUTED",
    );
  });

  it("n'admet que quatre répartitions de rôles sur les neuf que les rôles permettent", () => {
    const acteurs: readonly Acteur[] = ["OPERATOR", "SUBJECT", "DELEGATE"];

    // Then les quatre répartitions admises, et elles seules
    // Un opérateur contrôle le porteur, et un opérateur contrôle le délégué : le
    // second regard vient de l'équipe qui répond du dossier.
    expect(combinaisonValide("SUBJECT", "OPERATOR")).toBe(true);
    expect(combinaisonValide("DELEGATE", "OPERATOR")).toBe(true);

    // Un délégué contrôle le porteur : celui qui l'accueille répond de ce qu'il déclare.
    expect(combinaisonValide("SUBJECT", "DELEGATE")).toBe(true);

    // Un opérateur contrôle un opérateur, et c'est l'exemple qui a fait naître tout
    // ceci : « j'ai retiré l'accès administrateur » est un geste d'opérateur, et c'est
    // justement celui qui ne se croit pas sur parole. Ce n'est pas son auteur qui le
    // redit, la règle qui l'interdit portant sur le username : deux opérateurs sont
    // deux personnes, et `peutValider` s'en charge.
    expect(combinaisonValide("OPERATOR", "OPERATOR")).toBe(true);

    const valides = acteurs.flatMap((attendu) =>
      acteurs.filter((valideur) => combinaisonValide(attendu, valideur)),
    );
    expect(valides).toHaveLength(4);

    // Then la personne concernée ne contrôle jamais, quel que soit l'acteur attendu :
    // c'est elle qu'on contrôle.
    for (const attendu of acteurs) {
      expect(combinaisonValide(attendu, "SUBJECT")).toBe(false);
    }

    // Then un délégué ne contrôle jamais un opérateur : faire relire l'équipe
    // transverse par quelqu'un d'extérieur au dossier inverse la responsabilité.
    expect(combinaisonValide("OPERATOR", "DELEGATE")).toBe(false);

    // Then un délégué ne contrôle pas non plus un délégué : rien ne sait aujourd'hui
    // les distinguer l'un de l'autre, `roleSurDossier` ne rendant jamais `DELEGATE`,
    // là où `OPERATOR` sort d'une liste nommée.
    expect(combinaisonValide("DELEGATE", "DELEGATE")).toBe(false);

    // Then une étape sans contrôle est valide quel que soit son acteur : c'est le cas
    // de tout ce qui se croit sur parole, et de tout ce que les connecteurs calculent.
    for (const attendu of acteurs) {
      expect(combinaisonValide(attendu, null)).toBe(true);
    }
  });

  it("garde en attente le geste d'opérateur que son propre auteur pointe", () => {
    // Given une étape d'opérateur sous le regard d'un opérateur, celle qui n'existait
    // pas jusqu'ici : un accès d'administration qu'on retire ne se croit pas sur parole
    expect(combinaisonValide("OPERATOR", "OPERATOR")).toBe(true);

    // When un opérateur la pointe : c'est son geste, pas une substitution
    const apresDeclaration = validationApresPointage("OPERATOR", "OPERATOR", "OPERATOR");

    // Then elle attend, et c'est tout l'objet de la répartition : sans cela, celui qui
    // agit se validerait du seul fait de porter le rôle qui contrôle, et l'étape se
    // solderait sans que personne d'autre n'ait regardé.
    expect(apresDeclaration).toBe("AWAITING");
    expect(estSoldee(suivie("SUCCEEDED", apresDeclaration))).toBe(false);
    expect(etatApresPointage([suivie("SUCCEEDED", apresDeclaration)])).toBe("EXECUTING");

    // Then son auteur ne la contrôle pas, et un autre opérateur le fait : la règle
    // porte sur le nom, et c'est elle qui rend cette répartition tenable.
    const enAttente = {
      validationBy: "OPERATOR",
      validation: "AWAITING",
      declaredBy: OPERATEUR,
    } as const;
    expect(peutValider(enAttente, { username: OPERATEUR, role: "OPERATOR" }).possible).toBe(false);
    expect(peutValider(enAttente, { username: AUTRE_OPERATEUR, role: "OPERATOR" })).toEqual({
      possible: true,
    });

    // Then la substitution reste ce qu'elle était sur les autres répartitions : un
    // opérateur qui pointe à la place du porteur a vu la chose, et signe du même coup.
    expect(validationApresPointage("SUBJECT", "OPERATOR", "OPERATOR")).toBe("ACCEPTED");
    expect(validationApresPointage("DELEGATE", "OPERATOR", "OPERATOR")).toBe("ACCEPTED");
  });
});

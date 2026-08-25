import { describe, expect, it } from "vitest";

import {
  decider,
  issueDeLEtape,
  issueDUneException,
  ordreDExecution,
  peutExecuter,
  refusDEcart,
} from "@/core/execution";

/**
 * `dryRun` arrive toujours par paramètre, jamais depuis un module : ces deux
 * constantes nomment les deux régimes pour que chaque scénario dise lequel il exerce,
 * et pour que rien ici ne ressemble à un interrupteur qu'on pourrait forcer ailleurs.
 */
const SIMULATION = true;
const AUTORISEE = false;

describe("la décision d'une étape", () => {
  it("ne change rien en simulation quand l'étape est prête, et solde quand même ce qui est déjà fait", () => {
    // Given une étape prête, que la boucle saurait exécuter
    // When on décide en simulation
    const prete = decider({ state: "READY" }, SIMULATION, true);

    // Then aucun état ne bouge, et c'est la seule réponse honnête : « fait » ferait
    // mentir le dossier, « écartée » ferait croire qu'un humain l'a jugée
    expect(prete.geste).toBe("aucun");
    expect(prete.etat).toBeNull();
    expect(prete.resultat).toBe("SKIPPED");
    expect(prete.motif).toContain("ACTIONS_ENABLED");

    // When le précheck constate en revanche que l'accès est déjà ouvert
    const deja = decider({ state: "ALREADY_PRESENT" }, SIMULATION, true);

    // Then l'étape est soldée, en simulation comme hors : le précheck est une
    // lecture, son verdict vaut dans les deux régimes, et c'est là son meilleur usage
    expect(deja).toMatchObject({ geste: "aucun", etat: "ALREADY_PRESENT", resultat: "SUCCESS" });
    expect(decider({ state: "ALREADY_PRESENT" }, AUTORISEE, true).etat).toBe("ALREADY_PRESENT");

    // Then le symétrique vaut pour un départ
    expect(decider({ state: "ALREADY_ABSENT" }, SIMULATION, true).etat).toBe("ALREADY_ABSENT");

    // Then hors simulation, la même étape prête part
    const part = decider({ state: "READY" }, AUTORISEE, true);
    expect(part).toMatchObject({ geste: "executer", etat: null, resultat: "SUCCESS" });
  });

  it("n'exécute jamais un écart de rôle, et le dit en nommant l'attendu et le constaté", () => {
    // Given un précheck qui constate un autre rôle que celui du plan : c'est le
    // piège d'un octroi, qu'un système accepte de refaire en escaladant le privilège
    const stale = { state: "STALE", expected: { role: "member" }, actual: { role: "admin" } };

    for (const regime of [SIMULATION, AUTORISEE]) {
      // When on décide, dans un régime comme dans l'autre
      const decision = decider(stale as never, regime, true);

      // Then rien ne part, et l'étape porte l'écart plutôt qu'un succès
      expect(decision.geste).toBe("aucun");
      expect(decision.etat).toBe("STALE");
      expect(decision.resultat).toBe("SKIPPED");
      expect(decision.motif).toContain('"role":"member"');
      expect(decision.motif).toContain('"role":"admin"');
      expect(decision.motif).toContain("idempotent");
    }
  });

  it("laisse une étape manuelle à la main de l'opérateur, précheck ou pas", () => {
    // Given une étape qu'aucune voie automatique ne porte
    // When on décide hors simulation
    const manuelle = decider(null, AUTORISEE, false);

    // Then rien ne part et rien ne bouge : la boucle ne coche pas à la place de
    // l'humain, et le journal dit qu'elle l'attend
    expect(manuelle).toMatchObject({ geste: "aucun", etat: null, resultat: "SKIPPED" });
    expect(manuelle.motif).toContain("main");

    // Then le précheck la solde quand même, ce qui est tout l'intérêt de le faire
    // tourner sur une étape manuelle : n'envoyer personne faire ce qui est déjà fait
    expect(decider({ state: "ALREADY_PRESENT" }, AUTORISEE, false).etat).toBe("ALREADY_PRESENT");
  });
});

describe("l'ordre d'exécution", () => {
  it("passe par ce qui se défait le plus facilement, sans toucher au rang de lecture", () => {
    // Given un plan dont le rang de lecture range l'irréversible en premier
    const etapes = [
      { cle: "irreversible-risque", ordre: 0, riskLevel: "high" as const },
      { cle: "reversible-court", ordre: 1, reversibleForDays: 7, riskLevel: "high" as const },
      { cle: "irreversible-douce", ordre: 2, riskLevel: "low" as const },
      { cle: "reversible-long", ordre: 3, reversibleForDays: 30, riskLevel: "high" as const },
    ];

    // When on calcule l'ordre d'exécution
    const ordonnees = ordreDExecution(etapes);

    // Then la réversibilité décroissante décide, le risque départage à égalité, et le
    // rang de lecture ne tranche qu'en dernier : une exécution interrompue laisse
    // derrière elle ce qu'on sait le mieux défaire
    expect(ordonnees.map(({ cle }) => cle)).toEqual([
      "reversible-long",
      "reversible-court",
      "irreversible-douce",
      "irreversible-risque",
    ]);

    // Then le plan n'a pas été réécrit : les rangs de lecture sont intacts, et deux
    // exécutions du même plan se dérouleront dans le même ordre
    expect(etapes.map(({ ordre }) => ordre)).toEqual([0, 1, 2, 3]);
    expect(ordreDExecution(etapes).map(({ cle }) => cle)).toEqual(ordonnees.map(({ cle }) => cle));
  });
});

describe("les gardes d'une exécution", () => {
  it("refuse en bloc ce qui n'est plus le plan approuvé, et ne part que d'un plan confirmé", () => {
    // Given un plan confirmé sous une empreinte
    // When le recalcul rend la même
    expect(refusDEcart("abcd1234", "abcd1234")).toBeNull();

    // When il en rend une autre : une collecte est passée entre l'approbation et le
    // départ, et ce qu'on exécuterait n'est plus ce qui a été relu
    const ecart = refusDEcart("abcd1234", "0000ffff");
    expect(ecart).toContain("plus ce qui a été approuvé");
    expect(ecart).toContain("Rien n'a été exécuté");

    // When le plan ne porte aucune empreinte confirmée : rien ne dit ce qui a été
    // approuvé, donc il n'y a rien à comparer et rien à exécuter
    expect(refusDEcart(null, "abcd1234")).toContain("aucune empreinte confirmée");

    // Then seul un plan engagé s'exécute, et un plan dont une étape a échoué se
    // reprend, sans quoi le dossier serait muré
    expect(peutExecuter("EXECUTING")).toEqual({ possible: true });
    expect(peutExecuter("PARTIALLY_EXECUTED")).toEqual({ possible: true });
    expect(peutExecuter("DRAFT").possible).toBe(false);
    expect(peutExecuter("EXECUTED").possible).toBe(false);
    expect(peutExecuter("CANCELLED").possible).toBe(false);
  });
});

describe("ce qu'un connecteur rend", () => {
  it("devient l'état de l'étape, et une exception n'est jamais lue comme un verdict", () => {
    // Given un connecteur qui rend un succès réversible
    const jusqua = new Date("2026-09-01T00:00:00Z");
    const reussi = issueDeLEtape({
      state: "SUCCEEDED",
      reversibleUntil: jusqua,
      evidence: "invité",
    });

    // Then l'étape est faite, la fenêtre de réversibilité est reprise telle quelle
    expect(reussi).toMatchObject({
      etat: "SUCCEEDED",
      resultat: "SUCCESS",
      reversibleUntil: jusqua,
    });
    expect(reussi.motif).toBe("invité");

    // Given un échec que le connecteur dit reprenable, puis un qu'il dit définitif
    expect(issueDeLEtape({ state: "FAILED", error: "429", retryable: true })).toMatchObject({
      etat: "FAILED",
      resultat: "FAILURE",
      erreur: "429",
    });
    expect(issueDeLEtape({ state: "FAILED", error: "403", retryable: false }).motif).toContain(
      "échouera de la même façon",
    );

    // Given un connecteur qui lève au lieu de rendre un verdict
    const leve = issueDUneException(new Error("socket fermée"));

    // Then l'étape échoue, et la cause est recopiée plutôt que reformulée en avis
    // que personne n'a donné
    expect(leve).toMatchObject({ etat: "FAILED", resultat: "FAILURE", erreur: "socket fermée" });
    expect(leve.motif).toContain("exception");
  });
});

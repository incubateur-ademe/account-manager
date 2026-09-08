import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditInput } from "@/core/audit";

import { actionTracee } from "./actions";
import type { Utilisateur } from "./session";

/**
 * La session est un réglage du scénario, et tout ce qui traverse le passage tracé est
 * relevé dans l'ordre où il se produit : c'est cet ordre qui porte l'invariant, pas le
 * contenu des lignes.
 */
const base = vi.hoisted(() => ({
  session: null as unknown,
  gardes: [] as string[],
  gestes: [] as string[],
  journal: [] as { actorUsername?: string; result: string; after: unknown }[],
}));

function refus(): Promise<never> {
  const digest = "NEXT_REDIRECT;replace;/login;307;";
  const erreur = new Error(digest);
  Object.assign(erreur, { digest });
  return Promise.reject(erreur);
}

vi.mock("@/lib/session", () => ({
  requireOperateur: () => {
    base.gardes.push("requireOperateur");
    const session = base.session as Utilisateur | null;
    return session?.operateur === true ? Promise.resolve(session) : refus();
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: (entree: AuditInput) => {
    base.gestes.push(`journal:${entree.result}`);
    base.journal.push({
      ...(entree.actorUsername === undefined ? {} : { actorUsername: entree.actorUsername }),
      result: entree.result,
      after: entree.after,
    });
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => {
    base.gestes.push(`revalidation:${chemin}`);
  },
}));

const DOSSIER = "dos_0000000000000000000000";
const FICHE = "per_0000000000000000000000";

function operatrice(): Utilisateur {
  return {
    username: "operatrice.exemple",
    email: null,
    nom: null,
    personId: null,
    voie: "ESPACE_MEMBRE",
    operateur: true,
  };
}

function participante(): Utilisateur {
  return {
    username: "camille.exemple",
    email: "camille@exemple.org",
    nom: null,
    personId: FICHE,
    voie: "ADRESSE",
    operateur: false,
  };
}

beforeEach(() => {
  base.session = null;
  base.gardes = [];
  base.gestes = [];
  base.journal = [];
});

describe("le passage tracé, élargi au-delà des opérateurs", () => {
  it("écrit la trace avant l'action, la dément en échec, et dit par quelle porte on est entré", async () => {
    // Given une opératrice connectée et une action qui ne nomme aucun acteur.
    base.session = operatrice();

    // When elle écrit par le passage tracé.
    const resultat = await actionTracee({
      action: "dossier.cloture",
      targetType: "plan",
      targetId: DOSSIER,
      after: { etat: "DONE" },
      revalider: [`/dossiers/${DOSSIER}`],
      ecrire: (utilisateur) => {
        base.gestes.push(`écriture par ${utilisateur.username}`);
        return Promise.resolve("soldé");
      },
    });

    // Then le défaut reste l'opérateur.
    expect(base.gardes).toEqual(["requireOperateur"]);
    expect(resultat).toBe("soldé");

    // Then la trace précède l'écriture, qui précède la revalidation.
    expect(base.gestes).toEqual([
      "journal:SUCCESS",
      "écriture par operatrice.exemple",
      `revalidation:/dossiers/${DOSSIER}`,
    ]);

    // Then la charge utile porte la voie en plus de ce que l'appelant a fourni : sans
    // elle, un identifiant de fiche et un username beta.gouv se liraient pareil.
    expect(base.journal).toEqual([
      {
        actorUsername: "operatrice.exemple",
        result: "SUCCESS",
        after: { etat: "DONE", voie: "ESPACE_MEMBRE" },
      },
    ]);

    // When l'écriture échoue après que l'intention a été journalisée.
    base.gestes = [];
    base.journal = [];
    const panne = actionTracee({
      action: "dossier.cloture",
      targetType: "plan",
      targetId: DOSSIER,
      revalider: [`/dossiers/${DOSSIER}`],
      ecrire: () => Promise.reject(new Error("la base a refusé")),
    });

    // Then l'erreur remonte, aucune revalidation n'a lieu, et le journal dément.
    await expect(panne).rejects.toThrow("la base a refusé");
    expect(base.gestes).toEqual(["journal:SUCCESS", "journal:FAILURE"]);
    expect(base.journal.map((ligne) => ligne.result)).toEqual(["SUCCESS", "FAILURE"]);
    // Une action sans charge utile en gagne une, qui ne dit que la voie.
    expect(base.journal[1]?.after).toEqual({ voie: "ESPACE_MEMBRE" });

    // When personne n'est connecté.
    base.session = null;
    base.gestes = [];
    base.journal = [];

    // Then la garde refuse avant toute trace et avant toute écriture.
    await expect(
      actionTracee({
        action: "dossier.cloture",
        targetType: "plan",
        targetId: DOSSIER,
        ecrire: () => {
          base.gestes.push("écriture");
          return Promise.resolve(null);
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(base.gestes).toEqual([]);
    expect(base.journal).toEqual([]);
  });

  it("fait confiance à l'acteur que l'appelant a déjà résolu, sans le relire", async () => {
    // Given une action qui a eu besoin du nom avant d'écrire, donc qui a résolu
    // l'utilisateur et posé sa garde elle-même.
    base.session = null;

    // When elle passe cet acteur plutôt que de laisser le passage le résoudre.
    const resultat = await actionTracee({
      action: "dossier.pointage",
      targetType: "etape",
      targetId: `${DOSSIER}:1`,
      after: { verdict: "fait" },
      utilisateur: participante(),
      ecrire: (utilisateur) => Promise.resolve(utilisateur.username),
    });

    // Then aucune seconde résolution n'a lieu : un second endroit où lire le droit
    // serait un second endroit où le lire autrement, et la session d'une participante
    // ne franchirait pas la garde d'opérateur.
    expect(base.gardes).toEqual([]);
    expect(resultat).toBe("camille.exemple");

    // Then la trace nomme cet acteur-là et porte sa voie.
    expect(base.journal).toEqual([
      {
        actorUsername: "camille.exemple",
        result: "SUCCESS",
        after: { verdict: "fait", voie: "ADRESSE" },
      },
    ]);
  });
});

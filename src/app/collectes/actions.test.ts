import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le seul chemin par lequel on sorte d'un plancher installé traverse une action de
 * serveur, et il n'est gardé nulle part ailleurs : le noyau sait reconnaître la
 * famille du périmètre, mais c'est cette action qui reçoit ce que l'écran poste, en
 * chaîne libre, et qui décide de l'écrire ou de la refuser. Une famille annoncée en
 * tête d'écran et refusée ici laisserait un bandeau dont le bouton rend une erreur,
 * c'est-à-dire exactement le défaut que cette sortie existe pour fermer.
 */
/** Une autorisation telle que la table la garde, dépensée ou non. */
interface AutorisationEnBase {
  provider: string;
  famille: string;
  reason: string;
  createdBy: string;
  consumedAt: Date | null;
}

const base = vi.hoisted(() => ({
  autorisations: [] as AutorisationEnBase[],
  journal: [] as { action: string; targetId: string | null; result: string }[],
}));

/**
 * Ce que la requête des autorisations énonce, et rien de plus.
 *
 * Les clés sont facultatives parce que c'est exactement ce qui se prouve ici : un
 * double qui rejouerait de son côté la condition qu'il reçoit rendrait sa disparition
 * du code de production invisible. Celle qui manquerait le plus est `consumedAt` : sans
 * elle, la première décision posée sur un système fermerait la sortie pour de bon, une
 * décision déjà dépensée continuant de passer pour en attente.
 */
interface FiltreDAutorisation {
  provider: string;
  famille: string;
  consumedAt?: null;
}

function attendue(posee: AutorisationEnBase, where: FiltreDAutorisation): boolean {
  return (
    posee.provider === where.provider &&
    posee.famille === where.famille &&
    (where.consumedAt === undefined || posee.consumedAt === where.consumedAt)
  );
}

vi.mock("@/lib/session", () => ({
  requireOperateur: () =>
    Promise.resolve({
      username: "capucine.exemple",
      email: "capucine.exemple@beta.gouv.fr",
      nom: "Capucine Exemple",
      personId: null,
      voie: "espace-membre",
      operateur: true,
    }),
}));

vi.mock("@/lib/db", () => ({
  deconnecter: () => Promise.resolve(),
  prisma: {
    scopeDropOverride: {
      findFirst: ({ where }: { where: FiltreDAutorisation }) => {
        const rang = base.autorisations.findIndex((posee) => attendue(posee, where));
        return Promise.resolve(rang === -1 ? null : { id: `autorisation-${rang + 1}` });
      },
      create: ({
        data,
      }: {
        data: { provider: string; famille: string; reason: string; createdBy: string };
      }) => {
        base.autorisations.push({ ...data, consumedAt: null });
        return Promise.resolve({ id: `autorisation-${base.autorisations.length}` });
      },
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: (entree: { action: string; targetId?: string | null; result: string }) => {
    base.journal.push({
      action: entree.action,
      targetId: entree.targetId ?? null,
      result: entree.result,
    });
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/sync/executer", () => ({
  collecteEnCours: () => Promise.resolve(null),
  executerSync: () => Promise.resolve(undefined),
}));

const { autoriserDatation } = await import("./actions");

function poste(champs: Record<string, string>): FormData {
  const formulaire = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) {
    formulaire.set(cle, valeur);
  }
  return formulaire;
}

describe("ce que l'action de sortie accepte de l'écran qui l'appelle", () => {
  beforeEach(() => {
    base.autorisations.length = 0;
    base.journal.length = 0;
  });

  it("écrit la décision du périmètre comme celle des systèmes cibles, et refuse ce qu'aucun écran n'annonce", async () => {
    // Given le bandeau des blocages installés, qui annonce le plancher du périmètre au
    // même titre que ceux des systèmes cibles et poste la même chose.
    // When une opératrice tranche depuis ce bandeau-là.
    const perimetre = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
      }),
    );

    // Then l'action l'accepte, la ligne est écrite pour la prochaine collecte, et le
    // journal garde nominativement la décision avant elle.
    expect(perimetre).toBeNull();
    expect(base.autorisations).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        reason: "quatre fins de mission groupées, vérifiées une par une",
        createdBy: "capucine.exemple",
        consumedAt: null,
      },
    ]);
    expect(base.journal).toEqual([
      { action: "sync.gardefou.autorise", targetId: "espace-membre", result: "SUCCESS" },
    ]);

    // When la même opératrice recommence alors que sa première décision attend encore.
    const seconde = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "les mêmes quatre départs",
      }),
    );

    // Then rien n'est écrit : une autorisation qui attend est une décision en cours,
    // et en empiler une seconde ferait lever le garde-fou deux fois.
    expect(seconde).toEqual({
      erreur: "Une autorisation attend déjà la prochaine collecte pour ce système.",
    });
    expect(base.autorisations).toHaveLength(1);

    // When la collecte suivante dépense cette décision, et qu'une chute revient.
    const posee = base.autorisations[0];
    if (!posee) {
      throw new Error("la première décision devrait être en base");
    }
    posee.consumedAt = new Date("2026-09-05T04:30:00Z");
    const apres = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "trois départs de plus, vérifiés eux aussi",
      }),
    );

    // Then l'écran en accepte une nouvelle : ce qui interdit d'en poser une seconde est
    // qu'une décision attende, pas qu'il y en ait eu une. Confondre les deux fermerait
    // la sortie pour de bon dès le premier usage, et c'est le gel que ce lot existe
    // pour dénouer qui redeviendrait sans issue.
    expect(apres).toBeNull();
    expect(base.autorisations).toHaveLength(2);
    expect(base.journal).toHaveLength(2);

    // When ce qui arrive ne correspond à aucune famille que le noyau reconnaisse, la
    // valeur venant d'un formulaire et donc d'une chaîne libre.
    const inconnue = await autoriserDatation(
      null,
      poste({ provider: "espace-membre", famille: "effectifs", raison: "au hasard" }),
    );

    // Then l'action refuse sans rien écrire, et sans rien journaliser non plus : une
    // intention refusée n'est pas une décision.
    expect(inconnue).toEqual({ erreur: "Famille de garde-fou non reconnue." });
    expect(base.autorisations).toHaveLength(2);
    expect(base.journal).toHaveLength(2);
  });
});

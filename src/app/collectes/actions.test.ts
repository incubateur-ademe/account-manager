import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le seul chemin par lequel on sorte d'un plancher installé traverse une action de
 * serveur, et il n'est gardé nulle part ailleurs : le noyau sait reconnaître la
 * famille du périmètre, mais c'est cette action qui reçoit ce que l'écran poste, en
 * chaîne libre, et qui décide de l'écrire ou de la refuser. Une famille annoncée en
 * tête d'écran et refusée ici laisserait un bandeau dont le bouton rend une erreur,
 * c'est-à-dire exactement le défaut que cette sortie existe pour fermer.
 *
 * Ce qu'elle écrit décide ensuite de ce que la collecte datera : les nombres portés par
 * la ligne sont l'ampleur contre laquelle la chute du soir se mesure. Les prendre pour
 * argent comptant ferait de ce formulaire la porte par laquelle on choisit cette
 * ampleur, et c'est pourquoi ils se recalculent ici plutôt que de se croire.
 */
/** Une autorisation telle que la table la garde, dépensée ou non. */
interface AutorisationEnBase {
  provider: string;
  famille: string;
  reason: string;
  createdBy: string;
  /** Les nombres du refus tels que le bandeau les montrait à qui a tranché. */
  observe: number | null;
  reference: number | null;
  consumedAt: Date | null;
}

/** Un passage tel que la table des runs le garde, et sa trace en JSON libre. */
interface RunEnBase {
  provider: string;
  startedAt: Date;
  error: unknown;
}

const base = vi.hoisted(() => ({
  autorisations: [] as AutorisationEnBase[],
  runs: [] as RunEnBase[],
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
    // Les passages tels quels, et c'est le point : ce que l'action compare à ce qu'on
    // lui poste, elle le retire de cette table par la fonction même que l'écran appelle
    // pour l'afficher. Un double qui rendrait des blocages tout faits laisserait les
    // deux côtés s'accorder chacun dans son coin.
    syncRun: {
      findMany: ({ take }: { take: number }) =>
        Promise.resolve(
          [...base.runs]
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            .slice(0, take)
            .map((run) => ({ provider: run.provider, error: run.error })),
        ),
    },
    scopeDropOverride: {
      findFirst: ({ where }: { where: FiltreDAutorisation }) => {
        const rang = base.autorisations.findIndex((posee) => attendue(posee, where));
        return Promise.resolve(rang === -1 ? null : { id: `autorisation-${rang + 1}` });
      },
      create: ({
        data,
      }: {
        data: {
          provider: string;
          famille: string;
          reason: string;
          createdBy: string;
          observe: number | null;
          reference: number | null;
        };
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

function poste(champs: Record<string, string | number>): FormData {
  const formulaire = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) {
    formulaire.set(cle, String(valeur));
  }
  return formulaire;
}

/** Le début d'un passage, à l'heure du traitement quotidien. */
function nuit(index: number): Date {
  return new Date(Date.UTC(2026, 8, 1 + index, 4, 30, 0));
}

/**
 * Trois nuits qui refusent la même chute du périmètre, chacune portant l'âge du relevé
 * qu'elle a laissé vieillir : c'est ce qui ouvre le bandeau. Les traces sont posées
 * telles qu'un passage les écrit, et non des blocages tout faits, pour que ce que
 * l'action retrouve soit ce que l'écran affiche et non ce qu'un double aurait décidé
 * pour eux deux.
 */
function plancherDuPerimetre(observe: number, reference: number): void {
  for (const passage of [1, 2, 3]) {
    base.runs.push({
      provider: "espace-membre",
      startedAt: nuit(passage),
      error: { refus: [{ famille: "perimetre", observe, reference }], ageDuReleve: passage },
    });
  }
}

/** Trois nuits qui refusent la même chute de comptes sur un système cible. */
function chuteDesComptes(provider: string, observe: number, reference: number): void {
  for (const passage of [1, 2, 3]) {
    base.runs.push({
      provider,
      startedAt: nuit(passage),
      error: { refus: [{ famille: "identites", observe, reference }] },
    });
  }
}

describe("ce que l'action de sortie accepte de l'écran qui l'appelle", () => {
  beforeEach(() => {
    base.autorisations.length = 0;
    base.runs.length = 0;
    base.journal.length = 0;
  });

  it("écrit la décision du périmètre comme celle des systèmes cibles, avec les nombres du bandeau", async () => {
    // Given le bandeau des blocages installés, qui annonce le plancher du périmètre au
    // même titre que ceux des systèmes cibles et poste la même chose.
    plancherDuPerimetre(9, 13);
    chuteDesComptes("ovh", 12, 31);

    // When une opératrice tranche depuis ce bandeau-là, sur les nombres qu'il montre.
    const perimetre = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 9,
        reference: 13,
      }),
    );

    // Then l'action l'accepte, la ligne est écrite pour la prochaine collecte avec
    // l'ampleur sur laquelle elle a été prise, et le journal garde nominativement la
    // décision avant elle.
    expect(perimetre).toBeNull();
    expect(base.autorisations).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        reason: "quatre fins de mission groupées, vérifiées une par une",
        createdBy: "capucine.exemple",
        observe: 9,
        reference: 13,
        consumedAt: null,
      },
    ]);
    expect(base.journal).toEqual([
      { action: "sync.gardefou.autorise", targetId: "espace-membre", result: "SUCCESS" },
    ]);

    // When elle tranche aussi sur le garde-fou d'un système cible, depuis le même écran.
    const comptes = await autoriserDatation(
      null,
      poste({
        provider: "ovh",
        famille: "identites",
        raison: "purge des comptes de test, vérifiée ce matin",
        observe: 12,
        reference: 31,
      }),
    );

    // Then rien ne l'en distingue : même porte, mêmes nombres figés, même trace.
    expect(comptes).toBeNull();
    expect(base.autorisations[1]).toMatchObject({
      provider: "ovh",
      famille: "identites",
      observe: 12,
      reference: 31,
    });

    // When la même opératrice recommence alors que sa première décision attend encore.
    const seconde = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "les mêmes quatre départs",
        observe: 9,
        reference: 13,
      }),
    );

    // Then rien n'est écrit : une autorisation qui attend est une décision en cours,
    // et en empiler une seconde ferait lever le garde-fou deux fois.
    expect(seconde).toEqual({
      erreur: "Une autorisation attend déjà la prochaine collecte pour ce système.",
    });
    expect(base.autorisations).toHaveLength(2);

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
        observe: 9,
        reference: 13,
      }),
    );

    // Then l'écran en accepte une nouvelle : ce qui interdit d'en poser une seconde est
    // qu'une décision attende, pas qu'il y en ait eu une. Confondre les deux fermerait
    // la sortie pour de bon dès le premier usage, et c'est le gel que ce lot existe
    // pour dénouer qui redeviendrait sans issue.
    expect(apres).toBeNull();
    expect(base.autorisations).toHaveLength(3);
    expect(base.journal).toHaveLength(3);

    // When ce qui arrive ne correspond à aucune famille que le noyau reconnaisse, la
    // valeur venant d'un formulaire et donc d'une chaîne libre.
    const inconnue = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "effectifs",
        raison: "au hasard",
        observe: 9,
        reference: 13,
      }),
    );

    // Then l'action refuse sans rien écrire, et sans rien journaliser non plus : une
    // intention refusée n'est pas une décision.
    expect(inconnue).toEqual({ erreur: "Famille de garde-fou non reconnue." });
    expect(base.autorisations).toHaveLength(3);
    expect(base.journal).toHaveLength(3);
  });

  it("refuse les nombres qu'aucun écran du moment n'annonce, et le dit au lieu de les écrire", async () => {
    // Given le bandeau qui annonce neuf personnes contre treize.
    plancherDuPerimetre(9, 13);

    // When ce qui arrive porte d'autres nombres que ceux-là : un onglet ouvert la
    // veille, dont le passage du soir a creusé la chute, ou un envoi fabriqué qui
    // choisit son ampleur.
    const autres = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 3,
        reference: 13,
      }),
    );

    // Then l'action refuse, et rien n'est écrit. C'est tout l'objet du recalcul : crus
    // sur parole, ces nombres deviendraient l'ampleur contre laquelle la collecte
    // mesure la chute du soir, et le formulaire serait la porte par laquelle on écrit
    // la sienne.
    expect(autres).toEqual({
      erreur:
        "La chute a changé depuis l'affichage de cette page. Rechargez-la et décidez sur les nombres du jour : une décision porte l'ampleur qu'on avait sous les yeux, et rien de plus profond ne sera daté sur elle.",
    });
    expect(base.autorisations).toEqual([]);
    expect(base.journal).toEqual([]);

    // When ce qui arrive n'en porte aucun, comme le ferait une page d'avant que le
    // formulaire ne les poste.
    const muet = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
      }),
    );

    // Then même refus : une décision sans ampleur ne se mesure pas, et l'accueillir
    // reviendrait à écrire une ligne que la collecte écartera sans que personne ne
    // sache pourquoi.
    expect(muet?.erreur).toContain("Rechargez-la");
    expect(base.autorisations).toEqual([]);

    // When l'amont se répare pendant que l'onglet reste ouvert : plus aucun passage ne
    // refuse, et le bandeau n'a plus rien à annoncer.
    base.runs.length = 0;
    const guerie = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 9,
        reference: 13,
      }),
    );

    // Then l'action refuse encore, et le dit autrement : la sortie ne s'offre que sous
    // un refus, et une décision posée sans lui attendrait un passage qui ne la prendra
    // peut-être jamais, en interdisant entre-temps d'en poser une autre.
    expect(guerie?.erreur).toContain("ne bloque plus rien");
    expect(base.autorisations).toEqual([]);
    expect(base.journal).toEqual([]);

    // When l'opératrice recharge et tranche sur les nombres que le bandeau annonce
    // désormais, la chute étant repartie plus creuse qu'hier.
    plancherDuPerimetre(3, 13);
    const rechargee = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "sortie d'une startup entière, dix départs vérifiés ce matin",
        observe: 3,
        reference: 13,
      }),
    );

    // Then celle-là passe : le recalcul écarte les décisions prises sur un autre état,
    // il n'éteint pas la sortie.
    expect(rechargee).toBeNull();
    expect(base.autorisations).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        reason: "sortie d'une startup entière, dix départs vérifiés ce matin",
        createdBy: "capucine.exemple",
        observe: 3,
        reference: 13,
        consumedAt: null,
      },
    ]);
  });

  it("referme la sortie le temps qu'un passage tourne, et la rouvre sur ce qu'il laisse", async () => {
    // Given le bandeau installé, sur lequel une décision passerait.
    plancherDuPerimetre(9, 13);

    // When le passage du soir s'ouvre et n'a encore rien écrit, l'opératrice tranchant
    // sur les nombres que son onglet montre toujours. Un passage s'ouvre en échec et
    // sans trace : le dernier état de ce système ne refuse donc plus rien.
    base.runs.push({ provider: "espace-membre", startedAt: nuit(4), error: null });
    const pendant = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 9,
        reference: 13,
      }),
    );

    // Then l'action refuse, et ce refus-là porte plus que lui-même : une décision posée
    // pendant un passage lui est postérieure de démarrage, donc il ne la consomme ni ne
    // la périme, et le relevé qu'il laisse derrière lui changerait la référence sous
    // elle. La borne du soir ne compare que l'observé parce que cette porte est fermée.
    expect(pendant?.erreur).toContain("ne bloque plus rien");
    expect(base.autorisations).toEqual([]);
    expect(base.journal).toEqual([]);

    // When ce passage se referme complet, ayant retrouvé tout le monde.
    base.runs.push({
      provider: "espace-membre",
      startedAt: nuit(5),
      error: { messages: [] },
    });
    const complet = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 9,
        reference: 13,
      }),
    );

    // Then même refus, et pour la même raison qu'une page laissée ouverte sur un
    // garde-fou guéri : il n'y a plus rien à lever.
    expect(complet?.erreur).toContain("ne bloque plus rien");
    expect(base.autorisations).toEqual([]);

    // When le passage suivant refuse de nouveau la même chute.
    base.runs.push({
      provider: "espace-membre",
      startedAt: nuit(6),
      error: { refus: [{ famille: "perimetre", observe: 9, reference: 13 }], ageDuReleve: 6 },
    });
    const apres = await autoriserDatation(
      null,
      poste({
        provider: "espace-membre",
        famille: "perimetre",
        raison: "quatre fins de mission groupées, vérifiées une par une",
        observe: 9,
        reference: 13,
      }),
    );

    // Then la décision passe. La porte se referme le temps d'un passage et pas plus :
    // une opératrice qui clique pendant la collecte de nuit recharge et retrouve sa
    // sortie, là où un refus qui durerait la laisserait devant un bandeau sans issue.
    expect(apres).toBeNull();
    expect(base.autorisations).toEqual([
      {
        provider: "espace-membre",
        famille: "perimetre",
        reason: "quatre fins de mission groupées, vérifiées une par une",
        createdBy: "capucine.exemple",
        observe: 9,
        reference: 13,
        consumedAt: null,
      },
    ]);
    expect(base.journal).toEqual([
      { action: "sync.gardefou.autorise", targetId: "espace-membre", result: "SUCCESS" },
    ]);
  });
});

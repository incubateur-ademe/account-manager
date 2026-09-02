import { beforeEach, describe, expect, it, vi } from "vitest";

import { DUREE_DEFAUT_JOURS, DUREE_MAX_JOURS } from "@/core/participation";

import { octroyerParticipation, revoquerParticipation } from "./participation";

interface FicheEnBase {
  id: string;
  username: string;
  source: "BETA" | "LOCAL" | "SERVICE";
  usernameFabricated: boolean;
  communicationEmail: string | null;
}

interface DossierEnBase {
  id: string;
  state: "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";
}

interface DroitEnBase {
  id: string;
  accessCaseId: string;
  personId: string;
  reason: string;
  channelEmail: string | null;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

interface TraceEnBase {
  actorUsername: string | null;
  action: string;
  targetId: string | null;
  after: unknown;
  result: string;
}

/**
 * Un dépôt en mémoire plutôt que des doubles par appel : l'octroi lit un dossier, une
 * fiche, les candidats d'une adresse et une ligne d'utilisateur avant de décider, et
 * un `mockResolvedValue` par requête rendrait chaque refus vrai par construction.
 */
const base = vi.hoisted(() => ({
  operateur: "operatrice.exemple",
  operateurs: [] as string[],
  breakGlass: [] as string[],
  declaresLocaux: [] as string[],
  domainesMenaces: [] as string[],
  fiches: [] as FicheEnBase[],
  dossiers: [] as DossierEnBase[],
  droits: [] as DroitEnBase[],
  lignes: [] as { email: string; username: string | null }[],
  journal: [] as TraceEnBase[],
  /** L'ordre réel des écritures, pour dire si la trace a bien précédé l'action. */
  gestes: [] as string[],
  /**
   * Ce qui s'intercale entre la relecture du droit et son écriture, une seule fois.
   * La trace précède l'action, donc son double est le seul point où un second appel
   * peut se glisser : sans lui, deux retraits simultanés ne sont pas jouables sur un
   * dépôt séquentiel, chacun voyant toujours ce que l'autre a déjà écrit.
   */
  pendantLaTrace: null as (() => void) | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () =>
    Promise.resolve({
      username: base.operateur,
      email: null,
      nom: null,
      personId: null,
      voie: "ESPACE_MEMBRE",
      operateur: true,
    }),
}));

vi.mock("@/lib/env", () => ({
  webEnv: {
    get OPERATORS() {
      return base.operateurs;
    },
    get BREAK_GLASS_USERNAMES() {
      return base.breakGlass;
    },
  },
}));

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    scope: { local: base.declaresLocaux.map((username) => ({ username, until: "2099-12-31" })) },
    mail: { domainsLostOnDeparture: base.domainesMenaces },
  }),
}));

function seul<T>(liste: readonly T[], quoi: string): T {
  const premier = liste[0];
  if (premier === undefined) {
    throw new Error(`aucun ${quoi} dans le dépôt de test`);
  }
  return premier;
}

function ficheDe(personId: string): FicheEnBase {
  const fiche = base.fiches.find((candidate) => candidate.id === personId);
  if (fiche === undefined) {
    throw new Error(`fiche absente du dépôt de test : ${personId}`);
  }
  return fiche;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    auditEvent: {
      create: ({ data }: { data: TraceEnBase }) => {
        const pendant = base.pendantLaTrace;
        base.pendantLaTrace = null;
        pendant?.();
        base.gestes.push(`journal:${data.action}:${data.result}`);
        base.journal.push(data);
        return Promise.resolve(data);
      },
    },
    accessCase: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(base.dossiers.find((dossier) => dossier.id === where.id) ?? null),
    },
    person: {
      findUnique: ({ where }: { where: { username: string } }) =>
        Promise.resolve(base.fiches.find((fiche) => fiche.username === where.username) ?? null),
      findMany: ({ where }: { where: { communicationEmail: string } }) =>
        Promise.resolve(
          base.fiches.filter((fiche) => fiche.communicationEmail === where.communicationEmail),
        ),
    },
    user: {
      findUnique: ({ where }: { where: { email: string } }) => {
        const ligne = base.lignes.find((candidate) => candidate.email === where.email);
        return Promise.resolve(ligne === undefined ? null : { username: ligne.username });
      },
    },
    caseParticipation: {
      findMany: ({ where }: { where: { channelEmail: string } }) => {
        const droits = base.droits.filter((droit) => droit.channelEmail === where.channelEmail);
        return Promise.resolve(
          droits.map((droit) => ({
            expiresAt: droit.expiresAt,
            revokedAt: droit.revokedAt,
            accessCase: {
              state: base.dossiers.find((dossier) => dossier.id === droit.accessCaseId)?.state,
            },
            person: ficheDe(droit.personId),
          })),
        );
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        const droit = base.droits.find((candidate) => candidate.id === where.id);
        return Promise.resolve(
          droit === undefined
            ? null
            : {
                id: droit.id,
                accessCaseId: droit.accessCaseId,
                revokedAt: droit.revokedAt,
                person: { username: ficheDe(droit.personId).username },
              },
        );
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { accessCaseId_personId: { accessCaseId: string; personId: string } };
        create: Omit<DroitEnBase, "id" | "revokedAt" | "revokedBy" | "revokedReason">;
        update: Partial<DroitEnBase>;
      }) => {
        const cle = where.accessCaseId_personId;
        const existant = base.droits.find(
          (droit) => droit.accessCaseId === cle.accessCaseId && droit.personId === cle.personId,
        );

        base.gestes.push("droit:octroi");
        if (existant === undefined) {
          base.droits.push({
            id: `droit-${base.droits.length + 1}`,
            revokedAt: null,
            revokedBy: null,
            revokedReason: null,
            ...create,
          });
          return Promise.resolve(undefined);
        }
        Object.assign(existant, update);
        return Promise.resolve(undefined);
      },
      // La condition vient du `where` reçu et n'est pas recodée ici : un double qui
      // filtrerait de lui-même sur la révocation rendrait la garde de course vraie
      // par construction, et le test prouverait le double au lieu de l'action.
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; revokedAt?: null };
        data: { revokedAt: Date; revokedBy: string; revokedReason: string | null };
      }) => {
        const droit = base.droits.find(
          (candidate) =>
            candidate.id === where.id &&
            (!("revokedAt" in where) || candidate.revokedAt === where.revokedAt),
        );
        if (droit === undefined) {
          return Promise.resolve({ count: 0 });
        }
        base.gestes.push("droit:revocation");
        Object.assign(droit, data);
        return Promise.resolve({ count: 1 });
      },
    },
  },
}));

function formulaire(champs: Record<string, string>): FormData {
  const data = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) {
    data.set(cle, valeur);
  }
  return data;
}

function octroi(champs: Partial<Record<string, string>> = {}): FormData {
  return formulaire({
    dossierId: "dossier-1",
    identifiant: "lead.exemple",
    motif: "passation de la marche à suivre",
    jours: String(DUREE_DEFAUT_JOURS),
    ...(champs as Record<string, string>),
  });
}

beforeEach(() => {
  base.operateur = "operatrice.exemple";
  base.operateurs.length = 0;
  base.breakGlass.length = 0;
  base.declaresLocaux.length = 0;
  base.domainesMenaces.length = 0;
  base.fiches.length = 0;
  base.dossiers.length = 0;
  base.droits.length = 0;
  base.lignes.length = 0;
  base.journal.length = 0;
  base.gestes.length = 0;
  base.pendantLaTrace = null;

  base.operateurs.push("operatrice.exemple");
  base.dossiers.push({ id: "dossier-1", state: "CONFIRMED" });
  base.fiches.push({
    id: "personne-lead",
    username: "lead.exemple",
    source: "LOCAL",
    usernameFabricated: true,
    communicationEmail: "lead@exemple.org",
  });
});

describe("octroyer puis retirer un droit de participer", () => {
  it("ouvre un dossier pour un temps, repose tout au ré-octroi, et referme d'un geste", async () => {
    // Given un dossier confirmé et une fiche locale qui n'est pas de l'équipe
    // When un opérateur lui ouvre le dossier pour la durée proposée par défaut
    const avant = Date.now();
    expect(await octroyerParticipation(null, octroi())).toEqual({});

    // Then le droit existe, il porte son motif, son auteur et son terme, et rien n'y
    // est révoqué
    const droit = seul(base.droits, "droit");
    expect(droit).toMatchObject({
      accessCaseId: "dossier-1",
      personId: "personne-lead",
      reason: "passation de la marche à suivre",
      channelEmail: null,
      grantedBy: "operatrice.exemple",
      revokedAt: null,
    });
    const jours = (droit.expiresAt.getTime() - avant) / (24 * 60 * 60 * 1000);
    expect(jours).toBeGreaterThan(DUREE_DEFAUT_JOURS - 0.01);
    expect(jours).toBeLessThan(DUREE_DEFAUT_JOURS + 0.01);

    // Then la trace précède l'écriture, elle nomme l'opérateur, et elle dit par quelle
    // porte il a prouvé son identité
    expect(base.gestes).toEqual(["journal:participation.octroi:SUCCESS", "droit:octroi"]);
    expect(seul(base.journal, "événement")).toMatchObject({
      actorUsername: "operatrice.exemple",
      action: "participation.octroi",
      targetId: "dossier-1:lead.exemple",
      result: "SUCCESS",
    });
    expect(seul(base.journal, "événement").after).toMatchObject({
      personne: "lead.exemple",
      motif: "passation de la marche à suivre",
      canal: null,
      voie: "ESPACE_MEMBRE",
    });

    // When la boîte de la personne meurt et qu'on ré-octroie en déclarant un canal
    const premierOctroi = droit.grantedAt;
    droit.revokedAt = new Date();
    droit.revokedBy = "operatrice.exemple";
    droit.revokedReason = "erreur de personne";
    base.gestes.length = 0;

    expect(
      await octroyerParticipation(
        null,
        octroi({
          motif: "reprise après correction",
          identifiant: " Lead.Exemple ",
          canal: " Lead@Perso.Example ",
          jours: "7",
        }),
      ),
    ).toEqual({});

    // Then la même ligne est réécrite de fond en comble : les cinq champs de l'octroi
    // sont reposés, les trois de la révocation effacés, et l'identifiant comme le canal
    // sont réduits à la forme sous laquelle la base les porte et la connexion les
    // résoudra, sans quoi une saisie mal casée ne trouverait personne
    expect(base.droits).toHaveLength(1);
    expect(seul(base.droits, "droit")).toMatchObject({
      personId: "personne-lead",
      reason: "reprise après correction",
      channelEmail: "lead@perso.example",
      grantedBy: "operatrice.exemple",
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
    });
    expect(seul(base.droits, "droit").grantedAt.getTime()).toBeGreaterThan(premierOctroi.getTime());

    // When on retire le droit
    base.gestes.length = 0;
    expect(
      await revoquerParticipation(
        null,
        formulaire({ participationId: "droit-1", motif: "la passation est faite" }),
      ),
    ).toEqual({});

    // Then il est révoqué, daté et signé, la ligne reste en base comme trace, et le
    // journal a de nouveau parlé avant l'écriture
    expect(seul(base.droits, "droit")).toMatchObject({
      revokedBy: "operatrice.exemple",
      revokedReason: "la passation est faite",
    });
    expect(seul(base.droits, "droit").revokedAt).toBeInstanceOf(Date);
    expect(base.gestes).toEqual(["journal:participation.revocation:SUCCESS", "droit:revocation"]);

    // Then le perdant d'une seconde soumission n'écrase ni le nom ni l'heure du gagnant
    expect(await revoquerParticipation(null, formulaire({ participationId: "droit-1" }))).toEqual({
      erreur: "Ce droit est déjà révoqué.",
    });
    expect(seul(base.droits, "droit").revokedReason).toBe("la passation est faite");

    // Given le même droit reposé, et deux retraits vraiment simultanés cette fois : la
    // relecture ci-dessus ne prouve que le cas séquentiel, or la course que le schéma
    // rend possible est celle où les deux appels lisent `revokedAt` nul avant que l'un
    // d'eux n'écrive.
    base.gestes.length = 0;
    base.journal.length = 0;
    await octroyerParticipation(null, octroi({ motif: "seconde passation" }));
    const vivant = seul(base.droits, "droit");
    const heureDuGagnant = new Date(Date.now() - 1000);

    // When le gagnant écrit pendant que le perdant a déjà tout lu et s'apprête à écrire
    base.pendantLaTrace = () => {
      vivant.revokedAt = heureDuGagnant;
      vivant.revokedBy = "collegue.exemple";
      vivant.revokedReason = "retiré par la collègue";
    };
    const perdant = revoquerParticipation(
      null,
      formulaire({ participationId: "droit-1", motif: "retiré par moi" }),
    );

    // Then le perdant lève plutôt que d'écrire : c'est la condition du `where` qui le
    // tient, la relecture d'avant ne pouvant rien voir de ce qui n'existait pas encore
    await expect(perdant).rejects.toThrow("Ce droit a été révoqué pendant que vous le retiriez.");

    // Then la ligne garde le nom, l'heure et le motif du gagnant, aucune écriture n'a
    // eu lieu, et le journal porte l'intention du perdant puis son démenti
    expect(vivant).toMatchObject({
      revokedAt: heureDuGagnant,
      revokedBy: "collegue.exemple",
      revokedReason: "retiré par la collègue",
    });
    expect(base.gestes).toEqual([
      "journal:participation.octroi:SUCCESS",
      "droit:octroi",
      "journal:participation.revocation:SUCCESS",
      "journal:participation.revocation:FAILURE",
    ]);
  });

  it("refuse cinq choses, et chacune depuis la requête plutôt que depuis l'écran", async () => {
    // Given un droit sans motif est un droit que personne ne saura retirer, faute de
    // savoir pourquoi il a été posé : c'est la seule raison d'être de la colonne, et
    // une requête forgée sans le champ n'y échappe pas plus qu'un formulaire vide
    const SANS_MOTIF =
      "Dites pourquoi ce droit est accordé : sans motif, personne ne saura le retirer.";
    expect(await octroyerParticipation(null, octroi({ motif: "" }))).toEqual({
      erreur: SANS_MOTIF,
    });
    expect(await octroyerParticipation(null, octroi({ motif: "  " }))).toEqual({
      erreur: SANS_MOTIF,
    });
    expect(await octroyerParticipation(null, octroi({ motif: "ok" }))).toEqual({
      erreur: SANS_MOTIF,
    });

    // Then le formulaire ne propose jamais plus que le plafond : l'action reçoit
    // pourtant ce qu'on lui envoie
    expect(await octroyerParticipation(null, octroi({ jours: "60" }))).toEqual({
      erreur: `Une durée est un nombre entier de jours, d'au moins un et d'au plus ${DUREE_MAX_JOURS}.`,
    });
    expect(await octroyerParticipation(null, octroi({ jours: "0" }))).toMatchObject({
      erreur: expect.stringContaining("nombre entier de jours"),
    });
    expect(await octroyerParticipation(null, octroi({ jours: "-3" }))).toMatchObject({
      erreur: expect.stringContaining("nombre entier de jours"),
    });
    expect(await octroyerParticipation(null, octroi({ jours: "2,5" }))).toMatchObject({
      erreur: expect.stringContaining("nombre entier de jours"),
    });

    // Then un dossier qui n'est plus ouvert n'accueille aucun droit, et c'est celui
    // qu'on oublie : la mort du droit s'y déduit, rien n'empêcherait d'en poser un
    const dossier = seul(base.dossiers, "dossier");
    for (const etat of ["DONE", "CANCELLED"] as const) {
      dossier.state = etat;
      expect(await octroyerParticipation(null, octroi())).toEqual({
        erreur: "Ce dossier n'est plus ouvert.",
      });
    }

    // Then un départ seulement soupçonné ne s'ouvre pas non plus, et ce refus-là est
    // distinct du précédent : la lecture, elle, n'exclut pas cet état
    dossier.state = "WATCH";
    expect(await octroyerParticipation(null, octroi())).toMatchObject({
      erreur: expect.stringContaining("n'est que soupçonné"),
    });

    // Then une fiche qui nomme un opérateur ne reçoit rien : ce dossier lui est déjà
    // ouvert, et ce champ deviendrait la seule voie par laquelle une session pourrait
    // s'asseoir sur elle
    dossier.state = "CONFIRMED";
    base.breakGlass.push("lead.exemple");
    expect(await octroyerParticipation(null, octroi())).toMatchObject({
      erreur: expect.stringContaining("est un opérateur de l'outil"),
    });
    base.breakGlass.length = 0;

    // Then un canal qui n'est pas une adresse est écarté avant tout le reste : sans ce
    // refus il s'écrirait en `channelEmail`, aucun lien ne pourrait partir là, et la
    // connexion refuserait en `INCONNUE` bien après que l'opérateur ait pu corriger
    const PAS_UNE_ADRESSE = "Le canal est une adresse de courriel, ou rien du tout.";
    expect(await octroyerParticipation(null, octroi({ canal: "lead.exemple" }))).toEqual({
      erreur: PAS_UNE_ADRESSE,
    });
    expect(await octroyerParticipation(null, octroi({ canal: 'a"b@exemple.org' }))).toEqual({
      erreur: PAS_UNE_ADRESSE,
    });
    expect(await octroyerParticipation(null, octroi({ canal: "lead@" }))).toEqual({
      erreur: PAS_UNE_ADRESSE,
    });

    // Then un canal dont la partie locale nomme un opérateur est refusé là où
    // l'opérateur peut encore corriger, et pas seulement à la connexion
    expect(
      await octroyerParticipation(null, octroi({ canal: "operatrice.exemple@exemple.org" })),
    ).toMatchObject({ erreur: expect.stringContaining("porte le nom d'un opérateur") });

    // Then un canal que quelqu'un d'autre porte déjà n'identifierait personne
    base.fiches.push({
      id: "personne-tiers",
      username: "tiers.exemple",
      source: "LOCAL",
      usernameFabricated: true,
      communicationEmail: "commun@exemple.org",
    });
    expect(
      await octroyerParticipation(null, octroi({ canal: "commun@exemple.org" })),
    ).toMatchObject({ erreur: expect.stringContaining("désigne déjà quelqu'un d'autre") });

    // Then un canal porté par la ligne d'un opérateur déjà connu est refusé, celle-ci
    // portant un identifiant que la voie espace-membre lui a posé
    base.lignes.push({ email: "deja@exemple.org", username: "quelquun.exemple" });
    expect(await octroyerParticipation(null, octroi({ canal: "deja@exemple.org" }))).toMatchObject({
      erreur: expect.stringContaining("s'est déjà connecté"),
    });

    // Then aucun de ces refus n'a écrit quoi que ce soit, ni en base ni au journal :
    // le passage tracé n'a jamais été atteint
    expect(base.droits).toHaveLength(0);
    expect(base.journal).toHaveLength(0);

    // Then la ligne que la voie par adresse a elle-même fait naître, elle, ne ferme
    // rien : sans username, sur l'adresse qui vient de résoudre le candidat
    base.lignes.push({ email: "lead@perso.example", username: null });
    expect(await octroyerParticipation(null, octroi({ canal: "lead@perso.example" }))).toEqual({});
    expect(base.droits).toHaveLength(1);
  });

  it("dit au moment du geste que le lien partira sur une boîte que ce départ coupe", async () => {
    // Given une politique qui déclare les domaines qu'un départ coupe
    base.domainesMenaces.push("beta.gouv.fr", "ademe.fr");

    // When l'octroi déclare un canal sur l'un d'eux
    const menace = await octroyerParticipation(null, octroi({ canal: "lead@beta.gouv.fr" }));

    // Then l'avertissement se lève à l'octroi, là où l'opérateur peut encore choisir
    // une autre adresse, et le droit est bel et bien posé
    expect(menace.erreur).toBeUndefined();
    expect(menace.avertissement).toEqual(expect.stringContaining("que ce départ va couper"));
    expect(base.droits).toHaveLength(1);

    // When le canal est ailleurs, ou qu'il n'y en a pas et que la fiche porte une
    // adresse hors des domaines menacés
    base.droits.length = 0;
    const ailleurs = await octroyerParticipation(null, octroi({ canal: "lead@perso.example" }));
    const sansCanal = await octroyerParticipation(null, octroi());

    // Then rien ne crie au loup : la question se juge sur le domaine, et non sur une
    // égalité entre deux colonnes de la fiche
    expect(ailleurs.avertissement).toBeUndefined();
    expect(sansCanal.avertissement).toBeUndefined();

    // When la fiche elle-même ne porte qu'une adresse, et qu'elle est sur un domaine
    // menacé
    base.droits.length = 0;
    seul(base.fiches, "fiche").communicationEmail = "lead@ademe.fr";

    // Then l'avertissement se lève quand même, l'outil sachant où le lien partirait
    expect((await octroyerParticipation(null, octroi())).avertissement).toEqual(
      expect.stringContaining("que ce départ va couper"),
    );
  });
});

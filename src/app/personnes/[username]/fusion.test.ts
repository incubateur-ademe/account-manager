import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditInput } from "@/core/audit";

import { renommerFiche } from "./edition";

/**
 * Ce que la transaction de fusion fait des droits de participer, et dans quel ordre.
 *
 * Le cœur pur décide quel droit survit ; il ne dit rien de l'exécution. Or l'ordre des
 * deux requêtes du bras décide seul du sort de toute la fusion : un seul droit par
 * couple dossier et personne, si bien que déplacer avant d'avoir fait la place lève sur
 * l'index unique et annule tout. Et la boucle qui nomme les droits abandonnés est le
 * seul endroit où une décision nominative survit à sa disparition.
 */
interface DroitEnBase {
  id: string;
  accessCaseId: string;
  personId: string;
  grantedAt: Date;
}

const base = vi.hoisted(() => ({
  droits: [] as DroitEnBase[],
  /** Ce que la transaction a demandé, dans l'ordre, avec ses arguments. */
  requetes: [] as string[],
  journal: [] as AuditInput[],
}));

const SOURCE = {
  id: "personne-source",
  username: "camille.exemple",
  source: "LOCAL",
  usernameFabricated: true,
  fullname: "Camille Exemple",
  githubLogin: null,
  primaryEmail: null,
  communicationEmail: null,
  missionEnd: null,
};

const CIBLE = {
  id: "personne-cible",
  username: "camille.exemple.2",
  source: "LOCAL",
  usernameFabricated: true,
  fullname: "Camille Exemple",
  githubLogin: null,
  primaryEmail: null,
  communicationEmail: null,
  missionEnd: null,
};

vi.mock("@/lib/env", () => ({ webEnv: { OPERATORS: [], BREAK_GLASS_USERNAMES: [] } }));

vi.mock("@/lib/policy", () => ({ policy: () => ({ scope: { local: [] } }) }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () => Promise.resolve(operatrice()),
}));

vi.mock("@/lib/audit", () => ({
  audit: (entree: AuditInput) => {
    base.journal.push(entree);
  },
}));

// Le passage tracé est joué ailleurs : ici il n'est qu'un appelant, et le doubler
// donne la main sur l'utilisateur que `ecrire` reçoit, dont la voie part au journal.
vi.mock("@/lib/actions", () => ({
  actionTracee: async (params: {
    ecrire: (utilisateur: unknown) => Promise<unknown>;
  }): Promise<void> => {
    await params.ecrire(operatrice());
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (chemin: string) => {
    const digest = `NEXT_REDIRECT;replace;${chemin};307;`;
    const erreur = new Error(digest);
    Object.assign(erreur, { digest });
    throw erreur;
  },
}));

function operatrice() {
  return {
    username: "operatrice.exemple",
    email: null,
    nom: null,
    personId: null,
    voie: "ESPACE_MEMBRE" as const,
    operateur: true,
  };
}

/** Ce que la transaction relève : le nom de la requête et les identifiants qu'elle vise. */
function noter(requete: string, ids: readonly string[]): void {
  base.requetes.push(`${requete}(${[...ids].sort().join(",")})`);
}

/** Déclarée et non affectée : une fabrique de `vi.mock` est hissée au-dessus des const. */
function vide(): Promise<never[]> {
  return Promise.resolve([]);
}

vi.mock("@/lib/db", () => {
  const tx = {
    caseParticipation: {
      deleteMany: ({ where }: { where: { id: { in: readonly string[] } } }) => {
        noter("supprimer", where.id.in);
        for (const id of where.id.in) {
          const rang = base.droits.findIndex((candidat) => candidat.id === id);
          if (rang >= 0) {
            base.droits.splice(rang, 1);
          }
        }
        return Promise.resolve({ count: where.id.in.length });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: { in: readonly string[] } };
        data: { personId: string };
      }) => {
        // La collision se joue pour de vrai : un droit déplacé sur un dossier où la
        // cible en garde un lève, exactement comme l'index unique le ferait.
        for (const id of where.id.in) {
          const droit = base.droits.find((candidat) => candidat.id === id);
          const occupe =
            droit &&
            base.droits.some(
              (candidat) =>
                candidat.id !== id &&
                candidat.accessCaseId === droit.accessCaseId &&
                candidat.personId === data.personId,
            );
          if (occupe) {
            throw new Error("Unique constraint failed on accessCaseId_personId");
          }
        }
        noter("deplacer", where.id.in);
        for (const id of where.id.in) {
          const droit = base.droits.find((candidat) => candidat.id === id);
          if (droit) {
            droit.personId = data.personId;
          }
        }
        return Promise.resolve({ count: where.id.in.length });
      },
    },
    person: {
      // La cascade du schéma est jouée : ce que la fusion n'a pas déplacé disparaît
      // avec la fiche, et c'est ce que la ligne de journal doit avoir dit avant.
      delete: () => {
        base.requetes.push("supprimer la fiche");
        base.droits = base.droits.filter((droit) => droit.personId !== SOURCE.id);
        return Promise.resolve(undefined);
      },
    },
  };

  return {
    prisma: {
      $transaction: (execute: (transaction: typeof tx) => Promise<void>) => execute(tx),
      person: {
        findUnique: ({ where }: { where: { username: string } }) => {
          if (where.username === SOURCE.username) {
            return Promise.resolve(SOURCE);
          }
          return Promise.resolve(where.username === CIBLE.username ? CIBLE : null);
        },
      },
      externalIdentity: { findMany: vide },
      finding: { findMany: vide },
      accessCase: { findMany: vide },
      reference: { findMany: vide },
      startupAssignment: { findMany: vide },
      scopeOverride: { findUnique: () => Promise.resolve(null) },
      caseParticipation: {
        findMany: ({ where }: { where: { personId: string } }) =>
          Promise.resolve(base.droits.filter((droit) => droit.personId === where.personId)),
      },
    },
  };
});

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

function le(jour: number): Date {
  return new Date(Date.UTC(2026, 5, jour));
}

beforeEach(() => {
  base.requetes.length = 0;
  base.journal.length = 0;
  base.droits.length = 0;

  // Le dossier A n'appartient qu'à la source, le B et le C aux deux : sur B c'est le
  // droit de la source qui est le plus récent, sur C celui de la cible.
  base.droits.push(
    { id: "droit-source-a", accessCaseId: "dossier-a", personId: SOURCE.id, grantedAt: le(1) },
    { id: "droit-source-b", accessCaseId: "dossier-b", personId: SOURCE.id, grantedAt: le(10) },
    { id: "droit-source-c", accessCaseId: "dossier-c", personId: SOURCE.id, grantedAt: le(2) },
    { id: "droit-cible-b", accessCaseId: "dossier-b", personId: CIBLE.id, grantedAt: le(5) },
    { id: "droit-cible-c", accessCaseId: "dossier-c", personId: CIBLE.id, grantedAt: le(9) },
  );
});

describe("la fusion de deux fiches, et les droits de participer qu'elle départage", () => {
  it("fait la place avant de déplacer, et nomme au journal chaque droit qui disparaît", async () => {
    // Given deux fiches fabriquées ici, dont l'une participe à trois dossiers et
    // l'autre à deux des mêmes
    // When l'opératrice renomme la source du nom de la cible et confirme la fusion
    const fusion = renommerFiche(
      null,
      champs({ username: SOURCE.username, nouveau: CIBLE.username, confirme: "oui" }),
    );

    // Then la fusion aboutit et l'écran part sur la fiche qui survit
    await expect(fusion).rejects.toThrow(`NEXT_REDIRECT;replace;/personnes/${CIBLE.username}`);

    // Then la place est faite avant le déplacement, et dans la même transaction : la
    // suppression du droit remplacé précède l'écriture qui le remplacerait, sans quoi
    // l'index unique lèverait au premier doublon réel et annulerait toute la fusion,
    // comptes et constats compris
    expect(base.requetes).toEqual([
      "supprimer(droit-cible-b)",
      "deplacer(droit-source-a,droit-source-b)",
      "supprimer la fiche",
    ]);

    // Then il ne reste qu'un droit par dossier, tous sur la fiche qui survit : le
    // dossier C garde celui qu'elle détenait déjà, plus récent que celui de la source,
    // et le droit perdant de chaque collision a bel et bien disparu
    expect(base.droits.map((droit) => `${droit.id}:${droit.personId}`).sort()).toEqual([
      `droit-cible-c:${CIBLE.id}`,
      `droit-source-a:${CIBLE.id}`,
      `droit-source-b:${CIBLE.id}`,
    ]);

    // Then chaque droit abandonné a sa ligne au journal, nommée et non comptée : sans
    // elle, une décision qu'un opérateur avait prise disparaîtrait sans un mot, et le
    // compte porté par l'événement de fusion ne dirait pas lequel
    const abandons = base.journal.filter((ligne) => ligne.action === "participation.abandon");
    expect(abandons).toHaveLength(2);

    // Then chaque ligne nomme le détenteur du droit disparu, comme l'octroi et la
    // révocation nomment le leur : sur le dossier B c'est le droit de la cible que
    // celui de la source, plus récent, a chassé, sur le dossier C celui de la source
    expect(abandons.map((ligne) => ligne.targetId).sort()).toEqual([
      `dossier-b:${CIBLE.username}`,
      `dossier-c:${SOURCE.username}`,
    ]);

    // Then chacune dit qui l'a écrite, par quelle porte il s'est identifié, depuis
    // quand le droit existait et pourquoi il disparaît : les deux causes ne se
    // confondent pas, l'une est une place prise, l'autre une place déjà occupée
    expect(abandons[0]).toMatchObject({
      actorKind: "HUMAN",
      actorUsername: "operatrice.exemple",
      targetType: "participation",
      targetId: `dossier-b:${CIBLE.username}`,
      after: {
        raison: `remplacée par le droit plus récent apporté par ${SOURCE.username}`,
        octroyeLe: le(5),
        voie: "ESPACE_MEMBRE",
      },
      result: "SUCCESS",
    });
    expect(abandons[1]).toMatchObject({
      targetId: `dossier-c:${SOURCE.username}`,
      after: {
        raison: `fusionnée dans ${CIBLE.username}, qui porte un droit plus récent sur ce dossier`,
        octroyeLe: le(2),
      },
    });
  });
});

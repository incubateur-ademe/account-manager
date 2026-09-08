import { beforeEach, describe, expect, it, vi } from "vitest";

import { creerFichePourCompte } from "@/app/comptes-isoles/creer";
import { renommerFiche } from "@/app/personnes/[username]/edition";

/**
 * Le seul des verrous qui porte sur l'écriture d'un identifiant, et le seul qui protège
 * quelqu'un dont l'allowlist est la seule trace : ni fiche, ni ligne d'utilisateur, donc
 * rien sur quoi les verrous de la connexion pourraient s'ancrer. Les deux gestes qui
 * fabriquent un identifiant sont ici, et le relevé des accès en base dit à quel moment
 * le refus tombe : après, il aurait déjà répondu si le nom existe.
 *
 * À la racine de `src/` comme les autres invariants qui traversent deux répertoires :
 * ce qui se vérifie est que les deux gestes refusent le même nom, et un verrou posé sur
 * un seul des deux ne verrouille rien.
 */
const base = vi.hoisted(() => ({
  operateurs: [] as string[],
  breakGlass: [] as string[],
  lectures: [] as string[],
  traces: [] as string[],
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

vi.mock("@/lib/policy", () => ({ policy: () => ({ scope: { local: [] } }) }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () =>
    Promise.resolve({
      username: "operatrice.exemple",
      email: null,
      nom: null,
      personId: null,
      voie: "ESPACE_MEMBRE",
      operateur: true,
    }),
}));

vi.mock("@/lib/audit", () => ({ audit: () => undefined }));

vi.mock("@/lib/actions", () => ({
  actionTracee: (params: { action: string; targetId: string }) => {
    base.traces.push(`${params.action}:${params.targetId}`);
    return Promise.resolve(undefined);
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

const SOURCE = {
  id: "per_0000000000000000000000",
  username: "camille.exemple",
  source: "LOCAL",
  usernameFabricated: true,
  fullname: "Camille Exemple",
  githubLogin: null,
  primaryEmail: null,
  communicationEmail: null,
  missionEnd: null,
};

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: ({ where }: { where: { username: string } }) => {
        base.lectures.push(`person:${where.username}`);
        return Promise.resolve(where.username === SOURCE.username ? SOURCE : null);
      },
    },
    externalIdentity: {
      findUnique: ({ where }: { where: { id: string } }) => {
        base.lectures.push(`identite:${where.id}`);
        return Promise.resolve(null);
      },
      findMany: () => {
        base.lectures.push("identites");
        return Promise.resolve([]);
      },
    },
    startupAssignment: {
      findMany: () => {
        base.lectures.push("rattachements");
        return Promise.resolve([]);
      },
    },
  },
}));

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

const REFUS =
  "« operatrice.exemple » nomme un opérateur de l'outil : aucune fiche ne peut porter cet identifiant.";

beforeEach(() => {
  base.operateurs = [];
  base.breakGlass = [];
  base.lectures = [];
  base.traces = [];
});

describe("un identifiant que l'allowlist porte ne s'écrit sur aucune fiche", () => {
  it("refuse de renommer une fiche du nom d'un opérateur, avant même d'aller voir si ce nom est libre", async () => {
    // Given une opératrice que seul l'environnement nomme, et une fiche fabriquée ici.
    base.operateurs = ["operatrice.exemple"];

    // When un opérateur de bonne foi renomme cette fiche du nom de sa collègue, ce que
    // personne ne vivrait comme un octroi de droits.
    const refuse = await renommerFiche(
      null,
      champs({ username: "camille.exemple", nouveau: "Operatrice Exemple" }),
    );

    // Then le refus le dit, et rien n'a été écrit.
    expect(refuse).toEqual({ erreur: REFUS });
    expect(base.traces).toEqual([]);

    // Then il tombe avant la recherche du nom demandé : seule la fiche de départ a été
    // lue, et l'écran n'a donc pas dit si « operatrice.exemple » existe déjà en base.
    expect(base.lectures).toEqual(["person:camille.exemple"]);

    // Then l'accès de secours compte autant que la liste ordinaire : c'est lui que ce
    // verrou protège en propre, personne n'ayant besoin de s'être connecté pour y être.
    base.operateurs = [];
    base.breakGlass = ["operatrice.exemple"];
    base.lectures = [];
    await expect(
      renommerFiche(null, champs({ username: "camille.exemple", nouveau: "operatrice.exemple" })),
    ).resolves.toEqual({ erreur: REFUS });

    // When le nom demandé n'est porté par aucune allowlist.
    base.breakGlass = [];
    base.lectures = [];
    const abouti = renommerFiche(
      null,
      champs({ username: "camille.exemple", nouveau: "camille.exemple.2" }),
    );

    // Then le renommage suit son cours jusqu'au bout : c'est ce qui rend le refus
    // ci-dessus imputable au verrou et non à une garde qui aurait tout arrêté avant.
    await expect(abouti).rejects.toThrow("NEXT_REDIRECT;replace;/personnes/camille.exemple.2");
    expect(base.lectures).toContain("person:camille.exemple.2");
    expect(base.traces).toEqual(["personne.renommage:camille.exemple"]);
  });

  it("refuse de créer une fiche du nom d'un opérateur, sans toucher la base", async () => {
    // Given la même opératrice, et un compte isolé qu'on veut rattacher à une fiche neuve.
    base.operateurs = ["operatrice.exemple"];

    // When le nom saisi donne l'identifiant d'une opératrice.
    const refuse = await creerFichePourCompte(
      null,
      champs({ id: "idt_0000000000000000000000", nom: "Operatrice Exemple" }),
    );

    // Then le refus le dit, et aucune lecture n'a eu lieu : cette action rend quatre
    // messages distincts après sa première lecture, et aucun n'a été prononcé.
    expect(refuse).toEqual({ erreur: REFUS });
    expect(base.lectures).toEqual([]);
    expect(base.traces).toEqual([]);

    // When le nom saisi ne nomme personne de l'équipe.
    const suite = await creerFichePourCompte(
      null,
      champs({ id: "idt_0000000000000000000000", nom: "Camille Exemple" }),
    );

    // Then l'action reprend son cours ordinaire et va lire le compte : le refus
    // précédent venait bien du verrou et non d'une garde posée plus tôt.
    expect(suite).toEqual({ erreur: "Ce compte n'est plus en base." });
    expect(base.lectures).toEqual(["identite:idt_0000000000000000000000"]);
  });
});

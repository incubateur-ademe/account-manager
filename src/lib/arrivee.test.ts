import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedStep } from "@/core/connector";
import type { Profil } from "@/core/policy";
import { catalogueOctroyeur, profilsOfferts } from "@/lib/arrivee";
import { calculerPlan, enregistrerPlan, messageDeRefus, type PlanCalcule } from "@/lib/dossier";

interface IdentiteEnBase {
  provider: string;
  handle: string;
  matchMethod: string;
}

interface PlanEcrit {
  accessCaseId: string;
  etapes: number;
}

const base = vi.hoisted(() => ({
  organisation: "incubateur-ademe",
  /**
   * Ce que l'environnement porte, et jamais le vrai : lire l'environnement du dépôt
   * validerait toute sa configuration pour un seul jeton, et ce qui s'exerce ici est
   * la différence entre un octroi qu'un credential rend praticable et le même octroi
   * sans lui.
   */
  jetonAdmin: undefined as string | undefined,
  githubLogin: null as string | null,
  identites: [] as IdentiteEnBase[],
  profils: [] as Profil[],
  plansEcrits: [] as PlanEcrit[],
}));

vi.mock("@/lib/env", () => ({
  env: {
    // Le défaut du produit, et il ne se force nulle part : rien de ce fichier
    // n'exécute quoi que ce soit, il ne fait que construire des plans.
    get ACTIONS_ENABLED() {
      return false;
    },
    get GITHUB_TOKEN() {
      return "jeton-de-lecture";
    },
    get GITHUB_ADMIN_TOKEN() {
      return base.jetonAdmin;
    },
    get NOTION_SCIM_TOKEN() {
      return undefined;
    },
  },
}));

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    connectors: { github: { organisations: [base.organisation] } },
    profiles: base.profils,
    thresholds: { maxPlanSteps: 20 },
  }),
}));

vi.mock("@/lib/audit", () => ({ audit: () => {} }));

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: () =>
        Promise.resolve({ githubLogin: base.githubLogin, startups: [], startupAssignments: [] }),
    },
    externalIdentity: {
      findMany: () =>
        Promise.resolve(base.identites.map((identite) => ({ ...identite, vanishedAt: null }))),
    },
    planTemplate: { findMany: () => Promise.resolve([]) },
    plan: {
      create: ({
        data,
      }: {
        data: { id: string; accessCaseId: string; steps: { create: readonly unknown[] } };
      }) => {
        base.plansEcrits.push({
          accessCaseId: data.accessCaseId,
          etapes: data.steps.create.length,
        });
        return Promise.resolve({ id: data.id });
      },
    },
  },
}));

const ORGANISATION = "incubateur-ademe";
const USERNAME = "camille.rivet";
const PERSONNE = "personne-1";
const DOSSIER = "dossier-1";
const OPERATRICE = "olivia.mercier";
const MAINTENANT = new Date("2026-08-25T09:00:00Z");
const JOUR = 24 * 60 * 60_000;

const CLE_GITHUB = `github:${ORGANISATION}:grant:${USERNAME}:member`;

const DEVELOPPEUSE: Profil = {
  key: "developpeuse",
  label: "Développeuse d'une startup d'État",
  accesses: [
    { system: "github", scope: { organisation: ORGANISATION, role: "member" }, expiresInDays: 180 },
    { system: "notion", scope: {} },
  ],
};

/** Le même profil au terme près : c'est ce qui rend observable que l'échéance est hors empreinte. */
const SANS_TERME: Profil = {
  ...DEVELOPPEUSE,
  accesses: [
    { system: "github", scope: { organisation: ORGANISATION, role: "member" } },
    { system: "notion", scope: {} },
  ],
};

const ADMINISTRATION: Profil = {
  key: "administration-github",
  label: "Administration de l'organisation GitHub",
  accesses: [{ system: "github", scope: { organisation: ORGANISATION, role: "admin" } }],
};

const HORS_PARC: Profil = {
  key: "hors-parc",
  label: "Un profil qui vise une organisation qu'on ne suit pas",
  accesses: [
    { system: "github", scope: { organisation: "ademe-oubliee", role: "member" } },
    { system: "notion", scope: {} },
  ],
};

const arrivee = (profil?: Profil) =>
  calculerPlan("ONBOARDING", PERSONNE, USERNAME, MAINTENANT, profil);

const depart = () => calculerPlan("OFFBOARDING", PERSONNE, USERNAME, MAINTENANT);

function etapesDe(plan: PlanCalcule, systeme: string): readonly PlannedStep[] {
  return plan.etapes.filter(({ etape }) => etape.systemKey === systeme).map(({ etape }) => etape);
}

function uneEtape(plan: PlanCalcule, systeme: string): PlannedStep {
  const trouvees = etapesDe(plan, systeme);
  const [premiere] = trouvees;

  if (trouvees.length !== 1 || !premiere) {
    throw new Error(`${trouvees.length} étape(s) sur ${systeme}, une seule était attendue`);
  }
  return premiere;
}

async function tierDOctroi(systeme: string) {
  const catalogue = await catalogueOctroyeur();
  const trouve = catalogue.find(({ key }) => key === systeme);

  if (!trouve) {
    throw new Error(`aucun système ${systeme} au catalogue d'octroi`);
  }
  return trouve.capacite;
}

beforeEach(() => {
  base.jetonAdmin = "jeton-d-administration";
  base.githubLogin = null;
  base.identites.length = 0;
  base.profils.length = 0;
  base.profils.push(DEVELOPPEUSE, ADMINISTRATION, HORS_PARC);
  base.plansEcrits.length = 0;
});

describe("une arrivée ouvre pour de vrai ce qu'un profil déclare", () => {
  it("produit l'étape GitHub attendue, automatique avec le jeton d'écriture et manuelle sans lui", async () => {
    // Given une personne dont le compte GitHub est connu de deux sources sûres qui
    // concordent, sa fiche et une identité déclarée, et un jeton d'écriture en place
    base.githubLogin = "Camille-Rivet";
    base.identites.push(
      { provider: "github", handle: "camille-rivet", matchMethod: "DECLARED" },
      { provider: "notion", handle: "camille@exemple.org", matchMethod: "HEURISTIC" },
    );

    // When on calcule son arrivée sous le profil de développeuse
    const plan = await arrivee(DEVELOPPEUSE);

    // Then rien ne s'oppose à sa construction, et la source des systèmes interrogés
    // est celle de l'octroi : tous ceux qui déclarent savoir donner, et non ceux où un
    // compte est observé, puisqu'à l'arrivée elle n'en a par définition aucun
    expect(plan.refus).toEqual([]);
    expect(plan.systemes).toEqual(["github", "notion"]);
    expect(plan.etapes).toHaveLength(2);

    // Then l'étape GitHub est celle du connecteur et non un repli inventé par le
    // socle : son action, sa clé et sa fenêtre de réversibilité viennent de lui
    const github = uneEtape(plan, "github");
    expect(github.action).toBe("inviter-dans-l-organisation");
    expect(github.capability).toBe("grant");
    expect(github.tier).toBe("auto");
    expect(github.riskLevel).toBe("medium");
    expect(github.reversibleForDays).toBe(7);
    expect(github.manual).toBeUndefined();
    expect(github.idempotencyKey).toBe(CLE_GITHUB);

    // Then le compte visé est celui dont le socle répond, réduit et non deviné : c'est
    // `handlesSurs` qui l'a passé au connecteur, et le bénéficiaire reste le pivot
    // d'identité
    expect(github.params).toEqual({
      organisation: ORGANISATION,
      role: "member",
      beneficiaire: USERNAME,
      compte: "camille-rivet",
    });

    // Then le terme vient du profil et jamais du connecteur : c'est la politique qui
    // décide de la durée d'un accès, pas le système qui l'ouvre
    expect(github.grantExpiresAt).toEqual(new Date(MAINTENANT.getTime() + 180 * JOUR));

    // Then le même geste n'est demandé qu'une fois : le contrat du connecteur n'émet
    // aucun octroi sans scope, faute de quoi le même accès sortirait sous deux clés
    // que le dédoublonnage ne rapprocherait pas
    expect(etapesDe(plan, "github")).toHaveLength(1);
    expect(plan.ecartees).toEqual([]);

    // Then le système qui ne sait qu'inviter à la main produit son étape quand même,
    // et son critère de complétion reste le sien : le socle ne sait pas qu'une
    // invitation non acceptée est déjà un accès accordé
    const notion = uneEtape(plan, "notion");
    expect(notion.tier).toBe("manual");
    expect(notion.manual?.doneWhen).toContain("invitation non acceptée comprise");

    // When le même profil est calculé sans terme
    const sansTerme = await arrivee(SANS_TERME);

    // Then l'échéance ne pèse pas dans l'empreinte : absolue et comptée depuis le
    // calcul, elle rendrait sinon tout plan obsolète à la seconde suivante
    expect(uneEtape(sansTerme, "github").grantExpiresAt).toBeUndefined();
    expect(sansTerme.empreinte).toBe(plan.empreinte);

    // When le jeton d'écriture disparaît
    base.jetonAdmin = undefined;
    const manuel = await arrivee(DEVELOPPEUSE);

    // Then aucune ligne ne disparaît avec lui : un chemin automatique qui tombe
    // redevient un chemin manuel, et c'est le tier qui bouge, pas la liste
    expect(manuel.etapes).toHaveLength(2);
    const degrade = uneEtape(manuel, "github");
    expect(degrade.tier).toBe("manual");
    expect(degrade.reversibleForDays).toBeUndefined();

    // Then l'étape dit ce qui manque pour l'automatiser, et son critère de complétion
    // dit qu'une invitation en attente est un accès accordé : sans cette phrase,
    // l'opérateur croirait la porte fermée tant que personne n'a cliqué
    expect(degrade.manual?.runbook).toContain("github-token-admin");
    expect(degrade.manual?.doneWhen).toContain("invitations en attente");
    expect(degrade.manual?.doneWhen).toContain("accès accordé");

    // Then l'empreinte n'a pas bougé : un credential qui va et vient change la voie
    // et non le geste, et un plan confirmé ne doit pas se dire démenti parce qu'un
    // jeton a expiré entre-temps
    expect(degrade.idempotencyKey).toBe(CLE_GITHUB);
    expect(manuel.empreinte).toBe(plan.empreinte);

    // Then c'est bien la résolution de capacité qui a dégradé, et elle nomme le
    // credential absent plutôt que de se taire
    const sansJeton = await tierDOctroi("github");
    expect(sansJeton.tier).toBe("manual");
    expect(sansJeton.degradedFrom).toEqual({ tier: "auto", missing: ["github-token-admin"] });

    base.jetonAdmin = "jeton-d-administration";
    expect((await tierDOctroi("github")).tier).toBe("auto");
  });
});

describe("un scope qui ne s'applique pas arrête la construction, jamais l'exécution", () => {
  it("nomme le profil, l'accès et le système, n'enregistre aucun plan, et se lit avant le clic", async () => {
    // Given un profil qui vise une organisation qu'aucune configuration ne déclare
    // When on calcule l'arrivée qui l'applique
    const horsParc = await arrivee(HORS_PARC);

    // Then le refus nomme tout ce qu'il faut pour le corriger, et il vient du
    // connecteur : son schéma ne connaît pas les organisations suivies, elles sont
    // déclarées dans la politique
    expect(horsParc.refus).toHaveLength(1);
    expect(horsParc.refus[0]).toMatchObject({
      profil: "hors-parc",
      acces: 0,
      systeme: "github",
    });
    expect(horsParc.refus[0]?.motif).toContain("ademe-oubliee");
    expect(horsParc.refus[0]?.motif).toContain("connectors.github.organisations");

    // Then aucune étape n'en sort, pas même celle de l'accès valide du même profil :
    // un profil dont un accès ne s'applique pas n'ouvre pas les autres à moitié
    expect(horsParc.etapes).toEqual([]);

    // Then le message de refus se lit sans connaître le code
    const message = messageDeRefus(horsParc.refus);
    expect(message).toContain("hors-parc");
    expect(message).toContain("accès n°1");
    expect(message).toContain("github");

    // When on tente quand même d'enregistrer ce plan
    // Then c'est la construction qui échoue et non l'exécution : refuser plus tard
    // laisserait un plan confirmé que personne ne peut exécuter
    await expect(enregistrerPlan(DOSSIER, horsParc, OPERATRICE, MAINTENANT)).rejects.toThrow(
      "ademe-oubliee",
    );
    expect(base.plansEcrits).toEqual([]);

    // Given un profil qui ouvre une administration sans terme
    const sansTerme = await arrivee(ADMINISTRATION);

    // Then il est refusé lui aussi, et le refus nomme ce que le rôle ouvre : sans
    // échéance, un accès à risque élevé ne se referme jamais de lui-même
    expect(sansTerme.etapes).toEqual([]);
    expect(sansTerme.refus[0]?.motif).toContain(`le rôle admin sur l'organisation ${ORGANISATION}`);
    expect(sansTerme.refus[0]?.motif).toContain("risque élevé");
    expect(sansTerme.refus[0]?.motif).toContain("expiresInDays");
    await expect(enregistrerPlan(DOSSIER, sansTerme, OPERATRICE, MAINTENANT)).rejects.toThrow(
      "expiresInDays",
    );
    expect(base.plansEcrits).toEqual([]);

    // Given le même profil, terme compris
    const borne: Profil = {
      ...ADMINISTRATION,
      accesses: [{ ...ADMINISTRATION.accesses[0], expiresInDays: 180 } as Profil["accesses"][0]],
    };
    const admissible = await arrivee(borne);

    // Then il s'applique, l'étape porte le risque du rôle et son terme, et le plan
    // s'écrit : ce qui est refusé l'est à la construction, ce qui passe s'enregistre
    expect(admissible.refus).toEqual([]);
    const administration = uneEtape(admissible, "github");
    expect(administration.riskLevel).toBe("high");
    expect(administration.grantExpiresAt).toEqual(new Date(MAINTENANT.getTime() + 180 * JOUR));
    await enregistrerPlan(DOSSIER, admissible, OPERATRICE, MAINTENANT);
    expect(base.plansEcrits).toEqual([{ accessCaseId: DOSSIER, etapes: 1 }]);

    // Then les deux refus se lisent avant le clic et non après : un profil qui ne
    // produira aucun plan ne se propose pas à choisir
    const choix = profilsOfferts();
    expect(choix.etat).toBe("lus");
    if (choix.etat !== "lus") {
      throw new Error("la politique doublée est lisible, ce cas ne doit pas se produire");
    }
    expect(choix.offerts.map(({ cle }) => cle)).toEqual(["developpeuse"]);
    expect(choix.refuses.map(({ cle }) => cle)).toEqual(["administration-github", "hors-parc"]);
    expect(choix.refuses.flatMap(({ refus }) => refus).join(" ")).toContain("ademe-oubliee");

    // Then le profil admissible dit ce qu'il ouvre et sous quel terme, avant qu'on le
    // choisisse : l'échéance étant hors empreinte, elle ne se découvre pas plus tard
    expect(choix.offerts[0]?.ouvre).toEqual([
      {
        systeme: "github",
        scope: JSON.stringify(DEVELOPPEUSE.accesses[0]?.scope),
        echeance: "180 jours d'accès",
      },
      { systeme: "notion", scope: "{}", echeance: "sans échéance" },
    ]);
  });
});

describe("un doute d'identité ne prive pas d'un accès, et n'autorise jamais une coupure", () => {
  it("dégrade l'octroi en manuel faute de compte sûr, là où un départ n'émet rien du tout", async () => {
    // Given un compte GitHub rapproché par simple ressemblance, et rien sur la fiche
    base.identites.push({ provider: "github", handle: "cam-rvt", matchMethod: "HEURISTIC" });

    // When on calcule l'arrivée
    const doute = await arrivee(DEVELOPPEUSE);

    // Then l'étape d'octroi existe : écarter un octroi sur la foi d'une ressemblance
    // priverait quelqu'un d'un accès sans que rien ne le signale, là où un octroi de
    // trop se solde d'un clic sur « déjà présent »
    expect(doute.refus).toEqual([]);
    expect(doute.etapes).toHaveLength(2);

    // Then c'est le connecteur qui a dégradé, et il dit laquelle des deux causes :
    // aucun compte à viser, et non un credential qui manque. Les deux appellent deux
    // gestes différents, et les confondre enverrait chercher le mauvais
    const github = uneEtape(doute, "github");
    expect(github.tier).toBe("manual");
    expect(github.params["compte"]).toBeNull();
    expect(github.manual?.runbook).toContain("Aucun identifiant GitHub sûr");
    expect(github.manual?.runbook).not.toContain("github-token-admin");

    // Then la résolution de capacité, elle, n'a rien dégradé : le jeton d'écriture est
    // là, ce qui manque est une donnée
    const capacite = await tierDOctroi("github");
    expect(capacite.tier).toBe("auto");
    expect(capacite.degradedFrom).toBeUndefined();

    // Then la clé d'idempotence suit le pivot d'identité et non le compte : elle ne
    // bougera pas le jour où le compte se découvrira entre la confirmation et
    // l'exécution
    expect(github.idempotencyKey).toBe(CLE_GITHUB);

    // When on calcule le départ de la même personne, avec la même identité
    const sortie = await depart();

    // Then aucune étape, et le système n'est même pas interrogé : couper sur une
    // ressemblance, c'est couper l'accès d'un homonyme. L'asymétrie entre les deux
    // sens est voulue, et le doute s'affiche au lieu de se taire
    expect(sortie.etapes).toEqual([]);
    expect(sortie.systemes).toEqual([]);
    expect(sortie.nonConfirmes).toEqual(["github"]);

    // Given la même identité, mais rattachée par son login plutôt que par sa
    // ressemblance : seule la méthode de rapprochement change
    base.identites.length = 0;
    base.identites.push({ provider: "github", handle: "cam-rvt", matchMethod: "GITHUB_LOGIN" });

    // Then l'arrivée vise enfin un compte, et par la voie automatique
    const sur = uneEtape(await arrivee(DEVELOPPEUSE), "github");
    expect(sur.tier).toBe("auto");
    expect(sur.params["compte"]).toBe("cam-rvt");
    expect(sur.idempotencyKey).toBe(CLE_GITHUB);

    // Then le départ produit enfin son retrait, sur le pivot d'identité et non sur le
    // login : c'est la même donnée qui décide des deux, et un seul champ les sépare
    const coupure = await depart();
    expect(coupure.systemes).toEqual(["github"]);
    const retrait = uneEtape(coupure, "github");
    expect(retrait.capability).toBe("revoke");
    expect(retrait.action).toBe("retirer-de-l-organisation");
    expect(retrait.params).toEqual({ organisation: ORGANISATION, username: USERNAME });
    expect(coupure.nonConfirmes).toEqual([]);
  });
});

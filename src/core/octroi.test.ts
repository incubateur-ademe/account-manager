import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONTRAT_GITHUB, examinerScopeGithub } from "@/connectors/github";
import { CONTRAT_NOTION } from "@/connectors/notion";
import { type PlannedStep, resolveCapability, type SubjectRef } from "@/core/connector";
import {
  assemblerOctrois,
  echeanceDOctroi,
  handlesSurs,
  type SystemeOctroyeur,
  type SystemeOffrantOctroi,
  verifierProfils,
} from "@/core/octroi";
import { empreinteDuPlan } from "@/core/plan";
import { configSchema, type Profil } from "@/core/policy";

/**
 * Le vrai schéma du connecteur et son vrai examen, et non des doublures : ce qui est
 * vérifié ici est précisément que la politique et le connecteur se rencontrent, et une
 * doublure ferait passer le test le jour où le scope de GitHub changerait.
 */
const GITHUB: SystemeOffrantOctroi = {
  key: "github",
  scopeSchema: CONTRAT_GITHUB.scopeSchema,
  octroiDeclare: true,
  examinerScope: examinerScopeGithub(["incubateur-ademe", "startups-ademe"]),
};

/** Un octroi sans portée à choisir, et son vrai schéma : c'est sa stricture qu'on vérifie. */
const NOTION: SystemeOffrantOctroi = {
  key: "notion",
  scopeSchema: CONTRAT_NOTION.scopeSchema,
  octroiDeclare: true,
};

const SANS_OCTROI: SystemeOffrantOctroi = {
  key: "intranet",
  scopeSchema: z.strictObject({}),
  octroiDeclare: false,
};

const CATALOGUE = [GITHUB, NOTION, SANS_OCTROI];

/** Ce que Zod dirait de lui-même, et que personne ne doit lire dans un refus. */
const ANGLAIS = /Unrecognized key|Invalid input|Invalid option|Too small|expected|received/;

function profil(key: string, accesses: Profil["accesses"]): Profil {
  return { key, label: `profil ${key}`, accesses };
}

const MEMBRE = { organisation: "incubateur-ademe", role: "member" };
const ADMIN = { organisation: "incubateur-ademe", role: "admin" };

/** La même administration, sur une autre organisation : une autre cible, donc un autre accès. */
const ADMIN_AILLEURS = { organisation: "startups-ademe", role: "admin" };

describe("un profil ne s'applique que si tout ce qu'il désigne existe et se valide", () => {
  it("distingue la clé à corriger du connecteur qui ne sait pas encore faire", () => {
    expect(
      verifierProfils([profil("developpeur", [{ system: "github", scope: MEMBRE }])], CATALOGUE),
    ).toEqual([]);

    const inconnu = verifierProfils(
      [profil("developpeur", [{ system: "gitlab", scope: MEMBRE }])],
      CATALOGUE,
    );

    expect(inconnu).toHaveLength(1);
    expect(inconnu[0]?.profil).toBe("developpeur");
    expect(inconnu[0]?.systeme).toBe("gitlab");
    expect(inconnu[0]?.motif).toContain("aucun connecteur ne porte cette clé");
    // Les systèmes connus sont énumérés : la faute est une clé, elle se corrige en
    // lisant la bonne.
    expect(inconnu[0]?.motif).toContain("github");

    const sansOctroi = verifierProfils(
      [profil("developpeur", [{ system: "intranet", scope: {} }])],
      CATALOGUE,
    );

    expect(sansOctroi).toHaveLength(1);
    expect(sansOctroi[0]?.systeme).toBe("intranet");
    expect(sansOctroi[0]?.motif).toContain("ne déclare aucun octroi");

    // Deux motifs et non un seul : l'un s'adresse à qui écrit le fichier, l'autre à
    // qui écrit les connecteurs. Les confondre enverrait corriger la mauvaise chose.
    expect(sansOctroi[0]?.motif).not.toBe(inconnu[0]?.motif);
  });

  it("refuse un scope faux en désignant le champ, et jamais le profil entier", () => {
    const horsListe = verifierProfils(
      [profil("developpeur", [{ system: "github", scope: { ...MEMBRE, organisation: "autre" } }])],
      CATALOGUE,
    );

    expect(horsListe).toHaveLength(1);
    expect(horsListe[0]?.motif).toContain("scope.organisation");
    expect(horsListe[0]?.motif).toContain("autre");
    // L'appartenance à la liste ne se vérifie pas dans le schéma, qui est statique et
    // ne connaît aucune configuration : elle se vérifie ici, contre la configuration
    // résolue, et le message renvoie à la clé qui la porte.
    expect(horsListe[0]?.motif).toContain("connectors.github.organisations");

    const cleEnTrop = verifierProfils(
      [profil("developpeur", [{ system: "github", scope: { ...MEMBRE, equipe: "socle" } }])],
      CATALOGUE,
    );

    expect(cleEnTrop).toHaveLength(1);
    expect(cleEnTrop[0]?.motif).toContain("equipe");
    // Le refus dit quoi corriger, et non ce que le schéma attendait : personne ne
    // relit un profil pour y chercher une clé qu'on ne nomme pas.
    expect(cleEnTrop[0]?.motif).toContain("faute de frappe");

    const sansRole = verifierProfils(
      [profil("developpeur", [{ system: "github", scope: { organisation: "incubateur-ademe" } }])],
      CATALOGUE,
    );

    expect(sansRole).toHaveLength(1);
    expect(sansRole[0]?.motif).toContain("scope.role");
    expect(sansRole[0]?.motif).toContain("obligatoire");
    // Les valeurs admises sont énumérées : un champ obligatoire dont on ignore ce
    // qu'il accepte se remplit au hasard.
    expect(sansRole[0]?.motif).toContain("member, admin");

    const mauvaisType = verifierProfils(
      [profil("developpeur", [{ system: "github", scope: { ...MEMBRE, organisation: 42 } }])],
      CATALOGUE,
    );

    expect(mauvaisType).toHaveLength(1);
    expect(mauvaisType[0]?.motif).toContain("scope.organisation");
    expect(mauvaisType[0]?.motif).toContain("un texte");
    expect(mauvaisType[0]?.motif).toContain("un nombre");

    const roleInconnu = verifierProfils(
      [profil("developpeur", [{ system: "github", scope: { ...MEMBRE, role: "editeur" } }])],
      CATALOGUE,
    );

    expect(roleInconnu).toHaveLength(1);
    expect(roleInconnu[0]?.motif).toContain("editeur");
    expect(roleInconnu[0]?.motif).toContain("member, admin");

    // Ces refus s'affichent sur un écran français et dans un journal d'intégration
    // continue français, devant quelqu'un qui édite un YAML : le message brut de Zod
    // y parlerait anglais et de schémas, pas du fichier à corriger.
    for (const refuse of [
      ...horsListe,
      ...cleEnTrop,
      ...sansRole,
      ...mauvaisType,
      ...roleInconnu,
    ]) {
      expect(refuse.motif, refuse.motif).not.toMatch(ANGLAIS);
    }

    // Un profil fautif ne masque pas les autres : le fichier se corrige en une passe.
    const tous = verifierProfils(
      [
        profil("developpeur", [{ system: "github", scope: MEMBRE }]),
        profil("visiteur", [{ system: "gitlab", scope: MEMBRE }]),
        profil("stagiaire", [{ system: "github", scope: { ...MEMBRE, equipe: "socle" } }]),
      ],
      CATALOGUE,
    );

    expect(tous).toHaveLength(2);
    expect(tous.map((refus) => refus.profil)).toEqual(["visiteur", "stagiaire"]);
  });

  it("refuse un scope recopié sur un système qui n'attend aucune portée", () => {
    // Given un profil qui recopie le scope de GitHub sur Notion, où être membre du
    // workspace est tout ce qu'il y a à donner
    const recopie = verifierProfils(
      [profil("observateur", [{ system: "notion", scope: MEMBRE }])],
      CATALOGUE,
    );

    // Then les deux clés sont nommées et refusées : sur un système sans portée, un
    // scope non vide ne veut rien dire, et l'ignorer en silence donnerait un octroi
    // qui n'est pas celui qu'on croit avoir écrit.
    expect(recopie).toHaveLength(1);
    expect(recopie[0]?.systeme).toBe("notion");
    expect(recopie[0]?.motif).toContain("organisation");
    expect(recopie[0]?.motif).toContain("role");
    expect(recopie[0]?.motif).toContain("faute de frappe");
    expect(recopie[0]?.motif).not.toMatch(ANGLAIS);

    // Then la même faute est refusée sur les deux connecteurs et non sur un seul : la
    // stricture est une règle du contrat de scope, pas une préférence de connecteur.
    expect(
      verifierProfils([profil("developpeur", [{ system: "github", scope: MEMBRE }])], CATALOGUE),
    ).toEqual([]);

    // Then un scope vide passe, et c'est bien ce que ce système attend
    expect(
      verifierProfils([profil("observateur", [{ system: "notion", scope: {} }])], CATALOGUE),
    ).toEqual([]);
  });

  it("rend le même verdict que les credentials soient là ou non", () => {
    const profils = [
      profil("developpeur", [{ system: "github", scope: MEMBRE }]),
      profil("visiteur", [{ system: "gitlab", scope: MEMBRE }]),
    ];

    // La garantie est portée par le type et non par ce test : le catalogue ne porte
    // aucune sonde ni aucun tier, seulement un booléen, si bien que rien de ce que
    // `verifierProfils` reçoit ne peut dépendre d'un secret. Un octroi indisponible
    // faute de credential reste donc un profil valide, et c'est à l'exécution que le
    // tier dégrade. Poser un jeton dans l'environnement pour le montrer suggérerait
    // l'inverse : que la fonction saurait le lire.
    const refus = verifierProfils(profils, CATALOGUE);

    expect(refus).toHaveLength(1);
    expect(refus[0]?.profil).toBe("visiteur");
  });
});

describe("un accès élevé sans échéance ne s'applique pas, et une échéance ne se reconduit pas", () => {
  it("exige une échéance du seul rôle que le connecteur tient pour élevé", () => {
    const administration = verifierProfils(
      [profil("administration-github", [{ system: "github", scope: ADMIN }])],
      CATALOGUE,
    );

    expect(administration).toHaveLength(1);
    expect(administration[0]?.profil).toBe("administration-github");
    expect(administration[0]?.systeme).toBe("github");
    // Le refus nomme le rôle et l'organisation : sans eux, il faudrait rouvrir le
    // fichier pour savoir lequel des accès du profil est en cause.
    expect(administration[0]?.motif).toContain("admin");
    expect(administration[0]?.motif).toContain("incubateur-ademe");
    expect(administration[0]?.motif).toContain("expiresInDays");

    expect(
      verifierProfils(
        [profil("administration-github", [{ system: "github", scope: ADMIN, expiresInDays: 180 }])],
        CATALOGUE,
      ),
    ).toEqual([]);

    // Une place ordinaire n'a pas à porter de terme : l'exigence vise l'escalade, pas
    // l'accès courant, sans quoi elle deviendrait une formalité qu'on recopie partout.
    expect(
      verifierProfils([profil("developpeur", [{ system: "github", scope: MEMBRE }])], CATALOGUE),
    ).toEqual([]);
  });

  it("calcule une échéance absolue, que rien ne rattache à une mission", () => {
    const maintenant = new Date("2026-08-25T09:00:00.000Z");

    expect(echeanceDOctroi(undefined, maintenant)).toBeNull();
    expect(echeanceDOctroi(180, maintenant)?.toISOString()).toBe("2027-02-21T09:00:00.000Z");
    expect(echeanceDOctroi(1, maintenant)?.toISOString()).toBe("2026-08-26T09:00:00.000Z");

    // Rien ne borne ni ne raccourcit : la durée demandée est la durée obtenue.
    expect(echeanceDOctroi(3650, maintenant)?.toISOString()).toBe("2036-08-22T09:00:00.000Z");

    // La fin de mission n'est pas un paramètre, et c'est la règle elle-même : deux
    // personnes dont les missions finissent à dix ans d'écart reçoivent la même
    // échéance au même instant. Prolonger une mission ne reconduit rien.
    expect(echeanceDOctroi(180, maintenant)).toEqual(echeanceDOctroi(180, maintenant));
  });
});

describe("la politique charge un profil sans en valider le scope", () => {
  it("accepte un scope que le connecteur refusera, et refuse ce qui rendrait le fichier illisible", () => {
    const lu = configSchema.parse({
      version: 1,
      profiles: [
        {
          key: "developpeur",
          label: "Développeur",
          accesses: [{ system: "github", scope: MEMBRE }],
        },
        // Le scope est large ici : sa forme appartient au connecteur, et un connecteur
        // dont l'octroi n'a pas de périmètre à choisir n'attend rien du tout.
        { key: "observateur", label: "Observateur", accesses: [{ system: "notion" }] },
        { key: "sans-acces", label: "Sans accès" },
      ],
    });

    expect(lu.profiles.map((entree) => entree.key)).toEqual([
      "developpeur",
      "observateur",
      "sans-acces",
    ]);
    expect(lu.profiles[1]?.accesses[0]?.scope).toEqual({});
    expect(lu.profiles[2]?.accesses).toEqual([]);

    // La clé écrite puis laissée vide, que YAML rend en `null` : elle vaut le scope
    // vide et non le refus du fichier. Le défaut ne couvrait que l'absence de la clé,
    // si bien que ce seul caractère manquant arrêtait la collecte de tout le parc.
    const laisseVide = configSchema.parse({
      version: 1,
      profiles: [
        {
          key: "scope-laisse-vide",
          label: "Scope laissé vide",
          accesses: [{ system: "github", scope: null }],
        },
      ],
    });

    expect(laisseVide.profiles[0]?.accesses[0]?.scope).toEqual({});

    // Et c'est la seconde passe qui dit au profil ce qui lui manque, champ par champ,
    // sans rien emporter avec elle.
    const refusDuVide = verifierProfils(laisseVide.profiles, CATALOGUE);

    expect(refusDuVide.map((refuse) => refuse.motif.split(" : ")[0])).toEqual([
      "scope.organisation",
      "scope.role",
    ]);
    for (const refuse of refusDuVide) {
      expect(refuse.motif).toContain("obligatoire");
      expect(refuse.motif, refuse.motif).not.toMatch(ANGLAIS);
    }

    // Le coeur de la validation en deux passes : ce scope est refusé par le
    // connecteur, et pourtant le fichier se charge. S'il ne se chargeait pas, une
    // faute de frappe dans un profil arrêterait la collecte nocturne de tout le parc.
    const douteux = configSchema.parse({
      version: 1,
      profiles: [
        {
          key: "developpeur",
          label: "Développeur",
          accesses: [{ system: "github", scope: { organisation: 42 } }],
        },
      ],
    });

    expect(douteux.profiles[0]?.accesses[0]?.scope).toEqual({ organisation: 42 });
    expect(verifierProfils(douteux.profiles, CATALOGUE)).not.toHaveLength(0);

    // Deux profils de même clé, en revanche, rendent le fichier ininterprétable : une
    // arrivée qui désigne cette clé ne sait plus ce qu'elle demande.
    expect(() =>
      configSchema.parse({
        version: 1,
        profiles: [
          { key: "developpeur", label: "Un", accesses: [] },
          { key: "developpeur", label: "Deux", accesses: [] },
        ],
      }),
    ).toThrow(/même clé/);

    expect(() =>
      configSchema.parse({
        version: 1,
        profiles: [{ key: "developpeur", label: "Développeur", acces: [] }],
      }),
    ).toThrow();

    // Absent, le noeud vaut la liste vide : une instance qui ne déclare aucun profil
    // fonctionne, elle n'ouvre simplement rien automatiquement à l'arrivée.
    expect(configSchema.parse({ version: 1 }).profiles).toEqual([]);
  });
});

describe("un scope mal formé se charge quand même, et c'est la seconde passe qui le nomme", () => {
  it("laisse passer ce qui n'est pas un objet, puis le refuse en nommant l'accès fautif", () => {
    // Given un fichier où plusieurs profils écrivent leur scope de travers, et un
    // profil qui déclare deux accès sur le même système, l'un valide et l'autre non
    const lu = configSchema.parse({
      version: 1,
      profiles: [
        {
          key: "chaine",
          label: "Scope écrit sans accolades",
          accesses: [{ system: "notion", scope: "admin" }],
        },
        {
          key: "liste",
          label: "Scope écrit en liste",
          accesses: [{ system: "notion", scope: [] }],
        },
        {
          key: "nombre",
          label: "Scope écrit en nombre",
          accesses: [{ system: "notion", scope: 42 }],
        },
        {
          key: "vide",
          label: "Clé écrite puis laissée vide",
          accesses: [{ system: "notion", scope: null }],
        },
        {
          key: "developpeur",
          label: "Développeur",
          accesses: [
            { system: "github", scope: MEMBRE },
            { system: "github", scope: ADMIN },
          ],
        },
      ],
    });

    // Then le chargement passe, et c'est la propriété qui ne se négocie pas : un
    // fichier refusé ici, c'est la collecte de tout le parc qui ne tourne plus.
    expect(lu.profiles.map((entree) => entree.key)).toEqual([
      "chaine",
      "liste",
      "nombre",
      "vide",
      "developpeur",
    ]);

    // Then la valeur fautive est conservée telle quelle : la ramener au scope vide
    // effacerait la faute avec elle, et un système qui n'attend aucun champ
    // l'accepterait alors sans un mot.
    expect(lu.profiles[0]?.accesses[0]?.scope).toBe("admin");
    expect(lu.profiles[1]?.accesses[0]?.scope).toEqual([]);
    expect(lu.profiles[2]?.accesses[0]?.scope).toBe(42);

    // Then seule la clé laissée vide vaut le scope vide, elle qui ne dit rien de faux
    expect(lu.profiles[3]?.accesses[0]?.scope).toEqual({});

    // When la seconde passe examine ces profils
    const refus = verifierProfils(lu.profiles, CATALOGUE);

    // Then les trois scopes mal formés sont refusés, chacun nommant ce qu'il a reçu,
    // alors même que notion n'attend aucun champ et n'aurait rien eu à refuser
    expect(refus.filter((un) => un.profil === "chaine")).toHaveLength(1);
    expect(refus.find((un) => un.profil === "chaine")?.motif).toContain("attend un objet");
    expect(refus.find((un) => un.profil === "liste")?.motif).toContain("une liste");
    expect(refus.find((un) => un.profil === "nombre")?.motif).toContain("attend un objet");

    // Then la clé laissée vide ne dit rien de faux et ne se fait pas reprendre
    expect(refus.filter((un) => un.profil === "vide")).toEqual([]);

    // Then du profil à deux accès, seul le second est refusé, et son rang le désigne :
    // sans lui, l'accès valide afficherait le refus de son voisin.
    const deuxAcces = refus.filter((un) => un.profil === "developpeur");
    expect(deuxAcces).toHaveLength(1);
    expect(deuxAcces[0]?.acces).toBe(1);
    expect(deuxAcces[0]?.motif).toContain("échéance");

    // Then aucun de ces refus ne parle anglais
    for (const un of refus) {
      expect(un.motif).not.toMatch(ANGLAIS);
    }
  });
});

describe("les identifiants qu'un octroi reçoit sont ceux dont on répond", () => {
  it("retient la fiche et les comptes sûrs, écarte la ressemblance, l'inconnu et le disparu", () => {
    // Given une personne dont la fiche porte un login saisi à la main, un compte
    // rapproché sur son adresse, un compte qui lui ressemble, un compte que personne
    // ne réclame, et un compte sûr que le système ne rend plus
    const handles = handlesSurs("  https://github.com/Camille-Roux/  ", [
      {
        provider: "notion",
        handle: "camille.roux@beta.gouv.fr",
        methode: "EMAIL_EXACT",
        disparue: false,
      },
      { provider: "atelier", handle: "c.roux", methode: "HEURISTIC", disparue: false },
      { provider: "coffre", handle: "croux", methode: "NONE", disparue: false },
      { provider: "sentry", handle: "camille", methode: "EMAIL_EXACT", disparue: true },
    ]);

    // Then seuls les deux identifiants sûrs sortent, et le login de la fiche sort
    // réduit à ce qu'il désigne vraiment
    expect(handles).toEqual({ github: "camille-roux", notion: "camille.roux@beta.gouv.fr" });

    // Then la ressemblance n'entre pas : accorder une administration au compte d'un
    // homonyme est plus grave que de couper le mauvais, et c'est le seul endroit où
    // cette asymétrie se décide.
    expect(handles["atelier"]).toBeUndefined();
    expect(handles["coffre"]).toBeUndefined();

    // Then le compte disparu non plus : un octroi visant son identifiant viserait un
    // compte que le système ne rend plus.
    expect(handles["sentry"]).toBeUndefined();

    // Then une clé absente vaut « aucun identifiant fiable » et rien d'autre : ni
    // chaîne vide, ni identifiant deviné depuis le username.
    expect(Object.keys(handles).sort()).toEqual(["github", "notion"]);
  });

  it("laisse la clé absente plutôt que de départager deux identifiants sûrs qui se contredisent", () => {
    // Given une fiche et un compte observé qui désignent le même login à la casse près
    const accord = handlesSurs("Camille-Roux", [
      { provider: "github", handle: "camille-ROUX", methode: "GITHUB_LOGIN", disparue: false },
    ]);

    // Then l'accord se voit, une seule fois
    expect(accord).toEqual({ github: "camille-roux" });

    // Given deux comptes sûrs sur le même système, désignant deux comptes différents
    const contradiction = handlesSurs("camille-roux", [
      { provider: "github", handle: "croux-pro", methode: "EMAIL_EXACT", disparue: false },
    ]);

    // Then le système sort sans identifiant : trancher serait exactement la
    // supposition qu'on refuse, et l'octroi dégradera en manuel de lui-même.
    expect(contradiction).toEqual({});

    // Given une fiche vide et rien d'observé
    expect(handlesSurs(null, [])).toEqual({});
    expect(handlesSurs("   ", [])).toEqual({});
    expect(handlesSurs("@", [])).toEqual({});

    // Then rien n'est fabriqué : le socle ne suppose pas un identifiant, il en
    // répond ou il se tait.
    expect(
      handlesSurs(undefined, [
        { provider: "notion", handle: "   ", methode: "EMAIL_EXACT", disparue: false },
      ]),
    ).toEqual({});
  });
});

/**
 * Le vrai contrat de GitHub, la vraie résolution de capacité, une doublure pour le
 * seul appel sortant qu'il resterait : ce qui est vérifié ici est la rencontre du
 * profil, du connecteur et de l'horloge, et une doublure de scope ferait passer le
 * test le jour où GitHub changerait le sien.
 */
function octroyeur(over: Partial<SystemeOctroyeur> = {}): SystemeOctroyeur {
  return {
    key: "github",
    scopeSchema: CONTRAT_GITHUB.scopeSchema,
    octroiDeclare: true,
    examinerScope: examinerScopeGithub(["incubateur-ademe", "startups-ademe"]),
    capacite: resolveCapability(
      "grant",
      CONTRAT_GITHUB.capabilities.grant,
      [{ id: "github-token-admin", available: true, checkedAt: new Date(0) }],
      CONTRAT_GITHUB.runbook,
    ),
    planifier: (scope, sujet) => [etapeDouble(scope, sujet)],
    ...over,
  };
}

/**
 * Ce qu'un connecteur rend pour un octroi, dans la forme que le socle attend de lui :
 * un critère de complétion qui dit qu'une invitation en attente est un accès accordé.
 */
function etapeDouble(scope: unknown, sujet: SubjectRef): PlannedStep {
  const { organisation, role } = scope as { organisation: string; role: string };
  const qui = sujet.kind === "person" ? sujet.username : sujet.key;
  const handle = sujet.kind === "person" ? sujet.handles?.["github"] : undefined;

  return {
    systemKey: "github",
    capability: "grant",
    tier: handle ? "auto" : "manual",
    action: "ouvrir-l-acces",
    label: `Inviter ${qui} dans ${organisation} avec le rôle ${role}`,
    params: { organisation, role, beneficiaire: qui, compte: handle ?? null },
    riskLevel: role === "admin" ? "high" : "medium",
    expectedState: { role },
    idempotencyKey: `github:${organisation}:grant:${qui}:${role}`,
    manual: {
      title: `Inviter ${qui} dans ${organisation}`,
      runbook: CONTRAT_GITHUB.runbook,
      doneWhen: `${qui} figure parmi les membres de ${organisation} avec le rôle ${role}, ou parmi les invitations en attente : une invitation non acceptée est un accès accordé, pas un accès en suspens.`,
    },
  };
}

const ALICE: SubjectRef = {
  kind: "person",
  username: "alice.martin",
  handles: { github: "alicemartin" },
};

const LE_5_JANVIER = new Date("2026-01-05T09:00:00.000Z");

describe("un profil ouvre exactement ce qu'il déclare, et le socle y ajoute le terme", () => {
  it("pose l'échéance depuis le profil, laisse la justification vide, et passe au connecteur les identifiants sûrs", () => {
    // Given un profil qui ouvre une place ordinaire sans terme et, sur une autre
    // organisation, une administration à cent quatre-vingts jours
    const developpeur = profil("developpeur", [
      { system: "github", scope: MEMBRE },
      { system: "github", scope: ADMIN_AILLEURS, expiresInDays: 180 },
    ]);

    // When on assemble ses octrois pour une personne dont on connaît le compte
    const { etapes, refus } = assemblerOctrois(developpeur, [octroyeur()], ALICE, LE_5_JANVIER);

    // Then rien n'est refusé, et chaque accès a produit son étape
    expect(refus).toEqual([]);
    expect(etapes).toHaveLength(2);

    // Then le terme vient de `echeanceDOctroi` et de nulle part ailleurs : absolu,
    // compté depuis le calcul, et posé sur la seule étape que le profil borne
    expect(etapes[0]?.grantExpiresAt).toBeUndefined();
    expect(etapes[1]?.grantExpiresAt).toEqual(echeanceDOctroi(180, LE_5_JANVIER));
    expect(etapes[1]?.grantExpiresAt).toEqual(new Date("2026-07-04T09:00:00.000Z"));

    // Then aucune étape ne porte de justification : le profil est la justification, et
    // la recopier depuis lui ferait naître la file des accès à justifier pleine de faux
    for (const etape of etapes) {
      expect(Object.hasOwn(etape, "justification")).toBe(false);
    }

    // Then le connecteur a reçu le scope tel que son schéma le rend, et l'identifiant
    // dont on répond : il a donc pu tenir sa voie automatique
    expect(etapes[0]?.params).toMatchObject({ compte: "alicemartin", role: "member" });
    expect(etapes.map((etape) => etape.tier)).toEqual(["auto", "auto"]);

    // Then le critère de complétion reste celui du connecteur, et il dit ce que le
    // socle ne saurait pas dire : une invitation en attente est un accès accordé
    expect(etapes[1]?.manual?.doneWhen).toContain("invitations en attente");
  });

  it("refuse en bloc un accès élevé sans échéance, en nommant le profil, le système et le rôle", () => {
    // Given un profil où l'administration a été écrite sans terme, à côté d'un accès
    // parfaitement valide
    const sansTerme = profil("mainteneur", [
      { system: "github", scope: MEMBRE },
      { system: "github", scope: ADMIN },
    ]);

    // When on assemble
    const { etapes, refus } = assemblerOctrois(sansTerme, [octroyeur()], ALICE, LE_5_JANVIER);

    // Then la construction échoue, et elle échoue en bloc : l'accès valide ne part pas
    // à moitié pendant que son voisin attend une correction
    expect(etapes).toEqual([]);
    expect(refus).toHaveLength(1);

    // Then le refus nomme le profil, le système, le rang de l'accès et ce que le rôle
    // ouvre, faute de quoi il faudrait deviner laquelle des deux lignes corriger
    expect(refus[0]?.profil).toBe("mainteneur");
    expect(refus[0]?.systeme).toBe("github");
    expect(refus[0]?.acces).toBe(1);
    expect(refus[0]?.motif).toContain("admin");
    expect(refus[0]?.motif).toContain("incubateur-ademe");
    expect(refus[0]?.motif).toContain("expiresInDays");

    // Then c'est bien la construction qui refuse, et le même verdict qu'à la lecture
    // de la politique : un profil que `pnpm policy:check` accepte ne doit jamais faire
    // échouer un plan, ni l'inverse
    expect(verifierProfils([sansTerme], [octroyeur()])).toHaveLength(1);
  });

  it("rend le même verdict qu'à la vérification de la politique sur un scope faux", () => {
    // Given un profil qui vise une organisation hors liste et un système inconnu
    const boiteux = profil("boiteux", [
      { system: "github", scope: { organisation: "autre-org", role: "member" } },
      { system: "gitlab", scope: MEMBRE },
    ]);

    // When on assemble
    const { etapes, refus } = assemblerOctrois(boiteux, [octroyeur()], ALICE, LE_5_JANVIER);

    // Then rien n'est construit, et les deux motifs sont ceux du fichier de politique
    expect(etapes).toEqual([]);
    expect(refus.map((r) => r.systeme)).toEqual(["github", "gitlab"]);
    expect(refus[0]?.motif).toContain("autre-org");
    expect(refus[1]?.motif).toContain("aucun connecteur ne porte cette clé");
    expect(refus.map((r) => r.motif)).toEqual(
      verifierProfils([boiteux], [octroyeur()]).map((r) => r.motif),
    );
  });

  it("refuse deux accès qui visent la même cible sous deux rôles, à la vérification", () => {
    // Given un profil qui demande une place ordinaire et l'administration de la même
    // organisation, l'une et l'autre parfaitement écrites
    const deuxRoles = profil("mainteneur", [
      { system: "github", scope: MEMBRE },
      { system: "github", scope: ADMIN, expiresInDays: 180 },
    ]);

    // When on assemble
    const { etapes, refus } = assemblerOctrois(deuxRoles, [octroyeur()], ALICE, LE_5_JANVIER);

    // Then rien n'est construit : les deux étapes viseraient la même place, la première
    // exécutée ferait constater à la seconde un autre rôle que celui qu'elle attend, et
    // cette seconde étape resterait en écart sans que personne ne puisse la débloquer
    expect(etapes).toEqual([]);
    expect(refus).toHaveLength(1);

    // Then le refus nomme le profil, le système, le rang à corriger et les deux rôles :
    // c'est le second qui est en trop, et il faut savoir lequel des deux garder
    expect(refus[0]?.profil).toBe("mainteneur");
    expect(refus[0]?.systeme).toBe("github");
    expect(refus[0]?.acces).toBe(1);
    expect(refus[0]?.motif).toContain("admin");
    expect(refus[0]?.motif).toContain("member");
    expect(refus[0]?.motif).toContain("incubateur-ademe");

    // Then c'est bien la vérification qui refuse, et le même verdict qu'à la lecture de
    // la politique : le défaut se corrige dans le fichier, et jamais sur un plan confirmé
    // dont une étape serait murée pour toujours
    expect(verifierProfils([deuxRoles], CATALOGUE).map((r) => r.motif)).toEqual(
      refus.map((r) => r.motif),
    );

    // Then ce qui compte est la cible et non le système : deux organisations distinctes
    // ne se gênent pas, et le rôle n'entre pas dans la cible
    expect(
      verifierProfils(
        [
          profil("mainteneur", [
            { system: "github", scope: MEMBRE },
            { system: "github", scope: ADMIN_AILLEURS, expiresInDays: 180 },
          ]),
        ],
        CATALOGUE,
      ),
    ).toEqual([]);
  });

  it("tient le terme d'un octroi pour la seule affaire du profil, étape émise comprise", () => {
    // Given un connecteur qui relève lui-même le risque de son étape et lui pose une
    // échéance de son cru, sur un scope que son examen tient pourtant pour ordinaire
    const DANS_DIX_ANS = new Date("2036-01-05T09:00:00.000Z");
    const zele = octroyeur({
      planifier: (scope, sujet) => [
        { ...etapeDouble(scope, sujet), riskLevel: "high", grantExpiresAt: DANS_DIX_ANS },
      ],
    });
    const ordinaire = { system: "github" as const, scope: MEMBRE };

    // When on assemble un profil sans terme
    const sansTerme = assemblerOctrois(
      profil("developpeur", [ordinaire]),
      [zele],
      ALICE,
      LE_5_JANVIER,
    );

    // Then l'étape élevée est refusée : la règle regarde ce que l'étape porte et pas
    // seulement ce que le scope disait, faute de quoi un connecteur ouvrirait une
    // administration sans terme en relevant son propre risque
    expect(sansTerme.etapes).toEqual([]);
    expect(sansTerme.refus).toHaveLength(1);
    expect(sansTerme.refus[0]?.profil).toBe("developpeur");
    expect(sansTerme.refus[0]?.systeme).toBe("github");
    expect(sansTerme.refus[0]?.acces).toBe(0);
    expect(sansTerme.refus[0]?.motif).toContain("member");
    expect(sansTerme.refus[0]?.motif).toContain("expiresInDays");

    // Then l'examen du scope, lui, ne voyait rien : ce refus ne pouvait venir que de là
    expect(verifierProfils([profil("developpeur", [ordinaire])], CATALOGUE)).toEqual([]);

    // When le profil borne l'accès à quatre-vingt-dix jours
    const borne = assemblerOctrois(
      profil("developpeur", [{ ...ordinaire, expiresInDays: 90 }]),
      [zele],
      ALICE,
      LE_5_JANVIER,
    );

    // Then l'étape sort, et son terme est celui du profil : l'échéance du connecteur est
    // écrasée et non complétée, la durée d'un accès appartenant à la politique
    expect(borne.refus).toEqual([]);
    expect(borne.etapes[0]?.grantExpiresAt).toEqual(echeanceDOctroi(90, LE_5_JANVIER));
    expect(borne.etapes[0]?.grantExpiresAt).not.toEqual(DANS_DIX_ANS);

    // Then sans terme au profil, l'étape n'en porte aucun : l'absence de terme dans le
    // profil vaut absence de terme sur l'étape, et rien d'autre ne la décide
    const modeste = octroyeur({
      planifier: (scope, sujet) => [{ ...etapeDouble(scope, sujet), grantExpiresAt: DANS_DIX_ANS }],
    });
    const libre = assemblerOctrois(
      profil("developpeur", [ordinaire]),
      [modeste],
      ALICE,
      LE_5_JANVIER,
    );

    expect(libre.refus).toEqual([]);
    expect(libre.etapes[0]?.grantExpiresAt).toBeUndefined();
    expect(Object.hasOwn(libre.etapes[0] ?? {}, "grantExpiresAt")).toBe(false);
  });
});

describe("un octroi impossible produit une étape, jamais une omission", () => {
  it("émet l'étape au tier réel, en portant le runbook du contrat et ce qui manque", () => {
    // Given un système dont toutes les voies d'octroi exigent un credential absent :
    // la capacité résout donc en « none »
    const sansVoie = octroyeur({
      capacite: resolveCapability(
        "grant",
        [{ requires: ["jeton-notion"], tier: "auto", runbook: "Ouvrir l'espace, puis inviter." }],
        [
          {
            id: "jeton-notion",
            available: false,
            unavailableReason: "absent de l'environnement",
            checkedAt: new Date(0),
          },
        ],
        "Marche à suivre du contrat.",
      ),
      // Le connecteur n'est même pas consulté : il n'a aucune voie à proposer.
      planifier: () => {
        throw new Error("un connecteur sans voie ne doit pas être consulté");
      },
    });

    // When on assemble un profil qui vise ce système
    const { etapes, refus } = assemblerOctrois(
      profil("developpeur", [{ system: "github", scope: MEMBRE }]),
      [sansVoie],
      ALICE,
      LE_5_JANVIER,
    );

    // Then l'étape existe quand même : une ligne d'arrivée qui manque est le mode de
    // panne que ce produit existe pour éviter, une ligne à faire à la main se traite
    expect(refus).toEqual([]);
    expect(etapes).toHaveLength(1);
    expect(etapes[0]?.tier).toBe("none");
    expect(etapes[0]?.capability).toBe("grant");

    // Then elle porte le runbook du contrat, requis même sur une capacité automatique,
    // et elle nomme le credential qui manque plutôt que de se taire
    expect(etapes[0]?.manual?.runbook).toContain("Marche à suivre du contrat.");
    expect(etapes[0]?.manual?.runbook).toContain("jeton-notion");

    // Then son critère de complétion existe : sans lui, « fait » ne veut rien dire
    expect(etapes[0]?.manual?.doneWhen).toContain("alice.martin");

    // Then ses paramètres restent plats, tout le scope compris : `empreinteDuPlan`
    // filtre les clés à tous les niveaux, et un scope imbriqué disparaîtrait de
    // l'empreinte, rendant deux octrois différents indiscernables
    expect(etapes[0]?.params).toEqual({
      beneficiaire: "alice.martin",
      organisation: "incubateur-ademe",
      role: "member",
    });

    const memeSujetAutreRole = assemblerOctrois(
      profil("developpeur", [{ system: "github", scope: ADMIN, expiresInDays: 180 }]),
      [sansVoie],
      ALICE,
      LE_5_JANVIER,
    );
    expect(empreinteDuPlan(memeSujetAutreRole.etapes)).not.toBe(empreinteDuPlan(etapes));
  });

  it("émet l'étape quand le connecteur ne propose rien, sans inventer de voie", () => {
    // Given un connecteur qui déclare un octroi manuel mais ne sait rien en dire
    const muet = octroyeur({
      capacite: resolveCapability(
        "grant",
        [{ requires: [], tier: "manual" }],
        [],
        "Marche à suivre du contrat.",
      ),
      planifier: () => [],
    });

    // When on assemble
    const { etapes } = assemblerOctrois(
      profil("developpeur", [{ system: "github", scope: MEMBRE, expiresInDays: 90 }]),
      [muet],
      ALICE,
      LE_5_JANVIER,
    );

    // Then l'étape est là, à son tier réel et non dégradée d'un cran de plus
    expect(etapes).toHaveLength(1);
    expect(etapes[0]?.tier).toBe("manual");

    // Then le terme du profil s'y pose comme sur n'importe quelle autre
    expect(etapes[0]?.grantExpiresAt).toEqual(echeanceDOctroi(90, LE_5_JANVIER));
  });

  it("ne laisse jamais l'étape de repli au tier automatique, même quand la capacité y résout", () => {
    // Given un système dont l'octroi résout en automatique, credential présent, mais
    // dont le connecteur ne sait pas décrire l'étape : c'est la configuration où un
    // connecteur déclare savoir donner avant de savoir planifier.
    const muetMaisArme = octroyeur({
      capacite: resolveCapability(
        "grant",
        [
          { requires: ["jeton-admin"], tier: "auto", runbook: "Inviter depuis la console." },
          { requires: [], tier: "manual", runbook: "Inviter à la main." },
        ],
        [{ id: "jeton-admin", available: true, checkedAt: new Date(0) }],
        "Marche à suivre du contrat.",
      ),
      planifier: () => [],
    });

    // When on assemble un profil qui vise ce système
    const { etapes } = assemblerOctrois(
      profil("developpeur", [{ system: "github", scope: MEMBRE }]),
      [muetMaisArme],
      ALICE,
      LE_5_JANVIER,
    );

    // Then l'étape existe, mais à la main : elle porte une action que le socle a
    // inventée et que le connecteur n'a jamais planifiée. Au tier automatique, la
    // boucle la lui enverrait avec un ordre qu'il ne connaît pas, et le plafond de
    // masse la compterait comme si elle partait toute seule.
    expect(etapes).toHaveLength(1);
    expect(etapes[0]?.tier).toBe("manual");
    expect(etapes[0]?.manual).toBeDefined();
  });
});

describe("l'arrivée ne se prive pas d'un accès sur un doute d'identité", () => {
  it("émet l'étape sans identifiant sûr, et laisse le connecteur dégrader lui-même", () => {
    // Given une personne dont aucun compte n'est rattaché de façon sûre : ni login sur
    // sa fiche, ni identité observée que son rapprochement autorise à couper
    const douteuse: SubjectRef = {
      kind: "person",
      username: "bruno.lefevre",
      handles: handlesSurs(null, [
        { provider: "github", handle: "brunolf", methode: "HEURISTIC", disparue: false },
      ]),
    };
    expect(douteuse.kind === "person" && douteuse.handles).toEqual({});

    // When on assemble son arrivée
    const { etapes, refus } = assemblerOctrois(
      profil("developpeur", [{ system: "github", scope: MEMBRE }]),
      [octroyeur()],
      douteuse,
      LE_5_JANVIER,
    );

    // Then l'étape existe : écarter un octroi sur la foi d'une ressemblance priverait
    // quelqu'un d'un accès sans que rien ne le signale, là où un octroi de trop se
    // solde d'un clic sur « déjà présent »
    expect(refus).toEqual([]);
    expect(etapes).toHaveLength(1);

    // Then c'est le connecteur qui a dégradé en manuel, et non la résolution de
    // capacité : ce qui manque ici est une donnée, pas un credential
    expect(etapes[0]?.tier).toBe("manual");
    expect(etapes[0]?.params).toMatchObject({ compte: null });
    expect(etapes[0]?.manual?.doneWhen).toContain("invitations en attente");
  });
});

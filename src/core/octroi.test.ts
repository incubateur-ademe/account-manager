import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CONTRAT_GITHUB, examinerScopeGithub } from "@/connectors/github";
import { CONTRAT_NOTION } from "@/connectors/notion";
import {
  echeanceDOctroi,
  handlesSurs,
  type SystemeOffrantOctroi,
  verifierProfils,
} from "@/core/octroi";
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
  examinerScope: examinerScopeGithub(["incubateur-ademe"]),
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

    // Le catalogue ne porte aucune sonde et aucun tier, seulement un booléen : un
    // octroi indisponible faute de secret reste un profil valide, c'est à l'exécution
    // que le tier dégrade. La démonstration passe par l'environnement parce que c'est
    // le seul endroit d'où un credential pourrait entrer.
    process.env["GITHUB_ADMIN_TOKEN"] = "un-jeton-qui-ne-sert-a-rien-ici";
    const avec = verifierProfils(profils, CATALOGUE);

    delete process.env["GITHUB_ADMIN_TOKEN"];
    const sans = verifierProfils(profils, CATALOGUE);

    expect(avec).toEqual(sans);
    expect(sans).toHaveLength(1);
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

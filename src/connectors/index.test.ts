import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONNECTEURS, catalogueDOctroi, connecteur } from "@/connectors";
import type {
  Capability,
  CapabilityDecl,
  ConnectorContract,
  CredentialProbe,
  NonEmptyArray,
} from "@/core/connector";
import { resolveCapability } from "@/core/connector";
import { verifierProfils } from "@/core/octroi";
import type { Profil } from "@/core/policy";

/**
 * Les modèles de politique recopiés dans un répertoire jetable, parce que l'examen de
 * scope de GitHub lit les organisations déclarées : c'est ce trajet-là qu'on vérifie,
 * du fichier de politique jusqu'au verdict, et une doublure de configuration en
 * couperait le milieu.
 *
 * Posé dans le corps du module et non avant les imports : la politique se lit au
 * premier appel, et aucun import n'en déclenche la lecture.
 */
const REPERTOIRE = mkdtempSync(join(tmpdir(), "politique-registre-"));

for (const fichier of ["accounts", "config"]) {
  copyFileSync(
    resolve(process.cwd(), `config/${fichier}.exemple.yaml`),
    join(REPERTOIRE, `${fichier}.yaml`),
  );
}

process.env["POLICY_DIR"] = REPERTOIRE;

/**
 * Les capacités qui agissent sur un système, et les seules à qui ce test impose une
 * voie inconditionnelle, quand un contrat les déclare : ce que l'outil promet de faire
 * doit rester faisable le jour où le credential tombe, et un runbook est justement ce
 * qui le rend faisable. Un connecteur qui ne déclare pas d'octroi ne promet rien, donc
 * ne se voit rien exiger.
 *
 * `list` n'en est pas et ne peut pas l'être : une collecte à la main ne remplit
 * aucune base, et lui exiger une voie manuelle reviendrait à déclarer un tier que
 * personne n'exécutera jamais.
 */
const ACTIONS: readonly Capability[] = ["grant", "revoke"];

const INSTANT = new Date("2026-08-25T09:00:00.000Z");

/**
 * Les credentials du contrat, sondés, et disponibles seulement s'ils sont nommés. Des
 * sondes explicites plutôt qu'une liste vide : ce qui se vérifie ici est le
 * comportement d'un credential constaté absent, pas celui d'un credential oublié.
 */
function sondes(contrat: ConnectorContract, disponibles: readonly string[]): CredentialProbe[] {
  return contrat.credentials.map((credential) => ({
    id: credential.id,
    available: disponibles.includes(credential.id),
    checkedAt: INSTANT,
  }));
}

function capacitesDe(contrat: ConnectorContract): [Capability, NonEmptyArray<CapabilityDecl>][] {
  return ACTIONS.flatMap((capacite) => {
    const voies = contrat.capabilities[capacite];
    return voies ? [[capacite, voies] as [Capability, NonEmptyArray<CapabilityDecl>]] : [];
  });
}

function contratDe(key: string): ConnectorContract {
  const trouve = connecteur(key);

  if (!trouve) {
    throw new Error(`le registre devrait porter ${key}`);
  }

  return trouve.contract;
}

describe("ce que les contrats du registre promettent", () => {
  it("ne promet aucune action qu'un credential absent ferait disparaître", () => {
    // Given le registre tel qu'il est, deux connecteurs et non un seul
    expect(CONNECTEURS.map(({ contract }) => contract.key)).toEqual(["github", "notion"]);

    // Then les deux gestes du socle sont déclarés quelque part dans le registre. La
    // vérification est ici et non par contrat : ce qui suit n'oblige qu'une capacité
    // déjà déclarée, si bien qu'un connecteur en lecture seule y passerait sans un
    // mot, et cette ligne empêche la boucle de se vider en silence le jour où
    // l'octroi disparaîtrait de partout à la fois.
    const gestesDuRegistre = new Set(
      CONNECTEURS.flatMap(({ contract }) => capacitesDe(contract).map(([capacite]) => capacite)),
    );

    expect([...gestesDuRegistre].sort()).toEqual([...ACTIONS].sort());

    for (const { contract } of CONNECTEURS) {
      const declarees = capacitesDe(contract);

      expect(contract.runbook.length).toBeGreaterThan(0);

      for (const [capacite, voies] of declarees) {
        const ou = `${contract.key} / ${capacite}`;

        // Then une voie inconditionnelle existe, et elle est la dernière : les voies
        // se lisent du meilleur tier au moins bon, et une voie sans credential placée
        // avant une voie automatique la rendrait inatteignable.
        expect(
          voies.filter((voie) => voie.requires.length === 0),
          ou,
        ).toHaveLength(1);
        expect(voies.at(-1)?.requires, ou).toEqual([]);

        // Then aucun credential ne répond, et pourtant le geste reste praticable et
        // dit comment le faire. Un contrat qui tomberait à « none » ici promettrait
        // un tier qu'il ne peut pas tenir.
        const sansCredential = resolveCapability(
          capacite,
          voies,
          sondes(contract, []),
          contract.runbook,
        );

        expect(sansCredential.tier, ou).not.toBe("none");
        expect(sansCredential.decl, ou).toBeDefined();
        expect(sansCredential.runbook.length, ou).toBeGreaterThan(0);

        // Then le runbook tient jusque sur la voie automatique : un chemin auto qui
        // tombe redevient un chemin manuel, et il redevient manuel en pleine
        // exécution, quand plus personne n'a le temps d'écrire la marche à suivre.
        const avecTout = resolveCapability(
          capacite,
          voies,
          sondes(
            contract,
            contract.credentials.map(({ id }) => id),
          ),
          contract.runbook,
        );

        expect(avecTout.runbook.length, ou).toBeGreaterThan(0);
        expect(avecTout.decl, ou).toBe(voies[0]);
      }
    }
  });

  it("dit au catalogue d'octroi exactement ce que les contrats déclarent", () => {
    const catalogue = catalogueDOctroi();

    // Then le catalogue que la vérification des profils consomme couvre le registre
    // entier : un connecteur qui en sortirait ferait refuser ses profils pour « clé
    // inconnue », c'est-à-dire pour la mauvaise raison.
    expect(catalogue.map(({ key }) => key)).toEqual(
      CONNECTEURS.map(({ contract }) => contract.key),
    );

    for (const systeme of catalogue) {
      const contrat = contratDe(systeme.key);

      expect(systeme.octroiDeclare).toBe(contrat.capabilities.grant !== undefined);
      expect(systeme.scopeSchema).toBe(contrat.scopeSchema);
    }

    // Then les deux déclarent l'octroi aujourd'hui : un profil qui les vise ne se
    // fait plus renvoyer vers un connecteur qui ne saurait pas donner.
    expect(catalogue.map(({ octroiDeclare }) => octroiDeclare)).toEqual([true, true]);
  });
});

describe("un octroi dont la voie automatique n'est pas praticable", () => {
  it("dit ce qui manque, et jamais le tier qu'il ne peut pas tenir", () => {
    // Given le contrat de GitHub, dont l'octroi automatique tient à un jeton
    // d'administration distinct de celui de la collecte
    const github = contratDe("github");
    const voies = github.capabilities.grant;

    if (!voies) {
      throw new Error("github devrait déclarer l'octroi");
    }

    const meilleure = voies[0];
    expect(meilleure.tier).toBe("auto");
    expect(meilleure.requires.length).toBeGreaterThan(0);

    // When le jeton d'administration est sondé et absent
    const degrade = resolveCapability("grant", voies, sondes(github, []), github.runbook);

    // Then le tier rendu est celui qui se tient vraiment, et le tier théorique ne
    // s'affiche que sous ce qui manque pour l'atteindre : un écran qui montrerait
    // « auto » ici laisserait attendre une action que rien ne déclenchera.
    expect(degrade.tier).toBe("manual");
    expect(degrade.tier).not.toBe(meilleure.tier);
    expect(degrade.degradedFrom).toEqual({
      tier: "auto",
      missing: [...meilleure.requires],
    });

    // Then le runbook est celui de l'octroi et non celui du contrat, qui dit comment
    // retirer : dégrader vers une marche à suivre qui fait l'inverse du geste
    // demandé est pire que ne rien afficher.
    expect(degrade.runbook).toBe(voies.at(-1)?.runbook);
    expect(degrade.runbook).not.toBe(github.runbook);
    expect(degrade.runbook).toContain("Inviter");

    // When le jeton d'administration répond
    const complet = resolveCapability(
      "grant",
      voies,
      sondes(github, [...meilleure.requires]),
      github.runbook,
    );

    // Then la voie automatique est reprise, sans rien à signaler
    expect(complet.tier).toBe("auto");
    expect(complet.degradedFrom).toBeUndefined();
    expect(complet.decl?.reversibleForDays).toBe(7);

    // Given le contrat de Notion, dont le jeton sait pourtant créer un membre
    const notion = contratDe("notion");
    const octroiNotion = notion.capabilities.grant;

    // When tous ses credentials répondent
    const avecTout = resolveCapability(
      "grant",
      octroiNotion,
      sondes(
        notion,
        notion.credentials.map(({ id }) => id),
      ),
      notion.runbook,
    );

    // Then l'octroi reste manuel et ne signale aucune dégradation : ce qui n'est pas
    // déclaré n'est pas une voie perdue, et afficher « auto » parce qu'un jeton
    // répond promettrait un tier que rien n'exécute.
    expect(avecTout.tier).toBe("manual");
    expect(avecTout.degradedFrom).toBeUndefined();
    expect(avecTout.runbook.length).toBeGreaterThan(0);
  });
});

describe("l'examen de scope que le registre attache à son connecteur", () => {
  it("refuse une administration sans terme, et le refus vient bien de la politique lue", () => {
    // Given le catalogue tel que le registre l'assemble, sans doublure d'examen ni de
    // configuration
    const catalogue = catalogueDOctroi();
    const github = catalogue.find(({ key }) => key === "github");

    // Then GitHub y arrive avec son examen. Ce rattachement porte tout ce qui suit :
    // sans lui, aucun scope ne serait plus jugé au-delà de sa forme, et la règle du
    // risque élevé s'éteindrait sans qu'une seule ligne ne proteste.
    expect(github?.examinerScope).toBeDefined();

    const profil = (scope: Record<string, unknown>, expiresInDays?: number): readonly Profil[] => [
      {
        key: "administration",
        label: "Administration de l'organisation",
        accesses: [
          {
            system: "github",
            scope,
            ...(expiresInDays === undefined ? {} : { expiresInDays }),
          },
        ],
      },
    ];

    const ADMIN = { organisation: "incubateur-ademe", role: "admin" };
    const MEMBRE = { organisation: "incubateur-ademe", role: "member" };

    // When un profil ouvre une administration d'organisation sans échéance
    const sansTerme = verifierProfils(profil(ADMIN), catalogue);

    // Then il est refusé, et le refus nomme ce que le scope ouvre et le champ à
    // écrire : « scope refusé » enverrait chercher une faute de forme là où la forme
    // est juste.
    expect(sansTerme).toHaveLength(1);
    expect(sansTerme[0]?.systeme).toBe("github");
    expect(sansTerme[0]?.motif).toContain("le rôle admin sur l'organisation incubateur-ademe");
    expect(sansTerme[0]?.motif).toContain("expiresInDays");

    // When la même administration porte une échéance
    // Then elle passe : la règle exige un terme, elle n'interdit pas l'accès
    expect(verifierProfils(profil(ADMIN, 180), catalogue)).toEqual([]);

    // Then un rôle ordinaire n'a jamais rien exigé, avec terme comme sans : ce qui
    // déclenche la règle est le risque que le connecteur attribue au scope, pas
    // l'octroi en général
    expect(verifierProfils(profil(MEMBRE), catalogue)).toEqual([]);

    // When le scope vise une organisation qu'aucune politique ne déclare
    const ailleurs = verifierProfils(
      profil({ organisation: "une-autre-organisation", role: "member" }),
      catalogue,
    );

    // Then il est refusé pour cette raison, ce qu'un schéma statique ne saurait pas
    // dire : la configuration résolue est donc bien arrivée jusqu'à l'examen, par le
    // registre et par lui seul
    expect(ailleurs).toHaveLength(1);
    expect(ailleurs[0]?.motif).toContain("connectors.github.organisations");
    expect(ailleurs[0]?.motif).toContain("incubateur-ademe");
  });
});

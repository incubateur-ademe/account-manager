import { describe, expect, it } from "vitest";

import {
  CONTRAT_SCALINGO,
  examinerScopeScalingo,
  planifierOctroiScalingo,
  type ScopeCollaboration,
} from "@/connectors/scalingo";
import { resolveCapability, type SubjectRef } from "@/core/connector";
import {
  dernierGesteSolde,
  type IntentionDUnGeste,
  intentionDUnGeste,
  type LigneDEngagement,
  profilDUnGeste,
} from "@/core/geste";
import { assemblerOctrois, type SystemeOctroyeur } from "@/core/octroi";
import { empreinteDuPlan } from "@/core/plan";

/**
 * Le vrai contrat de Scalingo, son vrai examen de scope et sa vraie planification : ce qui
 * est vérifié ici est la rencontre d'une intention et d'un connecteur, et une doublure
 * ferait passer le test le jour où Scalingo changerait la forme de son scope.
 */
const SCALINGO: SystemeOctroyeur = {
  key: "scalingo",
  scopeSchema: CONTRAT_SCALINGO.scopeSchema,
  octroiDeclare: true,
  examinerScope: examinerScopeScalingo,
  capacite: resolveCapability(
    "grant",
    CONTRAT_SCALINGO.capabilities.grant,
    [{ id: "scalingo:api", available: true, checkedAt: new Date(0) }],
    CONTRAT_SCALINGO.runbook,
  ),
  planifier: (scope, sujet) => planifierOctroiScalingo(scope as ScopeCollaboration, sujet, true),
};

const MAINTENANT = new Date("2026-09-17T09:00:00Z");

const SUJET: SubjectRef = {
  kind: "person",
  username: "nour.exemple",
  email: "nour.exemple@exemple.invalid",
};

const INTENTION: IntentionDUnGeste = {
  systeme: "scalingo",
  scope: {
    nature: "collaboration",
    region: "osc-fr1",
    application: "portail-exemple",
    role: "limited",
  },
  expiresInDays: 30,
  justification: "renfort d'astreinte sur le portail pendant les congés",
};

const empreinteDe = (intention: IntentionDUnGeste): string =>
  empreinteDuPlan(
    assemblerOctrois(profilDUnGeste(intention), [SCALINGO], SUJET, MAINTENANT).etapes,
  );

describe("une intention gelée se rejoue à l'identique, et sa justification n'engage rien", () => {
  it("hache le périmètre demandé, et rien de ce qui l'explique", () => {
    // Given une intention qui porte un système, un scope complet, un terme et une
    // justification, relue par son propre schéma plutôt que crue sur parole : la colonne
    // est un Json, donc `unknown` côté client généré.
    const lue = intentionDUnGeste.parse(INTENTION);
    expect(lue).toEqual(INTENTION);

    // When on l'assemble deux fois contre le connecteur octroyeur,
    const premier = assemblerOctrois(profilDUnGeste(lue), [SCALINGO], SUJET, MAINTENANT);
    const second = assemblerOctrois(profilDUnGeste(lue), [SCALINGO], SUJET, MAINTENANT);

    // Then rien n'est refusé, une seule étape sort, et son terme vient de l'intention :
    // c'est `assemblerOctrois` qui le pose, et c'est la raison de passer par lui plutôt
    // que de fabriquer un second chemin d'octroi.
    expect(premier.refus).toEqual([]);
    expect(premier.etapes).toHaveLength(1);
    expect(premier.etapes[0]?.grantExpiresAt).toEqual(
      new Date(MAINTENANT.getTime() + 30 * 24 * 60 * 60_000),
    );

    // Then l'unique étape porte le scope de l'intention dans ses paramètres, et les deux
    // empreintes sont égales : un geste recalculé rend ce qui a été confirmé.
    expect(premier.etapes[0]?.params).toMatchObject({
      region: "osc-fr1",
      application: "portail-exemple",
      role: "limited",
    });
    expect(empreinteDuPlan(premier.etapes)).toBe(empreinteDuPlan(second.etapes));

    // When on change un seul caractère du nom d'application dans le scope,
    const ailleurs = empreinteDe({
      ...INTENTION,
      scope: { ...(INTENTION.scope as object), application: "portail-exemplo" },
    });

    // Then l'empreinte change : ce que le geste ouvre est dans ce qu'on approuve.
    expect(ailleurs).not.toBe(empreinteDuPlan(premier.etapes));

    // When on ne change que la justification,
    const reformulee = empreinteDe({
      ...INTENTION,
      justification: "renfort d'astreinte, demandé par l'équipe du portail",
    });

    // Then l'empreinte ne bouge pas, et la justification n'apparaît dans aucun paramètre
    // de l'étape : elle se pose à l'enregistrement, depuis l'ancrage. L'y faire entrer
    // déclarerait obsolète un geste confirmé parce que quelqu'un a reformulé une phrase.
    expect(reformulee).toBe(empreinteDuPlan(premier.etapes));
    expect(JSON.stringify(premier.etapes[0]?.params)).not.toContain("astreinte");
    expect(premier.etapes[0]).not.toHaveProperty("justification");
  });
});

/**
 * Les lignes telles que la requête les rend, de la plus récente à la plus ancienne, et à
 * date égale l'octroi avant la coupure.
 */
const ligne = (over: Partial<LigneDEngagement>): LigneDEngagement => ({
  engagementKey: "scalingo:jeton:1",
  capability: "grant",
  systemKey: "scalingo",
  label: "Émettre un jeton restreint",
  params: { usage: "inventaire-d-une-region" },
  grantExpiresAt: null,
  executedAt: new Date("2026-09-01T09:00:00Z"),
  ...over,
});

describe("le dernier geste soldé gagne", () => {
  it("garde ouvert ce qui a été rouvert, et laisse tomber ce dont le terme est passé", () => {
    // Given trois clés : la première ouverte, fermée, puis rouverte ; la deuxième ouverte
    // puis fermée ; la troisième ouverte avec un terme déjà passé. Plus une ligne en
    // attente de validation sur la première clé, datée après toutes les autres, que la
    // requête n'aurait pas rendue.
    const lignes: readonly LigneDEngagement[] = [
      ligne({ capability: "grant", executedAt: new Date("2026-09-10T09:00:00Z") }),
      ligne({ capability: "revoke", executedAt: new Date("2026-09-05T09:00:00Z") }),
      ligne({ capability: "grant", executedAt: new Date("2026-09-01T09:00:00Z") }),
      ligne({
        engagementKey: "scalingo:jeton:2",
        capability: "revoke",
        executedAt: new Date("2026-09-08T09:00:00Z"),
      }),
      ligne({
        engagementKey: "scalingo:jeton:2",
        capability: "grant",
        executedAt: new Date("2026-09-02T09:00:00Z"),
      }),
      ligne({
        engagementKey: "scalingo:jeton:3",
        capability: "grant",
        executedAt: new Date("2026-09-03T09:00:00Z"),
        grantExpiresAt: new Date("2026-09-15T09:00:00Z"),
      }),
    ];

    // When on plie à un instant donné,
    const ouverts = dernierGesteSolde(lignes, MAINTENANT);

    // Then seule la première clé ressort : un accès ouvert, repris, puis rouvert est
    // ouvert, et une différence d'ensembles le dirait fermé.
    expect(ouverts.map(({ key }) => key)).toEqual(["scalingo:jeton:1"]);
    expect(ouverts[0]).toMatchObject({
      systemKey: "scalingo",
      label: "Émettre un jeton restreint",
      openedAt: new Date("2026-09-10T09:00:00Z"),
    });
    expect(ouverts[0]?.params).toEqual({ usage: "inventaire-d-une-region" });

    // Then l'ordre reçu décide, et rien d'autre : le pli lit la première ligne de chaque
    // clé et tient les suivantes pour son passé. Les mêmes lignes de la plus ancienne à la
    // plus récente rendent l'inverse, ce qui dit où vit la garantie, dans le `desc` de la
    // requête, et ce qu'un tri retourné coûterait.
    expect(dernierGesteSolde([...lignes].reverse(), MAINTENANT).map(({ key }) => key)).toEqual([
      "scalingo:jeton:2",
      "scalingo:jeton:1",
    ]);

    // Then à égalité exacte de date, l'octroi l'emporte sur la coupure, et c'est l'ordre
    // secondaire de la requête qui le pose : conclure « fermé » ferait disparaître un
    // accès sans bruit, là où conclure « ouvert » fait une ligne de trop qui se voit.
    const memeInstant = dernierGesteSolde(
      [
        ligne({ capability: "grant", executedAt: new Date("2026-09-10T09:00:00Z") }),
        ligne({ capability: "revoke", executedAt: new Date("2026-09-10T09:00:00Z") }),
      ],
      MAINTENANT,
    );
    expect(memeInstant.map(({ key }) => key)).toEqual(["scalingo:jeton:1"]);

    // Then une étape jamais exécutée ne dit rien de l'état d'une clé, et le pli en répond
    // lui-même : la laisser prendre la place de sa clé ferait disparaître celle-ci du
    // résultat, c'est-à-dire déclarer fermé un accès qu'une étape antérieure a ouvert. La
    // clé ressort donc ouverte, à la date de la seule ligne qui dise quelque chose, et non
    // parce que le tri de la requête range ces lignes en dernier.
    const avecUneEtapeJamaisTentee = dernierGesteSolde(
      [ligne({ executedAt: null }), ligne({ executedAt: new Date("2026-09-10T09:00:00Z") })],
      MAINTENANT,
    );
    expect(avecUneEtapeJamaisTentee.map(({ key }) => key)).toEqual(["scalingo:jeton:1"]);
    expect(avecUneEtapeJamaisTentee[0]?.openedAt).toEqual(new Date("2026-09-10T09:00:00Z"));

    // Then seule, elle n'ouvre rien non plus : un engagement naît d'un geste fait, pas
    // d'un geste prévu.
    expect(dernierGesteSolde([ligne({ executedAt: null })], MAINTENANT)).toEqual([]);

    // Then le terme passé de la troisième clé la fait sortir : un jeton dont le terme est
    // échu est repris, puisque c'est la seule reprise qui existe.
    const avantLEcheance = dernierGesteSolde(lignes, new Date("2026-09-14T09:00:00Z"));
    expect(avantLEcheance.map(({ key }) => key)).toEqual(["scalingo:jeton:1", "scalingo:jeton:3"]);
  });
});

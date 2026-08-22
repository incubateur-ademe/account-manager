import { describe, expect, it } from "vitest";

import {
  type CredentialProbe,
  type Intent,
  type RunContext,
  resolveCapability,
} from "@/core/connector";
import { CONTRAT_NOTION, collecter, type LecteurScim, notion } from "./notion";
import fixture from "./notion-scim.fixture.json";

const PAGES = fixture.pages;

/**
 * Un lecteur factice qui retient ce qu'on lui a demandé : c'est ce qui rend observable
 * qu'une seconde page a bien été réclamée, et avec le bon `startIndex`. La sentinelle
 * « echec » simule une requête qui n'aboutit pas.
 */
function lecteur(reponses: readonly unknown[]): {
  lire: LecteurScim;
  appels: { startIndex: number; count: number }[];
} {
  const appels: { startIndex: number; count: number }[] = [];
  let rang = 0;

  const lire: LecteurScim = (startIndex, count) => {
    appels.push({ startIndex, count });
    const reponse = reponses[rang];
    rang += 1;

    if (reponse === undefined || reponse === "echec") {
      return Promise.reject(new Error("503 Service Unavailable"));
    }
    return Promise.resolve(reponse);
  };

  return { lire, appels };
}

function copie<T>(valeur: T): T {
  return structuredClone(valeur);
}

const CONTEXTE: RunContext = {
  runId: "collecte-de-test",
  now: new Date("2026-08-22T00:00:00Z"),
  dryRun: true,
  audit: () => undefined,
};

const sonde = (available: boolean): CredentialProbe => ({
  id: "notion:scim",
  available,
  checkedAt: new Date("2026-08-22T00:00:00Z"),
});

describe("ce que le connecteur Notion remonte du workspace", () => {
  it("rend chaque siège avec son rôle, en réclamant la seconde page", async () => {
    const { lire, appels } = lecteur(PAGES);

    const collecte = await collecter(lire);

    expect(collecte.status).toBe("ok");
    expect(collecte.errors).toBeUndefined();
    expect(collecte.status !== "failed" && collecte.itemsSeen).toBe(6);

    // Deux appels, et le second reprend là où le premier s'est arrêté : c'est la
    // seule preuve que la règle d'arrêt lit le total plutôt que la taille de page.
    expect(appels).toEqual([
      { startIndex: 1, count: 100 },
      { startIndex: 5, count: 100 },
    ]);

    const identites = collecte.status !== "failed" ? collecte.identities : [];
    const camille = identites.find((identite) => identite.handle.startsWith("camille"));
    expect(camille?.idKind).toBe("opaque");
    expect(camille?.externalId).toBe("922f3d9b-20be-461f-9b69-90928701ce93");
    expect(camille?.emails).toEqual(["camille.rivet@exemple.org", "c.rivet@autre-exemple.org"]);

    const acces = collecte.status !== "failed" ? collecte.grants : [];
    const roles = Object.fromEntries(acces.map((droit) => [droit.identityExternalId, droit.role]));
    expect(roles["a15919aa-5727-4fb9-84e9-2980007cfc58"]).toBe("owner");
    expect(roles["e04d8f16-7a25-4b93-8c51-df6290ab3e77"]).toBe("restricted_member");

    // Une extension absente ne vaut pas un rôle absent : le socle ne saurait quoi
    // faire d'un accès sans rôle, et le membre ordinaire est le cas de loin le plus
    // fréquent.
    expect(roles["7ec7b7c3-126b-412a-babf-fd79d002e921"]).toBe("member");

    // Un membre inactif reste un compte observé : chez Notion cet état est un
    // retrait, et le filtrer ferait dater comme disparu quelqu'un que Notion connaît.
    // Mais il ne porte plus d'accès, sinon l'outil affirmerait un droit que le
    // fournisseur dit éteint.
    const samir = identites.find((identite) => identite.handle.startsWith("samir"));
    expect(samir).toBeDefined();
    expect(samir?.details).toEqual([{ label: "État du compte", value: "retiré du workspace" }]);
    expect(acces.some((droit) => droit.identityExternalId === samir?.externalId)).toBe(false);
    expect(acces).toHaveLength(5);

    // Aucun accès ne nomme de ressource : un membre l'est du système entier.
    expect(acces.every((droit) => droit.resourceExternalId === undefined)).toBe(true);
    expect(collecte.status !== "failed" && collecte.resources).toEqual([]);
  });

  it("laisse passer un rôle qu'il ne connaît pas, plutôt que d'écarter la fiche", async () => {
    const page = copie(PAGES[0]) as { totalResults: number; Resources: Record<string, unknown>[] };
    page.totalResults = 4;
    page.Resources[0] = {
      ...page.Resources[0],
      "urn:ietf:params:scim:schemas:extension:notion:2.0:User": { role: "role-invente-par-notion" },
    };

    const collecte = await collecter(lecteur([page]).lire);

    // Notion a ajouté `restricted_member` sans prévenir. Une énumération fermée
    // ferait écarter la fiche, donc dater comme disparu quelqu'un dont le seul tort
    // serait d'avoir un rôle neuf.
    expect(collecte.status).toBe("ok");
    expect(collecte.status !== "failed" && collecte.itemsSeen).toBe(4);
    expect(
      collecte.status !== "failed" &&
        collecte.grants.find(
          (droit) => droit.identityExternalId === "922f3d9b-20be-461f-9b69-90928701ce93",
        )?.role,
    ).toBe("role-invente-par-notion");
  });

  it("ne conclut jamais sur une pagination interrompue", async () => {
    const partielle = await collecter(lecteur([PAGES[0], "echec"]).lire);

    expect(partielle.status).toBe("partial");
    expect(partielle.status !== "failed" && partielle.identities).toHaveLength(4);

    // L'écart avec le total annoncé remonte, sans quoi quatre sièges sur six
    // passeraient pour l'inventaire entier et les deux autres pour des partis.
    const dits = partielle.errors?.map((erreur) => erreur.message).join(" ") ?? "";
    expect(dits).toContain("4 entrées reçues pour 6 annoncées");
    expect(partielle.errors?.some((erreur) => erreur.itemRef === "startIndex=5")).toBe(true);

    const rien = await collecter(lecteur(["echec"]).lire);

    expect(rien.status).toBe("failed");
    expect(rien).not.toHaveProperty("identities");
    expect(rien.errors).toHaveLength(1);
  });

  it("écarte un membre illisible tout seul, et fait remonter l'écart", async () => {
    const page = copie(PAGES[0]) as { totalResults: number; Resources: Record<string, unknown>[] };
    page.totalResults = 4;
    delete page.Resources[0]?.["id"];
    page.Resources[1] = { ...page.Resources[1], userName: "" };

    const abimee = await collecter(lecteur([page]).lire);

    expect(abimee.status).toBe("partial");
    expect(abimee.status !== "failed" && abimee.identities).toHaveLength(2);

    // `itemsSeen` compte ce qui a été rendu, jamais ce qui a été reçu : les quatre
    // entrées reçues correspondent bien au total annoncé, donc rien n'est tronqué,
    // et pourtant deux fiches manquent. Confondre les deux compteurs ferait passer
    // cette page pour complète.
    expect(abimee.status !== "failed" && abimee.itemsSeen).toBe(2);
    expect(abimee.errors?.map((erreur) => erreur.message).join(" ")).not.toContain("tronqué");

    expect(abimee.errors).toHaveLength(2);
    expect(abimee.errors?.every((erreur) => erreur.scope === "membre")).toBe(true);
    // Le rang de l'entrée fautive vit dans le message, que `lireChaque` compose :
    // le redire dans `itemRef` ferait pointer le rang de l'erreur, pas celui de
    // l'entrée, et les deux ne coïncident que sur le premier écart.
    expect(abimee.errors?.[0]?.itemRef).toBe("page à partir de 1");
    expect(abimee.errors?.map((erreur) => erreur.message).join(" ")).toContain("élément 1");

    // C'est le scénario qui protège du pire silence possible : un champ renommé chez
    // Notion ferait passer tout le monde pour absent.
    const toutesIllisibles = copie(page);
    toutesIllisibles.Resources = toutesIllisibles.Resources.map((entree) => ({
      ...entree,
      id: undefined,
    }));
    const vide = await collecter(lecteur([toutesIllisibles]).lire);

    expect(vide.status).toBe("partial");
    expect(vide.status !== "failed" && vide.itemsSeen).toBe(0);
  });

  it("refuse de conclure quand une fiche est rendue deux fois", async () => {
    // Le serveur ne trie pas : une fiche qui glisse d'une page à l'autre entre deux
    // requêtes est vue deux fois pendant qu'une autre n'est jamais vue. Les deux
    // s'annulent dans le compte d'entrées reçues, si bien que le total tombe juste
    // sur un inventaire incomplet. Sans la détection du doublon, la collecte rendrait
    // ok et le socle daterait comme disparue une personne toujours membre.
    const premiere = copie(PAGES[0]) as { Resources: Record<string, unknown>[] };
    const seconde = copie(PAGES[1]) as { Resources: Record<string, unknown>[] };
    seconde.Resources = [...premiere.Resources.slice(0, 1), ...seconde.Resources.slice(0, 1)];

    const desordre = await collecter(lecteur([premiere, seconde]).lire);

    expect(desordre.status).toBe("partial");
    expect(desordre.errors?.map((erreur) => erreur.message).join(" ")).toContain(
      "rendue deux fois",
    );

    // Le total annoncé tombe pourtant juste : c'est précisément ce qui rendrait le
    // désordre invisible si l'on ne comptait que les entrées reçues.
    expect(desordre.errors?.map((erreur) => erreur.message).join(" ")).not.toContain("tronqué");

    // La fiche vue deux fois n'est comptée qu'une, et ne porte qu'un seul accès.
    expect(desordre.status !== "failed" && desordre.itemsSeen).toBe(5);
    const doublons =
      desordre.status !== "failed" &&
      desordre.grants.filter(
        (droit) => droit.identityExternalId === "922f3d9b-20be-461f-9b69-90928701ce93",
      );
    expect(doublons).toHaveLength(1);
  });

  it("s'annonce non lu plutôt qu'en échec quand le jeton manque", () => {
    const resolue = resolveCapability(
      "list",
      CONTRAT_NOTION.capabilities.list,
      [sonde(false)],
      CONTRAT_NOTION.runbook,
    );

    // C'est exactement la condition qui fait écrire un run SKIPPED plutôt que FAILED :
    // un système non lu n'est pas une panne.
    expect(resolue.tier).toBe("none");
    expect(resolue.degradedFrom).toEqual({ tier: "auto", missing: ["notion:scim"] });

    expect(
      resolveCapability(
        "list",
        CONTRAT_NOTION.capabilities.list,
        [sonde(true)],
        CONTRAT_NOTION.runbook,
      ).tier,
    ).toBe("auto");

    // Le retrait reste praticable sans le moindre credential, à la main.
    const retrait = resolveCapability(
      "revoke",
      CONTRAT_NOTION.capabilities.revoke,
      [sonde(false)],
      CONTRAT_NOTION.runbook,
    );
    expect(retrait.tier).toBe("manual");
    expect(retrait.runbook).toContain("les invités n'y figurent pas");
  });

  it("produit une tâche pointable au départ, jamais une action silencieuse", async () => {
    const revocation: Intent = {
      kind: "revoke",
      subject: { kind: "person", username: "camille.rivet" },
    };

    const etapes = await notion.plan(revocation, CONTEXTE);

    expect(etapes).toHaveLength(1);
    const etape = etapes[0];
    expect(etape?.tier).toBe("manual");
    expect(etape?.riskLevel).toBe("high");
    expect(etape?.idempotencyKey).toBe("notion:revoke:camille.rivet");
    expect(etape?.manual?.deeplink).toBe("https://www.notion.so/settings/members");
    expect(etape?.manual?.doneWhen).not.toBe("");

    // Le runbook dit ce que la coupure ne couvre pas, faute de quoi un opérateur
    // croirait avoir tout retiré.
    expect(etape?.manual?.runbook).toContain("propriétaire qui a créé le jeton SCIM");

    // Aucun moteur n'exécute quoi que ce soit : le connecteur ne porte pas `execute`.
    expect(notion.execute).toBeUndefined();

    expect(await notion.plan({ ...revocation, kind: "grant" }, CONTEXTE)).toHaveLength(0);
    expect(
      await notion.plan({ kind: "revoke", subject: { kind: "service", key: "robot" } }, CONTEXTE),
    ).toHaveLength(0);
  });
});

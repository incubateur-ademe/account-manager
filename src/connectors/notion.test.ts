import { describe, expect, it } from "vitest";

import {
  type CredentialProbe,
  type Intent,
  type RunContext,
  resolveCapability,
} from "@/core/connector";
import {
  CONTRAT_NOTION,
  collecter,
  constaterRetrait,
  diagnostiquer,
  executerRetrait,
  type LecteurScim,
  notion,
  planifierRetraitNotion,
  type ReponseScim,
} from "./notion";
import fixture from "./notion-scim.fixture.json";

const PAGES = fixture.pages;

const EXTENSION = "urn:ietf:params:scim:schemas:extension:notion:2.0:User";

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

  it("refuse de conclure quand le total annoncé bouge en cours de pagination", async () => {
    // Le parc grossit entre les deux requêtes. Les identifiants restent distincts, donc
    // la détection de doublon ne dit rien, et le compte d'entrées reçues tombe juste
    // face au total de la première page. Sans ce contrôle, la collecte conclurait `ok`
    // sur un inventaire amputé de ce qui vient d'arriver.
    const premiere = copie(PAGES[0]) as { totalResults: number };
    const seconde = copie(PAGES[1]) as { totalResults: number };
    seconde.totalResults = 10;

    const mouvante = await collecter(lecteur([premiere, seconde]).lire);

    expect(mouvante.status).toBe("partial");
    expect(mouvante.errors?.map((erreur) => erreur.message).join(" ")).toContain(
      "le total annoncé est passé de 6 à 10",
    );

    // Les six fiches lues restent rendues : ce qui manque n'autorise pas à jeter ce
    // qu'on a vu, seulement à refuser de conclure.
    expect(mouvante.status !== "failed" && mouvante.itemsSeen).toBe(6);
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

  it("refuse de collecter quand un champ facultatif a disparu de toutes les fiches", async () => {
    // La collecte ne voit que ce qui la casse. Un champ requis absent fait écarter la
    // fiche et rend le run non `ok` ; un champ facultatif absent ne casse rien et
    // dérive en silence, en laissant pour seul signe des rattachements qui cessent
    // lentement de se faire. C'est ce trou que le diagnostic ferme.
    const sansAdresse = copie(PAGES[0]) as {
      totalResults: number;
      Resources: Record<string, unknown>[];
    };
    sansAdresse.totalResults = 4;
    sansAdresse.Resources = sansAdresse.Resources.map((entree, rang) => ({
      ...entree,
      userName: `compte-${rang}`,
      emails: [],
    }));

    const perdue = await diagnostiquer(lecteur([sansAdresse]).lire);
    expect(perdue.findings).toHaveLength(1);
    expect(perdue.findings[0]?.message).toContain("une adresse exploitable");

    // Une extension renommée est indistinguable d'une extension absente : sans ce
    // diagnostic, tout le monde deviendrait « membre » sur une collecte verte.
    const sansRole = copie(PAGES[0]) as {
      totalResults: number;
      Resources: Record<string, unknown>[];
    };
    sansRole.totalResults = 4;
    sansRole.Resources = sansRole.Resources.map((entree) => {
      const { [EXTENSION]: _partie, ...reste } = entree;
      return reste;
    });

    const muette = await diagnostiquer(lecteur([sansRole]).lire);
    expect(muette.findings).toHaveLength(1);
    expect(muette.findings[0]?.message).toContain("rôle d'espace");

    // Une seule fiche qui porte le champ suffit : un compte incomplet est le travail
    // de la collecte, pas celui du diagnostic.
    const uneSeule = copie(sansRole) as { Resources: Record<string, unknown>[] };
    uneSeule.Resources[0] = { ...uneSeule.Resources[0], [EXTENSION]: { role: "member" } };
    expect((await diagnostiquer(lecteur([uneSeule]).lire)).findings).toEqual([]);

    // Et une réponse conforme ne dit rien, en une seule requête : paginer tout le
    // workspace pour chercher une disparition de champ doublerait le coût de chaque
    // collecte sans rien apprendre de plus.
    const conforme = lecteur(PAGES);
    expect((await diagnostiquer(conforme.lire)).findings).toEqual([]);
    expect(conforme.appels).toEqual([{ startIndex: 1, count: 100 }]);

    // Un système muet ne se diagnostique pas : ne pas savoir dire si la forme a changé
    // n'autorise pas à supposer qu'elle n'a pas changé.
    expect((await diagnostiquer(lecteur(["echec"]).lire)).findings).toHaveLength(1);
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

  it("produit une tâche pointable au départ quand aucun compte n'est relevé", async () => {
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

    expect(await notion.plan({ ...revocation, kind: "grant" }, CONTEXTE)).toHaveLength(0);
    expect(
      await notion.plan({ kind: "revoke", subject: { kind: "service", key: "robot" } }, CONTEXTE),
    ).toHaveLength(0);
  });
});

/** Un siège relevé, tel que le socle le transmet au départ. */
function siege(
  role = "member",
  identityExternalId = "scim-1",
  identityHandle = "camille@exemple.fr",
) {
  return { identityExternalId, identityHandle, role };
}

const EXECUTION: RunContext = { ...CONTEXTE, dryRun: false };

function retraitDUnMembre() {
  const [etape] = planifierRetraitNotion(
    { kind: "person", username: "camille.rivet", acces: [siege()] },
    true,
  );
  if (!etape) {
    throw new Error("le retrait n'a produit aucune étape");
  }
  return etape;
}

const reponse = (statut: number, corps?: unknown) => () =>
  Promise.resolve<ReponseScim>({ statut, corps });

describe("le départ sur Notion", () => {
  it("retire seul un membre ordinaire, et laisse à la main un propriétaire et plusieurs comptes", () => {
    // Given un membre ordinaire, avec le jeton SCIM
    const membre = retraitDUnMembre();

    // Then l'étape part seule, nomme le compte visé, et garde sa clé
    expect(membre.tier).toBe("auto");
    expect(membre.manual).toBeUndefined();
    expect(membre.label).toBe(
      "Retirer camille.rivet (compte camille@exemple.fr) du workspace Notion",
    );
    expect(membre.idempotencyKey).toBe("notion:revoke:camille.rivet");
    expect(membre.params).toMatchObject({ identifiant: "scim-1", role: "member" });

    // Then un membre restreint part seul aussi
    expect(
      planifierRetraitNotion(
        { kind: "person", username: "camille.rivet", acces: [siege("restricted_member")] },
        true,
      )[0]?.tier,
    ).toBe("auto");

    // Then un propriétaire, deux comptes, ou un jeton absent restent à la main, chacun avec
    // sa raison
    const proprietaire = planifierRetraitNotion(
      { kind: "person", username: "camille.rivet", acces: [siege("owner")] },
      true,
    )[0];
    expect(proprietaire?.tier).toBe("manual");
    expect(proprietaire?.manual?.runbook).toContain("Le rôle owner se retire à la main");
    expect(proprietaire?.manual?.doneWhen).toBe(
      "camille@exemple.fr n'apparaît plus dans la liste des membres du workspace.",
    );
    const deuxComptes = planifierRetraitNotion(
      {
        kind: "person",
        username: "camille.rivet",
        acces: [siege(), siege("member", "scim-2", "camille.perso@exemple.fr")],
      },
      true,
    )[0];
    expect(deuxComptes?.tier).toBe("manual");
    expect(deuxComptes?.manual?.runbook).toContain("Plusieurs comptes de la personne siègent");
    expect(deuxComptes?.label).toContain("camille@exemple.fr, camille.perso@exemple.fr");
    const sansJeton = planifierRetraitNotion(
      { kind: "person", username: "camille.rivet", acces: [siege()] },
      false,
    )[0];
    expect(sansJeton?.tier).toBe("manual");
    expect(sansJeton?.manual?.runbook).toContain("il manque : notion:scim");

    // Then le contrat déclare la voie automatique du retrait, et sa voie manuelle dessous
    expect(CONTRAT_NOTION.capabilities.revoke?.map(({ tier }) => tier)).toEqual(["auto", "manual"]);
    expect(
      resolveCapability(
        "revoke",
        CONTRAT_NOTION.capabilities.revoke,
        [sonde(true)],
        CONTRAT_NOTION.runbook,
      ).tier,
    ).toBe("auto");
  });

  it("relit le membre avant de conclure, et refuse un membre promu entre-temps", async () => {
    const etape = retraitDUnMembre();
    const membre = (role: string, active = true) => ({
      id: "scim-1",
      userName: "camille@exemple.fr",
      active,
      [EXTENSION]: { role },
    });

    expect(await constaterRetrait(reponse(200, membre("member")), etape)).toEqual({
      state: "READY",
    });
    // Chez Notion, `active: false` est le retrait lui-même
    expect(await constaterRetrait(reponse(200, membre("member", false)), etape)).toEqual({
      state: "ALREADY_ABSENT",
    });
    expect(await constaterRetrait(reponse(404), etape)).toEqual({ state: "ALREADY_ABSENT" });
    expect(await constaterRetrait(reponse(200, membre("owner")), etape)).toMatchObject({
      state: "STALE",
      actual: { role: "owner" },
    });
    await expect(constaterRetrait(reponse(502), etape)).rejects.toThrow("502");
  });

  it("ne part jamais en simulation, et dit ce que Notion a répondu quand elle part", async () => {
    const etape = retraitDUnMembre();
    const appels: string[] = [];
    const supprimer = (statut: number) => (identifiant: string) => {
      appels.push(identifiant);
      return Promise.resolve<ReponseScim>({ statut, corps: undefined });
    };

    await expect(executerRetrait(supprimer(204), true, etape, CONTEXTE)).rejects.toThrow(
      "ACTIONS_ENABLED",
    );
    expect(appels).toEqual([]);
    expect(await executerRetrait(supprimer(204), false, etape, EXECUTION)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });
    const proprietaire = { ...etape, params: { ...etape.params, role: "owner" } };
    expect(await executerRetrait(supprimer(204), true, proprietaire, EXECUTION)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });
    expect(appels).toEqual([]);

    expect(await executerRetrait(supprimer(204), true, etape, EXECUTION)).toMatchObject({
      state: "SUCCEEDED",
    });
    expect(appels).toEqual(["scim-1"]);
    expect(await executerRetrait(supprimer(404), true, etape, EXECUTION)).toEqual({
      state: "ALREADY_ABSENT",
    });
    expect(await executerRetrait(supprimer(403), true, etape, EXECUTION)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });
    expect(
      await executerRetrait(() => Promise.reject(new Error("coupure")), true, etape, EXECUTION),
    ).toMatchObject({ state: "FAILED", retryable: true });
  });
});

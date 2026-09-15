import { describe, expect, it } from "vitest";

import type { Intent, RunContext } from "@/core/connector";
import {
  CONTRAT_SCALINGO,
  collecter,
  constaterCollaborateur,
  type EcritureScalingo,
  executerScalingo,
  interpreterOctroi,
  interpreterRetrait,
  type LecteurScalingo,
  type Pause,
  planifierOctroiScalingo,
  type ReponseScalingo,
  scalingo,
} from "./scalingo";

const AUTH = "https://auth.scalingo.com";
const FR = "https://api.osc-fr1.scalingo.com";
const SECNUM = "https://api.osc-secnum-fr1.scalingo.com";

/** L'espacement existe pour le vrai plafond de requêtes, pas pour faire attendre une suite. */
const SANS_PAUSE: Pause = () => Promise.resolve();

/**
 * Un lecteur factice indexé par adresse, qui retient ce qu'on lui a demandé : c'est ce
 * qui rend observable qu'une application fille n'a jamais été interrogée, et que les deux
 * régions l'ont été. La sentinelle « echec » simule une requête qui n'aboutit pas.
 */
function lecteur(reponses: Readonly<Record<string, unknown>>): {
  lire: LecteurScalingo;
  appels: string[];
} {
  const appels: string[] = [];

  const lire: LecteurScalingo = (url) => {
    appels.push(url);
    const reponse = reponses[url];

    if (reponse === undefined || reponse === "echec") {
      return Promise.reject(new Error("503 Service Unavailable"));
    }
    return Promise.resolve(reponse);
  };

  return { lire, appels };
}

const REGIONS = {
  regions: [
    { name: "osc-fr1", api: FR },
    { name: "osc-secnum-fr1", api: SECNUM },
  ],
};

const PILOTE = { id: "us-pilote", email: "pilote@exemple.invalid", username: "pilote" };
const INTENDANCE = {
  id: "us-intendance",
  email: "intendance@exemple.invalid",
  username: "intendance",
};

/** La chaîne vide et non l'absence : c'est ce que l'API rend sur une application sans parent. */
const ANNUAIRE = {
  id: "app-annuaire",
  name: "service-annuaire",
  owner: PILOTE,
  parent_app_name: "",
};
const REVUE = {
  id: "app-revue",
  name: "service-annuaire-pr42",
  owner: PILOTE,
  parent_app_name: "service-annuaire",
};
const PAIE = { id: "app-paie", name: "service-paie", owner: INTENDANCE, parent_app_name: "" };

const TITULAIRE = {
  id: "collab-titulaire",
  email: "titulaire@exemple.invalid",
  status: "accepted",
  is_limited: false,
  app_id: "app-annuaire",
  user_id: "us-titulaire",
};

/** Ni compte, ni nom d'utilisateur : Scalingo y écrit la chaîne littérale « n/a ». */
const CONVIEE = {
  id: "collab-conviee",
  email: "conviee@exemple.invalid",
  username: "n/a",
  status: "pending",
  is_limited: true,
  app_id: "app-annuaire",
  user_id: null,
};

/** La même personne que sur l'autre région, et sous un rôle plus étroit. */
const TITULAIRE_AILLEURS = {
  id: "collab-titulaire-secnum",
  email: "titulaire@exemple.invalid",
  status: "accepted",
  is_limited: true,
  app_id: "app-paie",
  user_id: "us-titulaire",
};

function parcComplet(): Record<string, unknown> {
  return {
    [`${AUTH}/v1/regions`]: REGIONS,
    [`${FR}/v1/apps`]: { apps: [ANNUAIRE, REVUE] },
    [`${FR}/v1/apps/service-annuaire/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${FR}/v1/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${SECNUM}/v1/apps`]: { apps: [PAIE] },
    [`${SECNUM}/v1/apps/service-paie/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
    [`${SECNUM}/v1/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
  };
}

const CONTEXTE: RunContext = {
  runId: "collecte-de-test",
  now: new Date("2026-09-15T00:00:00Z"),
  dryRun: true,
  audit: () => undefined,
};

describe("ce que le connecteur Scalingo remonte du parc", () => {
  it("lit les deux régions, écarte les environnements de revue, et n'oublie aucun propriétaire", async () => {
    // Given un parc réparti sur deux régions, dont une application fille et une personne
    // présente des deux côtés sous deux rôles différents
    const { lire, appels } = lecteur(parcComplet());

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then rien n'a été avalé : un run qui se dit complet doit l'être
    expect(collecte.status).toBe("ok");
    if (collecte.status === "failed") {
      throw new Error("la collecte devait aboutir");
    }

    // Then les deux régions ont bien été interrogées, et l'environnement de revue n'a
    // jamais été lu : l'écarter après coup coûterait une requête pour rien, et le
    // compterait dans le plafond de soixante par minute
    expect(appels.some((url) => url.includes("service-annuaire-pr42"))).toBe(false);

    // Then une ressource par application retenue, la fille exclue, et chacune porte sa
    // région : deux régions peuvent servir le même nom
    expect(collecte.resources.map((ressource) => ressource.label)).toEqual([
      "service-annuaire (osc-fr1)",
      "service-paie (osc-secnum-fr1)",
    ]);
    expect(collecte.resources[1]?.url).toBe(
      "https://dashboard.scalingo.com/apps/osc-secnum-fr1/service-paie/settings/collaborators",
    );

    // Then la personne vue sur les deux régions ne compte qu'une fois, et les deux
    // propriétaires sont là : ils ne figurent dans aucune liste de collaborateurs
    expect(collecte.identities.map((identite) => identite.externalId).sort()).toEqual([
      "collab-conviee",
      "us-intendance",
      "us-pilote",
      "us-titulaire",
    ]);
    expect(collecte.itemsSeen).toBe(4);

    // Then l'invitation en attente est un accès et non une absence, son identité porte
    // l'adresse et jamais le « n/a » que Scalingo écrit à la place du nom d'utilisateur
    const conviee = collecte.identities.find(({ externalId }) => externalId === "collab-conviee");
    expect(conviee?.handle).toBe("conviee@exemple.invalid");
    expect(conviee?.emails).toEqual(["conviee@exemple.invalid"]);
    expect(conviee?.details).toEqual([
      { label: "État de l'accès", value: "invitation en attente" },
    ]);

    // Then chaque application produit l'accès de son propriétaire, et le rôle suit le
    // seul booléen que l'API expose, région par région
    expect(collecte.grants).toEqual([
      { identityExternalId: "us-pilote", resourceExternalId: "app-annuaire", role: "owner" },
      {
        identityExternalId: "us-titulaire",
        resourceExternalId: "app-annuaire",
        role: "collaborator",
      },
      { identityExternalId: "collab-conviee", resourceExternalId: "app-annuaire", role: "limited" },
      { identityExternalId: "us-intendance", resourceExternalId: "app-paie", role: "owner" },
      { identityExternalId: "us-titulaire", resourceExternalId: "app-paie", role: "limited" },
    ]);
  });

  it("rend ce qu'une région lisible porte, même quand l'autre est muette", async () => {
    // Given une région qui ne répond pas du tout
    const parc = parcComplet();
    parc[`${SECNUM}/v1/apps`] = "echec";
    const { lire } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then le run est partiel et non complet : sans quoi la collecte daterait comme
    // disparus tous les accès de la région muette
    expect(collecte.status).toBe("partial");
    const muette = collecte.errors?.find(({ itemRef }) => itemRef === "osc-secnum-fr1");
    expect(muette?.message).toContain("503");

    // Then la région qui a répondu est rendue entièrement : perdre tout le parc parce
    // qu'une région est tombée effacerait de la vue des accès parfaitement lisibles
    if (collecte.status === "failed") {
      throw new Error("une région lisible devait suffire");
    }
    expect(collecte.resources.map(({ externalId }) => externalId)).toEqual(["app-annuaire"]);
    expect(collecte.grants).toHaveLength(3);
  });

  it("refuse de conclure quand les deux lectures d'une région divergent", async () => {
    // Given une vue consolidée qui porte une collaboration que le relevé par application
    // n'a pas vue, ce qu'aucun compteur ne dirait : ces routes n'annoncent aucun total
    const parc = parcComplet();
    parc[`${FR}/v1/collaborators`] = {
      collaborators: [
        TITULAIRE,
        CONVIEE,
        { ...TITULAIRE, id: "collab-fantome", email: "fantome@exemple.invalid" },
      ],
    };
    const { lire } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then la divergence est une erreur unitaire, donc le run n'est pas complet
    expect(collecte.status).toBe("partial");
    const divergence = collecte.errors?.find(({ scope }) => scope === "recoupement");
    expect(divergence?.itemRef).toBe("app-annuaire");
    expect(divergence?.message).toContain("divergent");

    // Then ce qui a été lu reste rendu : un désaccord entre deux lectures ne vide pas
    // l'inventaire, il interdit seulement d'en tirer une disparition
  });

  it("refuse de conclure sur une pagination annoncée ou sur un rôle disparu", async () => {
    // Given une réponse qui annonce une page suivante, sur une route qui n'en rendait
    // aucune jusqu'ici
    const paginee = parcComplet();
    paginee[`${FR}/v1/apps`] = {
      apps: [ANNUAIRE, REVUE],
      meta: { pagination: { next_page: 2 } },
    };

    // When on collecte
    const surPagination = await collecter(lecteur(paginee).lire, SANS_PAUSE);

    // Then le run est partiel : une liste tronquée qui se dirait complète ferait dater
    // comme disparus des accès que personne n'a retirés
    expect(surPagination.status).toBe("partial");
    expect(surPagination.errors?.[0]?.message).toContain("tronqué");

    // Given un parc où plus aucune collaboration ne porte le rôle
    const sansRole = parcComplet();
    const sansLimite = (collaboration: Record<string, unknown>) => {
      const { is_limited: _, ...reste } = collaboration;
      return reste;
    };
    sansRole[`${FR}/v1/apps/service-annuaire/collaborators`] = {
      collaborators: [sansLimite(TITULAIRE), sansLimite(CONVIEE)],
    };
    sansRole[`${FR}/v1/collaborators`] = {
      collaborators: [sansLimite(TITULAIRE), sansLimite(CONVIEE)],
    };
    sansRole[`${SECNUM}/v1/apps/service-paie/collaborators`] = {
      collaborators: [sansLimite(TITULAIRE_AILLEURS)],
    };
    sansRole[`${SECNUM}/v1/collaborators`] = {
      collaborators: [sansLimite(TITULAIRE_AILLEURS)],
    };

    // When on collecte
    const surRole = await collecter(lecteur(sansRole).lire, SANS_PAUSE);

    // Then le run est partiel et le dit : sans ce contrôle, tous les accès limités
    // passeraient pour des accès pleins sur une collecte parfaitement verte, et l'outil
    // décrirait un accès aux secrets de production que personne ne détient
    expect(surRole.status).toBe("partial");
    expect(surRole.errors?.some(({ message }) => message.includes("is_limited"))).toBe(true);

    // Then les accès sortent quand même, et sous le rôle plein : écarter en silence les
    // collaborations dépourvues du champ ferait disparaître des accès bien réels
    if (surRole.status === "failed") {
      throw new Error("un rôle disparu ne doit pas empêcher de lire");
    }
    expect(surRole.grants.filter(({ role }) => role === "collaborator")).toHaveLength(3);

    // Given un parc où plus aucune collaboration ne porte le compte
    const sansCompte = parcComplet();
    const sansUserId = (collaboration: Record<string, unknown>) => {
      const { user_id: _, ...reste } = collaboration;
      return reste;
    };
    sansCompte[`${FR}/v1/apps/service-annuaire/collaborators`] = {
      collaborators: [sansUserId(TITULAIRE), sansUserId(CONVIEE)],
    };
    sansCompte[`${FR}/v1/collaborators`] = {
      collaborators: [sansUserId(TITULAIRE), sansUserId(CONVIEE)],
    };
    sansCompte[`${SECNUM}/v1/apps/service-paie/collaborators`] = {
      collaborators: [sansUserId(TITULAIRE_AILLEURS)],
    };
    sansCompte[`${SECNUM}/v1/collaborators`] = { collaborators: [sansUserId(TITULAIRE_AILLEURS)] };

    // Then le run est partiel. C'est le plus grave des trois : chaque identité
    // retomberait sur son identifiant de collaboration, donc tout le monde serait daté
    // disparu le soir même pendant qu'autant de comptes neufs apparaîtraient
    const surCompte = await collecter(lecteur(sansCompte).lire, SANS_PAUSE);
    expect(surCompte.status).toBe("partial");
    expect(surCompte.errors?.some(({ message }) => message.includes("user_id"))).toBe(true);

    // Given un parc où plus aucune application ne dit d'où elle sort
    const sansAscendance = parcComplet();
    const { parent_app_name: _, ...annuaireNu } = ANNUAIRE;
    const { parent_app_name: __, ...paieNue } = PAIE;
    sansAscendance[`${FR}/v1/apps`] = { apps: [annuaireNu, REVUE] };
    sansAscendance[`${SECNUM}/v1/apps`] = { apps: [paieNue] };

    // Then le run est partiel : sans ce champ, tout le parc éphémère entrerait dans le
    // périmètre sans qu'aucune erreur ne le dise
    const surAscendance = await collecter(lecteur(sansAscendance).lire, SANS_PAUSE);
    expect(surAscendance.status).toBe("partial");
    expect(surAscendance.errors?.some(({ message }) => message.includes("parent_app_name"))).toBe(
      true,
    );
  });

  it("refuse de conclure quand la liste des collaborateurs a perdu son nom", async () => {
    // Given une enveloppe qui ne porte plus la clé attendue, ce qu'une application sans
    // personne ne produit jamais : elle rend bien une liste vide, mais elle la rend
    const parc = parcComplet();
    parc[`${FR}/v1/apps/service-annuaire/collaborators`] = { collaborateurs: [] };
    const { lire } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then le run est partiel. Sans ce contrôle, la clé renommée rendrait une liste vide
    // sans erreur, le garde-fou du rôle serait sauté faute de collaboration relevée, le
    // recoupement ne verrait aucune divergence puisque les deux lectures seraient vides,
    // et le parc entier se daterait comme disparu sur une collecte verte.
    expect(collecte.status).toBe("partial");
    expect(collecte.errors?.some(({ message }) => message.includes("aucune liste"))).toBe(true);

    // Then une application qui n'a réellement aucun collaborateur ne déclenche rien :
    // elle rend une liste vide, et une liste vide n'est pas une clé absente
    const vide = parcComplet();
    vide[`${SECNUM}/v1/apps/service-paie/collaborators`] = { collaborators: [] };
    vide[`${SECNUM}/v1/collaborators`] = { collaborators: [] };
    const sansPersonne = await collecter(lecteur(vide).lire, SANS_PAUSE);

    expect(sansPersonne.status).toBe("ok");
    if (sansPersonne.status === "failed") {
      throw new Error("une application sans collaborateur reste lisible");
    }
    // Then son propriétaire reste rendu : une application sans collaborateur n'est pas
    // une application sans accès
    expect(sansPersonne.grants).toContainEqual({
      identityExternalId: "us-intendance",
      resourceExternalId: "app-paie",
      role: "owner",
    });
  });

  it("ne confond pas deux applications homonymes, ni deux facettes d'une même personne", async () => {
    // Given la même personne propriétaire d'un côté et collaboratrice de l'autre, et
    // deux applications de régions différentes qui portent le même nom
    const parc = parcComplet();
    const HOMONYME = {
      id: "app-annuaire-secnum",
      name: "service-annuaire",
      owner: INTENDANCE,
      parent_app_name: "",
    };
    parc[`${SECNUM}/v1/apps`] = { apps: [PAIE, HOMONYME] };
    parc[`${SECNUM}/v1/apps/service-annuaire/collaborators`] = {
      collaborators: [
        {
          id: "collab-pilote-secnum",
          email: PILOTE.email,
          status: "accepted",
          is_limited: false,
          app_id: "app-annuaire-secnum",
          user_id: PILOTE.id,
        },
      ],
    };
    parc[`${SECNUM}/v1/collaborators`] = { collaborators: [TITULAIRE_AILLEURS] };
    const { lire } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    expect(collecte.status).toBe("ok");
    if (collecte.status === "failed") {
      throw new Error("la collecte devait aboutir");
    }

    // Then les deux homonymes restent deux ressources distinctes : l'inventaire s'indexe
    // sur l'identifiant et jamais sur le nom, faute de quoi le relevé d'une région
    // écraserait celui de l'autre et une révocation partirait sur la mauvaise
    expect(collecte.resources.map(({ externalId }) => externalId).sort()).toEqual([
      "app-annuaire",
      "app-annuaire-secnum",
      "app-paie",
    ]);
    expect(
      collecte.grants.filter(
        ({ resourceExternalId }) => resourceExternalId === "app-annuaire-secnum",
      ),
    ).toHaveLength(2);

    // Then la personne propriétaire ici et collaboratrice là n'est qu'une seule identité,
    // portant tous ses accès. Les deux sources vivent dans le même espace
    // d'identifiants : si l'une dérivait, un plan de départ bâti sur l'une manquerait
    // l'autre moitié
    const pilote = collecte.identities.filter(({ externalId }) => externalId === PILOTE.id);
    expect(pilote).toHaveLength(1);
    expect(
      collecte.grants.filter(({ identityExternalId }) => identityExternalId === PILOTE.id),
    ).toEqual([
      { identityExternalId: "us-pilote", resourceExternalId: "app-annuaire", role: "owner" },
      {
        identityExternalId: "us-pilote",
        resourceExternalId: "app-annuaire-secnum",
        role: "collaborator",
      },
    ]);
  });

  it("n'accuse pas la lecture qui a répondu quand celle d'une application n'a pas abouti", async () => {
    // Given une application dont le relevé ne répond pas, alors que la vue consolidée la
    // cite avec ses deux collaborations
    const parc = parcComplet();
    parc[`${FR}/v1/apps/service-annuaire/collaborators`] = "echec";
    const { lire } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then l'erreur porte l'application en cause, et non la région entière
    expect(collecte.status).toBe("partial");
    const echec = collecte.errors?.find(({ itemRef }) => itemRef === "app-annuaire");
    expect(echec?.scope).toBe("collaborateurs");

    // Then aucune divergence n'est reprochée au recoupement : une lecture qui n'a pas
    // abouti n'est pas un désaccord, et poser une liste vide à sa place désignerait comme
    // fautive la seule des deux qui ait répondu
    expect(collecte.errors?.some(({ scope }) => scope === "recoupement")).toBe(false);

    // Then l'application sort quand même, avec l'accès de son propriétaire et rien
    // d'autre : ne pas avoir pu lire ses collaborateurs ne la fait pas disparaître
    if (collecte.status === "failed") {
      throw new Error("la collecte devait rendre ce qu'elle a lu");
    }
    expect(collecte.resources.map(({ externalId }) => externalId)).toContain("app-annuaire");
    expect(
      collecte.grants.filter(({ resourceExternalId }) => resourceExternalId === "app-annuaire"),
    ).toEqual([
      { identityExternalId: "us-pilote", resourceExternalId: "app-annuaire", role: "owner" },
    ]);
  });

  it("échoue sans rien rendre quand aucune région ne se lit", async () => {
    // Given la liste des régions elle-même hors d'atteinte
    const { lire, appels } = lecteur({ [`${AUTH}/v1/regions`]: "echec" });

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then la collecte échoue plutôt que de rendre un parc vide : ne pas savoir où
    // chercher n'autorise pas à conclure qu'il n'y a rien
    expect(collecte.status).toBe("failed");
    expect(collecte.errors?.[0]?.scope).toBe("regions");
    expect(appels).toEqual([`${AUTH}/v1/regions`]);
  });
});

describe("ce que le connecteur Scalingo propose à un départ", () => {
  it("propose la coupure et la rotation des secrets, sous deux clés distinctes", async () => {
    // Given le départ de quelqu'un, que le socle demande sans aucun identifiant distant
    const intention: Intent = {
      kind: "revoke",
      subject: { kind: "person", username: "camille.exemple" },
    };

    // When le connecteur calcule sa part du plan
    const etapes = await scalingo.plan(intention, CONTEXTE);

    // Then deux étapes et non une : Scalingo écrit que retirer un collaborateur ne
    // change ni les variables d'environnement ni les identifiants de base, si bien
    // qu'une seule étape cochée « fait » affirmerait une coupure qui n'a pas eu lieu
    expect(etapes.map(({ action }) => action)).toEqual([
      "retirer-des-collaborateurs",
      "renouveler-les-secrets",
    ]);

    // Then deux clés distinctes, faute de quoi le dédoublonnage du plan écarterait la
    // seconde comme un doublon de la première
    expect(etapes.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "scalingo:revoke:camille.exemple",
      "scalingo:rotation:camille.exemple",
    ]);

    // Then les deux sont manuelles, portent leur marche à suivre et un critère qu'un
    // opérateur peut constater : sans ça, « fait » ne veut rien dire
    for (const etape of etapes) {
      expect(etape.tier).toBe("manual");
      expect(etape.systemKey).toBe("scalingo");
      expect(etape.riskLevel).toBe("high");
      expect(etape.manual?.runbook).toContain("Scalingo");
      expect(etape.manual?.doneWhen).toContain("camille.exemple");
      expect(etape.manual?.deeplink).toBe("https://dashboard.scalingo.com/collaborators");
    }

    // Then la coupure dit ce qu'elle ne sait pas faire : un propriétaire ne figure dans
    // aucune liste de collaborateurs, et ne s'y retire donc pas
    expect(etapes[0]?.manual?.doneWhen).toContain("propriété");

    // Then un compte de service ne produit aucun geste : sans ce garde, le plan porterait
    // une tâche manuelle intitulée sur un nom indéfini, que personne ne saurait exécuter
    const service: Intent = { kind: "revoke", subject: { kind: "service", key: "deploiement" } };
    expect(await scalingo.plan(service, CONTEXTE)).toEqual([]);
  });

  it("vise chaque application constatée dès que le socle lui dit où la personne est", async () => {
    // Given un départ, avec ce que la collecte a constaté et l'adresse dont le socle répond
    const etapes = await scalingo.plan(
      {
        kind: "revoke",
        subject: {
          kind: "person",
          username: "camille.exemple",
          handles: { scalingo: "camille@exemple.invalid" },
          acces: [
            {
              identityExternalId: "us-camille",
              resourceExternalId: "app-annuaire",
              resourceLabel: "service-annuaire (osc-fr1)",
              role: "collaborator",
            },
            {
              identityExternalId: "us-camille",
              resourceExternalId: "app-paie",
              resourceLabel: "service-paie (osc-secnum-fr1)",
              role: "limited",
            },
          ],
        },
      },
      CONTEXTE,
    );

    // Then une coupure par application, chacune sur sa région, plus la rotation : un seul
    // geste pour tout le parc ne se pointerait ni ne s'exécuterait application par
    // application
    expect(etapes.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "scalingo:osc-fr1:service-annuaire:revoke:camille.exemple",
      "scalingo:osc-secnum-fr1:service-paie:revoke:camille.exemple",
      "scalingo:rotation:camille.exemple",
    ]);

    // Then chaque coupure porte de quoi être exécutée : la région qui donne l'hôte, le nom
    // de l'application, et l'adresse par laquelle la collaboration se retrouve
    expect(etapes[1]?.params).toEqual({
      region: "osc-secnum-fr1",
      application: "service-paie",
      beneficiaire: "camille@exemple.invalid",
    });
    expect(etapes[1]?.manual?.deeplink).toBe(
      "https://dashboard.scalingo.com/apps/osc-secnum-fr1/service-paie/settings/collaborators",
    );

    // Then sans jeton, tout dégrade en manuel plutôt que de promettre un geste que la
    // boucle n'emprunterait pas
    expect(etapes.map(({ tier }) => tier)).toEqual(["manual", "manual", "manual"]);

    // Then sans adresse sûre, le connecteur ne vise rien et retombe sur un seul geste, sur
    // la vue consolidée : ce qui manque est une donnée et non un credential
    const aveugle = await scalingo.plan(
      {
        kind: "revoke",
        subject: { kind: "person", username: "camille.exemple", acces: [] },
      },
      CONTEXTE,
    );
    expect(aveugle.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "scalingo:revoke:camille.exemple",
      "scalingo:rotation:camille.exemple",
    ]);
  });

  it("n'ouvre un accès que sous un scope validé, et pèse le rôle qu'il accorde", async () => {
    // Given un octroi dont la portée manque
    const sansScope: Intent = {
      kind: "grant",
      subject: { kind: "person", username: "camille.exemple" },
    };

    // Then aucune étape : le même octroi sortirait sinon sous deux clés que le
    // dédoublonnage ne rapprocherait pas
    expect(await scalingo.plan(sansScope, CONTEXTE)).toEqual([]);

    // Given une portée complète, avec sa région
    const scope = {
      region: "osc-fr1",
      application: "service-annuaire",
      role: "collaborator" as const,
    };

    // When le profil ouvre cet accès
    const etapes = scalingo.planifierOctroi?.(scope, {
      kind: "person",
      username: "camille.exemple",
    });

    // Then une étape manuelle qui vise la bonne application dans la bonne région
    expect(etapes).toHaveLength(1);
    expect(etapes?.[0]?.idempotencyKey).toBe(
      "scalingo:osc-fr1:service-annuaire:grant:camille.exemple:collaborator",
    );
    expect(etapes?.[0]?.manual?.deeplink).toBe(
      "https://dashboard.scalingo.com/apps/osc-fr1/service-annuaire/settings/collaborators",
    );

    // Then sans adresse, l'octroi dégrade de lui-même même avec le jeton : Scalingo invite
    // sur une adresse et non sur un compte, et ce qui manque est une donnée
    expect(
      planifierOctroiScalingo(scope, { kind: "person", username: "camille.exemple" }, true)[0]
        ?.tier,
    ).toBe("manual");
    expect(
      planifierOctroiScalingo(
        scope,
        { kind: "person", username: "camille.exemple", email: "camille@exemple.invalid" },
        true,
      )[0]?.tier,
    ).toBe("auto");

    // Then le rôle plein pèse plus lourd que le limité : il ouvre les variables
    // d'environnement, donc les secrets de l'application et les accès à ses bases
    expect(etapes?.[0]?.riskLevel).toBe("high");
    const limite = scalingo.planifierOctroi?.(
      { ...scope, role: "limited" },
      { kind: "person", username: "camille.exemple" },
    );
    expect(limite?.[0]?.riskLevel).toBe("medium");

    // Then le schéma refuse une portée incomplète, où la région manque : deux régions
    // peuvent servir le même nom d'application
    expect(CONTRAT_SCALINGO.scopeSchema.safeParse({ ...scope, region: undefined }).success).toBe(
      false,
    );
    expect(CONTRAT_SCALINGO.scopeSchema.safeParse({ ...scope, role: "owner" }).success).toBe(false);
  });
});

describe("ce que le connecteur Scalingo écrit, et ce qu'il refuse d'écrire", () => {
  const ETAPE = {
    systemKey: "scalingo",
    capability: "revoke" as const,
    tier: "auto" as const,
    action: "retirer-des-collaborateurs",
    label: "Retirer",
    params: { region: "osc-fr1", application: "service-annuaire", beneficiaire: TITULAIRE.email },
    riskLevel: "high" as const,
    expectedState: { collaborateur: false },
    idempotencyKey: "scalingo:osc-fr1:service-annuaire:revoke:camille.exemple",
  };

  const ROSTER = {
    [`${FR}/v1/apps/service-annuaire/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
  };

  function ecrivain(reponse: ReponseScalingo): {
    ecrire: EcritureScalingo;
    appels: { methode: string; url: string; corps?: unknown }[];
  } {
    const appels: { methode: string; url: string; corps?: unknown }[] = [];
    return {
      ecrire: (methode, url, corps) => {
        appels.push({ methode, url, ...(corps === undefined ? {} : { corps }) });
        return Promise.resolve(reponse);
      },
      appels,
    };
  }

  it("interprète chaque famille de réponses sans jamais avoir à deviner celle de Scalingo", () => {
    // Given un retrait. Scalingo ne documente pas ce qu'il rend sur une collaboration
    // absente, et son client officiel traite tout sauf 204 comme une erreur : les deux
    // branches existent donc ici, et « déjà absent » est un succès, pas un échec
    expect(interpreterRetrait(204, undefined).state).toBe("SUCCEEDED");
    expect(interpreterRetrait(404, undefined).state).toBe("ALREADY_ABSENT");

    // Then une panne se reprend, un refus non : les confondre ferait réessayer
    // indéfiniment ce qui ne passera jamais
    const panne = interpreterRetrait(503, { error: "indisponible" });
    expect(panne).toEqual({
      state: "FAILED",
      error: "Scalingo a répondu 503 : indisponible",
      retryable: true,
    });
    expect(interpreterRetrait(403, undefined)).toMatchObject({ retryable: false });
    expect(interpreterRetrait(429, undefined)).toMatchObject({ retryable: true });

    // Given une invitation. Un conflit dit que la personne détient déjà l'accès : le
    // traiter en échec enverrait un opérateur corriger ce qui est fait
    expect(interpreterOctroi(201, undefined).state).toBe("SUCCEEDED");
    expect(interpreterOctroi(409, undefined).state).toBe("ALREADY_PRESENT");
    expect(interpreterOctroi(422, undefined).state).toBe("ALREADY_PRESENT");
    expect(interpreterOctroi(500, undefined)).toMatchObject({ retryable: true });

    // Then le succès d'un retrait dit ce qu'il n'a pas fait : les secrets restent en place
    expect(interpreterRetrait(204, undefined)).toMatchObject({
      evidence: expect.stringContaining("rotation"),
    });
  });

  it("constate avant d'écrire, et se rapproche sur l'adresse et non sur un identifiant", async () => {
    const { lire } = lecteur(ROSTER);

    // Then une personne présente n'est pas encore retirée : l'étape reste à faire
    expect(await constaterCollaborateur(lire, ETAPE)).toEqual({ state: "READY" });

    // Then une personne absente solde l'étape sans qu'aucune écriture ne parte, ce qui est
    // le cas nominal quand une autre main est passée avant
    const partie = {
      ...ETAPE,
      params: { ...ETAPE.params, beneficiaire: "partie@exemple.invalid" },
    };
    expect(await constaterCollaborateur(lire, partie)).toEqual({ state: "ALREADY_ABSENT" });

    // Then sur un octroi, un rôle qui ne correspond pas est un écart et non un doublon :
    // la personne est là, mais pas avec l'accès que le plan décrivait
    const octroi = {
      ...ETAPE,
      capability: "grant" as const,
      action: "inviter-comme-collaborateur",
      params: { ...ETAPE.params, role: "limited" },
    };
    expect(await constaterCollaborateur(lire, octroi)).toEqual({
      state: "STALE",
      expected: { role: "limited" },
      actual: { role: "collaborator" },
    });
    expect(
      await constaterCollaborateur(lire, {
        ...octroi,
        params: { ...octroi.params, role: "collaborator" },
      }),
    ).toEqual({ state: "ALREADY_PRESENT" });

    // Then la casse ne sépare pas quelqu'un de son propre compte : Scalingo n'impose rien
    // sur celle des adresses, et comparer brut laisserait un accès ouvert derrière un
    // départ pour une majuscule
    const criard = lecteur({
      [`${FR}/v1/apps/service-annuaire/collaborators`]: {
        collaborators: [{ ...TITULAIRE, email: TITULAIRE.email.toUpperCase() }],
      },
    });
    expect(await constaterCollaborateur(criard.lire, ETAPE)).toEqual({ state: "READY" });

    // Then une étape que le connecteur ne sait pas lire ne lève pas : lever ferait compter
    // un échec à chaque passage sur la rotation des secrets, qui ne se lit par aucune API
    const rotation = { ...ETAPE, action: "renouveler-les-secrets", params: { username: "qui" } };
    expect(await constaterCollaborateur(lire, rotation)).toEqual({ state: "READY" });
  });

  it("refuse d'écrire en simulation, sans jeton, ou sur une étape qu'il ne reconnaît pas", async () => {
    const { lire } = lecteur(ROSTER);
    const { ecrire, appels } = ecrivain({ statut: 204, corps: undefined });

    // Then la simulation lève avant même de regarder ce que l'étape demande : ce qui ne
    // part pas ne peut pas partir par erreur
    await expect(executerScalingo(lire, ecrire, true, ETAPE, CONTEXTE)).rejects.toThrow(
      /ACTIONS_ENABLED/,
    );

    const reel = { ...CONTEXTE, dryRun: false };

    // Then sans jeton, un échec qui ne se reprend pas et qui renvoie à la marche à suivre
    expect(await executerScalingo(lire, ecrire, false, ETAPE, reel)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });

    // Then une étape sans voie automatique n'est pas une panne : elle attend une main
    const rotation = { ...ETAPE, action: "renouveler-les-secrets", params: { username: "qui" } };
    expect(await executerScalingo(lire, ecrire, true, rotation, reel)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });

    // Then aucun de ces trois refus n'a laissé partir le moindre appel
    expect(appels).toEqual([]);
  });

  it("retire la collaboration du jour, et jamais celle qu'un plan figé désignait", async () => {
    const { lire } = lecteur(ROSTER);
    const { ecrire, appels } = ecrivain({ statut: 204, corps: undefined });
    const reel = { ...CONTEXTE, dryRun: false };

    expect(await executerScalingo(lire, ecrire, true, ETAPE, reel)).toMatchObject({
      state: "SUCCEEDED",
    });

    // Then l'identifiant supprimé est celui relu à l'instant, et non un identifiant figé
    // dans le plan : celui-ci change dès qu'une invitation est retirée puis réémise, si
    // bien qu'un plan confirmé la veille viserait une collaboration morte
    expect(appels).toEqual([
      { methode: "DELETE", url: `${FR}/v1/apps/service-annuaire/collaborators/collab-titulaire` },
    ]);

    // Then quelqu'un qui n'est plus là ne déclenche aucune suppression
    const partie = {
      ...ETAPE,
      params: { ...ETAPE.params, beneficiaire: "partie@exemple.invalid" },
    };
    const seconde = ecrivain({ statut: 204, corps: undefined });
    expect(await executerScalingo(lire, seconde.ecrire, true, partie, reel)).toEqual({
      state: "ALREADY_ABSENT",
    });
    expect(seconde.appels).toEqual([]);
  });

  it("invite sur une adresse, en disant toujours quel rôle il ouvre", async () => {
    const { lire } = lecteur(ROSTER);
    const { ecrire, appels } = ecrivain({ statut: 201, corps: { collaborator: {} } });
    const octroi = {
      ...ETAPE,
      capability: "grant" as const,
      action: "inviter-comme-collaborateur",
      params: {
        region: "osc-fr1",
        application: "service-annuaire",
        beneficiaire: "nouvelle@exemple.invalid",
        role: "limited",
      },
    };

    expect(
      await executerScalingo(lire, ecrire, true, octroi, { ...CONTEXTE, dryRun: false }),
    ).toMatchObject({ state: "SUCCEEDED" });

    // Then le rôle part explicitement. Le défaut de l'API est le rôle limité quand son
    // client officiel envoie l'inverse : l'implicite reviendrait à ne pas savoir quel
    // accès on vient d'ouvrir
    expect(appels).toEqual([
      {
        methode: "POST",
        url: `${FR}/v1/apps/service-annuaire/collaborators`,
        corps: { collaborator: { email: "nouvelle@exemple.invalid", is_limited: true } },
      },
    ]);

    const plein = ecrivain({ statut: 201, corps: undefined });
    await executerScalingo(
      lire,
      plein.ecrire,
      true,
      { ...octroi, params: { ...octroi.params, role: "collaborator" } },
      { ...CONTEXTE, dryRun: false },
    );
    expect(plein.appels[0]?.corps).toEqual({
      collaborator: { email: "nouvelle@exemple.invalid", is_limited: false },
    });
  });
});

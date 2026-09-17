import { describe, expect, it } from "vitest";

import type { Intent, ObservedResource, RunContext } from "@/core/connector";
import {
  avecReprise,
  CONTRAT_SCALINGO,
  collecter,
  constaterCollaborateur,
  type EcritureScalingo,
  ErreurDeLecture,
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

/** Le compte que porte le jeton : c'est lui qui possède les applications de l'incubateur. */
const PILOTE = { id: "us-pilote", email: "pilote@exemple.invalid", username: "pilote" };
const INTENDANCE = {
  id: "us-intendance",
  email: "intendance@exemple.invalid",
  username: "intendance",
};

/** Le projet qui regroupe deux des applications du parc d'essai. */
const SOCLE = { id: "proj-socle", name: "socle-commun" };

/** La chaîne vide et non l'absence : c'est ce que l'API rend sur une application sans parent. */
const ANNUAIRE = {
  id: "app-annuaire",
  name: "service-annuaire",
  owner: PILOTE,
  parent_app_name: "",
  project: SOCLE,
};
const REVUE = {
  id: "app-revue",
  name: "service-annuaire-pr42",
  owner: PILOTE,
  parent_app_name: "service-annuaire",
  project: SOCLE,
};
/** Sans projet, et la clé présente à `null` : l'API la rend toujours. */
const PAIE = {
  id: "app-paie",
  name: "service-paie",
  owner: PILOTE,
  parent_app_name: "",
  project: null,
};

/** Possédée par quelqu'un d'autre : le compte n'en est que collaborateur. */
const ETRANGERE = {
  id: "app-etrangere",
  name: "service-d-ailleurs",
  owner: INTENDANCE,
  parent_app_name: "",
  project: null,
};

/** Un second projet, sur l'autre région : c'est ce qui rend observable que le libellé la porte. */
const BAC = { id: "proj-bac", name: "bac-a-sable" };

/** Le même projet que l'annuaire, et dans la même région : deux applications, un contenant. */
const ALPHA = {
  id: "app-alpha",
  name: "produit-alpha",
  owner: PILOTE,
  parent_app_name: "",
  project: SOCLE,
};
const BETA = {
  id: "app-beta",
  name: "produit-beta",
  owner: PILOTE,
  parent_app_name: "",
  project: BAC,
};

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
    [`${AUTH}/v1/users/self`]: { user: { id: PILOTE.id } },
    [`${AUTH}/v1/regions`]: REGIONS,
    [`${FR}/v1/apps`]: { apps: [ANNUAIRE, REVUE] },
    [`${FR}/v1/apps/service-annuaire/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${FR}/v1/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${SECNUM}/v1/apps`]: { apps: [PAIE] },
    [`${SECNUM}/v1/apps/service-paie/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
    [`${SECNUM}/v1/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
  };
}

/**
 * Un parc où le regroupement est de toutes les formes à la fois : deux applications d'un
 * même projet, une d'un autre, une sans. `remplacer` sert à ne faire varier que la clé
 * `project`, tout le reste du parc restant lisible : c'est ce qui permet de juger de la
 * clé disparue sans qu'une autre surveillance ne rende le run partiel pour autre chose.
 */
function parcAProjets(
  remplacer: (application: Record<string, unknown>) => Record<string, unknown> = (application) =>
    application,
): Record<string, unknown> {
  const [annuaire, alpha, beta, paie] = [ANNUAIRE, ALPHA, BETA, PAIE].map(remplacer);

  return {
    [`${AUTH}/v1/users/self`]: { user: { id: PILOTE.id } },
    [`${AUTH}/v1/regions`]: REGIONS,
    [`${FR}/v1/apps`]: { apps: [annuaire, alpha] },
    [`${FR}/v1/apps/service-annuaire/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${FR}/v1/apps/produit-alpha/collaborators`]: { collaborators: [] },
    [`${FR}/v1/collaborators`]: { collaborators: [TITULAIRE, CONVIEE] },
    [`${SECNUM}/v1/apps`]: { apps: [beta, paie] },
    [`${SECNUM}/v1/apps/produit-beta/collaborators`]: { collaborators: [] },
    [`${SECNUM}/v1/apps/service-paie/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
    [`${SECNUM}/v1/collaborators`]: { collaborators: [TITULAIRE_AILLEURS] },
  };
}

/** Ce que l'écran suivra pour regrouper : la clé du contenant d'une ressource, ou rien. */
const contenanceDe = (ressources: readonly ObservedResource[], cle: string) =>
  ressources.find(({ externalId }) => externalId === cle)?.parentExternalId;

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
    // Le projet vient en tête : c'est un contenant, et la ressource qu'il contient doit
    // pouvoir le désigner quel que soit l'ordre du relevé.
    expect(collecte.resources.map((ressource) => ressource.label)).toEqual([
      "socle-commun, osc-fr1",
      "service-annuaire, osc-fr1",
      "service-paie, osc-secnum-fr1",
    ]);
    expect(collecte.resources[2]?.url).toBe(
      "https://dashboard.scalingo.com/apps/osc-secnum-fr1/service-paie/settings/collaborators",
    );

    // Then la personne vue sur les deux régions ne compte qu'une fois, et les deux
    // propriétaires sont là : ils ne figurent dans aucune liste de collaborateurs
    expect(collecte.identities.map((identite) => identite.externalId).sort()).toEqual([
      "collab-conviee",
      "us-pilote",
      "us-titulaire",
    ]);
    expect(collecte.itemsSeen).toBe(3);

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
      { identityExternalId: "us-pilote", resourceExternalId: "app-paie", role: "owner" },
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
    expect(collecte.resources.map(({ externalId }) => externalId)).toEqual([
      "proj-socle",
      "app-annuaire",
    ]);
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
      identityExternalId: "us-pilote",
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
      owner: PILOTE,
      parent_app_name: "",
      project: null,
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
      "proj-socle",
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
      { identityExternalId: "us-pilote", resourceExternalId: "app-paie", role: "owner" },
      { identityExternalId: "us-pilote", resourceExternalId: "app-annuaire-secnum", role: "owner" },
      {
        identityExternalId: "us-pilote",
        resourceExternalId: "app-annuaire-secnum",
        role: "collaborator",
      },
    ]);
  });

  it("laisse dehors les applications que l'incubateur ne possède pas", async () => {
    // Given une application dont le compte n'est que collaborateur : elle appartient à une
    // autre structure, et le compte la voit sans en décider
    const parc = parcComplet();
    parc[`${FR}/v1/apps`] = { apps: [ANNUAIRE, REVUE, ETRANGERE] };
    parc[`${FR}/v1/apps/service-d-ailleurs/collaborators`] = {
      collaborators: [{ ...TITULAIRE, id: "collab-ailleurs", app_id: "app-etrangere" }],
    };
    const { lire, appels } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    expect(collecte.status).toBe("ok");
    if (collecte.status === "failed") {
      throw new Error("la collecte devait aboutir");
    }

    // Then elle ne produit ni ressource, ni accès, et son relevé n'a pas même été demandé :
    // ouvrir des constats sur des gens dont personne ici ne décide des accès ferait du
    // bruit que personne ne saurait traiter
    expect(collecte.resources.map(({ externalId }) => externalId)).not.toContain("app-etrangere");
    expect(
      collecte.grants.some(({ resourceExternalId }) => resourceExternalId === "app-etrangere"),
    ).toBe(false);
    expect(appels.some((url) => url.includes("service-d-ailleurs"))).toBe(false);
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

  it("retente une fois ce qui a expiré, et une fois seulement", async () => {
    /** Ce que lève `AbortSignal.timeout` : le nom est fixé par la plateforme, le message non. */
    const abandon = () => {
      const cause = new Error("The operation was aborted due to timeout");
      cause.name = "TimeoutError";
      return cause;
    };

    // Given une lecture qui expire au premier essai puis répond
    let essais = 0;
    const capricieux: LecteurScalingo = (url) => {
      if (url.endsWith("/apps/service-annuaire/collaborators")) {
        essais += 1;
        if (essais === 1) {
          return Promise.reject(abandon());
        }
      }
      return lecteur(parcComplet()).lire(url);
    };

    // When on collecte
    const collecte = await collecter(avecReprise(capricieux, SANS_PAUSE), SANS_PAUSE);

    // Then le run est complet. La collecte enchaîne une requête par application : laisser
    // un hoquet de réseau la rendre partielle lui interdirait de dater la moindre
    // disparition, toutes les nuits, sans que rien ne soit cassé
    expect(collecte.status).toBe("ok");
    expect(essais).toBe(2);

    // Given une lecture qui expire à chaque fois
    let obstines = 0;
    const mort: LecteurScalingo = (url) => {
      if (url.endsWith("/apps/service-annuaire/collaborators")) {
        obstines += 1;
        return Promise.reject(abandon());
      }
      return lecteur(parcComplet()).lire(url);
    };

    // Then deux essais et pas un de plus : ce qui ne passe pas au second est un vrai
    // écart, et insister doublerait la dépense sous un plafond de soixante requêtes par
    // minute. Le compte l'épingle, faute de quoi dix reprises passeraient aussi bien
    const tetu = await collecter(avecReprise(mort, SANS_PAUSE), SANS_PAUSE);
    expect(obstines).toBe(2);
    expect(tetu.status).toBe("partial");
    expect(tetu.errors?.some(({ message }) => message.includes("timeout"))).toBe(true);

    // Given un délai dépassé rendu par le serveur lui-même, dont le message ne porte pas
    // le mot qu'une comparaison de chaînes chercherait, et pas dans cette casse
    let lents = 0;
    const lent: LecteurScalingo = (url) => {
      if (url.endsWith("/apps/service-annuaire/collaborators")) {
        lents += 1;
        if (lents === 1) {
          return Promise.reject(new ErreurDeLecture("408 Request Timeout", 408));
        }
      }
      return lecteur(parcComplet()).lire(url);
    };

    // Then il est repris comme les autres : ce qui décide est le statut porté par
    // l'erreur, et jamais la casse d'un texte rendu par un tiers
    expect((await collecter(avecReprise(lent, SANS_PAUSE), SANS_PAUSE)).status).toBe("ok");
    expect(lents).toBe(2);

    // Given une panne du serveur, et le porteur périmé qui emprunte le même chemin :
    // celui-ci vient d'être oublié, si bien que le second essai en échangera un neuf
    for (const enPanne of [503, 500]) {
      let pannes = 0;
      const tombe: LecteurScalingo = (url) => {
        if (url.endsWith("/apps/service-annuaire/collaborators")) {
          pannes += 1;
          if (pannes === 1) {
            return Promise.reject(new ErreurDeLecture(`${enPanne} Server Error`, enPanne));
          }
        }
        return lecteur(parcComplet()).lire(url);
      };

      expect((await collecter(avecReprise(tombe, SANS_PAUSE), SANS_PAUSE)).status).toBe("ok");
      expect(pannes).toBe(2);
    }

    // Given un refus de droits, qui se reproduira à l'identique
    let refus = 0;
    const interdit: LecteurScalingo = (url) => {
      if (url.endsWith("/apps/service-annuaire/collaborators")) {
        refus += 1;
        return Promise.reject(new ErreurDeLecture("403 Forbidden", 403));
      }
      return lecteur(parcComplet()).lire(url);
    };

    // Then aucune reprise : le retenter ne ferait que dépenser une requête de plus
    await collecter(avecReprise(interdit, SANS_PAUSE), SANS_PAUSE);
    expect(refus).toBe(1);
  });

  it("échoue sans rien rendre quand le compte du jeton ne se lit pas", async () => {
    // Given un compte hors d'atteinte
    const parc = parcComplet();
    parc[`${AUTH}/v1/users/self`] = "echec";
    const { lire, appels } = lecteur(parc);

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then rien n'est rendu. Sans savoir à qui sont les applications, le périmètre ne se
    // décide pas : relever tout ce que le compte voit ferait entrer les applications
    // d'autres structures, et n'en relever aucune daterait le parc entier comme disparu
    expect(collecte.status).toBe("failed");
    expect(collecte.errors?.[0]?.scope).toBe("compte");
    expect(appels.some((url) => url.includes("/v1/apps"))).toBe(false);
  });

  it("échoue sans rien rendre quand aucune région ne se lit", async () => {
    // Given la liste des régions elle-même hors d'atteinte
    const { lire, appels } = lecteur({
      [`${AUTH}/v1/users/self`]: { user: { id: PILOTE.id } },
      [`${AUTH}/v1/regions`]: "echec",
    });

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    // Then la collecte échoue plutôt que de rendre un parc vide : ne pas savoir où
    // chercher n'autorise pas à conclure qu'il n'y a rien
    expect(collecte.status).toBe("failed");
    expect(collecte.errors?.[0]?.scope).toBe("regions");
    expect(appels).toEqual([`${AUTH}/v1/users/self`, `${AUTH}/v1/regions`]);
  });

  it("le projet regroupe, et il ne porte rien", async () => {
    // Given un parc de deux régions où deux applications partagent un projet, une
    // troisième en a un autre, et une quatrième n'en a aucun
    const { lire } = lecteur(parcAProjets());

    // When on collecte
    const collecte = await collecter(lire, SANS_PAUSE);

    expect(collecte.status).toBe("ok");
    if (collecte.status === "failed") {
      throw new Error("la collecte devait aboutir");
    }

    // Then un contenant par projet et non par application : deux applications du même
    // projet qui émettraient chacune le leur poseraient deux fois la même ressource, et
    // le relevé porterait deux fois la même clé au lieu de regrouper
    expect(collecte.resources.map(({ externalId }) => externalId)).toEqual([
      "proj-socle",
      "proj-bac",
      "app-annuaire",
      "app-alpha",
      "app-beta",
      "app-paie",
    ]);

    // Then le libellé d'un projet porte sa région, comme celui d'une application : deux
    // régions peuvent servir le même nom, et un écran qui les confondrait rangerait sous
    // un seul intitulé des applications qui n'ont rien à voir
    expect(collecte.resources.slice(0, 2).map(({ label }) => label)).toEqual([
      "socle-commun, osc-fr1",
      "bac-a-sable, osc-secnum-fr1",
    ]);

    // Then les deux applications du même projet portent la même clé de contenant, et
    // celle qui n'en a pas n'en porte aucune : sans la contenance, le projet sortirait en
    // ressource orpheline et l'écran regrouperait sur un lien que personne ne déclare
    expect(contenanceDe(collecte.resources, "app-annuaire")).toBe("proj-socle");
    expect(contenanceDe(collecte.resources, "app-alpha")).toBe("proj-socle");
    expect(contenanceDe(collecte.resources, "app-beta")).toBe("proj-bac");
    expect(contenanceDe(collecte.resources, "app-paie")).toBeUndefined();

    // Then un contenant ne se range dans rien : la contenance ne tient qu'un niveau, et
    // en poser un second ferait refuser la ressource à l'écriture
    expect(contenanceDe(collecte.resources, "proj-socle")).toBeUndefined();

    // Then aucun accès ne vise un projet. Scalingo gère les collaborateurs au niveau de
    // l'application : un accès posé sur le contenant décrirait un droit que personne ne
    // détient, et un plan de départ irait ensuite couper ce qui n'existe pas
    const contenants = new Set(["proj-socle", "proj-bac"]);
    expect(
      collecte.grants.filter(({ resourceExternalId }) => contenants.has(resourceExternalId ?? "")),
    ).toEqual([]);
    expect(collecte.grants).toHaveLength(7);
    expect(collecte.itemsSeen).toBe(3);

    // Given une application dont le projet arrive sous une forme neuve, ici un
    // identifiant nu à la place de l'objet
    const neuf = await collecter(
      lecteur(
        parcAProjets((application) =>
          application["id"] === ANNUAIRE.id ? { ...application, project: SOCLE.id } : application,
        ),
      ).lire,
      SANS_PAUSE,
    );

    if (neuf.status === "failed") {
      throw new Error("un projet de forme neuve ne doit pas emporter l'application");
    }

    // Then l'application sort quand même, avec tous ses accès et sans contenance : un
    // schéma qui refuserait la fiche entière daterait comme disparus trois accès bien
    // réels pour un champ qui ne sert qu'à regrouper
    expect(neuf.status).toBe("ok");
    expect(
      neuf.grants.filter(({ resourceExternalId }) => resourceExternalId === "app-annuaire"),
    ).toHaveLength(3);
    expect(contenanceDe(neuf.resources, "app-annuaire")).toBeUndefined();

    // Then le projet reste rendu, l'autre application du même projet le portant encore
    expect(neuf.resources.map(({ externalId }) => externalId)).toContain("proj-socle");

    // Given un parc où plus aucune application ne porte la clé du projet
    const sansCle = await collecter(
      lecteur(parcAProjets(({ project: _, ...reste }) => reste)).lire,
      SANS_PAUSE,
    );

    // Then le run est partiel et le message nomme le champ : sans cette surveillance, le
    // regroupement disparaîtrait de l'écran sur une collecte parfaitement verte
    expect(sansCle.status).toBe("partial");
    expect(
      sansCle.errors?.some(
        ({ scope, message }) => scope === "applications" && message.includes("project"),
      ),
    ).toBe(true);

    if (sansCle.status === "failed") {
      throw new Error("un champ de regroupement disparu ne fige pas le reste");
    }

    // Then les accès sortent tous : perdre un attribut de regroupement ne justifie pas de
    // taire ce que le système sait encore dire
    expect(sansCle.grants).toHaveLength(7);

    // Given un parc où chaque application porte la clé à `null`, c'est-à-dire un parc qui
    // n'emploie tout simplement pas les projets
    const toutNul = await collecter(
      lecteur(parcAProjets((application) => ({ ...application, project: null }))).lire,
      SANS_PAUSE,
    );

    if (toutNul.status === "failed") {
      throw new Error("un parc sans projet reste un parc lisible");
    }

    // Then le run est complet, et aucun contenant ne sort. Signaler ici rendrait partiel
    // chaque run d'un parc légitime, donc gèlerait toutes les nuits la datation des
    // disparitions pour un regroupement d'écran qui n'ouvre aucun droit
    expect(toutNul.status).toBe("ok");
    expect(toutNul.resources.map(({ externalId }) => externalId)).toEqual([
      "app-annuaire",
      "app-alpha",
      "app-beta",
      "app-paie",
    ]);
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
              resourceLabel: "service-annuaire, osc-fr1",
              role: "collaborator",
            },
            {
              identityExternalId: "us-camille",
              resourceExternalId: "app-paie",
              resourceLabel: "service-paie, osc-secnum-fr1",
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

    // Then une entité non traitable reste un échec. Scalingo la rend sur un champ invalide
    // sans nulle part dire qu'elle vaut « déjà présent » ici, et l'adresse vient de la base
    // sans autre contrôle qu'une arobase : la solder affirmerait un accès que personne ne
    // détient, et personne n'irait le rouvrir.
    expect(interpreterOctroi(422, { error: "email is invalid" })).toEqual({
      state: "FAILED",
      error: "Scalingo a répondu 422 : email is invalid",
      retryable: false,
    });
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

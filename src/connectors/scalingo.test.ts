import { describe, expect, it } from "vitest";

import { catalogueDOctroi } from "@/connectors";
import type {
  Intent,
  ObservedResource,
  PlannedStep,
  RunContext,
  SubjectRef,
} from "@/core/connector";
import { assemblerOctrois, echeanceDOctroi, verifierProfils } from "@/core/octroi";
import type { Profil } from "@/core/policy";
import { catalogueOctroyeur } from "@/lib/arrivee";
import {
  type DemandeDeJeton,
  type EmissionDeJeton,
  ErreurFgp,
  emettreUnJeton,
  type JetonEmis,
} from "@/lib/fgp";
import {
  avecReprise,
  CONTRAT_SCALINGO,
  collecter,
  constaterCollaborateur,
  type EcritureScalingo,
  ErreurDeLecture,
  examinerScopeScalingo,
  executerEmissionScalingo,
  executerScalingo,
  interpreterChangementDeRole,
  interpreterOctroi,
  interpreterRetrait,
  type LecteurScalingo,
  type Pause,
  planifierDepartScalingo,
  planifierJetonScalingo,
  planifierOctroiScalingo,
  type ReponseScalingo,
  type ScopeJeton,
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

  it("transfère une application possédée au lieu d'en retirer un collaborateur qui n'en est pas un", async () => {
    // Given le départ de quelqu'un qui possède une application et collabore à une autre.
    // La collecte pose le rôle « owner » sur l'accès du propriétaire, et le socle le
    // transmet au plan.
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
              role: "owner",
            },
            {
              identityExternalId: "us-camille",
              resourceExternalId: "app-paie",
              resourceLabel: "service-paie, osc-secnum-fr1",
              role: "collaborator",
            },
          ],
        },
      },
      CONTEXTE,
    );

    // Then l'application possédée sort un transfert et non un retrait. C'est la
    // régression que ce scénario garde : un retrait sur un propriétaire se solde en
    // « déjà absent », donc en succès, et l'application reste à quelqu'un qui est parti.
    expect(etapes.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "scalingo:osc-secnum-fr1:service-paie:revoke:camille.exemple",
      "scalingo:osc-fr1:service-annuaire:transfert:camille.exemple",
      "scalingo:rotation:camille.exemple",
    ]);
    expect(etapes.map(({ action }) => action)).toEqual([
      "retirer-des-collaborateurs",
      "transferer-la-propriete",
      "renouveler-les-secrets",
    ]);

    const transfert = etapes.find(({ action }) => action === "transferer-la-propriete");

    // Then le transfert vise l'application par sa région et son nom, et ne porte aucun
    // bénéficiaire. Sans ce manque, le précheck le reconnaîtrait et le solderait sur une
    // lecture de collaborateurs où un propriétaire ne figure pas.
    expect(transfert?.params).toEqual({
      region: "osc-fr1",
      application: "service-annuaire",
      username: "camille.exemple",
    });

    // Then il dit quoi constater, et les deux choses à constater, l'appartenance et la
    // collaboration que Scalingo peut laisser derrière.
    expect(transfert?.manual?.doneWhen).toContain("appartient à quelqu'un d'autre");
    expect(transfert?.manual?.doneWhen).toContain("collaborateurs");
    expect(transfert?.manual?.runbook).toContain("repreneur");

    // Then le pointage réclame le repreneur, faute de quoi le journal dirait qu'un
    // transfert a eu lieu sans dire à qui
    expect(transfert?.manual?.saisie).toEqual({
      libelle: "Compte Scalingo du repreneur",
      obligatoire: true,
    });
    expect(transfert?.manual?.deeplink).toBe(
      "https://dashboard.scalingo.com/apps/osc-fr1/service-annuaire/settings/collaborators",
    );

    // Given le même départ, cette fois avec un jeton qui répond,
    const avecJeton = planifierDepartScalingo(
      "camille.exemple",
      [
        {
          resourceExternalId: "app-annuaire",
          resourceLabel: "service-annuaire, osc-fr1",
          role: "owner",
        },
        {
          resourceExternalId: "app-paie",
          resourceLabel: "service-paie, osc-secnum-fr1",
          role: "collaborator",
        },
      ],
      "camille@exemple.invalid",
      true,
    );

    // Then le retrait passe en automatique et le transfert reste manuel. Aucune API ne
    // désigne un repreneur, et le tier ne se lit pas sur le credential seul.
    expect(
      avecJeton
        .filter(({ action }) => action !== "renouveler-les-secrets")
        .map(({ action, tier }) => [action, tier]),
    ).toEqual([
      ["retirer-des-collaborateurs", "auto"],
      ["transferer-la-propriete", "manual"],
    ]);

    // Given quelqu'un qui ne possède qu'une application et n'est collaborateur de rien,
    const seulementProprietaire = planifierDepartScalingo(
      "camille.exemple",
      [
        {
          resourceExternalId: "app-annuaire",
          resourceLabel: "service-annuaire, osc-fr1",
          role: "owner",
        },
      ],
      "camille@exemple.invalid",
      false,
    );

    // Then aucun retrait ne sort, pas même celui de la vue consolidée. Le produire
    // affirmerait une collaboration à couper là où il n'y en a aucune.
    expect(seulementProprietaire.map(({ action }) => action)).toEqual([
      "transferer-la-propriete",
      "renouveler-les-secrets",
    ]);

    // Given le même propriétaire, dont le socle ne connaît aucune adresse,
    const sansAdresse = planifierDepartScalingo(
      "camille.exemple",
      [
        {
          resourceExternalId: "app-annuaire",
          resourceLabel: "service-annuaire, osc-fr1",
          role: "owner",
        },
      ],
      undefined,
      false,
    );

    // Then toujours aucun retrait. L'adresse manque pour viser une collaboration, et
    // c'est sans effet ici puisqu'il n'y en a aucune à viser.
    expect(sansAdresse.map(({ action }) => action)).toEqual([
      "transferer-la-propriete",
      "renouveler-les-secrets",
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

    // Given une portée complète, avec sa nature et sa région
    const scope = {
      nature: "collaboration" as const,
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

    // Then la nature n'a pas de défaut, et c'est la rupture assumée : un profil qui ne la
    // porte pas ne décrit plus rien, l'octroi d'une collaboration et l'émission d'un jeton
    // n'ayant aucun champ en commun
    expect(
      CONTRAT_SCALINGO.scopeSchema.safeParse({
        region: scope.region,
        application: scope.application,
        role: scope.role,
      }).success,
    ).toBe(false);
  });

  it("pèse un jeton pour ce qu'il est, et refuse une cible que son usage n'ouvrira pas", () => {
    // Given un jeton qui sert l'inventaire d'une région, sous une région nommée
    const inventaire = {
      nature: "jeton" as const,
      usage: "inventaire-d-une-region" as const,
      region: "osc-fr1",
    };
    expect(CONTRAT_SCALINGO.scopeSchema.safeParse(inventaire).success).toBe(true);

    // Then tout jeton pèse le risque le plus lourd, quel que soit son usage : rien ne le
    // révoque, si bien que le plus étroit ouvre ce que personne ne saura refermer. C'est
    // ce qui lui fait exiger une échéance au verdict d'octroi.
    const examen = examinerScopeScalingo(inventaire);
    expect(examen).toMatchObject({ refus: [], risque: "high" });

    // Then la cible ne porte pas l'application : deux accès qui demandent le même jeton
    // pour la même personne demandent la même chose
    expect(examen.cible).toBe("jeton:inventaire-d-une-region:osc-fr1");
    expect(
      examinerScopeScalingo({
        nature: "jeton",
        usage: "catalogue-des-regions",
      }).cible,
    ).toBe("jeton:catalogue-des-regions:global");

    // Then un usage régional sans région est refusé : chaque région a son propre hôte, et
    // un jeton n'en ouvre qu'un
    expect(
      examinerScopeScalingo({ nature: "jeton", usage: "inventaire-d-une-region" }).refus,
    ).toEqual([expect.stringContaining("scope.region")]);

    // Then un usage qui vise le service d'authentification et porte quand même une région
    // est refusé lui aussi : la cible décrite n'est pas celle que le jeton ouvrira
    expect(
      examinerScopeScalingo({
        nature: "jeton",
        usage: "catalogue-des-regions",
        region: "osc-fr1",
      }).refus,
    ).toEqual([expect.stringContaining("scope.region")]);

    // Then une application se nomme quand les chemins la nomment, et jamais autrement
    expect(
      examinerScopeScalingo({
        nature: "jeton",
        usage: "collaborateurs-d-une-application",
        region: "osc-fr1",
      }).refus,
    ).toEqual([expect.stringContaining("scope.application")]);
    expect(examinerScopeScalingo({ ...inventaire, application: "service-annuaire" }).refus).toEqual(
      [expect.stringContaining("scope.application")],
    );
    expect(
      examinerScopeScalingo({
        nature: "jeton",
        usage: "collaborateurs-d-une-application",
        region: "osc-fr1",
        application: "service-annuaire",
      }).refus,
    ).toEqual([]);

    // Then une application réduite à l'étoile est refusée par le schéma, avant tout examen.
    // C'est la forme et rien d'autre qui le tient : le périmètre d'un geste accepte du JSON
    // brut, `examinerJeton` ne regarde que la présence du champ, et le catalogue interpole
    // ce qu'on lui donne. Acceptée, elle mettait l'étoile en place du nom dans les quatre
    // chemins des collaborateurs, c'est-à-dire le joker de préfixe que le catalogue déclare
    // refuser en toutes lettres, et de quoi s'inviter collaborateur de n'importe quelle
    // application du compte puis se porter au rôle plein
    for (const nom of ["*", "mon-application/*", "../autre", "MonApplication", "-tiret", ""]) {
      expect(
        CONTRAT_SCALINGO.scopeSchema.safeParse({
          nature: "jeton",
          usage: "collaborateurs-d-une-application",
          region: "osc-fr1",
          application: nom,
        }).success,
      ).toBe(false);
    }

    // Then une région tordue l'est aussi, et le tort y est d'une autre nature : la région
    // devient l'hôte de la cible du blob, donc l'unique destination vers laquelle le proxy
    // relaiera le jeton de compte entier. `x.exemple.invalid/` rendait la cible
    // `https://api.x.exemple.invalid/.scalingo.com`, dont l'hôte effectif n'est pas
    // Scalingo : un credential durable et irrévocable lié à un tiers
    for (const region of ["x.exemple.invalid/", "*", "osc fr1", "osc-fr1.exemple", ""]) {
      expect(
        CONTRAT_SCALINGO.scopeSchema.safeParse({
          nature: "jeton",
          usage: "inventaire-d-une-region",
          region,
        }).success,
      ).toBe(false);
      expect(
        CONTRAT_SCALINGO.scopeSchema.safeParse({
          nature: "collaboration",
          region,
          application: "mon-application",
          role: "limited",
        }).success,
      ).toBe(false);
    }

    // Then la branche collaboration porte la même borne sur son application, où le nom entre
    // dans l'adresse du tableau de bord et dans le chemin que l'écriture appelle
    expect(
      CONTRAT_SCALINGO.scopeSchema.safeParse({
        nature: "collaboration",
        region: "osc-fr1",
        application: "*",
        role: "limited",
      }).success,
    ).toBe(false);

    // Then ce que Scalingo nomme réellement passe : minuscules, chiffres et tirets
    expect(
      CONTRAT_SCALINGO.scopeSchema.safeParse({
        nature: "jeton",
        usage: "collaborateurs-d-une-application",
        region: "osc-secnum-fr1",
        application: "service-annuaire-2",
      }).success,
    ).toBe(true);

    // Then une collaboration reste pesée par son rôle, et sa cible ignore ce rôle : deux
    // rôles sur une même application ne s'ajoutent pas, le second remplace le premier
    const collaboration = {
      nature: "collaboration" as const,
      region: "osc-fr1",
      application: "service-annuaire",
      role: "limited" as const,
    };
    expect(examinerScopeScalingo(collaboration)).toMatchObject({
      refus: [],
      risque: "medium",
      cible: "application:osc-fr1:service-annuaire",
    });
    expect(examinerScopeScalingo({ ...collaboration, role: "collaborator" })).toMatchObject({
      risque: "high",
      cible: "application:osc-fr1:service-annuaire",
    });
  });

  it("refuse un jeton sans terme, et le refus passe par le registre", () => {
    // Given le catalogue tel que le registre l'assemble, sans doublure d'examen
    const catalogue = catalogueDOctroi();

    // Then Scalingo y arrive avec son examen. Ce rattachement porte tout ce qui suit :
    // sans lui, un scope ne serait plus jugé au-delà de sa forme, et la règle du risque
    // élevé s'éteindrait sans qu'une seule ligne ne proteste
    expect(catalogue.find(({ key }) => key === "scalingo")?.examinerScope).toBeDefined();

    const profil = (scope: Record<string, unknown>, expiresInDays?: number): readonly Profil[] => [
      {
        key: "intendance",
        label: "Intendance du parc",
        accesses: [
          { system: "scalingo", scope, ...(expiresInDays === undefined ? {} : { expiresInDays }) },
        ],
      },
    ];

    const JETON = { nature: "jeton", usage: "catalogue-des-regions" };

    // When un profil demande un jeton sans échéance
    const sansTerme = verifierProfils(profil(JETON), catalogue);

    // Then il est refusé, et le refus nomme ce que le jeton sert et le champ à écrire :
    // rien ne révoque un jeton, son terme est la seule reprise qui existe
    expect(sansTerme).toHaveLength(1);
    expect(sansTerme[0]?.motif).toContain("un jeton restreint pour découvrir les régions");
    expect(sansTerme[0]?.motif).toContain("expiresInDays");

    // Then avec un terme il passe : la règle exige une échéance, elle n'interdit pas
    expect(verifierProfils(profil(JETON, 90), catalogue)).toEqual([]);

    // Then une incohérence que le schéma ne sait pas dire est refusée par le même chemin,
    // terme ou pas
    expect(
      verifierProfils(profil({ ...JETON, region: "osc-fr1" }, 90), catalogue)[0]?.motif,
    ).toContain("scope.region");

    // Then un profil qui a gardé l'ancienne forme, sans nature, est refusé sur ce champ :
    // c'est la rupture, et elle se dit là où un auteur de profil la lit
    expect(
      verifierProfils(
        profil({ region: "osc-fr1", application: "service-annuaire", role: "limited" }),
        catalogue,
      )[0]?.motif,
    ).toContain("scope.nature");
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

    // Then sur un octroi, un rôle qui ne correspond pas laisse l'étape à faire : elle se
    // corrigera en place. La déclarer en écart la sortirait pour toujours de la portée de
    // l'exécution, le socle n'exécutant jamais une étape dont le précheck a vu un écart
    const octroi = {
      ...ETAPE,
      capability: "grant" as const,
      action: "inviter-comme-collaborateur",
      params: { ...ETAPE.params, role: "limited" },
    };
    expect(await constaterCollaborateur(lire, octroi)).toEqual({ state: "READY" });
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

    // Given une étape dont la région n'est pas une région, telle qu'une étape figée en base
    // peut la porter sans repasser par le schéma qui borne sa forme
    const detournee = {
      ...ETAPE,
      params: { ...ETAPE.params, region: "x.exemple.invalid/" },
    };

    // Then elle est refusée avant toute lecture et avant toute écriture : le porteur employé
    // ici porte le compte entier, et il n'a rien à dire à un hôte qui n'est pas Scalingo
    expect(await executerScalingo(lire, ecrire, true, detournee, reel)).toMatchObject({
      state: "FAILED",
      retryable: false,
    });

    // Then aucun de ces refus n'a laissé partir le moindre appel
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

  it("corrige un rôle en place plutôt que de retirer la personne pour la réinviter", async () => {
    const reel = { ...CONTEXTE, dryRun: false };

    // Given le titulaire, collaborateur plein de l'application, et une étape d'octroi qui
    // n'ouvre que le rôle limité
    const octroi = {
      ...ETAPE,
      capability: "grant" as const,
      action: "inviter-comme-collaborateur",
      params: { ...ETAPE.params, beneficiaire: TITULAIRE.email, role: "limited" },
    };
    const { lire } = lecteur(ROSTER);

    // When le précheck passe : l'étape reste à faire, et c'est ce qui la rend exécutable.
    // Un écart la ferait sauter à chaque reprise, et le rôle ne se corrigerait jamais
    expect(await constaterCollaborateur(lire, octroi)).toEqual({ state: "READY" });

    // When l'écriture part
    const corrige = ecrivain({ statut: 200, corps: { collaborator: { is_limited: true } } });
    expect(await executerScalingo(lire, corrige.ecrire, true, octroi, reel)).toMatchObject({
      state: "SUCCEEDED",
      evidence: expect.stringContaining("en place"),
    });

    // Then un seul appel, et c'est un PATCH sur la collaboration existante : ni retrait,
    // ni réinvitation, qui feraient perdre une invitation acceptée et renverraient un
    // courriel pour un accès déjà détenu
    expect(corrige.appels).toEqual([
      {
        methode: "PATCH",
        url: `${FR}/v1/apps/service-annuaire/collaborators/collab-titulaire`,
        corps: { collaborator: { is_limited: true } },
      },
    ]);

    // Then l'identifiant visé est celui du relevé de l'instant, retrouvé sur l'adresse en
    // minuscules : il change dès qu'une invitation est retirée puis réémise, et le plan
    // n'en porte aucun
    const reemis = lecteur({
      [`${FR}/v1/apps/service-annuaire/collaborators`]: {
        collaborators: [
          { ...TITULAIRE, id: "collab-reemis", email: TITULAIRE.email.toUpperCase() },
        ],
      },
    });
    const apresReemission = ecrivain({ statut: 200, corps: undefined });
    await executerScalingo(reemis.lire, apresReemission.ecrire, true, octroi, reel);
    expect(apresReemission.appels[0]).toMatchObject({
      methode: "PATCH",
      url: `${FR}/v1/apps/service-annuaire/collaborators/collab-reemis`,
    });

    // Then le rôle déjà en place ne fait rien partir : l'étape est idempotente, et la
    // corriger vers ce qu'elle constate déjà serait une écriture pour rien
    const conforme = ecrivain({ statut: 200, corps: undefined });
    expect(
      await executerScalingo(
        lire,
        conforme.ecrire,
        true,
        { ...octroi, params: { ...octroi.params, role: "collaborator" } },
        reel,
      ),
    ).toEqual({ state: "ALREADY_PRESENT" });
    expect(conforme.appels).toEqual([]);

    // Then c'est bien ce relevé qui décide du geste, et non la planification, qui ne lit
    // aucun système : la même étape sur une adresse absente invite au lieu de corriger
    const absente = ecrivain({ statut: 201, corps: undefined });
    await executerScalingo(
      lire,
      absente.ecrire,
      true,
      { ...octroi, params: { ...octroi.params, beneficiaire: "nouvelle@exemple.invalid" } },
      reel,
    );
    expect(absente.appels).toEqual([
      {
        methode: "POST",
        url: `${FR}/v1/apps/service-annuaire/collaborators`,
        corps: { collaborator: { email: "nouvelle@exemple.invalid", is_limited: true } },
      },
    ]);

    // Then une collaboration disparue entre la lecture et l'écriture n'est ni un succès ni
    // une panne : la solder affirmerait un accès que plus personne ne détient, et l'étape
    // se reprend, la reprise invitant
    const evanouie = ecrivain({ statut: 404, corps: undefined });
    expect(await executerScalingo(lire, evanouie.ecrire, true, octroi, reel)).toMatchObject({
      state: "FAILED",
      retryable: true,
    });
    expect(evanouie.appels).toHaveLength(1);

    // Then les autres familles de réponses se lisent comme ailleurs : une panne se reprend,
    // un refus non
    expect(interpreterChangementDeRole(503, { error: "indisponible" })).toEqual({
      state: "FAILED",
      error: "Scalingo a répondu 503 : indisponible",
      retryable: true,
    });
    expect(interpreterChangementDeRole(403, undefined)).toMatchObject({ retryable: false });
  });
});

describe("ce qu'un jeton restreint ouvre, et ce qu'il n'ouvre jamais", () => {
  const LE_10 = new Date("2026-09-10T09:00:00Z");
  const SEPT_JOURS = new Date("2026-09-17T09:00:00Z");

  /** La moitié qui ne repasse jamais, telle que le proxy la rendrait. */
  const CLE_CLIENTE = "cle-cliente-de-test-qui-ne-doit-nulle-part-se-lire";

  function emetteur(reponse: JetonEmis | ErreurFgp): {
    emettre: EmissionDeJeton;
    demandes: DemandeDeJeton[];
  } {
    const demandes: DemandeDeJeton[] = [];
    return {
      emettre: (demande) => {
        demandes.push(demande);
        return reponse instanceof ErreurFgp ? Promise.reject(reponse) : Promise.resolve(reponse);
      },
      demandes,
    };
  }

  const SUJET: SubjectRef = {
    kind: "person",
    username: "nour.exemple",
    email: "nour.exemple@exemple.invalid",
  };

  /** La seule lecture que l'émission fasse d'elle-même : les régions que Scalingo sert. */
  const regionsVivantes = () => lecteur({ [`${AUTH}/v1/regions`]: REGIONS });

  const etapeDeJeton = (
    scope: Omit<ScopeJeton, "nature">,
    terme: Date | undefined,
    credentials = true,
  ): PlannedStep => {
    const [etape] = planifierJetonScalingo({ nature: "jeton", ...scope }, SUJET, credentials);
    if (!etape) {
      throw new Error("le connecteur devrait proposer une étape d'émission");
    }
    // Ce que le socle recolle avant l'appel, et lui seul : l'échéance vient du profil, pas
    // du connecteur, et la clé stockée porte l'identifiant du plan.
    return {
      ...etape,
      idempotencyKey: `${etape.idempotencyKey}:plan-0001`,
      ...(terme === undefined ? {} : { grantExpiresAt: terme }),
    };
  };

  it("n'émet que borné, sur une seule cible, et range ce qui est émis en deux moitiés", async () => {
    // Given une étape d'émission pour les collaborateurs d'une seule application, un terme
    // à sept jours porté par le socle, et un proxy doublé qui rend un blob et une clé
    const etape = etapeDeJeton(
      {
        usage: "collaborateurs-d-une-application",
        region: "osc-fr1",
        application: "mon-application",
      },
      SEPT_JOURS,
    );
    const { emettre, demandes } = emetteur({ blob: "blob-opaque", cle: CLE_CLIENTE });
    const regions = regionsVivantes();

    // When on exécute
    const issue = await executerEmissionScalingo(regions.lire, emettre, "jeton-de-compte", etape, {
      ...CONTEXTE,
      now: LE_10,
      dryRun: false,
    });

    // Then la région a été confrontée à celles que le fournisseur annonce avant toute
    // émission : la liste blanche ne borne qu'une forme, et une forme valable désigne aussi
    // bien une région que personne ne sert
    expect(regions.appels).toEqual([`${AUTH}/v1/regions`]);

    // Then une seule demande est partie, vers l'API de la région et non vers l'hôte
    // d'authentification : un blob ne porte qu'une cible, et se tromper d'hôte donnerait un
    // jeton qui n'ouvre rien
    expect(demandes).toHaveLength(1);
    expect(demandes[0]?.cible).toBe("https://api.osc-fr1.scalingo.com");
    expect(demandes[0]?.cible).not.toBe(AUTH);

    // Then ses scopes sont exactement les quatre chemins de l'usage, tous sous les
    // collaborateurs de l'application nommée
    expect(demandes[0]?.scopes).toEqual([
      "GET:/v1/apps/mon-application/collaborators",
      "POST:/v1/apps/mon-application/collaborators",
      "PATCH:/v1/apps/mon-application/collaborators/*",
      "DELETE:/v1/apps/mon-application/collaborators/*",
    ]);

    // Then aucun joker de préfixe sur `/v1/apps` : le motif y matcherait tout ce qui pend
    // sous une application, à commencer par ses variables d'environnement, c'est-à-dire
    // exactement ce que le rôle limité ne voit pas
    for (const chemin of demandes[0]?.scopes ?? []) {
      // Le seul joker admis porte sur l'identifiant de collaboration, dernier segment sous
      // `collaborators` : tout autre élargissement ouvrirait ce qui pend sous l'application
      expect(chemin).toMatch(
        /^(?:GET|POST|PATCH|DELETE):\/v1\/apps\/mon-application\/collaborators(?:\/\*)?$/u,
      );
    }

    // Then le terme se compte en secondes, et n'est jamais nul : le proxy traite zéro comme
    // « pas d'expiration », et rien ne saurait reprendre un jeton qui n'expire pas
    expect(demandes[0]?.secondes).toBe(7 * 24 * 60 * 60);
    expect(demandes[0]?.secondes).toBeGreaterThan(0);

    // Then l'étape réussit et remet un credential dont la moitié à garder est celle que le
    // proxy a rendue, et la moitié à remettre est la clé cliente
    expect(issue.state).toBe("SUCCEEDED");
    const remis = issue.state === "SUCCEEDED" ? issue.credential : undefined;
    expect(remis).toMatchObject({
      provider: "scalingo",
      ownerUsername: "nour.exemple",
      blob: "blob-opaque",
      target: "https://api.osc-fr1.scalingo.com",
      expiresAt: SEPT_JOURS,
      aRemettre: CLE_CLIENTE,
    });
    expect(remis?.scopes).toEqual(demandes[0]?.scopes);
    // Dérivée de la clé d'idempotence stockée, qui porte l'identifiant du plan : une
    // réémission après un échec ambigu écrit une seconde fiche au lieu d'écraser la première
    expect(remis?.key).toContain("plan-0001");

    // Then la clé cliente n'entre dans rien qui parte au journal : `evidence` en devient le
    // motif, dans un journal en écriture seule à rétention indéfinie
    const versLeJournal = JSON.stringify({ ...issue, credential: undefined });
    expect(versLeJournal).not.toContain(CLE_CLIENTE);
    expect(issue.state === "SUCCEEDED" ? issue.evidence : "").not.toContain(CLE_CLIENTE);

    // When la même étape ne porte aucun terme
    const sansTerme = emetteur({ blob: "jamais", cle: "jamais" });
    const refus = await executerEmissionScalingo(
      regionsVivantes().lire,
      sansTerme.emettre,
      "jeton-de-compte",
      etapeDeJeton(
        {
          usage: "collaborateurs-d-une-application",
          region: "osc-fr1",
          application: "mon-application",
        },
        undefined,
      ),
      { ...CONTEXTE, now: LE_10, dryRun: false },
    );

    // Then rien n'est parti, et le refus dit que rien n'a été émis : c'est la garde de
    // dernier ressort, celle que le geste hors dossier rejoue faute de passer par le socle
    expect(sansTerme.demandes).toEqual([]);
    expect(refus).toMatchObject({ state: "FAILED", retryable: false });
    expect(refus.state === "FAILED" ? refus.error : "").toContain("Rien n'a été émis");
  });

  it("dit ce qui n'a pas pu s'émettre sans jamais réessayer", async () => {
    const reel = { ...CONTEXTE, now: LE_10, dryRun: false };
    const etape = etapeDeJeton({ usage: "catalogue-des-regions" }, SEPT_JOURS);

    // Then l'hôte d'un usage global est celui de l'authentification, et il ne porte pas de
    // région : deux usages, deux émissions, deux termes
    expect(etape.params["cible"]).toBe(AUTH);
    expect(etape.params["scopes"]).toEqual(["GET:/v1/regions", "GET:/v1/users/self"]);

    // Given un proxy qui refuse le corps avant d'avoir chiffré quoi que ce soit
    const refuse = emetteur(new ErreurFgp(400, true, "400 Bad Request"));
    const rejet = await executerEmissionScalingo(
      regionsVivantes().lire,
      refuse.emettre,
      "jeton-de-compte",
      etape,
      reel,
    );

    // Then l'échec ne se reprend pas, et il affirme que rien n'a été émis
    expect(rejet).toMatchObject({ state: "FAILED", retryable: false });
    expect(rejet.state === "FAILED" ? rejet.error : "").toContain("Rien n'a été émis");

    // Given un proxy qui expire au lieu de répondre : le doute ne se lèvera jamais, aucune
    // route d'introspection n'existant
    const muet = emetteur(new ErreurFgp(null, false, "The operation was aborted due to timeout"));
    const perdu = await executerEmissionScalingo(
      regionsVivantes().lire,
      muet.emettre,
      "jeton-de-compte",
      etape,
      reel,
    );

    // Then l'échec ne se reprend pas davantage, et il dit ce qu'il ne sait pas : un jeton a
    // pu naître, rien ne le liste, rien ne le révoque
    expect(perdu).toMatchObject({ state: "FAILED", retryable: false });
    const dit = perdu.state === "FAILED" ? perdu.error : "";
    expect(dit).toContain("Un jeton a pu naître");
    expect(dit).toContain("rien ne le révoque");
    expect(dit).not.toContain("Rien n'a été émis");

    // When la simulation est le régime, ce qui est le défaut du produit
    const enSimulation = emetteur({ blob: "jamais", cle: "jamais" });
    await expect(
      executerEmissionScalingo(
        regionsVivantes().lire,
        enSimulation.emettre,
        "jeton-de-compte",
        etape,
        CONTEXTE,
      ),
    ).rejects.toThrow(/ACTIONS_ENABLED/u);

    // Then l'émetteur n'a rien reçu : le refus précède la lecture de ce que l'étape demande,
    // parce que ce qui ne part pas ne peut pas partir par erreur
    expect(enSimulation.demandes).toEqual([]);

    // Given une étape dont la cible n'est pas un hôte Scalingo, telle qu'une étape figée en
    // base pourrait la porter sans repasser par le schéma qui borne la forme d'une région
    const detournee = emetteur({ blob: "jamais", cle: "jamais" });
    const versUnTiers = await executerEmissionScalingo(
      regionsVivantes().lire,
      detournee.emettre,
      "jeton-de-compte",
      {
        ...etape,
        params: { ...etape.params, cible: "https://api.x.exemple.invalid/.scalingo.com" },
      },
      reel,
    );

    // Then rien ne part, et le refus est définitif : ce qu'un blob porte est l'unique
    // destination vers laquelle le proxy relaiera le jeton de compte entier, et cette
    // liaison survit à la session sans qu'aucune route ne sache la reprendre
    expect(versUnTiers).toMatchObject({ state: "FAILED", retryable: false });
    expect(versUnTiers.state === "FAILED" ? versUnTiers.error : "").toContain(
      "aucun hôte Scalingo",
    );
    expect(detournee.demandes).toEqual([]);

    // When le jeton de compte manque, qui est ce que le proxy échange
    const sansJeton = emetteur({ blob: "jamais", cle: "jamais" });
    expect(
      await executerEmissionScalingo(
        regionsVivantes().lire,
        sansJeton.emettre,
        undefined,
        etape,
        reel,
      ),
    ).toMatchObject({ state: "FAILED", retryable: false });
    expect(sansJeton.demandes).toEqual([]);

    // Then l'étape sort automatique quand les deux credentials répondent, et manuelle sinon :
    // l'un chiffre le blob, l'autre dit vers quel proxy partir
    expect(etape.tier).toBe("auto");
    expect(etapeDeJeton({ usage: "catalogue-des-regions" }, SEPT_JOURS, false).tier).toBe("manual");

    // Then la voie manuelle garde son critère de complétion, qui nomme le blob à rapporter,
    // la fiche à saisir et le terme à y poser : il reste une marche à suivre, pas un trou
    expect(etape.manual?.doneWhen).toContain("blob");
    expect(etape.manual?.doneWhen).toContain("Comptes de service");
    expect(etape.manual?.doneWhen).toContain("terme");

    // Then la capacité déclare cette voie, et elle est la seule à exiger les deux : sans
    // l'adresse du proxy, l'octroi reste automatique pour une collaboration
    expect(CONTRAT_SCALINGO.capabilities.grant?.[0]?.requires).toEqual([
      "scalingo:api",
      "scalingo:fgp",
    ]);

    // Given une région dont la forme est valable et que le fournisseur n'annonce pas, telle
    // qu'une étape figée en base pourrait la porter
    const inventee = emetteur({ blob: "jamais", cle: "jamais" });
    const regions = regionsVivantes();
    const horsRegion = await executerEmissionScalingo(
      regions.lire,
      inventee.emettre,
      "jeton-de-compte",
      etapeDeJeton({ usage: "inventaire-d-une-region", region: "osc-fr9" }, SEPT_JOURS),
      reel,
    );

    // Then rien ne part, et le refus est définitif : un blob lie le jeton de compte entier à
    // cet hôte jusqu'à son terme, et aucune route ne sait le reprendre
    expect(horsRegion).toMatchObject({ state: "FAILED", retryable: false });
    expect(horsRegion.state === "FAILED" ? horsRegion.error : "").toContain("osc-fr1");
    expect(inventee.demandes).toEqual([]);

    // Given une liste de régions qu'on ne sait pas lire
    const aveugle = emetteur({ blob: "jamais", cle: "jamais" });
    const sansListe = await executerEmissionScalingo(
      lecteur({}).lire,
      aveugle.emettre,
      "jeton-de-compte",
      etapeDeJeton({ usage: "inventaire-d-une-region", region: "osc-fr1" }, SEPT_JOURS),
      reel,
    );

    // Then rien ne part non plus, mais l'étape se reprend : ne pas savoir quelles régions
    // existent n'autorise pas à conclure que celle-ci n'existe pas
    expect(sansListe).toMatchObject({ state: "FAILED", retryable: true });
    expect(aveugle.demandes).toEqual([]);

    // Then l'émission elle-même refuse sans appeler personne, la génération n'existant pas
    // hors ligne : le sel du serveur n'est exposé par aucune route
    await expect(
      emettreUnJeton({
        jeton: "jeton-de-compte",
        cible: AUTH,
        scopes: ["GET:/v1/regions"],
        secondes: 60,
        nom: "essai",
      }),
    ).rejects.toMatchObject({ statut: null, aucunBlob: true });
  });

  it("exige une échéance sans une ligne de règle nouvelle, et la pose sur l'étape", async () => {
    // Given le catalogue d'octroi tel que le socle l'assemble, avec le vrai connecteur
    const catalogue = await catalogueOctroyeur();
    const scalingoOctroyeur = catalogue.find(({ key }) => key === "scalingo");
    if (!scalingoOctroyeur) {
      throw new Error("le catalogue devrait porter scalingo");
    }

    const JETON = { nature: "jeton", usage: "inventaire-d-une-region", region: "osc-fr1" };
    const profil = (expiresInDays?: number): Profil => ({
      key: "intendance",
      label: "Intendance du parc",
      accesses: [
        {
          system: "scalingo",
          scope: JETON,
          ...(expiresInDays === undefined ? {} : { expiresInDays }),
        },
      ],
    });

    // Then l'étape que le connecteur propose porte un risque élevé sans condition : c'est
    // d'elle que l'échéance obligatoire découle, et non d'une règle écrite pour les jetons
    const proposees = scalingoOctroyeur.planifier(JETON, SUJET);
    expect(proposees).toHaveLength(1);
    expect(proposees[0]?.riskLevel).toBe("high");
    expect(proposees[0]?.capability).toBe("grant");

    // When un profil demande ce jeton sans échéance
    const sansTerme = assemblerOctrois(profil(), catalogue, SUJET, LE_10);

    // Then rien ne sort, et le refus nomme le champ à écrire : la règle existante sur les
    // accès à risque élevé suffit, elle n'a rien appris de neuf
    expect(sansTerme.etapes).toEqual([]);
    expect(sansTerme.refus).toHaveLength(1);
    expect(sansTerme.refus[0]?.motif).toContain("expiresInDays");

    // When le profil borne l'accès à sept jours
    const borne = assemblerOctrois(profil(7), catalogue, SUJET, LE_10);

    // Then l'étape sort, et c'est le socle qui pose son terme, jamais le connecteur
    expect(borne.refus).toEqual([]);
    expect(borne.etapes).toHaveLength(1);
    expect(borne.etapes[0]?.grantExpiresAt).toEqual(echeanceDOctroi(7, LE_10));

    // Then elle porte une clé d'engagement, parce que ce qu'elle ouvre ne reparaîtra dans
    // aucun relevé : aucune API de Scalingo ne liste les blobs d'un proxy qui n'en garde
    // aucun. Une étape de collaboration, que la collecte relit, n'en porte pas
    expect(borne.etapes[0]?.engagementKey).toBe(
      "scalingo:jeton:inventaire-d-une-region:osc-fr1:nour.exemple",
    );
    const collaboration = assemblerOctrois(
      {
        key: "developpeuse",
        label: "Développeuse",
        accesses: [
          {
            system: "scalingo",
            scope: {
              nature: "collaboration",
              region: "osc-fr1",
              application: "mon-application",
              role: "limited",
            },
            expiresInDays: 90,
          },
        ],
      },
      catalogue,
      SUJET,
      LE_10,
    );
    expect(collaboration.refus).toEqual([]);
    expect(collaboration.etapes[0]?.engagementKey).toBeUndefined();
  });

  it("propose au départ la reprise de chaque jeton, et interdit de tourner le jeton de compte", () => {
    // Given un engagement ouvert par une émission, tel que le socle le rend au connecteur
    const engagement = {
      key: "scalingo:jeton:inventaire-d-une-region:osc-fr1:nour.exemple",
      label: "Émettre un jeton restreint pour nour.exemple",
      params: { usage: "inventaire-d-une-region" },
      expiresAt: SEPT_JOURS,
      openedAt: LE_10,
    };

    // When le départ se calcule sans aucun accès constaté : un engagement peut exister sans
    // qu'aucun compte ne soit observé, et c'est le trou muet que la clé existe pour boucher
    const etapes = planifierDepartScalingo("nour.exemple", [], undefined, true, [engagement]);

    const reprise = etapes.find(({ action }) => action === "reprendre-un-jeton-restreint");
    if (!reprise) {
      throw new Error("le départ devrait proposer la reprise du jeton");
    }

    // Then elle est manuelle et porte le second regard : aucune lecture ne peut démentir ce
    // qui en sera déclaré, le proxy n'offrant ni révocation ni introspection
    expect(reprise.tier).toBe("manual");
    expect(reprise.riskLevel).toBe("high");
    expect(reprise.expectedActor).toBe("OPERATOR");
    expect(reprise.validationBy).toBe("OPERATOR");
    expect(reprise.idempotencyKey).toBe(
      `scalingo:reprise:${engagement.key}:${LE_10.toISOString()}`,
    );

    // Then deux émissions sous la même clé d'engagement donnent deux reprises distinctes, et
    // c'est l'instant d'ouverture qui les sépare : une émission n'est pas idempotente, deux
    // blobs vivent alors là-bas avec chacun son terme, et une seule étape ne nommerait qu'un
    // des deux termes en soldant l'autre avant l'heure
    const deuxJetons = planifierDepartScalingo("nour.exemple", [], undefined, true, [
      engagement,
      {
        ...engagement,
        openedAt: new Date("2026-09-01T09:00:00Z"),
        expiresAt: new Date("2026-11-30T09:00:00Z"),
      },
    ]).filter(({ action }) => action === "reprendre-un-jeton-restreint");
    expect(deuxJetons).toHaveLength(2);
    expect(new Set(deuxJetons.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2);
    expect(deuxJetons[1]?.manual?.doneWhen).toContain("2026-11-30");

    // Then son critère de complétion ne peut être que le terme, et il le dit
    expect(reprise.manual?.doneWhen).toContain("2026-09-17");
    expect(reprise.manual?.doneWhen).toContain("aucune émission nouvelle");
    expect(reprise.manual?.doneWhen).toContain("ni révocation ni introspection");

    // Then son runbook porte l'interdiction, parce que c'est le premier réflexe de qui
    // découvre qu'un jeton ne se révoque pas
    expect(reprise.manual?.runbook).toContain("Ne pas faire tourner le jeton d'API Scalingo");
    expect(reprise.manual?.runbook).toContain("la lecture nocturne");

    // Then un engagement d'un autre connecteur ne lui appartient pas : la clé n'a de sens
    // que pour celui qui l'a écrite, et il est le seul à la relire
    expect(
      planifierDepartScalingo("nour.exemple", [], undefined, true, [
        { ...engagement, key: "github:jeton:organisation:nour.exemple" },
      ]).some(({ action }) => action === "reprendre-un-jeton-restreint"),
    ).toBe(false);

    // Then sans engagement, le départ ne change pas : les jetons sont la seule chose qu'il
    // gagne ici
    expect(
      planifierDepartScalingo("nour.exemple", [], undefined, true).map(({ action }) => action),
    ).toEqual(["retirer-des-collaborateurs", "renouveler-les-secrets"]);
  });
});

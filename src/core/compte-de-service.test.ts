import { describe, expect, it } from "vitest";

import {
  cleProposee,
  enKebab,
  fragmentDAdresse,
  libellePropose,
  lireDeclaration,
  propositionDeMachine,
  REVUE_PAR_DEFAUT,
} from "./compte-de-service";

/**
 * Cette lecture existe pour être la même aux deux endroits qui déclarent un compte
 * machine : l'écran des comptes de service, et la file des comptes isolés quand un
 * compte constaté fait découvrir la machine qui le détient. La régression que ce
 * scénario épingle n'est pas un refus manquant, c'est la divergence : un écran qui
 * accepterait ce que l'autre refuse laisserait passer, par la porte la moins fréquentée,
 * exactement ce que la première garde.
 */

const COMPLETE = {
  key: "bot-de-deploiement",
  label: "Bot de déploiement",
  purpose: "Déploie les applications de l'incubateur",
  ownerUsername: "claire.durand",
  reviewEveryDays: REVUE_PAR_DEFAUT,
  provider: "scalingo",
};

const SYSTEMES = ["github", "notion", "scalingo"];

/** L'instant d'où le terme se juge, fixé pour que les deux bornes soient reproductibles. */
const MAINTENANT = new Date("2026-09-17T09:00:00Z");

const JOUR_MS = 24 * 60 * 60 * 1000;

const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR_MS);

const lire = (brut: typeof COMPLETE & { expiresAt?: string }) =>
  lireDeclaration(brut, SYSTEMES, MAINTENANT);

describe("la saisie d'un compte de service", () => {
  it("passe entière et détourée, et se refuse dès qu'un des quatre dits manque", () => {
    // Given une saisie complète, dont les bords portent les espaces qu'un copier-coller
    // emporte toujours.
    const lu = lire({
      ...COMPLETE,
      key: "  bot-de-deploiement  ",
      ownerUsername: " claire.durand ",
    });

    // Then elle passe, détourée : une clé qui garde son espace ne se retrouve plus, ni
    // par le rattachement d'un compte isolé, ni par qui la cherche dans la liste.
    expect(lu).toEqual({ declaration: COMPLETE });

    // Then chacun des quatre champs dits est exigé, y compris quand il n'est fait que
    // d'espaces : un libellé vide donne une ligne qu'on ne sait plus identifier.
    for (const vide of ["key", "label", "purpose"] as const) {
      expect(lire({ ...COMPLETE, [vide]: "   " })).toHaveProperty("erreur");
    }

    // Then le propriétaire a son propre refus, et il dit pourquoi : c'est lui, avec la
    // revue, qui rend un accès permanent non humain gouvernable. Un message commun
    // laisserait croire à un champ administratif de plus.
    const sansProprietaire = lire({ ...COMPLETE, ownerUsername: "" });
    expect(sansProprietaire).toHaveProperty("erreur");
    expect("erreur" in sansProprietaire && sansProprietaire.erreur).toContain("répond");
  });

  it("refuse toute revue qui ne se compterait pas en jours entiers positifs", () => {
    // Given les trois formes qu'une périodicité prend quand la saisie a dérapé : zéro,
    // négative, ou non entière. Un champ de nombre vide rend NaN, pas une absence.
    for (const revue of [0, -1, 1.5, Number.NaN]) {
      // Then elle est refusée. Zéro est le cas qui coûte : il poserait une revue due
      // chaque jour, un badge rouge que rien ne peut plus éteindre, et un signal qui ne
      // s'éteint jamais finit par ne plus rien signaler.
      expect(lire({ ...COMPLETE, reviewEveryDays: revue })).toHaveProperty("erreur");
    }

    // Then un seul jour passe : c'est court, mais c'est une décision, pas une erreur de
    // saisie, et rien ici n'a autorité pour dire combien de temps un bot se garde.
    expect(lire({ ...COMPLETE, reviewEveryDays: 1 })).toEqual({
      declaration: { ...COMPLETE, reviewEveryDays: 1 },
    });
  });

  it("borne le terme des deux côtés, parce qu'un terme posé éteint la revue et qu'aucun écran ne le corrige", () => {
    // Given l'absence de terme, qui est le cas ordinaire d'un compte machine : la
    // périodicité décide seule, et la fiche ne porte pas le champ.
    expect(lire({ ...COMPLETE, expiresAt: "" })).toEqual({ declaration: COMPLETE });
    expect(lire(COMPLETE)).toEqual({ declaration: COMPLETE });

    // Then un terme à venir passe, et il monte dans la déclaration : c'est la seule
    // reprise qui existe pour un jeton émis, faute de révocation chez le proxy.
    expect(lire({ ...COMPLETE, expiresAt: dans(30).toISOString() })).toEqual({
      declaration: { ...COMPLETE, expiresAt: dans(30) },
    });

    // Then une date illisible est refusée plutôt que repliée sur « aucun terme » : le
    // silence est ce qui rendrait la fiche indétectable.
    expect(lire({ ...COMPLETE, expiresAt: "le mois prochain" })).toHaveProperty("erreur");

    // Then un terme déjà passé est refusé : la fiche naîtrait « terme passé », donc
    // sans revue et sans rien à reprendre, ce qui ne décrit aucun jeton vivant.
    const passe = lire({ ...COMPLETE, expiresAt: dans(-1).toISOString() });
    expect("erreur" in passe && passe.erreur).toContain("déjà passé");

    // Then un terme trop lointain est refusé, et c'est le refus qui coûte : un terme non
    // nul fait dire « à jour » au calcul de revue et retire le bouton, aucun écran
    // n'édite cette colonne, et la saisie de travers serait donc irréversible depuis
    // l'interface. C'est le défaut miroir de la périodicité zéro, refusée juste au-dessus.
    const tropLoin = lire({ ...COMPLETE, expiresAt: dans(401).toISOString() });
    expect("erreur" in tropLoin && tropLoin.erreur).toContain("400");

    // Then la borne est bien au jour près, et non à l'année : la veille du plafond passe.
    expect(lire({ ...COMPLETE, expiresAt: dans(399).toISOString() })).toEqual({
      declaration: { ...COMPLETE, expiresAt: dans(399) },
    });
  });
});

describe("la clé proposée pour un compte constaté", () => {
  it("détoure une adresse de son extension, et compose sans jamais perdre le système", () => {
    // Given l'adresse d'un bot sur un domaine d'incubateur.
    // Then le fragment garde ce qui distingue et laisse l'extension, qui ne distingue
    // rien entre deux comptes du même domaine et allonge la lecture pour rien.
    expect(fragmentDAdresse("bot@incubateur.ademe.fr")).toBe("bot-incubateur-ademe");

    // Then un domaine sans extension garde tout : le retirer laisserait un fragment qui
    // ne dit plus d'où vient le compte.
    expect(fragmentDAdresse("bot@localhost")).toBe("bot-localhost");

    // Then la composition met le système devant, toujours : c'est ce qui rend une clé
    // lisible seule dans une liste où trois systèmes se mélangent.
    expect(cleProposee("notion", "bot-incubateur-ademe")).toBe("notion-bot-incubateur-ademe");

    // Then un compte que rien n'identifie ne reçoit pas de clé inventée, seulement le nom
    // du système. La saisie la complète, et c'est le bon moment pour s'en apercevoir :
    // une clé est ce sur quoi un rattachement se fait ensuite.
    expect(cleProposee("github", "")).toBe("github");

    // Then le détourage vaut aussi pour ce qu'on lui passe : un fragment déjà sale ne
    // doit pas produire une clé à deux tirets ou à accent, qu'on ne retrouverait plus.
    expect(cleProposee("notion", " Équipe  Données ")).toBe("notion-equipe-donnees");
    expect(enKebab("m--marceau_")).toBe("m-marceau");

    // Then le libellé garde le compte tel qu'il se lit chez lui : c'est la colonne qu'on
    // parcourt, et une clé remise en mots y perdrait l'adresse réelle, seule chose qui
    // permette de reconnaître le compte sans l'ouvrir.
    expect(libellePropose("Notion", "bot@incubateur.ademe.fr")).toBe(
      "Notion · bot@incubateur.ademe.fr",
    );
  });
});

describe("le système d'un compte de service", () => {
  it("est exigé et doit être servi par un connecteur", () => {
    // Then un système qu'aucun connecteur ne sert est refusé : la fiche d'un système
    // liste ses comptes machine, et celui-là n'a aucune fiche où les montrer.
    const inconnu = lire({ ...COMPLETE, provider: "heroku" });
    expect("erreur" in inconnu && inconnu.erreur).toContain("heroku");

    // Then son absence a son propre message : « aucun système ne porte la clé "" » se
    // lirait comme un défaut de l'outil plutôt que comme un champ à remplir.
    const absent = lire({ ...COMPLETE, provider: "" });
    expect("erreur" in absent && absent.erreur).toBe(
      "Indiquez le système auquel ce compte appartient.",
    );
  });
});

describe("ce qu'un compte constaté remplit tout seul", () => {
  it("compose les cinq champs déductibles, et laisse l'usage à qui déclare", () => {
    // Given un système dont le connecteur réduit les adresses, et un compte relevé chez lui.
    const notion = {
      key: "notion",
      label: "Notion",
      accountSlug: ({ handle }: { handle: string }) => fragmentDAdresse(handle),
    };

    // When on prépare la déclaration, au nom de qui regarde.
    const proposition = propositionDeMachine(
      notion,
      { handle: "bot@incubateur.ademe.fr", externalId: "u-1" },
      "operatrice.exemple",
    );

    // Then la clé porte son système en tête. Sans ce préfixe, deux comptes du même nom sur
    // deux systèmes se disputeraient la même clé, et aucune ne dirait plus d'où elle vient.
    expect(proposition).toEqual({
      provider: "notion",
      systemeLibelle: "Notion",
      key: "notion-bot-incubateur-ademe",
      label: "Notion · bot@incubateur.ademe.fr",
      ownerUsername: "operatrice.exemple",
      reviewEveryDays: REVUE_PAR_DEFAUT,
    });

    // Then rien n'y propose d'usage : c'est le seul champ que la saisie doit arracher, et
    // un défaut l'aurait rempli d'une phrase que personne ne relit.
    expect(proposition).not.toHaveProperty("purpose");
  });
});

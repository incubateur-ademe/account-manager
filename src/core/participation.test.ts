import { describe, expect, it } from "vitest";

import {
  type Acteur,
  combinaisonValide,
  type EtatDossier,
  type EtatValidation,
  peutPointer,
  roleSurDossier,
} from "./dossier";
import type { FicheManuelle } from "./fiche-manuelle";
import { candidateUsernames } from "./identite";
import {
  adresseRecevable,
  type CandidatAdresse,
  canalDuDroit,
  canalMenace,
  DUREE_DEFAUT_JOURS,
  DUREE_MAX_JOURS,
  echeanceDOctroi,
  etapesAControlerPar,
  etapesVisiblesPour,
  participationVivante,
  voieDeConnexion,
} from "./participation";

const MAINTENANT = new Date("2026-09-01T10:00:00Z");
const JOUR = 24 * 60 * 60 * 1000;

const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR);

const droit = (over: { expiresAt?: Date; revokedAt?: Date | null } = {}) => ({
  expiresAt: dans(DUREE_DEFAUT_JOURS),
  revokedAt: null,
  ...over,
});

const DECLARES_LOCAUX = ["prestataire.exemple"];
const ALLOWLISTS = { operateurs: ["camille.roy"], breakGlass: ["secours.exemple"] };
const DOMAINES_MENACES = ["beta.gouv.fr", "ademe.fr"];

const fiche = (over: Partial<FicheManuelle> = {}): FicheManuelle => ({
  username: "lead.exemple",
  source: "LOCAL",
  usernameFabricated: true,
  ...over,
});

const candidat = (over: Partial<CandidatAdresse> = {}): CandidatAdresse => ({
  personId: "personne-lead",
  fiche: fiche(),
  origine: "FICHE",
  adresse: "lead.exemple@exemple.org",
  ...over,
});

const refus = (resultat: ReturnType<typeof adresseRecevable>) =>
  resultat.recevable ? null : resultat.refus;

describe("le droit de participer à un dossier", () => {
  it("n'ouvre que vivant, sur un dossier vivant, et son échéance vaut révocation", () => {
    // Given un droit accordé pour la durée par défaut, sur un dossier confirmé
    expect(participationVivante(droit(), "CONFIRMED", MAINTENANT)).toBe(true);

    // Then l'état du dossier se lit sur les cinq valeurs de l'énumération et non sur
    // une liste écrite ici : la prochaine valeur ajoutée fera tomber le typecheck
    // plutôt que d'ouvrir en silence.
    const ouvre: Record<EtatDossier, boolean> = {
      WATCH: true,
      CANDIDATE: true,
      CONFIRMED: true,
      CANCELLED: false,
      DONE: false,
    };
    for (const [etat, attendu] of Object.entries(ouvre) as [EtatDossier, boolean][]) {
      expect(participationVivante(droit(), etat, MAINTENANT)).toBe(attendu);
    }

    // Et un dossier annulé ne laisse pas plus passer qu'un dossier clos : lire la
    // règle par un littéral aurait laissé le premier ouvert.
    expect(participationVivante(droit(), "CANCELLED", MAINTENANT)).toBe(false);

    // Then l'octroi, lui, refusera « WATCH » alors que la lecture l'accepte : un
    // départ soupçonné et pas décidé se divulgue à qui on y donne accès. Les deux
    // règles ne disent pas la même chose, et celle-ci n'est que la lecture.
    expect(participationVivante(droit(), "WATCH", MAINTENANT)).toBe(true);

    // When le droit est révoqué à la main, Then il n'ouvre plus rien, sur aucun état
    const revoque = droit({ revokedAt: dans(1) });
    for (const etat of Object.keys(ouvre) as EtatDossier[]) {
      expect(participationVivante(revoque, etat, MAINTENANT)).toBe(false);
    }

    // When l'échéance est passée, Then elle vaut exactement une révocation, et
    // l'instant même de l'échéance ferme déjà : un droit qui expire à midi n'ouvre
    // pas à midi.
    expect(participationVivante(droit({ expiresAt: dans(-1) }), "CONFIRMED", MAINTENANT)).toBe(
      false,
    );
    expect(participationVivante(droit({ expiresAt: MAINTENANT }), "CONFIRMED", MAINTENANT)).toBe(
      false,
    );
    expect(
      participationVivante(
        droit({ expiresAt: new Date(MAINTENANT.getTime() + 1) }),
        "CONFIRMED",
        MAINTENANT,
      ),
    ).toBe(true);
  });

  it("borne la durée d'un octroi aux deux bouts, et propose moins que le plafond", () => {
    // Given deux durées, et l'écart entre elles est la règle : un plafond qui serait
    // aussi le défaut ferait proposer le maximum par le formulaire, et personne ne le
    // baisserait.
    expect(DUREE_DEFAUT_JOURS).toBeLessThan(DUREE_MAX_JOURS);

    // Then la durée par défaut pose une échéance à autant de jours de l'octroi
    expect(echeanceDOctroi(MAINTENANT, DUREE_DEFAUT_JOURS)).toEqual(dans(DUREE_DEFAUT_JOURS));
    expect(echeanceDOctroi(MAINTENANT, DUREE_MAX_JOURS)).toEqual(dans(DUREE_MAX_JOURS));

    // Then les quatre refus sont des gardes et non des suppositions : le plafond, mais
    // aussi zéro et le négatif, qui poseraient une échéance déjà atteinte, c'est-à-dire
    // un droit inutilisable écrit en base sans que rien n'ait prévenu. Une requête
    // forgée suffit à les demander, l'écran n'est pas la garde.
    expect(echeanceDOctroi(MAINTENANT, DUREE_MAX_JOURS + 1)).toBeNull();
    expect(echeanceDOctroi(MAINTENANT, 0)).toBeNull();
    expect(echeanceDOctroi(MAINTENANT, -3)).toBeNull();
    expect(echeanceDOctroi(MAINTENANT, 1.5)).toBeNull();
    expect(echeanceDOctroi(MAINTENANT, Number.NaN)).toBeNull();
  });
});

describe("par quelle porte quelqu'un se présente", () => {
  it("route sur l'arobase, et refuse avant le paquet ce qui le ferait lever", () => {
    // Given un écran de connexion à un seul champ : c'est l'arobase qui route, pas la
    // personne, à qui on ne demande pas de savoir comment l'outil est construit.
    expect(voieDeConnexion("camille.roy")).toBe("ESPACE_MEMBRE");
    expect(voieDeConnexion("lead.exemple@exemple.org")).toBe("ADRESSE");
    expect(voieDeConnexion("  Lead.Exemple@Exemple.ORG  ")).toBe("ADRESSE");

    // Then rien ne sort des formes que le normalisateur du paquet refuse : une
    // exception remontée de là-bas vaut un message distinct, donc un oracle sur ce que
    // l'outil connaît.
    expect(voieDeConnexion("")).toBeNull();
    expect(voieDeConnexion("   ")).toBeNull();
    expect(voieDeConnexion("lead@exemple.org@ailleurs.org")).toBeNull();
    expect(voieDeConnexion('"lead"@exemple.org')).toBeNull();
    expect(voieDeConnexion("lead@")).toBeNull();
    expect(voieDeConnexion("@exemple.org")).toBeNull();
    expect(voieDeConnexion("lead@,exemple.org")).toBeNull();

    // Et un homoglyphe d'arobase ne passe pas pour un identifiant : le paquet
    // normalise en NFKC avant de compter les arobases, et cette fonction fait de même.
    expect(voieDeConnexion("lead.exemple＠exemple.org")).toBe("ADRESSE");
  });

  it("n'ouvre l'adresse qu'aux fiches que personne ne réécrit, sauf canal déclaré", () => {
    // Given quatre familles de fiches, et une seule que l'outil sait corriger
    const collectee = fiche({ username: "dominique.blin", source: "BETA" });
    const declaree = fiche({ username: "prestataire.exemple" });

    // Then seule la fiche locale et modifiable ouvre par sa propre adresse : les deux
    // autres sont réécrites par une collecte ou par le fichier de politique, et
    // entrer par là serait entrer par la porte faible.
    expect(adresseRecevable([candidat()], null, ALLOWLISTS, DECLARES_LOCAUX)).toEqual({
      recevable: true,
      candidat: candidat(),
    });
    expect(
      refus(
        adresseRecevable(
          [candidat({ fiche: collectee, adresse: "dominique.blin@beta.gouv.fr" })],
          null,
          ALLOWLISTS,
          DECLARES_LOCAUX,
        ),
      ),
    ).toBe("FICHE_FERMEE");
    expect(
      refus(adresseRecevable([candidat({ fiche: declaree })], null, ALLOWLISTS, DECLARES_LOCAUX)),
    ).toBe("FICHE_FERMEE");

    // Then une fiche sans adresse ne rend aucun candidat, et rien ne s'ouvre
    expect(refus(adresseRecevable([], null, ALLOWLISTS, DECLARES_LOCAUX))).toBe("INCONNUE");

    // When un opérateur a déclaré un canal à l'octroi, Then la fiche collectée entre,
    // et par ce chemin seulement : c'est le seul geste que l'outil sache offrir quand
    // la boîte de quelqu'un meurt au milieu de son départ, une fiche collectée
    // n'ayant aucune adresse qu'on puisse corriger ici.
    const parCanal = candidat({
      fiche: collectee,
      origine: "OCTROI",
      adresse: "dominique.blin@ailleurs.org",
    });
    expect(adresseRecevable([parCanal], null, ALLOWLISTS, DECLARES_LOCAUX).recevable).toBe(true);

    // Et quand les deux origines désignent la même personne, c'est le canal qui
    // tranche : sans cela, l'adresse de la fiche collectée refuserait la personne que
    // le canal vient d'ouvrir.
    const lesDeux = adresseRecevable(
      [
        candidat({ personId: "personne-dominique", fiche: collectee }),
        { ...parCanal, personId: "personne-dominique" },
      ],
      null,
      ALLOWLISTS,
      DECLARES_LOCAUX,
    );
    expect(lesDeux.recevable && lesDeux.candidat.origine).toBe("OCTROI");

    // Then une adresse qui désigne deux personnes distinctes n'identifie personne, et
    // ce refus se teste en premier : aucun index ne peut le tenir sur les canaux
    // d'octroi, une même personne portant légitimement le même canal sur deux
    // dossiers. Il compte donc des personnes, pas des lignes.
    for (const origines of [
      ["FICHE", "FICHE"],
      ["OCTROI", "OCTROI"],
      ["FICHE", "OCTROI"],
    ] as const) {
      expect(
        refus(
          adresseRecevable(
            [
              candidat({ personId: "personne-une", origine: origines[0] }),
              candidat({ personId: "personne-deux", origine: origines[1] }),
            ],
            null,
            ALLOWLISTS,
            DECLARES_LOCAUX,
          ),
        ),
      ).toBe("PLURALITE");
    }

    // Et deux droits d'une même personne sur deux dossiers portent le même canal sans
    // rien fermer : c'est le cas normal d'un délégué.
    expect(
      adresseRecevable(
        [candidat({ origine: "OCTROI" }), candidat({ origine: "OCTROI" })],
        null,
        ALLOWLISTS,
        DECLARES_LOCAUX,
      ).recevable,
    ).toBe(true);
  });
});

describe("l'identifiant fabriqué et la ligne d'utilisateur", () => {
  it("n'ouvre jamais sur un nom d'opérateur, et ne s'enferme pas dehors elle-même", () => {
    // Given « camille.roy » dans la liste des opérateurs et « secours.exemple » dans
    // celle de secours. Then une adresse dont la partie locale les nomme est refusée,
    // quelle que soit son origine et quelle que soit la fiche qui la porte : c'est le
    // seul garde-fou d'un opérateur qui n'a ni fiche ni ligne d'utilisateur, et rien
    // d'autre ne le couvre.
    for (const adresse of [
      "camille.roy@exemple.org",
      "Camille.Roy@Exemple.ORG",
      "secours.exemple@ailleurs.org",
    ]) {
      expect(
        refus(adresseRecevable([candidat({ adresse })], null, ALLOWLISTS, DECLARES_LOCAUX)),
      ).toBe("ALLOWLIST");
      expect(
        refus(
          adresseRecevable(
            [candidat({ adresse, origine: "OCTROI" })],
            null,
            ALLOWLISTS,
            DECLARES_LOCAUX,
          ),
        ),
      ).toBe("ALLOWLIST");
    }

    // Then une ligne d'utilisateur munie d'un username est celle de quelqu'un entré
    // par la voie espace-membre : le paquet l'adopterait et donnerait une session
    // assise sur elle.
    expect(
      refus(
        adresseRecevable(
          [candidat()],
          { email: "lead.exemple@exemple.org", username: "camille.roy" },
          ALLOWLISTS,
          DECLARES_LOCAUX,
        ),
      ),
    ).toBe("LIGNE_ETRANGERE");

    // Then une ligne sans username mais portant une autre adresse ne prouve rien de
    // cette personne-là
    expect(
      refus(
        adresseRecevable(
          [candidat()],
          { email: "quelquun.dautre@exemple.org", username: null },
          ALLOWLISTS,
          DECLARES_LOCAUX,
        ),
      ),
    ).toBe("LIGNE_ETRANGERE");

    // When la personne revient demander un second lien, Then elle entre encore : sa
    // première visite a fait naître une ligne sans username sur son adresse, et la
    // formulation naïve, « toute adresse portée par une ligne d'utilisateur »,
    // l'enfermerait dehors pour de bon.
    expect(
      adresseRecevable(
        [candidat()],
        { email: "Lead.Exemple@exemple.org", username: null },
        ALLOWLISTS,
        DECLARES_LOCAUX,
      ).recevable,
    ).toBe(true);

    // Then la même clause tient sur les deux origines, et c'est le canal qui la casse
    // le plus vite : sur une fiche collectée, la ligne née du premier lien porte le
    // canal et non l'adresse de la fiche. Une règle indexée sur la seule fiche
    // refuserait ici la personne que le canal existe pour servir.
    const collectee = fiche({ username: "dominique.blin", source: "BETA" });
    expect(
      adresseRecevable(
        [
          candidat({
            personId: "personne-dominique",
            fiche: collectee,
            origine: "OCTROI",
            adresse: "dominique.blin@ailleurs.org",
          }),
        ],
        { email: "dominique.blin@ailleurs.org", username: null },
        ALLOWLISTS,
        DECLARES_LOCAUX,
      ).recevable,
    ).toBe(true);

    // Then une adresse ne produit jamais de candidat username : les deux espaces de
    // noms restent disjoints, et le pivot d'identité ne sort pas de la voie par
    // adresse.
    expect(candidateUsernames({ email: "camille.roy@exemple.org" })).toEqual([]);
  });
});

describe("la boîte qui va être coupée", () => {
  it("se juge sur les domaines de la politique, pas sur l'égalité de deux colonnes", () => {
    // Given une fiche qui ne porte qu'une adresse, hors des domaines qu'un départ
    // coupe. Then rien ne s'annonce : l'égalité des deux colonnes de la fiche aurait
    // crié au loup ici, sans qu'aucune boîte ne soit menacée.
    expect(
      canalMenace({ communicationEmail: "lead.exemple@exemple.org" }, null, DOMAINES_MENACES),
    ).toBe(false);

    // Then une adresse de communication distincte de la principale, mais sur un
    // domaine que le départ coupe, lève l'avertissement : c'est le cas que l'égalité
    // des colonnes ratait, une secondaire fournie par l'employeur étant coupée tout
    // autant que la principale.
    expect(
      canalMenace({ communicationEmail: "dominique.blin@ademe.fr" }, null, DOMAINES_MENACES),
    ).toBe(true);
    expect(
      canalMenace({ communicationEmail: " Dominique.Blin@BETA.GOUV.FR " }, null, DOMAINES_MENACES),
    ).toBe(true);

    // When l'octroi déclare un canal, Then c'est lui qui décide, dans les deux sens :
    // un canal personnel sauve une fiche menacée, un canal menacé s'annonce même sur
    // une fiche qui ne l'est pas.
    expect(
      canalMenace(
        { communicationEmail: "dominique.blin@beta.gouv.fr" },
        "dominique.perso@ailleurs.org",
        DOMAINES_MENACES,
      ),
    ).toBe(false);
    expect(
      canalMenace(
        { communicationEmail: "lead.exemple@exemple.org" },
        "lead.exemple@beta.gouv.fr",
        DOMAINES_MENACES,
      ),
    ).toBe(true);

    // Then une fiche sans adresse et sans canal n'annonce rien, et une politique qui
    // ne déclare aucun domaine n'annonce rien non plus : la liste est une déclaration
    // et pas une propriété du code.
    expect(canalMenace({ communicationEmail: null }, null, DOMAINES_MENACES)).toBe(false);
    expect(canalMenace({ communicationEmail: "dominique.blin@ademe.fr" }, null, [])).toBe(false);
  });
});

describe("où le lien de connexion d'un droit partirait", () => {
  it("préfère le canal déclaré, tolère l'adresse de la fiche, et dit quand plus rien ne mène", () => {
    // Given une fiche locale modifiable qui porte une adresse de contact, sans canal
    // déclaré à l'octroi
    const locale = { ...fiche(), communicationEmail: "lead@exemple.org" };

    // Then le lien partira sur elle, mais ce n'est qu'une approximation : c'est la
    // collecte qui l'entretient, et elle peut se périmer en silence.
    expect(canalDuDroit(locale, null, DECLARES_LOCAUX)).toEqual({
      vivant: true,
      adresse: "lead@exemple.org",
      origine: "FICHE",
    });

    // When l'octroi déclare un canal, Then c'est lui qui sert, et l'outil sait cette
    // fois où le lien part, puisqu'il a lui-même écrit l'adresse.
    expect(canalDuDroit(locale, "lead@perso.example", DECLARES_LOCAUX)).toEqual({
      vivant: true,
      adresse: "lead@perso.example",
      origine: "OCTROI",
    });

    // Given une fiche que la collecte réécrit, c'est-à-dire celle dont l'outil ne peut
    // corriger aucune adresse. Then son adresse de contact n'ouvre rien, et c'est le
    // canal déclaré qui la sauve : sans lui, un départ n'aurait aucune réponse au
    // moment précis où le mécanisme sert.
    const collectee = {
      ...fiche({ source: "BETA", usernameFabricated: false }),
      communicationEmail: "lead@beta.gouv.fr",
    };
    expect(canalDuDroit(collectee, null, DECLARES_LOCAUX)).toEqual({ vivant: false });
    expect(canalDuDroit(collectee, "lead@perso.example", DECLARES_LOCAUX)).toEqual({
      vivant: true,
      adresse: "lead@perso.example",
      origine: "OCTROI",
    });

    // Then une fiche déclarée dans la politique n'ouvre pas davantage par sa propre
    // adresse : elle est locale, mais reconstruite chaque nuit depuis le fichier.
    const declaree = {
      ...fiche({ username: "prestataire.exemple" }),
      communicationEmail: "prestataire@exemple.org",
    };
    expect(canalDuDroit(declaree, null, DECLARES_LOCAUX)).toEqual({ vivant: false });

    // Then une fiche locale sans adresse de contact ne mène nulle part non plus, et
    // c'est la même réponse : ré-octroyer en déclarant une adresse, ou entrer par
    // l'identifiant beta.gouv.
    expect(canalDuDroit({ ...fiche(), communicationEmail: null }, null, DECLARES_LOCAUX)).toEqual({
      vivant: false,
    });

    // Then la bascule d'une fiche locale vers l'amont, qui arrive sans qu'aucun geste
    // humain n'ait eu lieu, tue le canal venu de la fiche et laisse intact celui de
    // l'octroi : c'est ce qui rend le second préférable au premier.
    const basculee = { ...locale, source: "BETA" as const, usernameFabricated: false };
    expect(canalDuDroit(basculee, null, DECLARES_LOCAUX)).toEqual({ vivant: false });
    expect(canalDuDroit(basculee, "lead@perso.example", DECLARES_LOCAUX)).toMatchObject({
      vivant: true,
      origine: "OCTROI",
    });
  });
});

describe("ce qu'un délégué voit d'un dossier", () => {
  it("ne montre que les étapes qui l'attendent, et s'éteint avec son droit", () => {
    // Given un dossier de départ confirmé, dont le porteur est alix.durand, et trois
    // étapes qui n'attendent pas les mêmes personnes
    const DOSSIER = { porteur: "alix.durand" };
    const etape = (cle: string, expectedActor: Acteur) => ({ cle, expectedActor });
    const etapes = [
      etape("acces-github", "OPERATOR"),
      etape("charte", "SUBJECT"),
      etape("materiel", "DELEGATE"),
    ];

    // Given un droit vivant accordé à lead.exemple, qui n'est ni le porteur ni de
    // l'équipe
    const vivant = participationVivante(droit(), "CONFIRMED", MAINTENANT);
    const role = roleSurDossier("lead.exemple", DOSSIER, false, vivant);

    // Then il est délégué sur ce dossier, il n'y voit que l'étape qui le nomme, et il
    // peut la pointer
    expect(role).toBe("DELEGATE");
    expect(etapesVisiblesPour("DELEGATE", etapes)).toEqual([etape("materiel", "DELEGATE")]);
    expect(peutPointer("EXECUTING", "DELEGATE", { role, operateur: false })).toEqual({
      possible: true,
    });

    // Et rien de plus : ni l'étape du porteur, ni celle de l'équipe. La projection se
    // fait sur le rôle attendu et non sur un nom, aucune étape ne sachant dire « ce
    // délégué-ci » : deux délégués d'un même dossier voient donc la même chose et se
    // pointent l'un pour l'autre, comme deux opérateurs le font.
    expect(peutPointer("EXECUTING", "SUBJECT", { role, operateur: false }).possible).toBe(false);
    expect(peutPointer("EXECUTING", "OPERATOR", { role, operateur: false }).possible).toBe(false);
    expect(etapesVisiblesPour("SUBJECT", etapes)).toEqual([etape("charte", "SUBJECT")]);
    expect(etapesVisiblesPour("OPERATOR", etapes)).toEqual([etape("acces-github", "OPERATOR")]);

    // Then le dossier voisin reste fermé : le droit est un fait par dossier, et il
    // arrive en argument plutôt que de se lire quelque part une fois pour toutes.
    const surLeVoisin = roleSurDossier("lead.exemple", { porteur: "camille.roy" }, false, false);
    expect(surLeVoisin).toBeNull();
    expect(
      peutPointer("EXECUTING", "DELEGATE", { role: surLeVoisin, operateur: false }).possible,
    ).toBe(false);

    // When le droit est révoqué alors que sa session est encore ouverte, Then la même
    // lecture ne lui rend plus aucun rôle et l'étape lui est refusée. Le refus ne
    // dépend d'aucune expiration de jeton : le droit se relit, il ne se stocke pas.
    const apresRevocation = roleSurDossier(
      "lead.exemple",
      DOSSIER,
      false,
      participationVivante(droit({ revokedAt: MAINTENANT }), "CONFIRMED", MAINTENANT),
    );
    expect(apresRevocation).toBeNull();
    expect(
      peutPointer("EXECUTING", "DELEGATE", { role: apresRevocation, operateur: false }).possible,
    ).toBe(false);

    // Et l'échéance fait exactement la même chose, sans que personne n'ait rien écrit
    expect(
      roleSurDossier(
        "lead.exemple",
        DOSSIER,
        false,
        participationVivante(droit({ expiresAt: dans(-1) }), "CONFIRMED", MAINTENANT),
      ),
    ).toBeNull();
  });

  it("lui donne à signer ce qu'un autre a déclaré, sans jamais lui ouvrir ce geste-là", () => {
    // Given un plan dont chaque étape nomme son contrôleur : deux étapes du porteur,
    // l'une sous le regard d'un délégué et l'autre sous celui d'un opérateur ; une
    // étape déléguée que l'équipe contrôle ; et une étape de l'équipe qu'un second
    // opérateur relit. Toutes ont été déclarées et attendent ce regard.
    const etape = (
      cle: string,
      expectedActor: Acteur,
      validationBy: Acteur | null,
      validation: EtatValidation,
    ) => ({ cle, expectedActor, validationBy, validation });
    const declarees = [
      etape("charte", "SUBJECT", "DELEGATE", "AWAITING"),
      etape("badge", "SUBJECT", "OPERATOR", "AWAITING"),
      etape("materiel", "DELEGATE", "OPERATOR", "AWAITING"),
      etape("acces-github", "OPERATOR", "OPERATOR", "AWAITING"),
    ];

    // Then un délégué ne signe que celle que le plan lui confie, et c'est une étape que
    // la première projection ne lui montrera jamais : elle attend le porteur, seule
    // répartition sous laquelle un délégué contrôle
    expect(etapesAControlerPar("DELEGATE", declarees)).toEqual([
      etape("charte", "SUBJECT", "DELEGATE", "AWAITING"),
    ]);
    expect(etapesVisiblesPour("DELEGATE", declarees)).toEqual([
      etape("materiel", "DELEGATE", "OPERATOR", "AWAITING"),
    ]);
    expect(combinaisonValide("SUBJECT", "DELEGATE")).toBe(true);
    expect(combinaisonValide("DELEGATE", "DELEGATE")).toBe(false);

    // Then la voir ne la lui ouvre pas : le geste reste celui de la personne concernée,
    // et la garde du pointage le refuse à qui n'est pas l'acteur attendu
    expect(peutPointer("EXECUTING", "SUBJECT", { role: "DELEGATE", operateur: false })).toEqual({
      possible: false,
      raison: "Cette étape ne vous revient pas : elle attend quelqu'un d'autre.",
    });

    // When personne n'a encore déclaré ces étapes, puis quand le regard a eu lieu
    // Then il n'y a rien à contrôler dans un cas comme dans l'autre : ce qu'il
    // contrôlera un jour ne le regarde pas, sans quoi un droit ouvrirait le plan entier
    // à qui n'y signe encore rien
    for (const etat of ["NONE", "ACCEPTED", "REFUSED"] as const) {
      const autrement = declarees.map((declaree) => ({ ...declaree, validation: etat }));
      expect(etapesAControlerPar("DELEGATE", autrement)).toEqual([]);
    }

    // Then la personne concernée ne contrôle rien de son propre dossier, aucune étape ne
    // pouvant la nommer contrôleur
    expect(etapesAControlerPar("SUBJECT", declarees)).toEqual([]);

    // Then un opérateur qui détiendrait aussi un droit ne lit pas deux fois la même
    // étape : celle qui l'attend est déjà rendue par la première projection, et seules
    // les déclarations d'autrui lui reviennent à signer
    expect(etapesAControlerPar("OPERATOR", declarees)).toEqual([
      etape("badge", "SUBJECT", "OPERATOR", "AWAITING"),
      etape("materiel", "DELEGATE", "OPERATOR", "AWAITING"),
    ]);
    expect(etapesVisiblesPour("OPERATOR", declarees)).toEqual([
      etape("acces-github", "OPERATOR", "OPERATOR", "AWAITING"),
    ]);
  });
});

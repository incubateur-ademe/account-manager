import { describe, expect, it } from "vitest";

import {
  CLE_INCUBATEUR,
  cleDEtape,
  type EtapeDeModele,
  ecartDeModele,
  etapesDepuisModeles,
  lireSaisieAttendue,
  type ModeleDePlan,
  modeleDuPlan,
  SYSTEME_MODELE,
  saisieAttendueSchema,
} from "./modele-plan";
import { assembler, empreinteDuPlan, type OrigineDEtapes } from "./plan";

const declaree = (titre: string, over: Partial<EtapeDeModele> = {}): EtapeDeModele => ({
  cle: cleDEtape(titre),
  position: 0,
  titre,
  marcheASuivre: null,
  lien: null,
  critere: `${titre} : c'est fait.`,
  risque: "LOW",
  acteur: "OPERATOR",
  controleur: null,
  saisie: null,
  saisieIllisible: false,
  ...over,
});

const modele = (
  proprietaire: string,
  etapes: readonly EtapeDeModele[],
  startupsPeuventCompleter = false,
): ModeleDePlan => ({ proprietaire, startupsPeuventCompleter, etapes });

const incubateur = (etapes: readonly EtapeDeModele[], ouvert = false): ModeleDePlan =>
  modele(CLE_INCUBATEUR, etapes, ouvert);

/** Les étapes retenues par un assemblage complet, dans l'ordre de lecture. */
const assemblage = (modeles: readonly ModeleDePlan[], moment: "ONBOARDING" | "OFFBOARDING") => {
  const { origines, ecartees } = etapesDepuisModeles({ modeles, moment });
  const assemble = assembler({ origines: [...origines] });

  return {
    etapes: assemble.etapes,
    cles: assemble.etapes.map(({ etape }) => etape.idempotencyKey),
    origines: assemble.etapes.map(({ origine }) => origine),
    ecartees: [...ecartees, ...assemble.ecartees],
    empreinte: empreinteDuPlan(assemble.etapes.map(({ etape }) => etape)),
  };
};

/**
 * Un modèle porte ce qu'aucun système ne connaît. Ce que le cœur doit garantir tient
 * en une phrase : la même déclaration donne toujours le même plan, et rien de ce
 * qu'on a pris la peine d'écrire ne disparaît sans le dire.
 */
describe("étapes issues des modèles déclarés", () => {
  const charte = declaree("Signer la charte", { position: 0 });
  const materiel = declaree("Remettre le matériel", { position: 1 });
  const trombinoscope = declaree("Retirer du trombinoscope", { position: 2 });

  it("donne le modèle de l'incubateur, et rien d'autre, à une personne sans startup", () => {
    // Given un modèle d'incubateur de trois étapes déclarées dans un ordre précis, et
    // deux modèles de startup auxquels cette personne n'est pas rattachée : ils ne
    // sont donc pas lus, ils n'apparaissent pas dans les modèles fournis.
    const modeles = [incubateur([trombinoscope, charte, materiel])];

    // When on assemble pour un départ
    const plan = assemblage(modeles, "OFFBOARDING");

    // Then exactement les trois étapes, dans l'ordre déclaré et non dans l'ordre où
    // la base les a rendues, et aucune écartée.
    expect(plan.cles).toEqual([
      "modele:signer-la-charte",
      "modele:remettre-le-materiel",
      "modele:retirer-du-trombinoscope",
    ]);
    expect(plan.ecartees).toEqual([]);
    expect(plan.etapes.map(({ ordre }) => ordre)).toEqual([0, 1, 2]);

    // Then chaque étape est une étape de plan ordinaire, remplie de façon documentée :
    // un système réservé qu'aucun connecteur ne relira, un tier toujours manuel, un
    // état attendu vide, un critère de complétion non vide, et une origine déclarée.
    for (const { etape } of plan.etapes) {
      expect(etape.systemKey).toBe(SYSTEME_MODELE);
      expect(etape.tier).toBe("manual");
      expect(etape.capability).toBe("revoke");
      expect(etape.expectedState).toEqual({});
      expect(etape.manual?.doneWhen).not.toBe("");
      expect(etape.template?.owner).toBe(CLE_INCUBATEUR);
    }

    // Then un dossier sans aucun modèle en base reste ouvrable : l'assemblage rend une
    // liste vide sans lever.
    const sansModele = assemblage([], "OFFBOARDING");
    expect(sansModele.etapes).toEqual([]);
    expect(sansModele.ecartees).toEqual([]);
  });

  it("assemble les trois modèles d'une personne rattachée sans lui demander deux fois le même geste", () => {
    // Given un incubateur qui demande de signer la charte sans contrôle, et trois
    // startups dont deux redemandent de présenter l'équipe à l'identique, et une
    // redemande la charte en la confiant à la personne concernée sous le regard d'un
    // opérateur.
    const equipe = declaree("Présenter l'équipe");
    const modeles = [
      modele("zeta", [equipe, declaree("Rendre le badge zeta")]),
      incubateur([charte], true),
      modele("alpha", [equipe]),
      modele("beta", [declaree("Signer la charte", { acteur: "SUBJECT", controleur: "OPERATOR" })]),
    ];

    // When on assemble
    const plan = assemblage(modeles, "OFFBOARDING");

    // Then chaque geste n'apparaît qu'une fois, l'incubateur d'abord, puis les
    // startups par ghid croissant, chacune dans son ordre déclaré.
    expect(plan.cles).toEqual([
      "modele:signer-la-charte",
      "modele:presenter-l-equipe",
      "modele:rendre-le-badge-zeta",
    ]);
    expect(plan.origines).toEqual([
      "modele:incubateur",
      "modele:startup:alpha",
      "modele:startup:zeta",
    ]);

    // Then l'exemplaire conservé de la charte est celui de l'incubateur : le premier
    // arrivé gagne, et l'incubateur prime toujours.
    expect(plan.etapes[0]?.etape.template?.owner).toBe(CLE_INCUBATEUR);

    // Then les deux étapes écartées le sont tout haut, avec la startup qui les portait
    // et la raison de leur écart, et les deux raisons ne sont pas la même : celle de
    // zeta redemandait mot pour mot ce que l'exemplaire retenu demande, celle de beta
    // réclamait un second regard que l'exemplaire retenu ne réclame pas. Confondre les
    // deux ferait disparaître un contrôle sous la phrase « déjà demandée plus haut ».
    expect(
      plan.ecartees.map(({ origine, raison, etape }) => [origine, raison, etape.idempotencyKey]),
    ).toEqual([
      ["modele:startup:beta", "doublon-sans-controle", "modele:signer-la-charte"],
      ["modele:startup:zeta", "doublon", "modele:presenter-l-equipe"],
    ]);

    // Then le contrôleur de l'exemplaire écarté n'engage rien : l'étape retenue est
    // celle de l'incubateur, sans contrôle, et l'empreinte ne compte qu'elle. C'est
    // précisément ce que la raison distincte donne à lire, faute de quoi la même
    // empreinte se ferait approuver pour deux plans qui ne demandent pas la même chose.
    expect(plan.etapes[0]?.etape.validationBy).toBeUndefined();
    const sansControleChezBeta = assemblage(
      [
        modele("zeta", [equipe, declaree("Rendre le badge zeta")]),
        incubateur([charte], true),
        modele("alpha", [equipe]),
        modele("beta", [declaree("Signer la charte")]),
      ],
      "OFFBOARDING",
    );
    expect(sansControleChezBeta.empreinte).toBe(plan.empreinte);
    expect(sansControleChezBeta.ecartees.map(({ raison }) => raison)).toEqual([
      "doublon",
      "doublon",
    ]);

    // Then l'assemblage est stable : l'ordre dans lequel les modèles sont fournis n'a
    // aucun effet, sans quoi l'empreinte bougerait d'un calcul à l'autre et un plan
    // confirmé se dirait obsolète tout seul.
    const autrement = assemblage([...modeles].reverse(), "OFFBOARDING");
    expect(autrement.cles).toEqual(plan.cles);
    expect(autrement.empreinte).toBe(plan.empreinte);
  });

  it("neutralise les étapes de startup quand l'incubateur ne les autorise pas, et le dit", () => {
    // Given un modèle d'incubateur fermé aux ajouts, et deux startups qui portent
    // chacune une étape
    const startups = [
      modele("alpha", [declaree("Présenter l'équipe")]),
      modele("zeta", [declaree("Rendre le badge zeta")]),
    ];
    const ferme = [incubateur([charte], false), ...startups];

    // When on assemble
    const plan = assemblage(ferme, "OFFBOARDING");

    // Then seules les étapes de l'incubateur sortent, et chaque étape de startup est
    // rendue écartée avec son origine et la raison qui la neutralise.
    expect(plan.cles).toEqual(["modele:signer-la-charte"]);
    expect(plan.ecartees.map(({ origine, raison }) => [origine, raison])).toEqual([
      ["modele:startup:alpha", "non-autorise"],
      ["modele:startup:zeta", "non-autorise"],
    ]);

    // Then rouvrir l'autorisation sans toucher à une seule étape les rend à
    // l'identique : neutraliser n'est pas supprimer.
    const ouvert = assemblage([incubateur([charte], true), ...startups], "OFFBOARDING");
    expect(ouvert.cles).toEqual([
      "modele:signer-la-charte",
      "modele:presenter-l-equipe",
      "modele:rendre-le-badge-zeta",
    ]);
    expect(ouvert.ecartees).toEqual([]);

    // Then en l'absence totale de modèle d'incubateur pour ce moment, les étapes de
    // startup sont écartées de la même façon : personne n'a donné d'autorisation.
    const orphelin = assemblage(startups, "OFFBOARDING");
    expect(orphelin.etapes).toEqual([]);
    expect(orphelin.ecartees.map(({ raison }) => raison)).toEqual(["non-autorise", "non-autorise"]);
  });

  it("gèle une étape déclarée en étape de plan lisible, pointable et comparable", () => {
    // Given une étape qui porte un lien, une marche à suivre et une saisie attendue
    const accueil = declaree("Ouvrir l'accès à l'atelier", {
      marcheASuivre: "Console de l'atelier, onglet Membres, Inviter.",
      lien: "https://exemple.org/atelier/membres",
      critere: "La personne apparaît dans les membres de l'atelier.",
      risque: "HIGH",
      saisie: { libelle: "Adresse du compte créé", obligatoire: true },
    });

    // When on produit les étapes pour un départ puis pour une arrivée
    const depart = assemblage([incubateur([accueil])], "OFFBOARDING");
    const arrivee = assemblage([incubateur([accueil])], "ONBOARDING");

    // Then la capability suit le moment, et rien d'autre ne bouge
    expect(depart.etapes[0]?.etape.capability).toBe("revoke");
    expect(arrivee.etapes[0]?.etape.capability).toBe("grant");

    // Then la marche à suivre est recopiée telle quelle, saisie comprise, et le niveau
    // de risque déclaré est celui de l'étape.
    const gelee = arrivee.etapes[0]?.etape;
    expect(gelee?.manual).toEqual({
      title: "Ouvrir l'accès à l'atelier",
      runbook: "Console de l'atelier, onglet Membres, Inviter.",
      deeplink: "https://exemple.org/atelier/membres",
      doneWhen: "La personne apparaît dans les membres de l'atelier.",
    });
    expect(gelee?.riskLevel).toBe("high");
    expect(gelee?.template).toEqual({
      owner: CLE_INCUBATEUR,
      stepKey: "ouvrir-l-acces-a-l-atelier",
      saisie: { libelle: "Adresse du compte créé", obligatoire: true },
    });

    // Then la clé d'idempotence ne porte pas le propriétaire : deux modèles qui
    // demandent le même geste le demandent une fois, et le suffixe qui rend la clé
    // unique en base est posé à l'enregistrement, pas ici.
    expect(gelee?.idempotencyKey).toBe("modele:ouvrir-l-acces-a-l-atelier");
    const chezUneStartup = assemblage(
      [incubateur([], true), modele("alpha", [accueil])],
      "ONBOARDING",
    );
    expect(chezUneStartup.cles).toEqual([gelee?.idempotencyKey]);

    // Then réécrire un titre garde la clé, donc reste la même étape, et l'écart n'a
    // rien à signaler : une étape renommée n'est ni retirée ni ajoutée. C'est bien ce
    // que l'éditeur produit, la clé étant figée à la création et jamais recalculée.
    const reference = assemblage([incubateur([charte])], "OFFBOARDING");
    const reformule = assemblage(
      [incubateur([{ ...charte, titre: "Faire signer la charte" }])],
      "OFFBOARDING",
    );
    expect(reformule.cles).toEqual(reference.cles);
    expect(
      ecartDeModele(
        reference.etapes.map(({ etape }) => ({
          label: etape.label,
          template: etape.template ?? null,
        })),
        reformule.etapes.map(({ etape }) => etape),
      ),
    ).toEqual({ manquantes: [], retirees: [] });

    // Then l'empreinte, elle, bouge : le titre d'une étape déclarée est une partie de
    // ce qu'on demande de faire, et un brouillon calculé avant la réécriture doit se
    // découvrir obsolète plutôt que de se confirmer sur un texte démenti.
    expect(reformule.empreinte).not.toBe(reference.empreinte);

    // Then elle change aussi dès qu'une étape s'ajoute au modèle.
    const augmente = assemblage([incubateur([charte, materiel])], "OFFBOARDING");
    expect(augmente.empreinte).not.toBe(reference.empreinte);

    // Then le propriétaire, lui, entre bien dans l'empreinte : les paramètres restent
    // plats, sans quoi le filtre de clés de l'empreinte les avalerait et deux plans
    // différents se croiraient identiques.
    const parLaStartup = assemblage(
      [incubateur([], true), modele("alpha", [charte])],
      "OFFBOARDING",
    );
    expect(parLaStartup.cles).toEqual(reference.cles);
    expect(parLaStartup.empreinte).not.toBe(reference.empreinte);
  });

  it("fait entrer dans l'empreinte tout ce qui engage une étape déclarée", () => {
    // Given une étape de départ complète, telle qu'un opérateur l'a écrite
    const initiale = declaree("Rendre le badge", {
      critere: "Le badge est au coffre.",
      marcheASuivre: "Passer par l'accueil.",
      lien: "https://exemple.org/badges",
      risque: "LOW",
      saisie: { libelle: "Numéro du badge", obligatoire: false },
    });
    const reference = assemblage([incubateur([initiale])], "OFFBOARDING");

    // Then ses paramètres sont strictement plats : `empreinteDuPlan` filtre les clés
    // de `params` à tous les niveaux, un sous-objet y disparaîtrait en silence et
    // rendrait deux étapes différentes indiscernables.
    const params: Record<string, unknown> = reference.etapes[0]?.etape.params ?? {};
    expect(
      Object.values(params).every((valeur) => typeof valeur !== "object" || valeur === null),
    ).toBe(true);
    expect(params["saisieLibelle"]).toBe("Numéro du badge");
    expect(params["saisieObligatoire"]).toBe(false);

    // When on change, une par une, les choses qui engagent cette étape
    const variantes: readonly (readonly [string, Partial<EtapeDeModele>])[] = [
      ["le titre", { titre: "Rendre le badge d'accès" }],
      ["le critère", { critere: "Le badge est détruit." }],
      ["le risque", { risque: "HIGH" }],
      ["l'acteur attendu", { acteur: "SUBJECT" }],
      ["le contrôleur", { controleur: "OPERATOR" }],
      ["le libellé de la saisie", { saisie: { libelle: "Numéro gravé", obligatoire: false } }],
      [
        "la saisie devenue obligatoire",
        { saisie: { libelle: "Numéro du badge", obligatoire: true } },
      ],
      ["la saisie retirée", { saisie: null }],
      ["la marche à suivre", { marcheASuivre: "Passer par le coffre." }],
      ["le lien", { lien: "https://exemple.org/badges/rendus" }],
    ];

    // Then chacune déplace l'empreinte. Une étape déclarée n'a ni système ni action
    // pour la distinguer : son texte est tout ce qu'on exécute, et une empreinte
    // aveugle à ce texte laisserait un critère faux se confirmer intact.
    for (const [quoi, variante] of variantes) {
      const modifiee = assemblage([incubateur([{ ...initiale, ...variante }])], "OFFBOARDING");
      expect(modifiee.empreinte, quoi).not.toBe(reference.empreinte);
    }

    // Then la position, elle, n'engage rien : elle range l'écran, pas le geste.
    const deplacee = assemblage([incubateur([{ ...initiale, position: 7 }])], "OFFBOARDING");
    expect(deplacee.empreinte).toBe(reference.empreinte);

    // Then une étape qui ne répartit rien pèse exactement ce qu'elle pesait avant que
    // la question se pose : émettre « à l'opérateur, sans contrôle » là où rien n'était
    // émis est indiscernable de ne rien émettre, `empreinteDuPlan` lisant déjà ces deux
    // valeurs à part avec ce défaut. C'est ce qui garantit qu'aucun brouillon en vol ne
    // se découvre obsolète le jour où les modèles savent nommer un contrôleur.
    const muettes = reference.etapes.map(({ etape }) => {
      const sansRepartition = { ...etape };
      delete sansRepartition.expectedActor;
      delete sansRepartition.validationBy;
      return sansRepartition;
    });
    expect(empreinteDuPlan(muettes)).toBe(reference.empreinte);
  });

  it("écarte une étape à la saisie illisible, sauf si l'autorisation l'avait déjà neutralisée", () => {
    // Given une étape de l'incubateur dont la valeur stockée en guise de saisie n'en
    // est pas une, et une startup qui en porte une aussi
    const cassee = declaree("Rendre le badge", { position: 1, saisieIllisible: true });
    const alpha = modele("alpha", [declaree("Présenter l'équipe", { saisieIllisible: true })]);

    // When l'autorisation est ouverte
    const ouvert = assemblage([incubateur([charte, cassee], true), alpha], "OFFBOARDING");

    // Then rien ne lève, l'étape saine sort seule, et les deux étapes illisibles sont
    // écartées avec la raison qui dit quoi réparer et le modèle qui la porte.
    expect(ouvert.cles).toEqual(["modele:signer-la-charte"]);
    expect(
      ouvert.ecartees.map(({ origine, raison, etape }) => [origine, raison, etape.label]),
    ).toEqual([
      ["modele:incubateur", "saisie-illisible", "Rendre le badge"],
      ["modele:startup:alpha", "saisie-illisible", "Présenter l'équipe"],
    ]);

    // When la même startup se voit refermer l'autorisation
    const ferme = assemblage([incubateur([charte], false), alpha], "OFFBOARDING");

    // Then son étape ne signale plus rien d'autre que sa neutralisation : une étape
    // qu'aucun dossier ne portera n'a pas à réclamer une réparation.
    expect(ferme.ecartees.map(({ raison }) => raison)).toEqual(["non-autorise"]);
  });

  it("laisse les étapes des connecteurs derrière les étapes déclarées, sans y toucher", () => {
    // Given un plan de départ qui réunit ses trois origines
    const { origines } = etapesDepuisModeles({
      modeles: [incubateur([charte], true), modele("alpha", [declaree("Présenter l'équipe")])],
      moment: "OFFBOARDING",
    });
    const parLeConnecteur = {
      systemKey: "github",
      capability: "revoke" as const,
      tier: "manual" as const,
      action: "retirer-de-l-organisation",
      label: "Retirer jean.dupont de l'organisation incubateur-ademe",
      params: { organisation: "incubateur-ademe", username: "jean.dupont" },
      riskLevel: "high" as const,
      expectedState: { membre: false },
      idempotencyKey: "github:incubateur-ademe:revoke:jean.dupont",
    };
    const toutes: OrigineDEtapes[] = [
      { origine: "connecteur", etapes: [parLeConnecteur] },
      ...origines,
    ];

    // When on assemble le tout
    const assemble = assembler({ origines: toutes });

    // Then les étapes déclarées passent devant, celle du connecteur ferme la marche
    // sans avoir été touchée, et rien n'a été écarté.
    expect(assemble.etapes.map(({ etape }) => etape.idempotencyKey)).toEqual([
      "modele:signer-la-charte",
      "modele:presenter-l-equipe",
      "github:incubateur-ademe:revoke:jean.dupont",
    ]);
    expect(assemble.etapes[2]?.etape).toBe(parLeConnecteur);
    expect(assemble.etapes[2]?.etape.template).toBeUndefined();
    expect(assemble.ecartees).toEqual([]);
  });

  it("dit ce qu'un plan figé ne porte plus, sans rien y changer", () => {
    // Given un départ figé sur ce que l'incubateur et la startup alpha demandaient
    // ce jour-là, plus une étape rendue par un connecteur
    const fige = assemblage(
      [incubateur([charte], true), modele("alpha", [declaree("Présenter l'équipe")])],
      "OFFBOARDING",
    );
    const gelees = [
      ...fige.etapes.map(({ etape }) => ({ label: etape.label, template: etape.template ?? null })),
      { label: "Retirer de l'organisation", template: null },
    ];

    // When la personne est rattachée depuis à une startup beta qui demande autre
    // chose, et que l'incubateur a retiré la charte de son modèle
    const aujourdhui = assemblage(
      [
        incubateur([], true),
        modele("alpha", [declaree("Présenter l'équipe")]),
        modele("beta", [declaree("Rendre le badge")]),
      ],
      "OFFBOARDING",
    );
    const ecart = ecartDeModele(
      gelees,
      aujourdhui.etapes.map(({ etape }) => etape),
    );

    // Then l'écart se dit dans les deux sens, l'étape du connecteur n'y entre pas, et
    // le plan figé n'a pas bougé d'une ligne
    expect(ecart.manquantes.map(({ cle }) => cle)).toEqual(["rendre-le-badge"]);
    expect(ecart.retirees.map(({ cle }) => cle)).toEqual(["signer-la-charte"]);
    expect(ecart.retirees[0]?.titre).toBe("Signer la charte");
    expect(gelees).toHaveLength(3);
    expect(fige.cles).toEqual(["modele:signer-la-charte", "modele:presenter-l-equipe"]);

    // Et quand rien n'a changé, il n'y a rien à dire
    expect(
      ecartDeModele(
        gelees,
        fige.etapes.map(({ etape }) => etape),
      ),
    ).toEqual({ manquantes: [], retirees: [] });
  });
});

/**
 * La clé d'une étape, le moment d'un plan et la saisie attendue sont les trois
 * conversions que tout le reste tient pour acquises.
 */
describe("clés, moments et saisie attendue", () => {
  it("dérive une clé stable d'un titre écrit à la main", () => {
    // Given des titres tels qu'un opérateur les écrit, accents, apostrophes et
    // ponctuation comprises
    expect(cleDEtape("Signer la charte")).toBe("signer-la-charte");
    expect(cleDEtape("Présenter l'équipe !")).toBe("presenter-l-equipe");
    expect(cleDEtape("  Rendre le badge  ")).toBe("rendre-le-badge");
    expect(cleDEtape("Faire le point sur les nœuds")).toBe("faire-le-point-sur-les-noeuds");

    // Then deux écritures qui ne diffèrent que par la casse ou la ponctuation donnent
    // la même clé : c'est exactement ce qui dédoublonne entre deux startups.
    expect(cleDEtape("PRÉSENTER L'ÉQUIPE")).toBe(cleDEtape("Présenter l'équipe"));

    // Then un titre qui ne porte rien de clétable rend une chaîne vide, à l'écriture
    // de la refuser plutôt qu'à l'assemblage de la deviner.
    expect(cleDEtape("« ??? »")).toBe("");
  });

  it("ne prétend pas qu'un correctif de dérive relève d'un modèle", () => {
    expect(modeleDuPlan("ONBOARDING")).toBe("ONBOARDING");
    expect(modeleDuPlan("OFFBOARDING")).toBe("OFFBOARDING");
    expect(modeleDuPlan("DRIFT_FIX")).toBeNull();
    expect(modeleDuPlan("MANUAL_OP")).toBeNull();
  });

  it("tient une saisie obligatoire par défaut et refuse une saisie mal formée", () => {
    // Given une saisie déclarée sans dire si elle est obligatoire
    expect(saisieAttendueSchema.parse({ libelle: "Adresse du compte créé" })).toEqual({
      libelle: "Adresse du compte créé",
      obligatoire: true,
    });

    // Then un libellé vide n'est pas une saisie : demander une valeur sans dire
    // laquelle ne se pointe pas.
    expect(saisieAttendueSchema.safeParse({ libelle: "   " }).success).toBe(false);
    expect(saisieAttendueSchema.safeParse({ libelle: "Compte", type: "url" }).success).toBe(false);

    // Then l'absence de saisie est un cas normal, une saisie mal formée non : elle ne
    // peut venir que d'une écriture faite hors de cet outil.
    expect(lireSaisieAttendue(null)).toBeNull();
    expect(lireSaisieAttendue(undefined)).toBeNull();
    expect(lireSaisieAttendue({ libelle: "Compte", obligatoire: false })).toEqual({
      libelle: "Compte",
      obligatoire: false,
    });
    expect(() => lireSaisieAttendue({ obligatoire: true })).toThrow();
  });
});

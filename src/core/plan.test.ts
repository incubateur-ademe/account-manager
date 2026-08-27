import { describe, expect, it } from "vitest";

import type { PlannedStep } from "./connector";
import {
  assembler,
  empreinteDuPlan,
  exigerDesCombinaisonsValides,
  masseDuPlan,
  type OrigineDEtapes,
  peremptionDuPlan,
  refusDeMasse,
} from "./plan";

const etape = (over: Partial<PlannedStep> = {}): PlannedStep => ({
  systemKey: "github",
  capability: "revoke",
  tier: "manual",
  action: "retirer-de-l-organisation",
  label: "Retirer jean.dupont de l'organisation incubateur-ademe",
  params: { organisation: "incubateur-ademe", username: "jean.dupont" },
  riskLevel: "high",
  expectedState: { membre: false },
  idempotencyKey: "github:incubateur-ademe:revoke:jean.dupont",
  ...over,
});

/**
 * L'empreinte sert à répondre à une seule question au moment d'agir : est-ce encore
 * ce qui a été approuvé ? Trop sensible, elle ferait rejouer une approbation pour un
 * libellé reformulé ; trop laxiste, elle laisserait exécuter autre chose.
 */
describe("empreinte d'un plan", () => {
  it("ne change pas quand seule la présentation change", () => {
    // Given un plan approuvé
    const reference = empreinteDuPlan([etape()]);

    // When le libellé est reformulé et le niveau de risque relu à la baisse
    const reformule = empreinteDuPlan([
      etape({ label: "Sortir jean.dupont de l'organisation", riskLevel: "medium" }),
    ]);

    // Then c'est le même plan : rien de ce qui engage n'a bougé
    expect(reformule).toBe(reference);
  });

  it("ne dépend pas de l'ordre des étapes", () => {
    const a = etape();
    const b = etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" });

    expect(empreinteDuPlan([a, b])).toBe(empreinteDuPlan([b, a]));
  });

  it("change dès qu'une étape vise autre chose", () => {
    // Le cas qui compte : une collecte est passée, la personne a un compte de plus.
    const initial = empreinteDuPlan([etape()]);
    const augmente = empreinteDuPlan([
      etape(),
      etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" }),
    ]);

    expect(augmente).not.toBe(initial);
  });

  it("change quand les paramètres d'une même action changent", () => {
    const initial = empreinteDuPlan([etape()]);
    const ailleurs = empreinteDuPlan([etape({ params: { organisation: "autre-org" } })]);

    expect(ailleurs).not.toBe(initial);
  });

  it("descend dans un paramètre imbriqué, sans déplacer l'empreinte d'un plan déjà confirmé", () => {
    // Given deux étapes qui ne diffèrent que par un sous-objet de paramètres : rien
    // n'empêche un connecteur d'en produire un, et le socle n'est pas seul à écrire ici
    const socle = etape({
      params: { organisation: "incubateur-ademe", equipe: { slug: "socle" } },
    });
    const produit = etape({
      params: { organisation: "incubateur-ademe", equipe: { slug: "produit" } },
    });

    // Then les deux plans se distinguent : le filtre de clés de `JSON.stringify` porte à
    // tous les niveaux, et borné au premier il faisait disparaître le sous-objet, si bien
    // que deux étapes différentes passaient ensemble sous la garde d'écart
    expect(empreinteDuPlan([socle])).not.toBe(empreinteDuPlan([produit]));

    // Then l'ordre des clés n'y change rien à l'intérieur non plus qu'au premier niveau
    expect(
      empreinteDuPlan([etape({ params: { equipe: { role: "member", slug: "produit" } } })]),
    ).toBe(empreinteDuPlan([etape({ params: { equipe: { slug: "produit", role: "member" } } })]));

    // Then l'empreinte d'un plan aux paramètres plats ne bouge pas d'un caractère.
    // Ces valeurs sont celles que les plans confirmés portent en base : les déplacer
    // dirait obsolète, d'un seul coup, tout plan en attente d'exécution. Elles ont été
    // déplacées une fois, sciemment, par l'entrée de l'acteur attendu dans l'empreinte,
    // et le scénario suivant en garde la preuve.
    expect(empreinteDuPlan([etape()])).toBe("f142c4c0");
    expect(empreinteDuPlan([etape({ params: {} })])).toBe("2ab0f825");
    expect(
      empreinteDuPlan([
        etape(),
        etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" }),
      ]),
    ).toBe("a09048a6");
  });

  it("suit qui doit agir et qui doit contrôler", () => {
    // Given deux calculs identiques au seul acteur attendu près
    const parLOperateur = empreinteDuPlan([etape()]);
    const parLePorteur = empreinteDuPlan([etape({ expectedActor: "SUBJECT" })]);

    // Then ce ne sont pas les mêmes plans : qui doit agir fait partie de ce qu'un
    // opérateur approuve en confirmant, et un brouillon dont la répartition des rôles
    // a changé n'est plus confirmable en l'état.
    expect(parLePorteur).not.toBe(parLOperateur);

    // Then qui doit contrôler aussi, à acteur égal
    expect(
      empreinteDuPlan([etape({ expectedActor: "SUBJECT", validationBy: "OPERATOR" })]),
    ).not.toBe(parLePorteur);

    // Then une étape muette vaut une étape d'opérateur sans contrôle, la valeur que la
    // ligne prendra en base : dire l'implicite ne déplace rien.
    expect(empreinteDuPlan([etape({ expectedActor: "OPERATOR" })])).toBe(parLOperateur);

    // Then l'ajout de ces deux champs a bel et bien déplacé l'empreinte de tout plan
    // existant. Ces trois valeurs sont celles d'avant la livraison, gardées pour ce
    // qu'elles prouvent : les brouillons en vol sont devenus non confirmables et se
    // recalculent d'un clic.
    const avantLesActeurs = ["9ce27f80", "18947b65", "5be04c6e"];
    expect(avantLesActeurs).not.toContain(parLOperateur);
    expect(avantLesActeurs).not.toContain(empreinteDuPlan([etape({ params: {} })]));
  });
});

/**
 * Un plan cesse d'être valide de deux façons, et les confondre ferait exécuter ce
 * que personne n'a approuvé sous cette forme.
 */
describe("péremption d'un plan", () => {
  const MAINTENANT = new Date("2026-08-18T12:00:00Z");
  const plan = { expiresAt: new Date("2026-08-25T12:00:00Z"), planDigest: "abcd1234" };

  it("laisse passer un plan récent que rien n'a démenti", () => {
    expect(peremptionDuPlan(plan, "abcd1234", MAINTENANT)).toEqual({
      perime: false,
      obsolete: false,
    });
  });

  it("distingue le plan trop vieux du plan démenti par une collecte", () => {
    // Deux raisons différentes de ne pas exécuter, qui appellent deux gestes
    // différents : recalculer d'un côté, faire reconfirmer de l'autre.
    const vieux = { ...plan, expiresAt: new Date("2026-08-17T12:00:00Z") };

    expect(peremptionDuPlan(vieux, "abcd1234", MAINTENANT).perime).toBe(true);
    expect(peremptionDuPlan(plan, "9999ffff", MAINTENANT).obsolete).toBe(true);
  });

  it("tient un plan pour périmé le jour même de son échéance", () => {
    const aLEcheance = { ...plan, expiresAt: MAINTENANT };
    expect(peremptionDuPlan(aLEcheance, "abcd1234", MAINTENANT).perime).toBe(true);
  });
});

/**
 * Assembler, c'est réunir ce que trois sources demandent en une seule liste dont
 * l'ordre ne dépend de personne. Un ordre qui bouge d'un calcul à l'autre ferait
 * bouger l'empreinte, donc dirait obsolète un plan que rien n'a démenti.
 */
describe("assemblage d'un plan", () => {
  const charte = etape({
    idempotencyKey: "modele:incubateur:charte:jean.dupont",
    label: "Faire signer la charte",
  });
  const accueilAlpha = etape({
    idempotencyKey: "modele:startup:alpha:accueil:jean.dupont",
    label: "Présenter l'équipe d'alpha",
  });
  const accueilZeta = etape({
    idempotencyKey: "modele:startup:zeta:accueil:jean.dupont",
    label: "Présenter l'équipe de zeta",
  });
  const github = etape();
  const notion = etape({ systemKey: "notion", idempotencyKey: "notion:revoke:jean.dupont" });

  const cles = (assemblage: ReturnType<typeof assembler>) =>
    assemblage.etapes.map(({ etape: retenue }) => retenue.idempotencyKey);

  it("range l'incubateur, puis les startups par ghid, puis les connecteurs", () => {
    // Given les trois origines fournies dans un ordre quelconque
    const origines: OrigineDEtapes[] = [
      { origine: "connecteur", etapes: [github, notion] },
      { origine: "modele:startup:zeta", etapes: [accueilZeta] },
      { origine: "modele:incubateur", etapes: [charte] },
      { origine: "modele:startup:alpha", etapes: [accueilAlpha] },
    ];

    // When on assemble
    const assemblage = assembler({ origines });

    // Then l'incubateur prime, les startups suivent par ghid croissant, les
    // connecteurs ferment la marche dans l'ordre où ils ont été interrogés.
    expect(cles(assemblage)).toEqual([
      charte.idempotencyKey,
      accueilAlpha.idempotencyKey,
      accueilZeta.idempotencyKey,
      github.idempotencyKey,
      notion.idempotencyKey,
    ]);

    // Then le rang de lecture est strictement croissant et figé dans l'étape.
    expect(assemblage.etapes.map(({ ordre }) => ordre)).toEqual([0, 1, 2, 3, 4]);
    expect(assemblage.etapes.map(({ origine }) => origine)).toEqual([
      "modele:incubateur",
      "modele:startup:alpha",
      "modele:startup:zeta",
      "connecteur",
      "connecteur",
    ]);

    // Then l'ordre dans lequel l'appelant a fourni ses listes n'a aucun effet.
    const autrement = assembler({ origines: [...origines].reverse() });
    expect(cles(autrement)).toEqual(cles(assemblage));
    expect(assemblage.ecartees).toEqual([]);
  });

  it("ne demande pas deux fois le même geste, et dit tout haut ce qu'il écarte", () => {
    // Given un modèle d'incubateur qui demande ce qu'un connecteur demande déjà
    const parLIncubateur = etape({
      idempotencyKey: github.idempotencyKey,
      label: "Retirer jean.dupont de l'organisation, à la main",
    });

    // When on assemble
    const assemblage = assembler({
      origines: [
        { origine: "connecteur", etapes: [github, notion] },
        { origine: "modele:incubateur", etapes: [parLIncubateur] },
      ],
    });

    // Then le premier arrivé gagne et garde sa place : c'est l'incubateur qui prime,
    // et son libellé est celui qui est retenu.
    expect(cles(assemblage)).toEqual([github.idempotencyKey, notion.idempotencyKey]);
    expect(assemblage.etapes[0]?.etape.label).toBe(parLIncubateur.label);
    expect(assemblage.etapes[0]?.origine).toBe("modele:incubateur");
    expect(assemblage.etapes.map(({ ordre }) => ordre)).toEqual([0, 1]);

    // Then l'étape écartée n'est pas perdue : elle porte son origine et sa raison,
    // parce qu'écarter en silence ce que quelqu'un a déclaré est la panne muette que
    // cet outil existe pour éviter.
    expect(assemblage.ecartees).toEqual([
      { etape: github, origine: "connecteur", raison: "doublon" },
    ]);
  });

  it("laisse l'empreinte insensible au libellé, à l'ordre et au rang de lecture", () => {
    // Given deux assemblages des mêmes étapes, rangées autrement
    const reference = assembler({
      origines: [{ origine: "connecteur", etapes: [github, notion] }],
    });
    const inverse = assembler({ origines: [{ origine: "connecteur", etapes: [notion, github] }] });

    const empreinte = (assemblage: ReturnType<typeof assembler>) =>
      empreinteDuPlan(assemblage.etapes.map(({ etape: retenue }) => retenue));

    // Then les rangs diffèrent, l'empreinte non
    expect(cles(inverse)).not.toEqual(cles(reference));
    expect(empreinte(inverse)).toBe(empreinte(reference));

    // Then reformuler une étape ne déplace pas davantage l'empreinte
    const reformule = assembler({
      origines: [
        {
          origine: "connecteur",
          etapes: [etape({ label: "Sortir jean.dupont de l'organisation" }), notion],
        },
      ],
    });
    expect(empreinte(reformule)).toBe(empreinte(reference));

    // Then ajouter une étape la déplace : c'est tout ce que l'empreinte a à dire.
    const augmente = assembler({
      origines: [
        { origine: "modele:incubateur", etapes: [charte] },
        { origine: "connecteur", etapes: [github, notion] },
      ],
    });
    expect(empreinte(augmente)).not.toBe(empreinte(reference));

    // Le suffixe de clé d'idempotence est posé à l'enregistrement, jamais avant :
    // l'empreinte se calcule sur les étapes telles que les connecteurs les rendent,
    // sinon deux plans successifs d'un même dossier ne se compareraient jamais.
    const suffixee = empreinteDuPlan([etape({ idempotencyKey: `${github.idempotencyKey}:6f1b` })]);
    expect(suffixee).not.toBe(empreinteDuPlan([github]));
  });
});

/**
 * Le plafond de masse est le seul garde-fou que ce produit conserve à la place des
 * approbateurs multiples, de la fenêtre de rétractation et du quorum. Il ne sert
 * qu'une fois : le jour où un calcul dérape et où personne ne le voit avant la
 * première écriture sur un système tiers.
 */
describe("plafond de masse d'un plan", () => {
  const auto = (rang: number) => etape({ tier: "auto", idempotencyKey: `auto:${rang}` });
  const main = (rang: number) => etape({ tier: "manual", idempotencyKey: `manual:${rang}` });

  it("ne compte que ce que la boucle toucherait, et laisse partir un plan ordinaire", () => {
    // Given un plan d'arrivée nominal : trois gestes automatiques, une dizaine de
    // lignes qu'un humain ira faire, et une ligne sans voie praticable
    const nominal = [
      ...Array.from({ length: 3 }, (_, rang) => auto(rang)),
      ...Array.from({ length: 12 }, (_, rang) => main(rang)),
      etape({ tier: "none", idempotencyKey: "none:0" }),
    ];

    // When on le mesure contre le plafond de la politique
    const masse = masseDuPlan(nominal, 5);

    // Then seules les trois automatiques comptent : les manuelles sont déjà bornées
    // par la main qui les coche, et une étape sans voie n'est jamais exécutée
    expect(masse.executables).toBe(3);
    expect(masse.seuil).toBe(5);
    expect(masse.depasse).toBe(false);

    // Then rien n'est demandé de plus, et surtout pas une confirmation de routine :
    // un garde-fou qui se déclenche à chaque fois cesse d'être lu dès la deuxième
    expect(refusDeMasse(masse, false)).toBeNull();
  });

  it("ne compte pas un tier assisté, que la boucle ne sait pas conduire", () => {
    // Given un plan où un geste se dit assisté, tier qu'aucun connecteur ne déclare et
    // dont la boucle ne saurait rien faire d'autre qu'un appel automatique
    const mixte = [auto(0), auto(1), etape({ tier: "assisted", idempotencyKey: "assisted:0" })];

    // When on le mesure
    // Then seuls les deux gestes automatiques comptent : le plafond borne ce que la
    // machine ferait vraiment, et compter un tier promis mais non tenu ferait retenir
    // des plans sur des étapes que rien n'exécute
    expect(masseDuPlan(mixte, 2).executables).toBe(2);
    expect(masseDuPlan(mixte, 2).depasse).toBe(false);

    // Then c'est bien le tier qui décide, et non le nombre de lignes
    expect(masseDuPlan([...mixte, auto(2)], 2).executables).toBe(3);
    expect(masseDuPlan([...mixte, auto(2)], 2).depasse).toBe(true);
  });

  it("retient un plan au-dessus du seuil tant qu'aucun geste humain ne l'a confirmé", () => {
    // Given un calcul qui a dérapé et produit trente-quatre écritures d'un coup
    const derape = Array.from({ length: 34 }, (_, rang) => auto(rang));
    const masse = masseDuPlan(derape, 20);

    // Then le plafond est franchi
    expect(masse.depasse).toBe(true);
    expect(masse.executables).toBe(34);

    // When personne n'a rien confirmé de plus
    const refus = refusDeMasse(masse, false);

    // Then le plan ne part pas, et le refus dit ce qu'il refuse, de combien, et quoi
    // faire : un refus qui se contente de bloquer se contourne au lieu de se lire
    expect(refus).not.toBeNull();
    expect(refus).toContain("34");
    expect(refus).toContain("20");
    expect(refus).toContain("relisez la liste étape par étape");

    // When l'opérateur confirme la masse explicitement
    // Then le plan part, sans que rien d'autre n'ait changé
    expect(refusDeMasse(masse, true)).toBeNull();

    // Then le plafond reste franchi malgré la confirmation : ce qui a été confirmé
    // est la masse, pas le fait qu'elle soit normale
    expect(masseDuPlan(derape, 20).depasse).toBe(true);
  });

  it("laisse passer le plan qui touche exactement le seuil, et retient le suivant", () => {
    // Given deux plans qui ne diffèrent que d'une étape, de part et d'autre du seuil
    const juste = Array.from({ length: 20 }, (_, rang) => auto(rang));
    const une = [...juste, auto(20)];

    // Then le plafond est un maximum admis, pas une borne à ne pas atteindre : sans
    // quoi le nombre écrit dans la politique ne serait pas celui qu'elle dit
    expect(refusDeMasse(masseDuPlan(juste, 20), false)).toBeNull();
    expect(refusDeMasse(masseDuPlan(une, 20), false)).not.toBeNull();
  });
});

/**
 * L'unique garde de la répartition des rôles : rien en base ne la double. Une étape
 * dont le contrôle revient à un rôle qui ne peut pas le porter attendrait pour toujours
 * un validateur qui n'existe pas, et le dossier ne se clôturerait jamais.
 */
describe("répartition des rôles au moment de figer les étapes", () => {
  it("laisse passer les quatre répartitions prévues, et tout ce qui se croit sur parole", () => {
    // Given un plan mêlant des étapes de connecteur, muettes, et des étapes déclarées
    // qui nomment qui agit et qui contrôle
    const plan = [
      etape(),
      etape({
        idempotencyKey: "modele:charte",
        expectedActor: "SUBJECT",
        validationBy: "OPERATOR",
      }),
      etape({ idempotencyKey: "modele:cle", expectedActor: "DELEGATE", validationBy: "OPERATOR" }),
      etape({ idempotencyKey: "modele:acces", expectedActor: "SUBJECT", validationBy: "DELEGATE" }),
      // Le geste d'opérateur qu'un opérateur relit : « j'ai retiré l'accès
      // administrateur » ne se croit pas sur parole, et deux opérateurs sont deux
      // personnes, ce dont `peutValider` répond sur le username.
      etape({
        idempotencyKey: "modele:admin",
        expectedActor: "OPERATOR",
        validationBy: "OPERATOR",
      }),
      etape({ idempotencyKey: "modele:mot", expectedActor: "SUBJECT" }),
    ];

    // Then rien ne s'y oppose
    expect(() => exigerDesCombinaisonsValides(plan)).not.toThrow();
  });

  it("refuse net les répartitions qui n'existent pas, et nomme l'étape fautive", () => {
    // Given une étape que la personne concernée contrôlerait elle-même
    const parLeSujet = [
      etape(),
      etape({
        label: "Signer la charte",
        idempotencyKey: "modele:charte",
        expectedActor: "SUBJECT",
        validationBy: "SUBJECT",
      }),
    ];

    // Then le plan ne se fige pas, et le message nomme l'étape fautive : ce qui sort
    // d'ici est un défaut de construction, et le corriger demande de savoir laquelle
    // des origines l'a proposée.
    expect(() => exigerDesCombinaisonsValides(parLeSujet)).toThrow(/Signer la charte/);

    // Then un délégué ne contrôle pas un délégué : rien ne sait aujourd'hui les
    // distinguer l'un de l'autre, `roleSurDossier` ne rendant jamais `DELEGATE`.
    expect(() =>
      exigerDesCombinaisonsValides([
        etape({ expectedActor: "DELEGATE", validationBy: "DELEGATE" }),
      ]),
    ).toThrow();

    // Then un délégué ne relit pas un opérateur : faire contrôler l'équipe transverse
    // par quelqu'un d'extérieur au dossier inverse la responsabilité.
    expect(() =>
      exigerDesCombinaisonsValides([
        etape({ expectedActor: "OPERATOR", validationBy: "DELEGATE" }),
      ]),
    ).toThrow();
  });
});

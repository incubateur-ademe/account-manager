import { describe, expect, it } from "vitest";

import type { PlannedStep } from "./connector";
import { assembler, empreinteDuPlan, type OrigineDEtapes, peremptionDuPlan } from "./plan";

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

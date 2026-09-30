// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MODELE } from "@/app/modeles/redaction";
import { CLE_INCUBATEUR } from "@/core/modele-plan";

/**
 * Ce que l'écran des modèles rend de ce qu'il a lu.
 *
 * Deux avertissements y vivent, et ni l'un ni l'autre n'était monté nulle part. Ce sont
 * pourtant les seules parties de cet écran qui paraissent ou disparaissent selon la
 * base : le reste s'affiche toujours. Une condition inversée les rendrait muets sans
 * qu'aucune mesure ne bouge, le relevé visuel jouant sur un semis qui pose déjà un
 * contrôleur.
 */

interface ModeleLu {
  ownerKey: string;
  kind: "ONBOARDING" | "OFFBOARDING";
}

const lu = vi.hoisted(() => ({
  relues: 0,
  startups: [] as { ghid: string; vanishedAt?: Date }[],
  modeles: [] as { ownerKey: string; kind: "ONBOARDING" | "OFFBOARDING" }[],
}));

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());

vi.mock("@/lib/db", async () => {
  const { doublerBase } = await import("@/test/doubles/db");
  return doublerBase({
    planTemplate: {
      findMany: () =>
        Promise.resolve(
          lu.modeles.map(({ ownerKey, kind }) => ({
            ownerKey,
            kind,
            startupsMayExtend: false,
            _count: { steps: 1 },
          })),
        ),
    },
    startup: {
      findMany: () =>
        Promise.resolve(
          lu.startups.map(({ ghid, vanishedAt }) => ({
            ghid,
            name: ghid,
            vanishedAt: vanishedAt ?? null,
          })),
        ),
    },
    planTemplateStep: { count: () => Promise.resolve(lu.relues) },
  });
});

const ModelesPage = (await import("@/app/modeles/page")).default;

const INCUBATEUR_DEPART: ModeleLu = { ownerKey: CLE_INCUBATEUR, kind: "OFFBOARDING" };

afterEach(cleanup);

async function ouvrir(): Promise<void> {
  render(await ModelesPage());
}

describe("l'écran des modèles rend ce que la base lui dit", () => {
  it("montre l'avertissement du second regard quand rien ne relit un départ, et le retire sinon", async () => {
    // Given un incubateur dont aucune étape de départ n'est relue,
    lu.relues = 0;
    lu.startups = [];
    lu.modeles = [INCUBATEUR_DEPART];

    // When on ouvre l'écran,
    await ouvrir();

    // Then il le dit, et il dit le geste plutôt que la règle,
    expect(screen.getByText(MODELE.secondRegard.titre)).toBeDefined();
    expect(screen.getByText(MODELE.secondRegard.quoiFaire)).toBeDefined();

    // When une étape de départ est relue,
    cleanup();
    lu.relues = 1;
    await ouvrir();

    // Then l'avertissement disparaît. C'est ce sens-là qui compte : un avertissement qui
    // reste affiché une fois le contrôleur posé s'apprend à ignorer, et n'avertit plus
    // de rien.
    expect(screen.queryByText(MODELE.secondRegard.titre)).toBeNull();

    // Then le lien vers le modèle de l'incubateur reste servi dans les deux cas, parce
    // que c'est lui qui mène au geste.
    expect(screen.getByRole("link", { name: "Éditer le modèle de l'incubateur" })).toBeDefined();
  });

  it("montre l'avertissement des modèles orphelins, et n'y range ni l'incubateur ni une startup connue, même sortie", async () => {
    // Given trois modèles de startup. L'un vise une startup active, l'autre une startup
    // sortie, que la collecte garde en base sous `vanishedAt` sans la supprimer, et le
    // dernier un identifiant qu'aucune collecte n'a rendu. Le rapprochement se fait sur
    // le ghid, sans clé étrangère.
    lu.relues = 1;
    lu.startups = [
      { ghid: "produit-exemple" },
      { ghid: "produit-sorti", vanishedAt: new Date("2026-06-01") },
    ];
    lu.modeles = [
      INCUBATEUR_DEPART,
      { ownerKey: "produit-exemple", kind: "ONBOARDING" },
      { ownerKey: "produit-sorti", kind: "OFFBOARDING" },
      { ownerKey: "produit-jamais-vu", kind: "ONBOARDING" },
    ];

    // When on ouvre l'écran,
    await ouvrir();

    // Then seul l'identifiant jamais collecté est signalé et nommé, avec le lien qui
    // mène à ses étapes. La clé de l'incubateur ne sera jamais un ghid, et l'y compter
    // mettrait sous avertissement le modèle qui s'applique à tout le monde.
    const titre = screen.getByRole("heading", {
      name: /ne correspond(ent)? à aucune startup connue/u,
    });
    const alerte = within(titre.parentElement as HTMLElement);
    expect(alerte.getByText(MODELE.orphelins.plusieurs)).toBeDefined();
    expect(alerte.getAllByRole("link").map((lien) => lien.textContent)).toEqual([
      "produit-jamais-vu",
    ]);
    expect(screen.queryByRole("link", { name: CLE_INCUBATEUR })).toBeNull();

    // When une collecte rend pour la première fois cet identifiant,
    cleanup();
    lu.startups = [...lu.startups, { ghid: "produit-jamais-vu" }];
    await ouvrir();

    // Then l'avertissement s'éteint.
    expect(screen.queryByText(MODELE.orphelins.plusieurs)).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EtapeFigee } from "@/app/dossiers/[id]/EtapeOperateur";

import type { GesteEnAttente } from "./geste-en-attente";
import { GESTE } from "./libelles";

/**
 * Ce que la fiche montre d'un brouillon de geste, et ce que son bouton envoie.
 *
 * Un brouillon n'a ni recalcul ni annulation, et reposer le geste est sa seule sortie.
 * Les deux états qui le bloquent doivent donc retirer la confirmation et nommer cette
 * sortie, faute de quoi l'écran offre un bouton qui refusera sans dire quoi faire.
 */

vi.mock("@/app/dossiers/[id]/actions", () => ({
  confirmerPlan: vi.fn(() => Promise.resolve({})),
  pointerEtape: vi.fn(() => Promise.resolve({})),
  validerEtape: vi.fn(() => Promise.resolve({})),
  clorePlan: vi.fn(() => Promise.resolve({})),
  lancerExecution: vi.fn(() => Promise.resolve({})),
  recalculerPlan: vi.fn(() => Promise.resolve({})),
  annulerDossier: vi.fn(() => Promise.resolve({})),
}));

const { confirmerPlan } = await import("@/app/dossiers/[id]/actions");
const { SectionGeste } = await import("./SectionGeste");

afterEach(cleanup);

const ETAPE: EtapeFigee = {
  id: "etape-1",
  label: "Émettre un jeton restreint",
  systemKey: "scalingo",
  capability: "grant",
  idempotencyKey: "cle-1",
  tier: "manual",
  riskLevel: "HIGH",
  state: "PENDING",
  validation: "NONE",
  expectedActor: "OPERATOR",
  validationBy: null,
  declaredBy: null,
  validatedBy: null,
  validatedAt: null,
  validationNote: null,
  manual: { doneWhen: "Le jeton figure dans la fiche du compte machine" },
  reponse: null,
  lastError: null,
  executedAt: null,
  grantExpiresAt: null,
};

const TERME = new Date("2026-10-01T12:00:00Z");

function geste(surcharge: Partial<GesteEnAttente> = {}): GesteEnAttente {
  return {
    planId: "pla-geste",
    systeme: "scalingo",
    etapes: [ETAPE],
    expiresAt: TERME,
    perime: false,
    ecarte: false,
    ...surcharge,
  };
}

function monter(surcharge: Partial<GesteEnAttente> = {}) {
  return render(
    <SectionGeste
      geste={geste(surcharge)}
      nomDuSysteme="Scalingo"
      declarant={{ role: "OPERATOR", operateur: true }}
      valideur={{ username: "operatrice.exemple", role: "OPERATOR" }}
    />,
  );
}

describe("le brouillon de geste sur la fiche de la personne", () => {
  it("montre ses étapes et envoie son identifiant de plan quand on le confirme", async () => {
    // Given un brouillon encore valable,
    monter();

    // Then l'étape figée se lit, avec ce qu'il faudra constater,
    expect(screen.getByText("Émettre un jeton restreint")).toBeDefined();
    expect(screen.getByText(/Le jeton figure dans la fiche du compte machine/u)).toBeDefined();

    // Then le terme se dit, parce qu'un brouillon périmé ne se confirme plus et que
    // rien d'autre ne l'annonce,
    expect(
      screen.getByText(GESTE.terme(TERME, new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }))),
    ).toBeDefined();

    // Then le chemin de retour est servi, et nommé par le système d'où le geste est parti,
    const retour = screen.getByRole("link", { name: GESTE.reposer("Scalingo") });
    expect(retour.getAttribute("href")).toBe("/systemes/scalingo");

    // When on confirme,
    await userEvent.setup().click(screen.getByRole("button", { name: /Confirmer/u }));

    // Then c'est bien l'identifiant du plan qui part, et non celui d'un dossier que ce
    // plan n'a pas. Le lire dans le formulaire rendu est la seule façon de le voir : les
    // accessoires passés au bouton ne disent rien de ce qu'il enverra.
    const envoye = Object.fromEntries(
      vi.mocked(confirmerPlan).mock.calls[0]?.[1] as unknown as FormData,
    );
    expect(envoye).toMatchObject({ planId: "pla-geste" });
  });

  it("retire la confirmation dès que le brouillon ne se confirme plus, et nomme la sortie", () => {
    // Given un brouillon dont le terme est passé,
    monter({ perime: true });

    // Then aucune confirmation n'est offerte. L'offrir ferait cliquer sur un refus,
    expect(screen.queryByRole("button", { name: /Confirmer/u })).toBeNull();

    // Then l'écran dit la seule sortie, qui est de reposer le geste,
    expect(screen.getByText(GESTE.perime("Scalingo"))).toBeDefined();

    // When c'est l'empreinte qui a bougé plutôt que le terme,
    cleanup();
    monter({ ecarte: true });

    // Then même retrait, et une raison différente. Les confondre ferait chercher une
    // date en cause là où c'est la collecte de la nuit qui a déplacé le calcul.
    expect(screen.queryByRole("button", { name: /Confirmer/u })).toBeNull();
    expect(screen.getByText(GESTE.ecarte("Scalingo"))).toBeDefined();
    expect(screen.queryByText(GESTE.perime("Scalingo"))).toBeNull();

    // Then le chemin de retour reste servi dans les deux cas, c'est lui qui porte la sortie.
    expect(screen.getByRole("link", { name: GESTE.reposer("Scalingo") })).toBeDefined();
  });
});

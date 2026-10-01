// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EtapeFigee } from "@/app/dossiers/[id]/EtapeOperateur";
import { REFUS_DEPART_OUVERT } from "@/lib/geste";
import { dateLocale, instantLocal } from "@/ui/dates";

import type { GesteEnAttente } from "./geste-en-attente";
import type { GesteEnCours } from "./gestes-confirmes";
import { GESTE, GESTE_CONFIRME } from "./libelles";

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

const { confirmerPlan, lancerExecution, pointerEtape } = await import(
  "@/app/dossiers/[id]/actions"
);
const { SectionGeste } = await import("./SectionGeste");
const { GestesSoldes, SectionGesteEnCours } = await import("./SectionGestesConfirmes");
const { PorteurDeRemises } = await import("@/app/dossiers/[id]/PorteurDeRemises");

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
    // Then le terme se dit avec son heure, parce qu'il tombe à un instant : sept jours
    // après l'écriture, et non la fin du septième jour. La date seule laisserait croire
    // à des heures de validité que le brouillon n'a pas.
    expect(screen.getByText(GESTE.terme(TERME, instantLocal))).toBeDefined();
    expect(instantLocal.format(TERME)).toMatch(/\d{1,2}:\d{2}/u);

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

const CONFIRME_LE = new Date("2026-09-20T08:00:00Z");
const TERME_DE_L_ACCES = new Date("2026-12-01T12:00:00Z");

function enCours(surcharge: Partial<GesteEnCours> = {}): GesteEnCours {
  return {
    planId: "pla-confirme",
    systeme: "scalingo",
    etat: "EXECUTING",
    etapes: [
      {
        ...ETAPE,
        grantExpiresAt: TERME_DE_L_ACCES,
        voie: "Aujourd'hui cette étape est à faire à la main.",
      },
    ],
    confirmeLe: CONFIRME_LE,
    confirmePar: "operatrice.exemple",
    refus: null,
    pointable: true,
    masse: { executables: 1, seuil: 20, depasse: false },
    ...surcharge,
  };
}

function monterEnCours(surcharge: Partial<GesteEnCours> = {}) {
  return render(
    <SectionGesteEnCours
      geste={enCours(surcharge)}
      nomDuSysteme="Scalingo"
      declarant={{ role: "OPERATOR", operateur: true }}
      valideur={{ username: "operatrice.exemple", role: "OPERATOR" }}
      simulation
    />,
  );
}

describe("le geste confirmé sur la fiche de la personne", () => {
  it("se pointe et se lance d'ici, en envoyant l'identifiant de son plan", async () => {
    // Given un geste confirmé que l'exécution accepterait,
    monterEnCours();
    const utilisateur = userEvent.setup();

    // Then il se nomme par son système, et dit qui en répond,
    expect(screen.getByRole("heading", { name: GESTE_CONFIRME.titre("Scalingo") })).toBeDefined();
    expect(
      screen.getByText(GESTE_CONFIRME.confirme(CONFIRME_LE, "operatrice.exemple", dateLocale)),
    ).toBeDefined();

    // Then l'étape dit sa voie du jour, et le terme de l'accès se lit avant le lancement,
    // seul endroit où il se lit,
    expect(screen.getByText("Aujourd'hui cette étape est à faire à la main.")).toBeDefined();
    expect(
      screen.getByText(
        `Émettre un jeton restreint : jusqu'au ${dateLocale.format(TERME_DE_L_ACCES)}.`,
      ),
    ).toBeDefined();

    // Then le lancement n'est pas le bouton primaire de la fiche, qui peut porter un
    // brouillon à confirmer et d'autres gestes,
    const lancer = screen.getByRole("button", { name: "Lancer la simulation" });
    expect(lancer.className).toContain("fr-btn--secondary");

    // When on lance la simulation,
    await utilisateur.click(lancer);

    // Then c'est le plan du geste qui part, lu dans le formulaire rendu,
    const lance = Object.fromEntries(
      vi.mocked(lancerExecution).mock.calls[0]?.[1] as unknown as FormData,
    );
    expect(lance).toMatchObject({ planId: "pla-confirme" });

    // When on pointe l'étape à la main,
    await utilisateur.selectOptions(screen.getByLabelText("Ce qui a été fait"), "fait");
    await utilisateur.click(screen.getByRole("button", { name: /Enregistrer/u }));

    // Then c'est l'étape du geste qui est pointée, sans dossier pour la porter.
    const pointe = Object.fromEntries(
      vi.mocked(pointerEtape).mock.calls[0]?.[1] as unknown as FormData,
    );
    expect(pointe).toMatchObject({ etapeId: "etape-1", pointage: "fait" });
  });

  it("garde la clé remise quand un rafraîchissement retire le geste qui l'a émise", async () => {
    // Given un geste dont le lancement émet un jeton, sous le porteur de la fiche,
    vi.mocked(lancerExecution).mockResolvedValueOnce({
      execution: {
        simulation: false,
        executees: 1,
        soldees: 1,
        echecs: 0,
        remises: [
          {
            key: "scalingo:jeton:pla-confirme",
            label: "Jeton Scalingo sur service-annuaire",
            aRemettre: "cle_inventee_pour_ce_test",
          },
        ],
      },
    });
    const fiche = (avecLeGeste: boolean) => (
      <PorteurDeRemises titre="h2">
        {avecLeGeste ? (
          <SectionGesteEnCours
            geste={enCours()}
            nomDuSysteme="Scalingo"
            declarant={{ role: "OPERATOR", operateur: true }}
            valideur={{ username: "operatrice.exemple", role: "OPERATOR" }}
            simulation
          />
        ) : null}
      </PorteurDeRemises>
    );
    const { rerender } = render(fiche(true));

    // When on lance,
    await userEvent.setup().click(screen.getByRole("button", { name: "Lancer la simulation" }));

    // Then la clé se lit,
    expect(await screen.findByText("cle_inventee_pour_ce_test", { exact: false })).toBeDefined();

    // When un rafraîchissement range le geste soldé hors des gestes en cours, ce que fait
    // n'importe quelle action de la fiche,
    rerender(fiche(false));

    // Then la clé reste lisible : elle ne vivait pas dans le bouton qui vient de partir.
    expect(screen.queryByRole("button", { name: "Lancer la simulation" })).toBeNull();
    expect(screen.getByText("cle_inventee_pour_ce_test", { exact: false })).toBeDefined();
  });

  it("remplace le lancement par son refus, et garde l'étape à écarter avec sa raison", async () => {
    // Given un geste dont l'empreinte a bougé depuis la confirmation, et une étape qui a
    // échoué au passage précédent,
    const refus = "Ce plan ne décrit plus ce qui a été approuvé. Reposez ce geste.";
    monterEnCours({ refus, masse: null, etat: "PARTIALLY_EXECUTED" });
    const utilisateur = userEvent.setup();

    // Then aucun lancement n'est offert, et le refus se lit à sa place,
    expect(screen.queryByRole("button", { name: "Lancer la simulation" })).toBeNull();
    expect(screen.getByText(refus)).toBeDefined();
    expect(screen.getByText(GESTE_CONFIRME.echec)).toBeDefined();
    expect(screen.getByRole("link", { name: GESTE.reposer("Scalingo") })).toBeDefined();

    // When on écarte l'étape avec sa raison, seule sortie d'un plan sans dossier,
    await utilisateur.selectOptions(screen.getByLabelText("Ce qui a été fait"), "ignoree");
    await utilisateur.type(screen.getByLabelText("Raison"), "Accès donné par un autre geste");
    await utilisateur.click(screen.getByRole("button", { name: /Enregistrer/u }));

    // Then l'écart part avec sa raison,
    const ecarte = Object.fromEntries(
      vi.mocked(pointerEtape).mock.calls.at(-1)?.[1] as unknown as FormData,
    );
    expect(ecarte).toMatchObject({
      etapeId: "etape-1",
      pointage: "ignoree",
      note: "Accès donné par un autre geste",
    });

    // When un départ est ouvert sur la personne,
    cleanup();
    monterEnCours({ refus: REFUS_DEPART_OUVERT, masse: null, pointable: false });

    // Then plus rien ne se pointe ni ne se repose : les deux refuseraient.
    expect(screen.getByText(REFUS_DEPART_OUVERT)).toBeDefined();
    expect(screen.queryByLabelText("Ce qui a été fait")).toBeNull();
    expect(screen.queryByRole("link", { name: GESTE.reposer("Scalingo") })).toBeNull();
  });

  it("résume les gestes soldés avec les termes qu'ils ont posés", () => {
    // Given deux gestes soldés, dont un a posé un terme,
    const terme = new Date("2027-03-01T12:00:00Z");
    render(
      <GestesSoldes
        gestes={[
          {
            planId: "pla-jeton",
            systeme: "scalingo",
            etapes: 2,
            confirmeLe: CONFIRME_LE,
            confirmePar: "operatrice.exemple",
            termes: [terme],
          },
          {
            planId: "pla-collaboration",
            systeme: "inconnu",
            etapes: 1,
            confirmeLe: null,
            confirmePar: null,
            termes: [],
          },
        ]}
        nomDuSysteme={(cle) => (cle === "scalingo" ? "Scalingo" : cle)}
      />,
    );

    // Then ils se comptent, et chacun se lit avec son système et son terme.
    expect(screen.getByRole("button", { name: GESTE_CONFIRME.soldes(2) })).toBeDefined();
    expect(
      screen.getByText(
        GESTE_CONFIRME.solde("Scalingo", 2, CONFIRME_LE, "operatrice.exemple", dateLocale),
        { exact: false },
      ),
    ).toBeDefined();
    expect(
      screen.getByText(GESTE_CONFIRME.terme(terme, dateLocale), { exact: false }),
    ).toBeDefined();
    expect(screen.getByText("inconnu, 1 étape. Confirmé.")).toBeDefined();
  });
});

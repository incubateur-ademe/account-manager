// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVUE_PAR_DEFAUT } from "@/core/compte-de-service";

/**
 * L'action serveur remonte jusqu'à `next-auth`, une chaîne que jsdom ne résout pas :
 * le double la coupe à sa racine.
 */
const doubles = vi.hoisted(() => ({ declarer: vi.fn() }));

vi.mock("@/app/comptes-de-service/actions", () => ({
  declarerUnCompteDeService: doubles.declarer,
}));

const { Declarer } = await import("@/app/comptes-de-service/Declarer");

const MODALE = "declarer-compte-de-service";

/**
 * Ce que le JS du système de design ferait, et que jsdom ne fera jamais : basculer
 * l'attribut et émettre l'évènement que `useCleDOuverture` écoute. `modale.close` passe
 * par `window.dsfr`, donc la fermeture demandée par le code emprunte la même porte que
 * celle qu'un opérateur déclenche.
 */
function basculer(element: HTMLElement, ouvert: boolean): void {
  if (ouvert) {
    element.setAttribute("open", "");
    element.dispatchEvent(new Event("dsfr.disclose"));
  } else {
    element.removeAttribute("open");
    element.dispatchEvent(new Event("dsfr.conceal"));
  }
}

function poserLeRuntimeDuSystemeDeDesign(): void {
  const dsfr = (element: HTMLElement | null) => ({
    modal: {
      disclose: () => {
        if (element !== null) basculer(element, true);
      },
      conceal: () => {
        if (element !== null) basculer(element, false);
      },
    },
  });
  (window as unknown as { dsfr: typeof dsfr }).dsfr = dsfr;
}

function modaleDe(): HTMLElement {
  const element = document.getElementById(MODALE);
  if (element === null) {
    throw new Error("La modale de déclaration n'est pas montée.");
  }
  return element;
}

function ouvrir(): void {
  act(() => {
    basculer(modaleDe(), true);
  });
}

function fermer(): void {
  act(() => {
    basculer(modaleDe(), false);
  });
}

const SYSTEMES = [
  { key: "github", label: "GitHub" },
  { key: "notion", label: "Notion" },
];

const DEJA_PRISE = "Un compte de service porte déjà la clé « github-robot-gabarits ».";

async function saisir(
  utilisateur: ReturnType<typeof userEvent.setup>,
  compte: { provider: string; key: string; label: string },
) {
  const modale = within(modaleDe());
  await utilisateur.selectOptions(modale.getByLabelText(/^Système/), compte.provider);
  await utilisateur.type(modale.getByLabelText(/^Clé/), compte.key);
  await utilisateur.type(modale.getByLabelText(/^Libellé/), compte.label);
  await utilisateur.type(modale.getByLabelText(/^Objet/), "Publier les gabarits");
  await utilisateur.type(modale.getByLabelText(/^Propriétaire/), "operatrice.exemple");
  await utilisateur.click(modale.getByRole("button", { name: "Déclarer" }));
}

beforeEach(poserLeRuntimeDuSystemeDeDesign);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("la déclaration d'un compte de service", () => {
  it("ne rejoue pas le refus de la déclaration précédente, et se retire quand le serveur a accepté", async () => {
    // Given un premier compte dont la clé est déjà prise
    const utilisateur = userEvent.setup();
    doubles.declarer.mockResolvedValueOnce({ erreur: DEJA_PRISE }).mockResolvedValueOnce(null);

    render(<Declarer systemes={SYSTEMES} />);
    ouvrir();

    // When on le déclare
    await saisir(utilisateur, {
      provider: "github",
      key: "github-robot-gabarits",
      label: "GitHub · robot des gabarits",
    });

    // Then le refus se lit, et l'action a reçu la saisie sous les noms qu'elle lit : un
    // champ renommé ici ferait refuser une déclaration complète comme incomplète.
    expect(await within(modaleDe()).findByText(DEJA_PRISE)).toBeDefined();
    const premier = doubles.declarer.mock.calls[0]?.[1] as FormData;
    expect(premier.get("provider")).toBe("github");
    expect(premier.get("key")).toBe("github-robot-gabarits");
    expect(premier.get("label")).toBe("GitHub · robot des gabarits");
    expect(premier.get("purpose")).toBe("Publier les gabarits");
    expect(premier.get("ownerUsername")).toBe("operatrice.exemple");
    expect(premier.get("reviewEveryDays")).toBe(String(REVUE_PAR_DEFAUT));

    // When on referme, puis on rouvre pour déclarer un autre compte
    fermer();
    ouvrir();

    // Then le formulaire repart vierge : ce refus périmé coifferait sinon des champs
    // vides, et porterait sur une clé que plus personne n'a saisie.
    expect(within(modaleDe()).queryByText(DEJA_PRISE)).toBeNull();
    expect(within(modaleDe()).getByLabelText(/^Clé/)).toHaveProperty("value", "");
    expect(within(modaleDe()).getByLabelText(/^Libellé/)).toHaveProperty("value", "");

    // When le serveur accepte celui-ci
    await saisir(utilisateur, {
      provider: "notion",
      key: "notion-robot-gabarits",
      label: "Notion · robot des gabarits",
    });

    // Then la modale se retire d'elle-même. Un succès ne laisse rien à lire ici : rester
    // ouvert sur des champs encore remplis fait recliquer, et le second envoi se heurte
    // à la clé que le premier vient de poser.
    expect(doubles.declarer).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(modaleDe().hasAttribute("open")).toBe(false);
    });
    expect(screen.queryByText(DEJA_PRISE)).toBeNull();
  });
});

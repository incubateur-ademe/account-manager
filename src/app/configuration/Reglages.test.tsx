// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LigneDeReglage } from "@/app/configuration/Reglages";

/**
 * L'action serveur remonte jusqu'à `next-auth`, une chaîne que jsdom ne résout pas :
 * le double la coupe à sa racine.
 */
const doubles = vi.hoisted(() => ({ regler: vi.fn(), lever: vi.fn() }));

vi.mock("@/app/configuration/actions", () => ({
  reglerUneValeur: doubles.regler,
  leverUnReglage: doubles.lever,
}));

const { Reglages } = await import("@/app/configuration/Reglages");

const MODALE = "regler-une-valeur";

/**
 * Ce que le JS du système de design ferait, et que jsdom ne fera jamais : basculer
 * l'attribut et émettre l'évènement que `useCleDOuverture` écoute. `modale.close` passant
 * par `window.dsfr`, la même porte sert à la fermeture que le composant demande.
 */
function poserLeRuntimeDuSystemeDeDesign(): void {
  const dsfr = (element: HTMLElement | null) => ({
    modal: {
      disclose: () => {
        element?.setAttribute("open", "");
        element?.dispatchEvent(new Event("dsfr.disclose"));
      },
      conceal: () => {
        element?.removeAttribute("open");
        element?.dispatchEvent(new Event("dsfr.conceal"));
      },
    },
  });
  (window as unknown as { dsfr: typeof dsfr }).dsfr = dsfr;
}

function modaleDe(): HTMLElement {
  const element = document.getElementById(MODALE);
  if (element === null) {
    throw new Error("La modale des réglages n'est pas montée.");
  }
  return element;
}

function ouvrir(): void {
  act(() => {
    modaleDe().setAttribute("open", "");
    modaleDe().dispatchEvent(new Event("dsfr.disclose"));
  });
}

function fermer(): void {
  act(() => {
    modaleDe().removeAttribute("open");
    modaleDe().dispatchEvent(new Event("dsfr.conceal"));
  });
}

const REVUE: LigneDeReglage = {
  chemin: "comptesDeService.revueTousLesJours",
  variable: "COMPTES_DE_SERVICE_REVUE_TOUS_LES_JOURS",
  forme: "nombre",
  valeur: "90",
  niveau: "base",
  severite: "success",
  provenance: "Réglé ici",
};

const DELAI: LigneDeReglage = {
  chemin: "depart.delaiDeCoupure",
  variable: "DEPART_DELAI_DE_COUPURE",
  forme: "nombre",
  valeur: "7",
  niveau: "fichier",
  severite: "info",
  provenance: "Fichier",
};

/** Le tableau, et non l'écran : la modale ouverte porte le même chemin en titre. */
function ligneDe(chemin: string): HTMLElement {
  const ligne = within(screen.getByRole("table")).getByText(chemin).closest("tr");
  if (ligne === null) {
    throw new Error(`Aucune ligne pour ${chemin}.`);
  }
  return ligne;
}

function formulaireDe(libelleDuBouton: string): HTMLElement {
  const formulaire = within(modaleDe())
    .getByRole("button", { name: libelleDuBouton })
    .closest("form");
  if (formulaire === null) {
    throw new Error(`Le bouton « ${libelleDuBouton} » n'est dans aucun formulaire.`);
  }
  return formulaire;
}

async function choisir(utilisateur: ReturnType<typeof userEvent.setup>, chemin: string) {
  await utilisateur.click(within(ligneDe(chemin)).getByRole("button", { name: "Régler" }));
  ouvrir();
}

beforeEach(poserLeRuntimeDuSystemeDeDesign);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("les réglages de la configuration", () => {
  it("ne montre pas sur un réglage le refus qu'un autre a essuyé", async () => {
    const utilisateur = userEvent.setup();
    doubles.regler.mockResolvedValueOnce({ erreur: "Valeur refusée : trop petit." });

    // Given un premier réglage dont l'envoi se solde par un refus lisible
    render(<Reglages lignes={[REVUE, DELAI]} />);
    await choisir(utilisateur, REVUE.chemin);

    await utilisateur.click(within(modaleDe()).getByRole("button", { name: "Régler" }));

    expect(await screen.findByText("Valeur refusée : trop petit.")).toBeDefined();

    // When on referme, puis on vient régler un autre chemin
    fermer();
    await choisir(utilisateur, DELAI.chemin);

    // Then le champ porte la valeur du réglage choisi, et rien du refus précédent : une
    // phrase héritée porterait ici sur une valeur que l'on n'a pas essayée.
    expect(screen.queryByText("Valeur refusée : trop petit.")).toBeNull();
    expect(within(modaleDe()).getByRole("textbox")).toHaveProperty("value", DELAI.valeur);
    expect(doubles.regler).toHaveBeenCalledTimes(1);
  });

  it("ferme la modale sur chacun des deux gestes qui aboutissent", async () => {
    const utilisateur = userEvent.setup();
    doubles.regler.mockResolvedValue(null);
    doubles.lever.mockResolvedValue(null);

    // Given un réglage posé ici, donc le seul des deux qui se rende au fichier
    render(<Reglages lignes={[REVUE, DELAI]} />);
    await choisir(utilisateur, REVUE.chemin);

    // When on pose une autre valeur et que le serveur l'accepte
    const champ = within(modaleDe()).getByRole("textbox");
    await utilisateur.clear(champ);
    await utilisateur.type(champ, "120");
    await utilisateur.click(within(modaleDe()).getByRole("button", { name: "Régler" }));

    // Then le chemin et la valeur partent ensemble, et la modale se ferme. Ces actions
    // ne rendent rien quand elles aboutissent, la fermeture est le seul signe que la
    // valeur est passée.
    await vi.waitFor(() => {
      expect(modaleDe().hasAttribute("open")).toBe(false);
    });
    const pose = doubles.regler.mock.calls[0]?.[1] as FormData;
    expect(pose.get("chemin")).toBe(REVUE.chemin);
    expect(pose.get("valeur")).toBe("120");

    // When on rouvre le même réglage pour le rendre au fichier, et que la levée aboutit
    await choisir(utilisateur, REVUE.chemin);
    expect(modaleDe().hasAttribute("open")).toBe(true);
    await utilisateur.click(within(modaleDe()).getByRole("button", { name: "Rendre au fichier" }));

    // Then elle se ferme aussi. C'est le geste qui se paie le plus cher en restant
    // ouvert : le second clic tombe sur un réglage que le premier a levé, et le serveur
    // répond « Aucun réglage à lever », un refus qui porte sur la réussite d'avant.
    await vi.waitFor(() => {
      expect(modaleDe().hasAttribute("open")).toBe(false);
    });
    expect(doubles.lever).toHaveBeenCalledTimes(1);
    const levee = doubles.lever.mock.calls[0]?.[1] as FormData;
    expect(levee.get("chemin")).toBe(REVUE.chemin);
    expect(doubles.regler).toHaveBeenCalledTimes(1);
  });

  it("range le refus de la levée sous son bouton, et laisse le champ de valeur hors de cause", async () => {
    const utilisateur = userEvent.setup();
    const refus = "Aucun réglage à lever sur « comptesDeService.revueTousLesJours ».";
    doubles.lever.mockResolvedValueOnce({ erreur: refus });

    // Given un réglage que l'écran donne pour posé ici, mais que la base ne porte plus
    render(<Reglages lignes={[REVUE, DELAI]} />);
    await choisir(utilisateur, REVUE.chemin);

    // When on le rend au fichier et que le serveur refuse
    await utilisateur.click(within(modaleDe()).getByRole("button", { name: "Rendre au fichier" }));

    // Then le refus se lit dans le formulaire qui l'a provoqué
    const phrase = await within(modaleDe()).findByText(refus);
    expect(phrase.closest("form")).toBe(formulaireDe("Rendre au fichier"));

    // And rien n'en arrive au champ de valeur. Logé là, ce refus accuserait une saisie
    // que personne n'a envoyée.
    expect(within(formulaireDe("Régler")).queryByText(refus)).toBeNull();
    const champ = within(modaleDe()).getByRole("textbox");
    expect(champ).toHaveProperty("value", REVUE.valeur);
    expect(champ.className).not.toContain("fr-input--error");

    // And la modale reste ouverte, sans quoi elle emporterait le refus.
    expect(modaleDe().hasAttribute("open")).toBe(true);
  });
});

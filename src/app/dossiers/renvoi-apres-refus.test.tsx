// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Ce qu'une liste déroulante renvoie après un refus du serveur.
 *
 * React remet un `<form action>` à zéro quand l'action rend la main, refus compris, et la
 * sélection d'une liste se défait avec lui. Un `FormData` se lit dans le DOM : sans le
 * rendu qui la rétablit, corriger sa saisie et renvoyer expédierait la première option.
 * Sur un pointage, c'est déclarer « fait » ce qui a échoué.
 *
 * Une histoire par formulaire qui porte une liste, hors de l'éditeur de modèle et de la
 * déclaration d'un compte de service, qui ont les leurs : chacun appelle
 * `useListesApresEnvoi` de son côté, et un seul oubli suffit. Deux refus de suite, parce
 * qu'on corrige puis qu'on renvoie : un rétablissement qui ne jouerait qu'une fois laisserait
 * le second envoi repartir sur la première option.
 */

const { refus } = vi.hoisted(() => ({
  refus: (erreur: string) => vi.fn(() => Promise.resolve({ erreur })),
}));

vi.mock("@/app/dossiers/[id]/actions", () => ({
  pointerEtape: refus("Cette étape attend quelqu'un d'autre."),
  validerEtape: refus("Une déclaration ne se valide pas par son auteur."),
  confirmerPlan: vi.fn(),
  lancerExecution: vi.fn(),
  recalculerPlan: vi.fn(),
  cloreDossier: vi.fn(),
  annulerDossier: vi.fn(),
}));

vi.mock("@/app/dossiers/actions", () => ({
  ouvrirArrivee: refus("Un dossier d'arrivée est déjà ouvert sur cette personne."),
  ouvrirDepart: vi.fn(),
}));

const { pointerEtape, validerEtape } = await import("@/app/dossiers/[id]/actions");
const { ouvrirArrivee } = await import("@/app/dossiers/actions");
const { Pointage, Validation } = await import("@/app/dossiers/[id]/Pointage");
const { FormulaireOuverture } = await import("@/app/dossiers/FormulaireOuverture");

afterEach(cleanup);

/** Ce que le formulaire enverrait maintenant, lu dans le DOM comme le navigateur le lit. */
function aEnvoyer(controle: HTMLElement): Record<string, FormDataEntryValue> {
  return Object.fromEntries(new FormData(controle.closest("form") as HTMLFormElement));
}

describe("une liste déroulante après un refus", () => {
  it("renvoie l'échec choisi au pointage, et non « c'est fait »", async () => {
    // Given une étape à pointer, et une opératrice qui déclare un échec avec sa raison
    render(
      <Pointage
        etapeId="etape-1"
        faite={false}
        sens="OFFBOARDING"
        saisie={null}
        reponse={null}
        ecartOffert
        possible
        raison={null}
      />,
    );
    const utilisateur = userEvent.setup();
    const liste = screen.getByLabelText("Ce qui a été fait");
    await utilisateur.selectOptions(liste, "echec");
    await utilisateur.type(screen.getByLabelText("Raison"), "La console refuse le retrait");

    // When le serveur refuse
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Cette étape attend quelqu'un d'autre.")).toBeDefined();

    // Then la liste renvoie l'échec, attendu et non lu au vol : ce qui la rétablit passe
    // par un rendu plus tardif que celui où le refus paraît
    expect(vi.mocked(pointerEtape)).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(aEnvoyer(screen.getByLabelText("Ce qui a été fait"))).toMatchObject({
        pointage: "echec",
      });
    });

    // When elle corrige sa raison et renvoie, et que le serveur refuse encore
    await utilisateur.clear(screen.getByLabelText("Raison"));
    await utilisateur.type(screen.getByLabelText("Raison"), "La console refuse toujours");
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer" }));
    await vi.waitFor(() => expect(vi.mocked(pointerEtape)).toHaveBeenCalledTimes(2));

    // Then la liste renvoie encore l'échec
    await vi.waitFor(() => {
      expect(aEnvoyer(screen.getByLabelText("Ce qui a été fait"))).toMatchObject({
        pointage: "echec",
      });
    });
  });

  it("renvoie le refus d'une déclaration, et non son acceptation", async () => {
    // Given une déclaration soumise au regard, et un valideur qui la refuse avec un motif
    render(<Validation etapeId="etape-1" ecart={false} possible raison={null} />);
    const utilisateur = userEvent.setup();
    await utilisateur.selectOptions(
      screen.getByLabelText("Ce que vaut cette déclaration"),
      "refuser",
    );
    await utilisateur.type(screen.getByLabelText("Motif du refus"), "Le badge n'est pas rendu");

    // When le serveur refuse
    await utilisateur.click(screen.getByRole("button", { name: "Enregistrer cet avis" }));
    expect(
      await screen.findByText("Une déclaration ne se valide pas par son auteur."),
    ).toBeDefined();

    // Then la liste renvoie le refus, et encore après un second refus du serveur
    for (const envois of [1, 2]) {
      await vi.waitFor(() => expect(vi.mocked(validerEtape)).toHaveBeenCalledTimes(envois));
      await vi.waitFor(() => {
        expect(aEnvoyer(screen.getByLabelText("Ce que vaut cette déclaration"))).toMatchObject({
          verdict: "refuser",
        });
      });
      if (envois === 1) {
        await utilisateur.clear(screen.getByLabelText("Motif du refus"));
        await utilisateur.type(screen.getByLabelText("Motif du refus"), "Le badge manque encore");
        await utilisateur.click(screen.getByRole("button", { name: "Enregistrer cet avis" }));
      }
    }
  });

  it("renvoie le profil choisi à l'ouverture d'une arrivée, et non l'arrivée sans profil", async () => {
    // Given une arrivée à ouvrir, et un profil choisi
    render(
      <FormulaireOuverture
        username="nour.exemple"
        sens="ONBOARDING"
        profils={{
          etat: "lus",
          offerts: [{ cle: "developpeur", libelle: "Développeur", ouvre: [], refus: [] }],
          refuses: [],
        }}
      />,
    );
    const utilisateur = userEvent.setup();
    await utilisateur.selectOptions(screen.getByLabelText(/Profil appliqué/u), "developpeur");

    // When le serveur refuse
    await utilisateur.click(screen.getByRole("button", { name: "Ouvrir le dossier" }));
    expect(
      await screen.findByText("Un dossier d'arrivée est déjà ouvert sur cette personne."),
    ).toBeDefined();

    // Then la liste renvoie le profil, et encore après un second refus du serveur
    for (const envois of [1, 2]) {
      await vi.waitFor(() => expect(vi.mocked(ouvrirArrivee)).toHaveBeenCalledTimes(envois));
      await vi.waitFor(() => {
        expect(aEnvoyer(screen.getByLabelText(/Profil appliqué/u))).toMatchObject({
          profil: "developpeur",
        });
      });
      if (envois === 1) {
        await utilisateur.click(screen.getByRole("button", { name: "Ouvrir le dossier" }));
      }
    }
  });
});

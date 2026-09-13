// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useActionState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCleDOuverture, useFermetureApresSucces } from "@/ui/modale";

const modale = { id: "essai-de-modale", isOpenedByDefault: false };

type Etat = { erreur?: string; message?: string } | null;

type Action = (precedent: Etat, donnees: FormData) => Promise<Etat>;

/** Rend les issues dans l'ordre où on les a écrites, puis le succès muet. */
function actionScriptee(issues: readonly Etat[]): Action {
  let appel = 0;
  return () => Promise.resolve(issues[appel++] ?? null);
}

function Formulaire({ agir, fermer }: { agir: Action; fermer: () => void }) {
  const [etat, envoyer, pending] = useActionState<Etat, FormData>(agir, null);

  useFermetureApresSucces(pending, etat?.erreur ?? etat?.message, fermer);

  return (
    <form action={envoyer}>
      <label htmlFor="raison">Ce qui a été fait</label>
      <input id="raison" name="raison" defaultValue="" />
      <button type="submit">Clore</button>
      {etat?.erreur === undefined ? null : <p>{etat.erreur}</p>}
      {etat?.message === undefined ? null : <p>{etat.message}</p>}
    </form>
  );
}

/**
 * Le dialogue n'est ici qu'une cible d'événement, et le formulaire lui reste extérieur.
 *
 * C'est fidèle à ce qu'on exerce : dans le système de design la modale ne meurt jamais
 * et son contenu reste monté, ouverte ou non. Le mettre dans le `dialog` ferait décider
 * la feuille de style par défaut de jsdom de ce qui est lisible, alors que la garantie
 * porte sur la clé, pas sur l'affichage.
 */
function Ecran({ agir, fermer }: { agir: Action; fermer: () => void }) {
  const ouverture = useCleDOuverture(modale);

  return (
    <>
      <dialog id={modale.id} />
      <Formulaire key={ouverture} agir={agir} fermer={fermer} />
    </>
  );
}

function dialogue(): HTMLElement {
  const element = document.getElementById(modale.id);
  if (element === null) {
    throw new Error("le dialogue d'essai n'est pas dans le document");
  }
  return element;
}

function ouvrir(): void {
  act(() => {
    dialogue().dispatchEvent(new Event("dsfr.disclose"));
  });
}

function fermerDuDehors(): void {
  act(() => {
    dialogue().dispatchEvent(new Event("dsfr.conceal"));
  });
}

// Les globals ne sont pas activés, donc le nettoyage automatique de la bibliothèque de
// rendu ne s'accroche à rien : sans ça, le second scénario trouverait deux formulaires et
// deux dialogues du même identifiant.
afterEach(cleanup);

describe("la remise à neuf des modales", () => {
  it("ne rejoue pas à la réouverture l'issue de l'ouverture précédente", async () => {
    const utilisateur = userEvent.setup();
    const fermer = vi.fn();

    // Given une modale ouverte, dont l'envoi se solde par un refus lisible
    render(
      <Ecran agir={actionScriptee([{ erreur: "Dites ce qui a été fait." }])} fermer={fermer} />,
    );
    ouvrir();

    await utilisateur.type(screen.getByLabelText("Ce qui a été fait"), "Accès coupés hier");
    await utilisateur.click(screen.getByRole("button", { name: "Clore" }));

    expect(await screen.findByText("Dites ce qui a été fait.")).toBeDefined();
    expect(fermer).not.toHaveBeenCalled();

    // When on referme, puis on rouvre pour un autre geste
    fermerDuDehors();
    ouvrir();

    // Then rien du geste précédent ne survit : ni le refus périmé, ni la saisie qui
    // l'avait provoqué. Une phrase héritée porterait ici sur une cible que l'on n'a
    // pas choisie.
    expect(screen.queryByText("Dites ce qui a été fait.")).toBeNull();
    expect(screen.getByLabelText("Ce qui a été fait")).toHaveProperty("value", "");
  });

  it("ne ferme la modale qu'au bout d'un envoi qui ne laisse rien à lire", async () => {
    const utilisateur = userEvent.setup();
    const fermer = vi.fn();

    // Given une modale qui vient de s'ouvrir, donc dont l'état vaut `null` sans qu'aucun
    // envoi n'ait eu lieu : la même valeur que celle d'un succès
    render(
      <Ecran
        agir={actionScriptee([
          { erreur: "Dites ce qui a été fait." },
          { message: "Deux comptes restent à couper à la main." },
        ])}
        fermer={fermer}
      />,
    );
    ouvrir();

    // Then elle reste ouverte : sans quoi elle disparaîtrait avant d'avoir servi
    expect(fermer).not.toHaveBeenCalled();

    const bouton = screen.getByRole("button", { name: "Clore" });

    // When un premier envoi se solde par un refus
    await utilisateur.click(bouton);

    // Then le refus se lit et retient la fermeture
    expect(await screen.findByText("Dites ce qui a été fait.")).toBeDefined();
    expect(fermer).not.toHaveBeenCalled();

    // When un deuxième envoi aboutit, mais rapporte une phrase qui ne se lit qu'ici
    await utilisateur.click(bouton);

    // Then la fermeture l'emporterait avec elle, donc elle attend
    expect(await screen.findByText("Deux comptes restent à couper à la main.")).toBeDefined();
    expect(fermer).not.toHaveBeenCalled();

    // When un troisième envoi aboutit sans rien laisser à lire
    await utilisateur.click(bouton);

    // Then, et alors seulement, la modale se ferme, une seule fois
    await vi.waitFor(() => {
      expect(fermer).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Deux comptes restent à couper à la main.")).toBeNull();
  });
});

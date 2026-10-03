// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DESTIN_AU_DEPART } from "@/ui/severites";

import { objetsDeLaFiche, SectionObjetsPossedes } from "./SectionObjetsPossedes";

afterEach(cleanup);

const objet = (id: string, onOffboard: "TRANSFER" | "ARCHIVE" | "KEEP") => ({
  id,
  onOffboard,
  resource: { label: `Dépôt incubateur-exemple/${id}`, url: null },
});

describe("les objets possédés sur la fiche d'une personne", () => {
  it("annonce le geste du départ sur preuve, et rien sur une ressemblance", () => {
    // Given un compte rattaché sur preuve et un compte rattaché par ressemblance, chacun avec
    // un dépôt à transférer
    const objets = objetsDeLaFiche([
      {
        provider: "github",
        handle: "alix-gh",
        matchMethod: "GITHUB_LOGIN",
        references: [objet("carte", "TRANSFER")],
      },
      {
        provider: "github",
        handle: "alix-dev",
        matchMethod: "HEURISTIC",
        references: [objet("prototype", "TRANSFER")],
      },
    ]);

    // When la section se rend
    render(<SectionObjetsPossedes objets={objets} />);
    const lignes = screen
      .getAllByRole("row")
      .slice(1)
      .map((ligne) => ligne.textContent);

    // Then le dépôt du compte sûr annonce son transfert, et celui de la ressemblance ne
    // promet rien que le départ ne fera
    expect(lignes).toEqual([
      `Dépôt incubateur-exemple/cartegithubalix-gh${DESTIN_AU_DEPART.TRANSFER.libelle}`,
      "Dépôt incubateur-exemple/prototypegithubalix-devRattachement à confirmer",
    ]);
  });
});

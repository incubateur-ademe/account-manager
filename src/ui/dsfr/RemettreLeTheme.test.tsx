// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemettreLeTheme } from "@/ui/dsfr/RemettreLeTheme";

const enSombre = vi.hoisted(() => ({ valeur: true }));

vi.mock("@codegouvfr/react-dsfr/useIsDark", () => ({
  useIsDark: () => ({ isDark: enSombre.valeur, setIsDark: () => undefined }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-fr-theme");
  document.documentElement.removeAttribute("data-fr-scheme");
});

describe("le thème qu'une réponse d'erreur emporte", () => {
  it("repose la couleur du moment quand le document n'en porte plus, et ne touche pas celle qui tient", () => {
    // Given un document dont le gabarit vient d'emporter les attributs du système de design,
    // comme après une 404, et une personne qui navigue en sombre
    enSombre.valeur = true;
    expect(document.documentElement.getAttribute("data-fr-theme")).toBeNull();

    // When le gabarit se rend
    render(<RemettreLeTheme />);

    // Then l'écran retrouve le sombre, au lieu de rester blanc, et le choix qui gouverne la
    // couleur n'est pas fabriqué pour autant
    expect(document.documentElement.getAttribute("data-fr-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-fr-scheme")).toBeNull();

    cleanup();

    // Given un document où le système de design a posé ce qu'il fallait, et un choix qui ne
    // suit pas la préférence du poste
    document.documentElement.setAttribute("data-fr-theme", "light");
    document.documentElement.setAttribute("data-fr-scheme", "system");

    // When le gabarit se rend de nouveau
    render(<RemettreLeTheme />);

    // Then rien n'est écrasé : une couleur posée survit à la préférence du poste, et le choix
    // « system » reste ce qu'il est
    expect(document.documentElement.getAttribute("data-fr-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-fr-scheme")).toBe("system");
  });
});

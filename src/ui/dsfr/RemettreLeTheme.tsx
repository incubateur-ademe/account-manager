"use client";

import { useIsDark } from "@codegouvfr/react-dsfr/useIsDark";
import { useLayoutEffect } from "react";

/**
 * Next sert ses réponses 404 dans un document de secours, `<html id="__next_error__">`, et c'est
 * React qui remonte le `<html>` du gabarit une fois côté client. Les attributs que le système de
 * design avait posés entre-temps partent avec l'ancien nœud, si bien qu'un écran introuvable reste
 * blanc pour qui navigue en thème sombre.
 *
 * Seule la couleur appliquée se remet, et non le choix qui la gouverne : `data-fr-scheme` vaut
 * « system » quand la couleur suit le poste, et le remplacer par la couleur constatée en ferait un
 * choix explicite qui cesserait de suivre.
 *
 * L'effet est de mise en page et non différé, pour devancer l'observateur que le système de design
 * a posé sur cet attribut : il le relit au moment où il est notifié, et une assertion y lève quand
 * il n'en trouve plus. Le retrait précède le premier effet, mesuré dans le navigateur.
 */
export function RemettreLeTheme() {
  const { isDark } = useIsDark();

  useLayoutEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute("data-fr-theme") === null) {
      html.setAttribute("data-fr-theme", isDark ? "dark" : "light");
    }
  }, [isDark]);

  return null;
}

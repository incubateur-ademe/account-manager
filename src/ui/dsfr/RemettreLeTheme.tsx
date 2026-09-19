"use client";

import { useIsDark } from "@codegouvfr/react-dsfr/useIsDark";
import { useLayoutEffect } from "react";

/**
 * Next sert ses réponses 404 dans un document de secours, `<html id="__next_error__">`, et c'est
 * React qui remonte le `<html>` du gabarit une fois côté client. Les attributs que le système de
 * design avait posés entre-temps partent avec l'ancien nœud, si bien qu'un écran introuvable reste
 * blanc pour qui navigue en thème sombre.
 *
 * L'effet est de mise en page et non différé, pour devancer l'observateur que le système de design
 * a posé sur cet attribut : il le relit au moment où il est notifié, et une assertion y lève quand
 * il n'en trouve plus.
 */
export function RemettreLeTheme() {
  const { isDark } = useIsDark();

  useLayoutEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute("data-fr-theme") === null) {
      html.setAttribute("data-fr-theme", isDark ? "dark" : "light");
    }
    if (html.getAttribute("data-fr-scheme") === null) {
      html.setAttribute("data-fr-scheme", isDark ? "dark" : "light");
    }
  });

  return null;
}

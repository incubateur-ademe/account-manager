"use client";

import { Tooltip } from "@codegouvfr/react-dsfr/Tooltip";

import { useModeAide } from "@/ui/ModeAide";

/**
 * L'explication d'un geste, sous le point d'interrogation du système de design.
 *
 * Au clic et non au survol : le `kind="click"` rend un bouton de plus sur la ligne,
 * ce qui alourdit le parcours au clavier. C'est assumé ici parce que le mode d'aide
 * s'éteint, et qu'éteint, il ne rend plus rien du tout.
 */
export function Aide({ children }: { children: string }) {
  const { actif } = useModeAide();

  if (!actif || children === "") {
    return null;
  }

  return <Tooltip kind="click" title={children} />;
}

"use client";

import {
  DsfrProviderBase,
  type DsfrProviderProps,
  StartDsfrOnHydration,
} from "@codegouvfr/react-dsfr/next-app-router";
import Link from "next/link";

import { defaultColorScheme } from "./defaultColorScheme";

declare module "@codegouvfr/react-dsfr/next-app-router" {
  interface RegisterLink {
    Link: typeof Link;
  }
}

export function DsfrProvider(props: DsfrProviderProps) {
  return <DsfrProviderBase defaultColorScheme={defaultColorScheme} Link={Link} {...props} />;
}

/**
 * Le DSFR n'a pas de composant de saisie assistée. Plutôt que d'en écrire un, on
 * emprunte celui de MUI, dont react-dsfr sait aligner le thème sur celui du système
 * de design : c'est la porte que le système ouvre lui-même pour ce qui lui manque.
 */
export { default as MuiDsfrThemeProvider } from "@codegouvfr/react-dsfr/mui";
export { StartDsfrOnHydration };

import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { operateurCourant } from "@/lib/session";
import { Deconnexion } from "@/ui/Deconnexion";
import { DsfrProvider, MuiDsfrThemeProvider, StartDsfrOnHydration } from "@/ui/dsfr/client";
import { DsfrHead, getHtmlAttributes } from "@/ui/dsfr/server";
import { Navigation } from "@/ui/Navigation";

export const metadata: Metadata = {
  title: "Gestionnaire de Comptes de l'Incubateur ADEME",
  description: "Donner et retirer des accès depuis un seul endroit, avec une trace.",
};

const lang = "fr";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const operateur = await operateurCourant();

  return (
    <html {...getHtmlAttributes({ lang })}>
      <head>
        <DsfrHead />
      </head>
      <body>
        <DsfrProvider lang={lang}>
          <MuiDsfrThemeProvider>
            <Navigation
              deconnexion={operateur ? <Deconnexion username={operateur.username} /> : undefined}
            />
            <Suspense>{children}</Suspense>
            {/* Après le contenu, et non dans le `head` : le `Suspense` ci-dessus laisse
              React hydrater la coque avant la page, si bien qu'un démarrage plus haut
              lâchait le JS du DSFR sur des tableaux que React n'avait pas encore
              hydratés. Il y posait ses `data-fr-js-*`, écart que React signale en
              annonçant qu'il ne le rattrapera pas. Ici, il démarre une fois la page
              hydratée, et les composants qui s'enregistrent avant lui sont rejoués
              par `registerEffectAction`. */}
            <StartDsfrOnHydration />
          </MuiDsfrThemeProvider>
        </DsfrProvider>
      </body>
    </html>
  );
}

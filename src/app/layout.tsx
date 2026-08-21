import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { operateurCourant } from "@/lib/session";
import { Deconnexion } from "@/ui/Deconnexion";
import { DsfrProvider, StartDsfrOnHydration } from "@/ui/dsfr/client";
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
          <Navigation
            deconnexion={operateur ? <Deconnexion username={operateur.username} /> : undefined}
          />
          {/* Le démarrage du DSFR vit dans la même frontière que la page, et après
              elle. Placé dehors, il s'hydrate avec la coque et lâche son JS sur des
              tableaux, des modales et un fil d'Ariane que React n'a pas encore
              hydratés : il y pose ses `data-fr-js-*`, écart que React signale en
              annonçant qu'il ne le rattrapera pas. Ici, il part une fois la page
              hydratée, et les composants montés avant lui sont rejoués par
              `registerEffectAction`. */}
          <Suspense>
            {children}
            <StartDsfrOnHydration />
          </Suspense>
        </DsfrProvider>
      </body>
    </html>
  );
}

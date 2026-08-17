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
        <StartDsfrOnHydration />
        <DsfrHead />
      </head>
      <body>
        <DsfrProvider lang={lang}>
          <Navigation
            deconnexion={operateur ? <Deconnexion username={operateur.username} /> : undefined}
          />
          <Suspense>{children}</Suspense>
        </DsfrProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
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
          {/* Pas de frontière de suspension autour de la page. Elle a existé pour
            que le démarrage du DSFR parte après l'hydratation, mais elle empêchait
            cette hydratation d'avoir lieu : le contenu partait en flux dans un
              conteneur caché, la frontière restait en attente dans le HTML final, et
            React n'hydratait jamais ce qu'elle portait. Aucune interaction de page
            ne fonctionnait, sur aucun écran.

            Le démarrage du DSFR n'y était pour rien, vérifié en le sortant de la
            frontière sans que l'hydratation revienne. Il reste donc ici, après la
            page, et `registerEffectAction` continue de rejouer les composants
            montés avant lui. */}
          {children}
          <StartDsfrOnHydration />
        </DsfrProvider>
      </body>
    </html>
  );
}

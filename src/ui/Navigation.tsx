"use client";

import { Header } from "@codegouvfr/react-dsfr/Header";
import { usePathname } from "next/navigation";
import type { JSX } from "react";

const LIENS = [
  { text: "Tableau de bord", href: "/" },
  { text: "Personnes", href: "/personnes" },
  { text: "Constats", href: "/constats" },
  { text: "Comptes isolés", href: "/comptes-isoles" },
  { text: "Comptes de service", href: "/comptes-de-service" },
  { text: "Journal", href: "/journal" },
] as const;

export function Navigation({ deconnexion }: { deconnexion?: JSX.Element }) {
  const pathname = usePathname();

  // Sur la page de connexion, proposer un menu vers des écrans protégés reviendrait
  // à inviter à cliquer sur des liens qui renvoient ici.
  const surConnexion = pathname === "/connexion";
  const menu = surConnexion ? [] : LIENS;

  return (
    <Header
      brandTop={
        <>
          Incubateur
          <br />
          ADEME
        </>
      }
      homeLinkProps={{ href: "/", title: "Accueil du gestionnaire de comptes" }}
      serviceTitle="Gestionnaire de comptes"
      serviceTagline="Donner et retirer des accès, avec une trace"
      quickAccessItems={surConnexion || !deconnexion ? [] : [deconnexion]}
      navigation={menu.map((lien) => ({
        text: lien.text,
        linkProps: { href: lien.href },
        isActive: lien.href === "/" ? pathname === "/" : pathname.startsWith(lien.href),
      }))}
    />
  );
}

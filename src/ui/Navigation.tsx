"use client";

import { Header } from "@codegouvfr/react-dsfr/Header";
import { usePathname } from "next/navigation";
import type { JSX } from "react";
import { BasculeModeAide } from "@/ui/ModeAide";

const LIENS = [
  { text: "Tableau de bord", href: "/" },
  { text: "Personnes", href: "/personnes" },
  { text: "Startups", href: "/startups" },
  { text: "Dossiers", href: "/dossiers" },
  { text: "Modèles", href: "/modeles" },
  { text: "Constats", href: "/constats" },
  { text: "Comptes isolés", href: "/comptes-isoles" },
  { text: "Comptes de service", href: "/comptes-de-service" },
  { text: "Systèmes", href: "/systemes" },
  { text: "Collectes", href: "/collectes" },
  { text: "Journal", href: "/journal" },
] as const;

export function Navigation({ deconnexion }: { deconnexion?: JSX.Element }) {
  const pathname = usePathname();

  // Sur la page de connexion, proposer un menu vers des écrans protégés reviendrait
  // à inviter à cliquer sur des liens qui renvoient ici.
  const surConnexion = pathname === "/login";
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
      quickAccessItems={
        surConnexion || !deconnexion ? [] : [<BasculeModeAide key="aide" />, deconnexion]
      }
      navigation={menu.map((lien) => ({
        text: lien.text,
        linkProps: { href: lien.href },
        isActive: lien.href === "/" ? pathname === "/" : pathname.startsWith(lien.href),
      }))}
    />
  );
}

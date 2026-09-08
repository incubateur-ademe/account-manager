"use client";

import { Header } from "@codegouvfr/react-dsfr/Header";
import { usePathname } from "next/navigation";
import type { JSX } from "react";
import { BasculeModeAide } from "@/ui/ModeAide";

const LIENS_OPERATEUR = [
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

/**
 * Ce qu'un non-opérateur voit du menu, et c'est tout ce qu'il en voit. Les onze liens
 * de l'équipe transverse le rejetteraient un par un tout en lui apprenant de quoi
 * l'outil est fait.
 */
const LIENS_PARTICIPANT = [{ text: "Mon espace", href: "/moi" }] as const;

export function Navigation({
  operateur = false,
  deconnexion,
}: {
  operateur?: boolean;
  deconnexion?: JSX.Element;
}) {
  const pathname = usePathname();

  // Sur la page de connexion, proposer un menu vers des écrans protégés reviendrait
  // à inviter à cliquer sur des liens qui renvoient ici.
  const surConnexion = pathname === "/login";
  const menu = surConnexion ? [] : operateur ? LIENS_OPERATEUR : LIENS_PARTICIPANT;
  // Le bloc-marque suit la même règle que le menu, `surConnexion` compris : le laisser
  // sur la racine reproduirait une fois le rejet que la réduction du menu évite onze
  // fois, et hors session `operateur` dit « inconnu » plutôt que « participant ».
  const accueil = surConnexion ? "/login" : operateur ? "/" : "/moi";

  return (
    <Header
      brandTop={
        <>
          Incubateur
          <br />
          ADEME
        </>
      }
      homeLinkProps={{ href: accueil, title: "Accueil du gestionnaire de comptes" }}
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

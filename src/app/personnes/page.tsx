import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import { LIBELLE_STATUT, type Statut, statutDePersonne } from "@/core/statut";
import {
  type Colonne,
  estColonne,
  estSens,
  estVue,
  filtrer,
  type Sens,
  trier,
  type Vue,
} from "@/core/tri-personnes";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { EnteteTri } from "./EnteteTri";
import { Filtres } from "./Filtres";

export const metadata: Metadata = { title: "Personnes suivies" };

export const dynamic = "force-dynamic";

const SEVERITE: Record<Statut, "success" | "info" | "warning" | "error" | "new"> = {
  SORTI: "error",
  A_TRAITER: "error",
  EN_SURSIS: "warning",
  BIENTOT: "new",
  ACTIF: "success",
  SANS_ECHEANCE: "info",
  ANCIEN: "info",
};

const RATTACHEMENT: Record<string, string> = {
  STARTUPS: "Startup",
  DECLARED: "Transverse",
  BOTH: "Transverse et startup",
  LOCAL: "Hors incubateur",
};

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

export default async function PersonnesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperateur();

  const searchParams = await props.searchParams;
  const premier = (cle: string): string | undefined => {
    const valeur = searchParams[cle];
    return Array.isArray(valeur) ? valeur[0] : valeur;
  };

  const vueBrute = premier("vue");
  const triBrut = premier("tri");
  const sensBrut = premier("sens");
  const vue: Vue = estVue(vueBrute) ? vueBrute : "a-suivre";
  const tri: Colonne = estColonne(triBrut) ? triBrut : "statut";
  const sens: Sens = estSens(sensBrut) ? sensBrut : "asc";
  const recherche = premier("q") ?? "";

  const { thresholds } = policy();
  const today = new Date();

  const personnes = await prisma.person.findMany({
    select: {
      username: true,
      fullname: true,
      missionEnd: true,
      attachment: true,
      startups: true,
      vanishedAt: true,
    },
  });

  const avecStatut = personnes.map((personne) => ({
    ...personne,
    statut: statutDePersonne(personne, today, {
      graceDays: thresholds.graceDays,
      soonDays: thresholds.soonDays,
      staleDays: thresholds.staleDays,
    }),
  }));

  const parametresConserves: Record<string, string> = { vue };
  if (recherche.length > 0) {
    parametresConserves["q"] = recherche;
  }

  const visibles = trier(filtrer(avecStatut, vue, recherche), tri, sens);
  const masquees = avecStatut.length - visibles.length;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Personnes suivies</h1>

      <Filtres vue={vue} recherche={recherche} tri={tri} sens={sens} />

      <p className={fr.cx("fr-text--sm")}>
        {visibles.length} personne{visibles.length > 1 ? "s" : ""} affichée
        {visibles.length > 1 ? "s" : ""}
        {masquees > 0 ? `, ${masquees} masquée${masquees > 1 ? "s" : ""} par le filtre.` : "."}
      </p>

      {visibles.length === 0 ? (
        <p className={fr.cx("fr-text--lead")}>Aucune personne ne correspond à ces critères.</p>
      ) : (
        <Table
          fixed
          headers={[
            <EnteteTri
              key="h-nom"
              libelle="Personne"
              colonne="nom"
              colonneActive={tri}
              sens={sens}
              parametres={parametresConserves}
            />,
            <EnteteTri
              key="h-echeance"
              libelle="Échéance"
              colonne="echeance"
              colonneActive={tri}
              sens={sens}
              parametres={parametresConserves}
            />,
            <EnteteTri
              key="h-statut"
              libelle="Statut"
              colonne="statut"
              colonneActive={tri}
              sens={sens}
              parametres={parametresConserves}
            />,
            "Rattachement",
            "Startups",
          ]}
          data={visibles.map((personne) => [
            <span key="p">
              <Link href={`/personnes/${encodeURIComponent(personne.username)}`}>
                {personne.fullname}
              </Link>
              <br />
              <span className={fr.cx("fr-text--sm")}>{personne.username}</span>
            </span>,
            personne.missionEnd ? dateFr.format(personne.missionEnd) : "aucune",
            <Badge key="s" severity={SEVERITE[personne.statut]} noIcon>
              {LIBELLE_STATUT[personne.statut]}
            </Badge>,
            RATTACHEMENT[personne.attachment] ?? personne.attachment,
            personne.startups.length > 0 ? personne.startups.join(", ") : "aucune",
          ])}
        />
      )}
    </main>
  );
}

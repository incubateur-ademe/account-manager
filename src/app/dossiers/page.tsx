import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import { dossierVivant, type EtatDossier, type EtatEtape, estSoldee } from "@/core/dossier";
import { LIBELLE_DOSSIER, LIBELLE_ETAT_DOSSIER } from "@/core/libelle-dossier";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

export const metadata: Metadata = { title: "Dossiers" };

export const dynamic = "force-dynamic";

const SEVERITE: Record<EtatDossier, "success" | "info" | "warning"> = {
  WATCH: "info",
  CANDIDATE: "warning",
  CONFIRMED: "warning",
  CANCELLED: "info",
  DONE: "success",
};

const dateLocale = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export default async function DossiersPage() {
  await requireOperateur();

  const dossiers = await prisma.accessCase.findMany({
    orderBy: { firstSignalAt: "desc" },
    take: 200,
    select: {
      id: true,
      kind: true,
      state: true,
      firstSignalAt: true,
      person: { select: { username: true, fullname: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { steps: { select: { state: true } } },
      },
    },
  });

  const lignes = dossiers.map((dossier) => {
    const etapes = dossier.plans[0]?.steps ?? [];
    return {
      id: dossier.id,
      sens: dossier.kind,
      state: dossier.state,
      firstSignalAt: dossier.firstSignalAt,
      person: dossier.person,
      etapes: etapes.length,
      restantes: etapes.filter((etape) => !estSoldee(etape.state as EtatEtape)).length,
      vivant: dossierVivant(dossier.state),
    };
  });

  const ouverts = lignes.filter((ligne) => ligne.vivant);
  const soldes = lignes.filter((ligne) => !ligne.vivant);

  const tableau = (rangs: typeof lignes) => (
    <Table
      headers={["Personne", "Sens", "État", "Ouvert le", "Étapes"]}
      data={rangs.map((ligne) => [
        <span key="p">
          <Link href={`/dossiers/${ligne.id}`}>{ligne.person.fullname}</Link>
          <br />
          <span className={fr.cx("fr-text--sm")}>{ligne.person.username}</span>
        </span>,
        LIBELLE_DOSSIER[ligne.sens].nom,
        <Badge key="e" severity={SEVERITE[ligne.state]} small noIcon>
          {LIBELLE_ETAT_DOSSIER[ligne.state]}
        </Badge>,
        dateLocale.format(ligne.firstSignalAt),
        ligne.etapes === 0
          ? "aucune"
          : ligne.restantes === 0
            ? `${ligne.etapes}, toutes soldées`
            : `${ligne.restantes} en attente sur ${ligne.etapes}`,
      ])}
    />
  );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Dossiers</h1>

      <p className={fr.cx("fr-text--lead")}>
        Les arrivées et les départs en préparation, et ceux qui sont soldés. Un dossier s'ouvre
        depuis la fiche d'une personne : il n'y a pas d'autre porte d'entrée, le pivot restant
        l'identifiant beta.gouv.
      </p>

      {ouverts.length === 0 ? (
        <p>
          Aucun dossier ouvert. Rien n'est en préparation, ce qui n'est pas la même chose que rien à
          faire : la fiche d'une personne dit ce qui l'attend.
        </p>
      ) : (
        <>
          <h2 className={fr.cx("fr-h5")}>
            {ouverts.length} dossier{ouverts.length > 1 ? "s" : ""} ouvert
            {ouverts.length > 1 ? "s" : ""}
          </h2>
          {tableau(ouverts)}
        </>
      )}

      {soldes.length > 0 ? (
        <section className={fr.cx("fr-mt-6w")}>
          <h2 className={fr.cx("fr-h5")}>Dossiers clos ou annulés</h2>
          <p className={fr.cx("fr-text--sm")}>
            Ils restent lisibles : ce qui a été décidé, et ce qui a été pointé, ne s'efface pas.
          </p>
          {tableau(soldes)}
        </section>
      ) : null}

      <p className={fr.cx("fr-text--sm", "fr-mt-4w")}>
        Deux cents dernières ouvertures au plus. Le journal, lui, garde tout sans limite de date.
      </p>
    </main>
  );
}

import { fr } from "@codegouvfr/react-dsfr";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { Button } from "@codegouvfr/react-dsfr/Button";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ficheEditable, renommable } from "@/core/fiche-manuelle";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";

import { FicheEditable } from "../FicheEditable";
import { Identifiant } from "../Identifiant";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const personne = await prisma.person.findUnique({
    where: { username },
    select: { fullname: true },
  });

  return { title: personne ? `Éditer ${personne.fullname}` : "Personne introuvable" };
}

export default async function EditionFichePage({ params }: Props) {
  await requireOperateur();

  const { username } = await params;
  const { scope } = policy();

  const personne = await prisma.person.findUnique({
    where: { username },
    select: {
      username: true,
      fullname: true,
      primaryEmail: true,
      communicationEmail: true,
      githubLogin: true,
      source: true,
      usernameFabricated: true,
    },
  });

  if (!personne) {
    notFound();
  }

  const declaresLocaux = scope.local.map((entree) => entree.username);

  // La fiche n'affiche pas le bouton, mais l'adresse reste tapable : le refus se
  // décide ici, sur les mêmes règles, et non sur la présence d'un lien.
  if (!ficheEditable(personne, declaresLocaux).editable) {
    redirect(`/personnes/${encodeURIComponent(personne.username)}`);
  }

  const retour = `/personnes/${encodeURIComponent(personne.username)}`;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel="Éditer"
        homeLinkProps={{ href: "/" }}
        segments={[
          { label: "Personnes suivies", linkProps: { href: "/personnes" } },
          { label: personne.fullname, linkProps: { href: retour } },
        ]}
      />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--middle")}>
        <div className={fr.cx("fr-col")}>
          <h1 className={fr.cx("fr-mb-1v")}>Éditer la fiche de {personne.fullname}</h1>
          <p className={fr.cx("fr-text--sm", "fr-mb-0")}>{personne.username}</p>
        </div>
        <Button priority="tertiary" size="small" linkProps={{ href: retour }}>
          Retour à la fiche
        </Button>
      </div>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Champs modifiables</h2>
        <FicheEditable fiche={personne} />
      </section>

      {renommable(personne, declaresLocaux) ? (
        <section className={fr.cx("fr-mt-6w")}>
          <h2 className={fr.cx("fr-h5")}>Identifiant</h2>
          <Identifiant username={personne.username} />
        </section>
      ) : null}
    </main>
  );
}

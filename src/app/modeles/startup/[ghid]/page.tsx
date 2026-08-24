import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CLE_INCUBATEUR } from "@/core/modele-plan";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import { Editeur } from "../../Editeur";
import {
  autorisationsDeLIncubateur,
  etapesNeutralisees,
  MOMENTS,
  modelesDuProprietaire,
} from "../../lecture";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ ghid: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ghid } = await params;
  const startup = await prisma.startup.findUnique({ where: { ghid }, select: { name: true } });

  return { title: `Modèle de ${startup ? startup.name : ghid}` };
}

export default async function ModeleDeStartupPage({ params }: Props) {
  await requireOperateur();

  const { ghid } = await params;

  // La clé de l'incubateur n'est pas un ghid : servie ici, cette page présenterait le
  // modèle qui s'applique à tout le monde comme celui d'une startup, et l'ouvrirait à
  // l'édition sous ce nom. Son écran est `/modeles/incubateur`.
  if (ghid === CLE_INCUBATEUR) {
    notFound();
  }

  const [startup, modeles, autorise] = await Promise.all([
    prisma.startup.findUnique({ where: { ghid }, select: { ghid: true, name: true } }),
    modelesDuProprietaire(ghid),
    autorisationsDeLIncubateur(),
  ]);

  const declare = modeles.some((modele) => modele.existe);

  // Une startup inconnue qui ne porte aucun modèle n'a rien à éditer. Celle qui en
  // porte un, en revanche, garde sa page : c'est là qu'on répare un modèle qu'un
  // renommage amont a laissé orphelin.
  if (!startup && !declare) {
    notFound();
  }

  const neutralisees = await etapesNeutralisees(autorise, ghid);
  const nom = startup?.name ?? ghid;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel={nom}
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Modèles de plan", linkProps: { href: "/modeles" } }]}
      />

      <h1 className={fr.cx("fr-mb-1v")}>Le modèle de {nom}</h1>
      <p className={fr.cx("fr-text--sm")}>
        {ghid}
        {startup ? (
          <>
            {" · "}
            <Link href={`/startups/${encodeURIComponent(ghid)}`}>La fiche de cette startup</Link>
          </>
        ) : null}
      </p>

      {startup ? null : (
        <Alert
          className={fr.cx("fr-mt-3w")}
          severity="warning"
          title="Ce ghid ne correspond à aucune startup connue"
          description="Aucun plan ne portera ses étapes : l'assemblage compare des ghid à des ghid, et celui-ci n'est plus rendu par le référentiel. Un renommage amont, une sortie de l'incubateur ou une faute de frappe donnent ici le même symptôme. Redéclarez ces étapes sous le bon ghid, puis retirez celles-ci."
        />
      )}

      <p className={fr.cx("fr-text--lead", "fr-mt-3w")}>
        Ce que cette startup demande en propre, en plus de ce que l'incubateur demande à tout le
        monde. Un geste que l'incubateur demande déjà ne se demande pas une seconde fois : c'est son
        exemplaire qui est retenu.
      </p>

      {MOMENTS.map(({ moment, titre, quoi }) => {
        const modele = modeles.find((candidat) => candidat.moment === moment);

        return (
          <section key={moment} className={fr.cx("fr-mt-6w")}>
            <h2 className={fr.cx("fr-h4")}>{titre}</h2>
            <p>{quoi}</p>

            {autorise[moment] ? null : (
              <Alert
                className={fr.cx("fr-mb-3w")}
                severity="warning"
                title={`Le modèle ${moment === "ONBOARDING" ? "d'arrivée" : "de départ"} de l'incubateur n'autorise pas les startups à le compléter`}
                description={
                  <>
                    <p className={fr.cx("fr-mb-1w")}>
                      {neutralisees[moment] === 0
                        ? "Aucune étape n'est déclarée ici pour ce moment, et aucune ne pourrait l'être tant que l'autorisation reste fermée."
                        : `${neutralisees[moment]} étape${neutralisees[moment] > 1 ? "s" : ""} déclarée${neutralisees[moment] > 1 ? "s" : ""} ici ${neutralisees[moment] > 1 ? "sont neutralisées" : "est neutralisée"} : ${neutralisees[moment] > 1 ? "elles restent" : "elle reste"} en base et ${neutralisees[moment] > 1 ? "n'entrent" : "n'entre"} dans aucun plan. Rouvrir l'autorisation ${neutralisees[moment] > 1 ? "les rend" : "la rend"} à l'identique.`}
                    </p>
                    <p className={fr.cx("fr-mb-0")}>
                      <Link href="/modeles/incubateur">
                        Ouvrir l'autorisation depuis le modèle de l'incubateur
                      </Link>
                    </p>
                  </>
                }
              />
            )}

            <Editeur proprietaire={ghid} moment={moment} etapes={modele?.etapes ?? []} />
          </section>
        );
      })}
    </main>
  );
}

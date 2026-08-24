import { fr } from "@codegouvfr/react-dsfr";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import type { Metadata } from "next";

import { CLE_INCUBATEUR } from "@/core/modele-plan";
import type { TemplateKind } from "@/generated/prisma/enums";
import { requireOperateur } from "@/lib/session";

import { BasculeAutorisation, Editeur } from "../Editeur";
import { etapesNeutralisees, MOMENTS, modelesDuProprietaire } from "../lecture";

export const metadata: Metadata = { title: "Modèle de l'incubateur" };

export const dynamic = "force-dynamic";

export default async function ModeleDeLIncubateurPage() {
  await requireOperateur();

  const modeles = await modelesDuProprietaire(CLE_INCUBATEUR);

  const ouvert = (moment: TemplateKind) =>
    modeles.find((modele) => modele.moment === moment)?.startupsPeuventCompleter ?? false;
  const autorise: Record<TemplateKind, boolean> = {
    ONBOARDING: ouvert("ONBOARDING"),
    OFFBOARDING: ouvert("OFFBOARDING"),
  };

  const neutralisees = await etapesNeutralisees(autorise);

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <Breadcrumb
        currentPageLabel="Incubateur"
        homeLinkProps={{ href: "/" }}
        segments={[{ label: "Modèles de plan", linkProps: { href: "/modeles" } }]}
      />

      <h1>Le modèle de l'incubateur</h1>

      <p className={fr.cx("fr-text--lead")}>
        Ce que l'incubateur demande pour tout le monde. Ces étapes passent devant celles des
        startups, et un geste qu'il demande déjà ne se demande pas une seconde fois.
      </p>

      <p className={fr.cx("fr-text--sm")}>
        Modifier ce modèle ne change aucun plan déjà calculé : les étapes sont figées à la création
        du plan. Un brouillon en cours se découvrira obsolète et se réparera par un recalcul, un
        plan confirmé gardera les siennes et dira ce qui n'y figure pas.
      </p>

      {MOMENTS.map(({ moment, titre, quoi }) => {
        const modele = modeles.find((candidat) => candidat.moment === moment);

        return (
          <section key={moment} className={fr.cx("fr-mt-6w")}>
            <h2 className={fr.cx("fr-h4")}>{titre}</h2>
            <p>{quoi}</p>

            <BasculeAutorisation
              moment={moment}
              autorise={autorise[moment]}
              neutralisees={neutralisees[moment]}
            />

            <Editeur proprietaire={CLE_INCUBATEUR} moment={moment} etapes={modele?.etapes ?? []} />
          </section>
        );
      })}
    </main>
  );
}

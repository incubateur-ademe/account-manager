import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import { CLE_INCUBATEUR } from "@/core/modele-plan";
import type { TemplateKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import { MOMENTS } from "./lecture";

export const metadata: Metadata = { title: "Modèles de plan" };

export const dynamic = "force-dynamic";

type Comptes = Record<TemplateKind, number>;

const AUCUNE: Comptes = { ONBOARDING: 0, OFFBOARDING: 0 };

function etapes(comptes: Comptes, moment: TemplateKind): string {
  const nombre = comptes[moment];
  return nombre === 0 ? "aucune étape" : `${nombre} étape${nombre > 1 ? "s" : ""}`;
}

export default async function ModelesPage() {
  await requireOperateur();

  const [modeles, startups] = await Promise.all([
    prisma.planTemplate.findMany({
      select: {
        ownerKey: true,
        kind: true,
        startupsMayExtend: true,
        _count: { select: { steps: true } },
      },
    }),
    prisma.startup.findMany({
      orderBy: { name: "asc" },
      select: { ghid: true, name: true, vanishedAt: true },
    }),
  ]);

  const parProprietaire = new Map<string, Comptes>();
  for (const modele of modeles) {
    const comptes = parProprietaire.get(modele.ownerKey) ?? { ...AUCUNE };
    comptes[modele.kind] = modele._count.steps;
    parProprietaire.set(modele.ownerKey, comptes);
  }

  const autorise = (moment: TemplateKind) =>
    modeles.find((modele) => modele.ownerKey === CLE_INCUBATEUR && modele.kind === moment)
      ?.startupsMayExtend ?? false;

  const incubateur = parProprietaire.get(CLE_INCUBATEUR) ?? AUCUNE;

  const connues = new Set(startups.map((startup) => startup.ghid));
  // Aucune clé étrangère ne relie un modèle à une startup, et c'est voulu :
  // `Person.startups` porte déjà des ghid sans FK. Ce rapprochement est donc le seul
  // endroit d'où un renommage amont se verra, un modèle orphelin cessant de
  // contribuer sans qu'aucune erreur ne soit levée.
  const orphelins = [...parProprietaire.keys()]
    .filter((proprietaire) => proprietaire !== CLE_INCUBATEUR && !connues.has(proprietaire))
    .sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Modèles de plan</h1>

      <p className={fr.cx("fr-text--lead")}>
        Ce qu'un modèle porte, aucun système ne le connaît : signer une charte, présenter l'équipe,
        ouvrir un accès dans un outil que l'outil ne collecte pas. Ces étapes s'ajoutent à ce que
        les connecteurs proposent, au moment où un dossier est ouvert.
      </p>

      <p className={fr.cx("fr-text--sm")}>
        Modifier un modèle ne change aucun plan déjà calculé : les étapes sont figées à la création
        du plan. Un brouillon en cours se découvrira obsolète et se réparera par un recalcul.
      </p>

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>Le modèle de l'incubateur</h2>
        <p>
          Il s'applique à tout le monde, et ses étapes passent devant celles des startups. C'est lui
          aussi qui décide, moment par moment, si les startups ont le droit de compléter.
        </p>

        <Table
          headers={["Moment", "Étapes déclarées", "Les startups complètent"]}
          data={MOMENTS.map(({ moment, titre }) => [
            <Link key="m" href="/modeles/incubateur">
              {titre}
            </Link>,
            etapes(incubateur, moment),
            <Badge key="a" severity={autorise(moment) ? "success" : "warning"} small noIcon>
              {autorise(moment) ? "oui" : "non"}
            </Badge>,
          ])}
        />

        <p>
          <Link className={fr.cx("fr-link")} href="/modeles/incubateur">
            Éditer le modèle de l'incubateur
          </Link>
        </p>
      </section>

      <section className={fr.cx("fr-mt-6w")}>
        <h2 className={fr.cx("fr-h5")}>Les modèles des startups</h2>
        <p>
          Une startup déclare ce qui lui est propre. Ses étapes n'entrent dans un plan que si le
          modèle de l'incubateur l'autorise pour ce moment, et un geste déjà demandé par
          l'incubateur ne se demande pas deux fois.
        </p>

        {startups.length === 0 ? (
          <p>Aucune startup n'est connue : la collecte du référentiel n'a rien rendu.</p>
        ) : (
          <Table
            headers={["Startup", "Arrivée", "Départ"]}
            data={startups.map((startup) => {
              const comptes = parProprietaire.get(startup.ghid) ?? AUCUNE;
              return [
                <div key="s">
                  <Link href={`/modeles/startup/${encodeURIComponent(startup.ghid)}`}>
                    {startup.name}
                  </Link>
                  {startup.vanishedAt ? (
                    <>
                      {" "}
                      <Badge severity="warning" small noIcon>
                        sortie
                      </Badge>
                    </>
                  ) : null}
                  <br />
                  <span className={fr.cx("fr-text--sm")}>{startup.ghid}</span>
                </div>,
                etapes(comptes, "ONBOARDING"),
                etapes(comptes, "OFFBOARDING"),
              ];
            })}
          />
        )}
      </section>

      {orphelins.length > 0 ? (
        <Alert
          className={fr.cx("fr-mt-4w")}
          severity="warning"
          title={`${orphelins.length} modèle${orphelins.length > 1 ? "s" : ""} ne correspond${orphelins.length > 1 ? "ent" : ""} plus à aucune startup connue`}
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Aucun plan ne porte plus leurs étapes : l'assemblage compare des ghid à des ghid, et
                celui-ci n'est plus rendu par le référentiel. Un renommage amont, une sortie de
                l'incubateur ou une faute de frappe donnent ici le même symptôme, et c'est le seul
                endroit où cela se voit.
              </p>
              <ul className={fr.cx("fr-mb-0")}>
                {orphelins.map((ghid) => {
                  const comptes = parProprietaire.get(ghid) ?? AUCUNE;
                  return (
                    <li key={ghid}>
                      <Link href={`/modeles/startup/${encodeURIComponent(ghid)}`}>{ghid}</Link>{" "}
                      <span className={fr.cx("fr-text--sm")}>
                        ({etapes(comptes, "ONBOARDING")} à l'arrivée,{" "}
                        {etapes(comptes, "OFFBOARDING")} au départ)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          }
        />
      ) : null}
    </main>
  );
}

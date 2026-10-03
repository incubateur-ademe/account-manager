import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SECTIONS_D_OBJETS, type SectionDObjets } from "@/core/objets-possedes";
import { lireLesObjetsPossedes, type ObjetPossede } from "@/lib/objets-possedes";
import { requireOperateur } from "@/lib/session";
import { Absent } from "@/ui/Absent";
import { dateFr } from "@/ui/dates";
import { DESTIN_AU_DEPART } from "@/ui/severites";

export const metadata: Metadata = { title: "Objets possédés" };

export const dynamic = "force-dynamic";

const SECTIONS: Record<SectionDObjets, { titre: string; precision: ReactNode }> = {
  orphelins: {
    titre: "Orphelins",
    precision: "Aucun de leurs comptes n'est rattaché à une personne présente du référentiel.",
  },
  "a-confirmer": {
    titre: "Auteur à confirmer",
    precision: (
      <>
        Leur compte est rattaché à une personne par ressemblance de nom. Confirmez ce rattachement
        depuis les <Link href="/comptes-isoles">comptes isolés</Link>.
      </>
    ),
  },
  "auteur-present": {
    titre: "Auteur présent",
    precision: "Au moins un de leurs comptes est rattaché sur preuve à une personne suivie.",
  },
};

function objetDe(objet: ObjetPossede): ReactNode {
  return objet.resource.url ? (
    <a
      key="o"
      href={objet.resource.url}
      target="_blank"
      rel="noreferrer"
      title={`${objet.resource.label}, nouvelle fenêtre`}
    >
      {objet.resource.label}
    </a>
  ) : (
    objet.resource.label
  );
}

function compteDe({ id, compte }: ObjetPossede): ReactNode {
  if (compte === null) {
    return (
      <div key={id}>
        <Absent mention="aucun compte connu" />
      </div>
    );
  }

  return (
    <div key={id}>
      {compte.handle}
      {compte.person ? (
        <>
          <br />
          <Link href={`/personnes/${encodeURIComponent(compte.person.username)}`}>
            {compte.person.fullname}
          </Link>
          {compte.person.vanishedAt ? (
            <>
              {" "}
              <Badge severity="warning" small noIcon>
                sortie
              </Badge>
            </>
          ) : null}
        </>
      ) : (
        <>
          <br />
          <span className={fr.cx("fr-text--sm")}>
            {compte.serviceAccountId ? "compte de service" : "rattaché à aucune personne"}
          </span>
        </>
      )}
      {compte.vanishedAt ? (
        <>
          <br />
          <Badge severity="info" small noIcon>
            Disparu le {dateFr.format(compte.vanishedAt)}
          </Badge>
        </>
      ) : null}
    </div>
  );
}

export default async function ObjetsPossedesPage() {
  await requireOperateur();

  const { sections, total, recensent } = await lireLesObjetsPossedes();

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Objets possédés</h1>

      <p className={fr.cx("fr-text--lead")}>
        Un dépôt ou une page qu'une personne administre survit à son départ. La collecte de chaque
        système fixe ce qu'il en advient.
      </p>

      {recensent.length === 0 ? (
        <p>
          Aucun système couvert ne recense les objets possédés.{" "}
          <Link href="/systemes">Ce que chaque système sait faire</Link>.
        </p>
      ) : total === 0 ? (
        <p>Aucun objet possédé relevé sur {recensent.join(", ")}.</p>
      ) : null}

      {total > 0 ? (
        <p className={fr.cx("fr-text--sm")}>
          {total} objet{total > 1 ? "s" : ""} possédé{total > 1 ? "s" : ""}.
        </p>
      ) : null}

      {SECTIONS_D_OBJETS.filter((cle) => sections[cle].length > 0).map((cle) => (
        <section key={cle} className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h5")}>{SECTIONS[cle].titre}</h2>
          <p className={fr.cx("fr-text--sm")}>{SECTIONS[cle].precision}</p>

          <Table
            headers={["Objet", "Système", "Compte", "Au départ"]}
            data={sections[cle].map(([objet, ...autres]) => [
              objetDe(objet),
              objet.provider,
              <div key="c">{[objet, ...autres].map(compteDe)}</div>,
              <div key="d">
                {[...new Set([objet, ...autres].map(({ onOffboard }) => onOffboard))].map(
                  (destin) => (
                    <div key={destin}>
                      <Badge severity={DESTIN_AU_DEPART[destin].severite} small noIcon>
                        {DESTIN_AU_DEPART[destin].libelle}
                      </Badge>
                    </div>
                  ),
                )}
              </div>,
            ])}
          />
        </section>
      ))}
    </main>
  );
}

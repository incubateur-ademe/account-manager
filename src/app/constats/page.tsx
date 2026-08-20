import { fr } from "@codegouvfr/react-dsfr";
import type { Metadata } from "next";

import type { ConstatKind } from "@/core/constat";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import { FileDesConstats, type LigneConstat } from "./FileDesConstats";

export const metadata: Metadata = { title: "Constats" };

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

export default async function ConstatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperateur();
  const { constat: designe } = await searchParams;

  const constats = await prisma.finding.findMany({
    where: { closedAt: null },
    orderBy: [{ severity: "asc" }, { openedAt: "asc" }],
    select: {
      id: true,
      kind: true,
      severity: true,
      openedAt: true,
      dedupKey: true,
      person: { select: { username: true, fullname: true } },
      externalIdentity: { select: { provider: true, handle: true } },
    },
  });

  const ordre = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const tries = [...constats].sort((a, b) => ordre[a.severity] - ordre[b.severity]);

  const parType = new Map<string, number>();
  for (const constat of tries) {
    parType.set(constat.kind, (parType.get(constat.kind) ?? 0) + 1);
  }

  // Les dates sont mises en forme ici : la même chaîne traverse jusqu'au client,
  // là où deux `Intl` de fuseaux différents feraient diverger le rendu.
  const lignes: LigneConstat[] = tries.map((constat) => ({
    id: constat.id,
    dedupKey: constat.dedupKey,
    titre: LIBELLE_CONSTAT[constat.kind as ConstatKind]?.titre ?? constat.kind,
    explication: LIBELLE_CONSTAT[constat.kind as ConstatKind]?.explication ?? "",
    action: LIBELLE_CONSTAT[constat.kind as ConstatKind]?.action ?? "",
    severity: constat.severity,
    ouvertLe: dateFr.format(constat.openedAt),
    personne: constat.person
      ? { username: constat.person.username, fullname: constat.person.fullname }
      : null,
    compte: constat.externalIdentity,
  }));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Constats</h1>

      {lignes.length === 0 ? (
        <p className={fr.cx("fr-text--lead")}>
          Aucun constat ouvert. Rien ne demande d'action à ce jour.
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--lead")}>
            {lignes.length} constat{lignes.length > 1 ? "s" : ""} ouvert
            {lignes.length > 1 ? "s" : ""}. Ils se referment d'eux-mêmes dès qu'une collecte ne les
            vérifie plus.{" "}
            <a className={fr.cx("fr-link")} href="#consignes">
              Ce que dit chaque type de constat
            </a>
            .
          </p>

          <FileDesConstats lignes={lignes} {...(typeof designe === "string" ? { designe } : {})} />

          {/* Une consigne par type et non par ligne : répétée treize fois, elle
              cessait d'être lue dès la deuxième. */}
          <h2 className={fr.cx("fr-h6", "fr-mt-6w")} id="consignes">
            Ce que dit chaque type de constat
          </h2>

          {[...parType.entries()].map(([kind, nombre]) => {
            const libelle = LIBELLE_CONSTAT[kind as ConstatKind];
            if (!libelle) {
              return null;
            }
            return (
              <section key={kind} className={fr.cx("fr-mt-3w")}>
                <h3 className={fr.cx("fr-text--bold", "fr-mb-1v")}>
                  {libelle.titre} ({nombre})
                </h3>
                <p className={fr.cx("fr-mb-1w")}>{libelle.explication}</p>
                <p className={fr.cx("fr-text--sm", "fr-mb-0")}>
                  <strong>Ce qu'il y a à faire :</strong> {libelle.action}
                </p>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

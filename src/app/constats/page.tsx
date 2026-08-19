import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import type { ConstatKind } from "@/core/constat";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import { ClotureConstat } from "./ClotureConstat";

export const metadata: Metadata = { title: "Constats" };

export const dynamic = "force-dynamic";

const SEVERITE = { HIGH: "error", MEDIUM: "warning", LOW: "info" } as const;
const LIBELLE_SEVERITE = { HIGH: "Haute", MEDIUM: "Moyenne", LOW: "Basse" } as const;

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

export default async function ConstatsPage() {
  await requireOperateur();

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

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Constats</h1>

      {tries.length === 0 ? (
        <p className={fr.cx("fr-text--lead")}>
          Aucun constat ouvert. Rien ne demande d'action à ce jour.
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--lead")}>
            {tries.length} constat{tries.length > 1 ? "s" : ""} ouvert
            {tries.length > 1 ? "s" : ""}. Ils se referment d'eux-mêmes dès qu'une collecte ne les
            vérifie plus. Clore à la main sert à l'inverse : dire qu'une situation qui dure a bien
            été traitée, pour qu'elle cesse de revenir chaque nuit.
          </p>

          <Table
            headers={["Gravité", "Concerne", "Constat", "Ouvert le", "Traitement"]}
            data={tries.map((constat) => {
              const libelle = LIBELLE_CONSTAT[constat.kind as ConstatKind];
              const username = constat.person?.username;
              const compte = constat.externalIdentity;
              return [
                <Badge key="g" severity={SEVERITE[constat.severity]} noIcon>
                  {LIBELLE_SEVERITE[constat.severity]}
                </Badge>,
                // Un constat porte sur quelqu'un, sur un compte, ou sur les deux
                // quand un compte survit à son détenteur. Sans le compte, treize
                // lignes d'affilée diraient la même chose sans dire de quoi.
                <span key="p">
                  {username ? (
                    <Link href={`/personnes/${username}`} className={fr.cx("fr-link")}>
                      {constat.person?.fullname ?? username}
                    </Link>
                  ) : compte ? (
                    <Link href="/comptes-isoles" className={fr.cx("fr-link")}>
                      {compte.handle}
                    </Link>
                  ) : (
                    "inconnue"
                  )}
                  <br />
                  <span className={fr.cx("fr-text--sm")}>
                    {compte ? `${compte.provider} : ${compte.handle}` : (username ?? "")}
                  </span>
                </span>,
                <span key="c">
                  <strong>{libelle?.titre ?? constat.kind}</strong>
                  <br />
                  <span className={fr.cx("fr-text--sm")}>{libelle?.action ?? ""}</span>
                </span>,
                dateFr.format(constat.openedAt),
                <ClotureConstat key="t" dedupKey={constat.dedupKey} />,
              ];
            })}
          />

          {[...parType.keys()].map((kind) => {
            const libelle = LIBELLE_CONSTAT[kind as ConstatKind];
            if (!libelle) {
              return null;
            }
            return (
              <section key={kind} className={fr.cx("fr-mt-4w")}>
                <h2 className={fr.cx("fr-h5")}>{libelle.titre}</h2>
                <p>{libelle.explication}</p>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

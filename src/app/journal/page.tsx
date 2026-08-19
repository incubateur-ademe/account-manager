import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import type { ActorKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import {
  auMoinsUnFiltre,
  type Criteres,
  identifiantsLies,
  lienJournal,
  lireCriteres,
  nombreDePages,
  TAILLE_PAGE,
  versFiltre,
} from "./criteres";
import { DetailJson } from "./DetailJson";
import { Filtres } from "./Filtres";
import { libelleAction, libelleCible, libelleResultat, severiteResultat } from "./libelles";
import { Pagination } from "./Pagination";

export const metadata: Metadata = { title: "Journal d'audit" };

export const dynamic = "force-dynamic";

const horodatageFr = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "UTC",
});

function celluleActeur(actorKind: ActorKind, actorUsername: string | null) {
  if (actorKind === "SYSTEM") {
    return (
      <Badge key="acteur" as="span" severity="info" small noIcon>
        Système
      </Badge>
    );
  }

  return (
    <span key="acteur">
      <strong>{actorUsername ?? "identité inconnue"}</strong>
      <br />
      <span className={fr.cx("fr-text--xs")}>humain</span>
    </span>
  );
}

function celluleExecution(correlationId: string | null, criteres: Criteres) {
  if (correlationId === null) {
    return (
      <span key="execution" className={fr.cx("fr-text--sm")}>
        hors exécution
      </span>
    );
  }

  return (
    <Link
      key="execution"
      href={lienJournal(criteres, { execution: correlationId, page: 1 })}
      className={fr.cx("fr-link", "fr-link--sm")}
      title={`Voir les événements de l'exécution ${correlationId}`}
    >
      {correlationId.slice(0, 8)}…
    </Link>
  );
}

export default async function JournalPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperateur();

  const criteres = lireCriteres(await props.searchParams);

  // Une fiche renommée puis fusionnée a porté plusieurs identifiants, et les
  // événements antérieurs nomment les précédents. Sans cette relecture, l'histoire
  // d'un compte se couperait au premier renommage.
  const liens =
    criteres.personne === ""
      ? []
      : await prisma.auditEvent.findMany({
          where: { action: { in: ["personne.renommage", "personne.fusion"] } },
          select: { before: true, after: true },
        });

  const filtre = versFiltre(criteres, identifiantsLies(liens, criteres.personne));

  const [total, acteurs, actions] = await Promise.all([
    prisma.auditEvent.count({ where: filtre }),
    prisma.auditEvent.findMany({
      where: { actorKind: "HUMAN", actorUsername: { not: null } },
      distinct: ["actorUsername"],
      select: { actorUsername: true },
      orderBy: { actorUsername: "asc" },
    }),
    prisma.auditEvent.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  const pages = nombreDePages(total);
  const page = Math.min(criteres.page, pages);

  const evenements = await prisma.auditEvent.findMany({
    where: filtre,
    // Une collecte écrit ses événements dans la même milliseconde : sans départage
    // stable, deux pages successives peuvent servir deux fois la même ligne et en
    // perdre une autre, ce qu'un journal ne peut pas se permettre.
    orderBy: [{ at: "desc" }, { id: "desc" }],
    skip: (page - 1) * TAILLE_PAGE,
    take: TAILLE_PAGE,
  });

  const filtreActif = auMoinsUnFiltre(criteres);

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Journal d'audit</h1>

      <p className={fr.cx("fr-text--lead")}>
        Chaque connexion et chaque collecte y laissent une trace nominative, écrite avant l'action
        qu'elle documente. Le journal ne se modifie ni ne s'efface.
      </p>

      <Filtres
        criteres={criteres}
        acteurs={acteurs.flatMap((ligne) =>
          ligne.actorUsername === null ? [] : [ligne.actorUsername],
        )}
        actions={actions.map((ligne) => ligne.action)}
      />

      {criteres.personne === "" ? null : (
        <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>
          Ce que le journal retient de <code>{criteres.personne}</code>.{" "}
          <Link
            href={lienJournal(criteres, { personne: "", page: 1 })}
            className={fr.cx("fr-link", "fr-link--sm")}
          >
            Revenir à tout le journal
          </Link>
        </p>
      )}

      {criteres.execution === "" ? null : (
        <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>
          Événements de l'exécution <code>{criteres.execution}</code>.{" "}
          <Link
            href={lienJournal(criteres, { execution: "", page: 1 })}
            className={fr.cx("fr-link", "fr-link--sm")}
          >
            Revenir à tout le journal
          </Link>
        </p>
      )}

      {evenements.length === 0 ? (
        <p className={fr.cx("fr-text--lead")}>
          {filtreActif
            ? "Aucun événement ne correspond à ces critères."
            : "Le journal est vide : aucune connexion ni aucune collecte n'a encore été tracée."}
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            {total} événement{total > 1 ? "s" : ""}
            {filtreActif ? " retenu" : ""}
            {filtreActif && total > 1 ? "s" : ""}, page {page} sur {pages}.
          </p>

          <Table
            headers={["Horodatage (UTC)", "Acteur", "Action", "Résultat", "Exécution", "Détail"]}
            data={evenements.map((evenement) => [
              <span key="horodatage" className={fr.cx("fr-text--sm")}>
                {horodatageFr.format(evenement.at)}
              </span>,
              celluleActeur(evenement.actorKind, evenement.actorUsername),
              <span key="action">
                <strong>{libelleAction(evenement.action)}</strong>
                <br />
                <span className={fr.cx("fr-text--xs")}>{evenement.action}</span>
                <br />
                <span className={fr.cx("fr-text--sm")}>
                  {libelleCible(evenement.targetType)}
                  {evenement.targetId === null ? "" : ` : ${evenement.targetId}`}
                </span>
              </span>,
              <Badge
                key="resultat"
                as="span"
                severity={severiteResultat(evenement.result)}
                small
                noIcon
              >
                {libelleResultat(evenement.result)}
              </Badge>,
              celluleExecution(evenement.correlationId, criteres),
              <span key="detail">
                <DetailJson titre="Avant" valeur={evenement.before} />
                <DetailJson titre="Après" valeur={evenement.after} />
                {evenement.before === null && evenement.after === null ? (
                  <span className={fr.cx("fr-text--sm")}>aucun</span>
                ) : null}
              </span>,
            ])}
          />

          <Pagination criteres={criteres} page={page} pages={pages} />
        </>
      )}
    </main>
  );
}

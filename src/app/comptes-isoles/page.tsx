import { fr } from "@codegouvfr/react-dsfr";
import type { Metadata } from "next";

import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import type { Suggestion } from "@/ui/ChampAvecListe";

import { FileDesComptesIsoles, type LigneCompteIsole } from "./FileDesComptesIsoles";

export const metadata: Metadata = { title: "Comptes isolés" };

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

/**
 * Ce que le connecteur a écrit, relu sans confiance : la colonne est libre, et une
 * forme écrite par une version antérieure ne doit pas faire tomber la page. Tout ce
 * qui n'est pas un couple de deux chaînes est écarté sans bruit.
 */
function metadonnees(details: unknown): { libelle: string; valeur: string }[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details.flatMap((detail) =>
    typeof detail === "object" &&
    detail !== null &&
    typeof (detail as { label?: unknown }).label === "string" &&
    typeof (detail as { value?: unknown }).value === "string"
      ? [
          {
            libelle: (detail as { label: string }).label,
            valeur: (detail as { value: string }).value,
          },
        ]
      : [],
  );
}

export default async function ComptesIsolesPage() {
  await requireOperateur();

  const [isoles, personnes, comptes] = await Promise.all([
    prisma.externalIdentity.findMany({
      // Un rattachement par ressemblance appelle le même geste qu'un compte sans
      // détenteur : quelqu'un doit trancher. Le laisser hors de cette file le
      // rendrait invisible, alors qu'il ne pourra jamais justifier une révocation.
      where: {
        vanishedAt: null,
        OR: [{ personId: null, serviceAccountId: null }, { matchMethod: "HEURISTIC" }],
      },
      orderBy: [{ provider: "asc" }, { handle: "asc" }],
      select: {
        id: true,
        provider: true,
        handle: true,
        matchMethod: true,
        firstSeenAt: true,
        lastSeenAt: true,
        details: true,
        grants: {
          where: { vanishedAt: null },
          // Ordonnés, sans quoi « le premier accès » de la cellule change d'un jour à
          // l'autre pour la même situation.
          orderBy: [{ resource: { externalId: "asc" } }, { role: "asc" }],
          select: { role: true, resource: { select: { label: true } } },
        },
      },
    }),
    prisma.person.findMany({
      where: { vanishedAt: null },
      orderBy: { username: "asc" },
      select: { username: true, fullname: true },
    }),
    prisma.serviceAccount.findMany({ orderBy: { key: "asc" }, select: { key: true, label: true } }),
  ]);

  // Les dates sont mises en forme ici : la même chaîne traverse jusqu'au client, là
  // où deux `Intl` de fuseaux différents feraient diverger le rendu.
  const cibles: Suggestion[] = [
    ...personnes.map((personne) => ({ valeur: personne.username, libelle: personne.fullname })),
    ...comptes.map((compte) => ({
      valeur: compte.key,
      libelle: compte.label,
      mention: "compte de service",
    })),
  ];

  const lignes: LigneCompteIsole[] = isoles.map((identite) => ({
    id: identite.id,
    provider: identite.provider,
    handle: identite.handle,
    ressemblance: identite.matchMethod === "HEURISTIC",
    acces: identite.grants.map((acces) => `${acces.role} sur ${acces.resource.label}`),
    metadonnees: metadonnees(identite.details),
    vuDepuis: dateFr.format(identite.firstSeenAt),
    vuEncore: dateFr.format(identite.lastSeenAt),
  }));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Comptes isolés</h1>

      <p className={fr.cx("fr-text--lead")}>
        Des comptes existent sur des systèmes de l'incubateur sans qu'aucune personne suivie ni
        aucun compte de service ne s'en réclame. Ce n'est pas une anomalie de la collecte : c'est
        précisément ce que cet outil existe pour mettre au jour.
      </p>

      {lignes.length === 0 ? (
        <p>
          Aucun compte isolé. Tout ce qui a été observé est rattaché à quelqu'un, ou à un compte de
          service déclaré.
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            {lignes.length} compte{lignes.length > 1 ? "s" : ""} sans détenteur connu.
          </p>

          <FileDesComptesIsoles lignes={lignes} cibles={cibles} />
        </>
      )}
    </main>
  );
}

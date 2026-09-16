import { fr } from "@codegouvfr/react-dsfr";
import type { Metadata } from "next";

import { connecteur } from "@/connectors";
import { propositionDeMachine } from "@/core/compte-de-service";
import { type SuggestionRattachement, suggererRattachements } from "@/core/suggestion-rattachement";
import { OU_NON_REVOCABLE } from "@/lib/comptes-isoles";
import { prisma } from "@/lib/db";
import { toleranceDesComptes } from "@/lib/derogation";
import { requireOperateur } from "@/lib/session";
import type { Suggestion } from "@/ui/ChampAvecListe";
import { dateFr } from "@/ui/dates";
import { tolerance } from "@/ui/tolerance";

import { FileDesComptesIsoles, type LigneCompteIsole } from "./FileDesComptesIsoles";

export const metadata: Metadata = { title: "Comptes isolés" };

export const dynamic = "force-dynamic";

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

/**
 * Ce que l'écran propose de rattacher, du plus sûr au plus faible.
 *
 * La collecte suppose déjà un détenteur pour les identités rapprochées par
 * ressemblance, et cet écran ne l'a jamais dit : il affichait un badge sans nom,
 * laissant retrouver à la main ce que la base savait. Cette supposition passe devant
 * les autres, seule à reposer sur une égalité d'identifiant plutôt que sur un
 * fragment d'adresse, et ne se répète pas si la comparaison la retrouve.
 */
function propositions(
  handle: string,
  supposee: { username: string; fullname: string } | null,
  personnes: readonly { username: string; fullname: string }[],
): readonly SuggestionRattachement[] {
  const devinees = suggererRattachements(handle, personnes);
  if (supposee === null) {
    return devinees;
  }

  return [
    {
      username: supposee.username,
      fullname: supposee.fullname,
      niveau: "forte",
      // « Reconnu » serait trop dire : ces lignes portent `HEURISTIC`, c'est-à-dire une
      // ressemblance que personne n'a confirmée, et la ligne du tableau les marque
      // elle-même comme telles. Accepter la proposition pose `DECLARED` et rend le
      // compte révocable : le titre ne doit pas donner l'assurance qui manque.
      motif: "Ressemblance relevée par la collecte",
    },
    ...devinees.filter((devinee) => devinee.username !== supposee.username),
  ];
}

export default async function ComptesIsolesPage() {
  const operateur = await requireOperateur();

  const [isoles, personnes, comptes] = await Promise.all([
    prisma.externalIdentity.findMany({
      where: OU_NON_REVOCABLE,
      orderBy: [{ provider: "asc" }, { handle: "asc" }],
      select: {
        id: true,
        provider: true,
        handle: true,
        externalId: true,
        matchMethod: true,
        person: { select: { username: true, fullname: true } },
        firstSeenAt: true,
        lastSeenAt: true,
        details: true,
        grants: {
          where: { vanishedAt: null },
          // Ordonnés, sans quoi « le premier accès » de la cellule change d'un jour à
          // l'autre pour la même situation.
          orderBy: [{ resource: { externalId: "asc" } }, { role: "asc" }],
          select: { role: true, resource: { select: { label: true, provider: true } } },
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

  // Un compte toléré reste dans cette file : il est toujours isolé, et le rattacher
  // reste le geste qui le résout. Ce qui change, c'est qu'il ne remonte plus dans les
  // constats, et le taire ici ferait chercher pourquoi.
  const couverts = await toleranceDesComptes(isoles, new Date());

  const lignes: LigneCompteIsole[] = isoles.map((identite) => ({
    id: identite.id,
    provider: identite.provider,
    handle: identite.handle,
    tolere: tolerance(couverts, identite),
    ressemblance: identite.matchMethod === "HEURISTIC",
    propositions: propositions(identite.handle, identite.person, personnes),
    // Une seule forme pour tous les systèmes : le rôle entre guillemets parce qu'il vient
    // du fournisseur et se lit tel quel, puis le système, puis ce qu'il vise. Un accès qui
    // ne visait rien de précis porte la ressource que le socle réserve, et dont le libellé
    // le dit.
    acces: identite.grants.map(
      (acces) => `« ${acces.role} » ${acces.resource.provider} (${acces.resource.label})`,
    ),
    metadonnees: metadonnees(identite.details),
    // Nul quand aucun connecteur enregistré ne sert ce système : la déclaration n'aurait
    // alors ni clé à proposer ni système où ranger la machine, et l'écran ne l'offre pas.
    machine: (() => {
      const systeme = connecteur(identite.provider)?.contract;
      return systeme ? propositionDeMachine(systeme, identite, operateur.username) : null;
    })(),
    vuDepuis: dateFr.format(identite.firstSeenAt),
    vuEncore: dateFr.format(identite.lastSeenAt),
  }));

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Comptes isolés</h1>

      <p className={fr.cx("fr-text--lead")}>
        Des comptes existent sur des systèmes de l'incubateur sans qu'aucune personne suivie ni
        aucun compte de service ne s'en réclame. Ce n'est pas une anomalie de la collecte : chacun
        attend qu'on lui trouve un détenteur, ou qu'on crée la fiche qui lui manque.
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

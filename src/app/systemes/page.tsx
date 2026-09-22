import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import { CONNECTEURS, catalogueDOctroi } from "@/connectors";
import { type Capability, resolveCapability } from "@/core/connector";
import { LIBELLE_ETAT_COLLECTE, LIBELLE_TIER } from "@/core/lexique";
import { verifierProfils } from "@/core/octroi";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { requireOperateur } from "@/lib/session";
import { aUnePage } from "@/ui/connecteurs/registre";
import { type ScopeAttendu, scopeAttendu } from "@/ui/connecteurs/scope-attendu";

export const metadata: Metadata = { title: "Systèmes couverts" };

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

const CAPACITES: { cle: Capability; libelle: string; quoi: string }[] = [
  { cle: "list", libelle: "Lire", quoi: "relever les comptes et leurs accès" },
  { cle: "revoke", libelle: "Retirer", quoi: "couper un accès" },
  { cle: "grant", libelle: "Donner", quoi: "ouvrir un accès" },
  { cle: "verify", libelle: "Vérifier", quoi: "confirmer l'état après coup" },
  { cle: "reference", libelle: "Inventorier", quoi: "relever les objets possédés" },
];

interface AccesDeProfil {
  profil: string;
  /** Rang dans la liste du profil : deux accès y visent parfois le même système. */
  rang: number;
  libelle: string;
  scope: string;
  echeance: string;
  refus: readonly string[];
}

type ProfilsDeclares =
  | {
      etat: "lus";
      parSysteme: ReadonlyMap<string, readonly AccesDeProfil[]>;
      /**
       * Les accès dont aucun connecteur ne porte la clé. La boucle de cette page suit
       * le registre : sans cette liste, un profil qui vise un système inconnu serait
       * refusé par la vérification puis rendu nulle part, et son refus se perdrait
       * exactement là où on vient le chercher.
       */
      horsCatalogue: readonly { systeme: string; acces: readonly AccesDeProfil[] }[];
    }
  | { etat: "illisible" };

/**
 * La politique est lue à part, et son échec est absorbé : cet écran est celui qu'on
 * ouvre quand quelque chose ne marche pas, et un fichier de politique absent ou
 * refusé ne doit pas emporter avec lui l'état des credentials et des capacités, qui
 * n'en dépend pas.
 */
function profilsDeclares(): ProfilsDeclares {
  try {
    const profils = policy().profiles;
    const refus = verifierProfils(profils, catalogueDOctroi());
    const parSysteme = new Map<string, AccesDeProfil[]>();

    for (const profil of profils) {
      for (const [rang, acces] of profil.accesses.entries()) {
        const lignes = parSysteme.get(acces.system) ?? [];

        lignes.push({
          profil: profil.key,
          rang,
          libelle: profil.label,
          scope: JSON.stringify(acces.scope),
          echeance:
            acces.expiresInDays === undefined
              ? "sans échéance"
              : `${acces.expiresInDays} jours d'accès`,
          refus: refus
            .filter((un) => un.profil === profil.key && un.acces === rang)
            .map((un) => un.motif),
        });

        parSysteme.set(acces.system, lignes);
      }
    }

    const couverts = new Set(CONNECTEURS.map(({ contract }) => contract.key));
    const horsCatalogue = [...parSysteme]
      .filter(([systeme]) => !couverts.has(systeme))
      .map(([systeme, acces]) => ({ systeme, acces }));

    return { etat: "lus", parSysteme, horsCatalogue };
  } catch (erreur) {
    console.error("[systèmes] politique illisible, profils non affichés", erreur);
    return { etat: "illisible" };
  }
}

function Scope({
  systeme,
  octroiDeclare,
  scope,
}: {
  systeme: string;
  octroiDeclare: boolean;
  scope: ScopeAttendu;
}) {
  if (!octroiDeclare) {
    return (
      <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
        Aucun scope attendu. Un profil ne peut pas encore viser ce système.
      </p>
    );
  }

  if (scope.etat === "illisible") {
    return (
      <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
        Le scope attendu n'a pas pu être rendu, le schéma de ce connecteur n'étant pas déclaratif.
        C'est un défaut du connecteur, à corriger dans le code.
      </p>
    );
  }

  if (scope.champs.length === 0) {
    return (
      <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
        Aucun champ de scope. Un accès ne s'y découpe pas, et un profil y laisse <code>scope</code>{" "}
        vide.
      </p>
    );
  }

  return (
    <>
      <p className={fr.cx("fr-text--sm", "fr-mt-2w", "fr-mb-1w")}>
        Ce qu'un profil de la politique écrit sous <code>accesses[].scope</code> pour viser ce
        système. C'est le schéma du connecteur lui-même, pas une copie tenue à côté.{" "}
        {scope.clesInconnuesRefusees ? "Toute clé absente de ce tableau est refusée." : ""}
      </p>

      <Table
        fixed
        caption={`Scope attendu par ${systeme}`}
        headers={["Champ", "Attendu", "Ce que c'est"]}
        data={scope.champs.map(({ nom, requis, attendu, description, exemple }) => [
          <span key="n">
            <code>{nom}</code>
            <br />
            <span className={fr.cx("fr-text--sm")}>{requis ? "requis" : "facultatif"}</span>
          </span>,
          <span key="a" className={fr.cx("fr-text--sm")}>
            {attendu}
            {exemple === undefined ? null : (
              <>
                <br />
                exemple : <code>{exemple}</code>
              </>
            )}
          </span>,
          <span key="d" className={fr.cx("fr-text--sm")}>
            {description ?? "non documenté par le connecteur"}
          </span>,
        ])}
      />
    </>
  );
}

function Profils({ acces }: { acces: readonly AccesDeProfil[] }) {
  if (acces.length === 0) {
    return (
      <p className={fr.cx("fr-text--sm")}>Aucun profil déclaré n'ouvre d'accès sur ce système.</p>
    );
  }

  return (
    <>
      <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
        Profils qui ouvrent un accès ici, tels que <code>profiles</code> les déclare :
      </p>
      <ul className={fr.cx("fr-text--sm")}>
        {acces.map((un) => (
          <li key={`${un.profil}:${un.rang}`}>
            {un.libelle} (<code>{un.profil}</code>) : <code>{un.scope}</code>, {un.echeance}.{" "}
            {un.refus.length === 0 ? null : (
              <>
                <Badge severity="error" small noIcon>
                  refusé
                </Badge>{" "}
                {un.refus.join(" ")}
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function SystemesPage() {
  await requireOperateur();

  const profils = profilsDeclares();

  const systemes = await Promise.all(
    CONNECTEURS.map(async (connecteur) => {
      const contrat = connecteur.contract;
      const sondes = await connecteur.probe();

      return {
        contrat,
        sondes,
        page: aUnePage(contrat),
        octroiDeclare: contrat.capabilities.grant !== undefined,
        scope: scopeAttendu(contrat.scopeSchema),
        capacites: CAPACITES.map((capacite) => ({
          ...capacite,
          resolue: resolveCapability(
            capacite.cle,
            contrat.capabilities[capacite.cle],
            sondes,
            contrat.runbook,
          ),
        })),
        dernierReleve: await prisma.syncRun.findFirst({
          where: { provider: contrat.key, capability: "list" },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true, status: true, itemsSeen: true },
        }),
      };
    }),
  );

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Systèmes couverts</h1>

      <p className={fr.cx("fr-text--sm")}>
        Ce que l'outil sait faire sur chaque système, tel que ses credentials le permettent
        aujourd'hui et non tel que le code l'espère.
      </p>

      {profils.etat === "illisible" ? (
        <p className={fr.cx("fr-text--sm")}>
          La politique n'a pas pu être lue. Les profils déclarés ne sont pas affichés, le reste de
          cet écran n'en dépend pas.
        </p>
      ) : null}

      {systemes.map(({ contrat, sondes, capacites, dernierReleve, page, octroiDeclare, scope }) => (
        <section key={contrat.key} className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h4", "fr-mb-1v")}>
            {contrat.label}{" "}
            <span className={fr.cx("fr-text--sm")}>
              <code>{contrat.key}</code>
            </span>
          </h2>

          <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>
            {dernierReleve
              ? `Dernière lecture le ${dateFr.format(dernierReleve.startedAt)}, collecte ${LIBELLE_ETAT_COLLECTE[dernierReleve.status].libelle}, ${dernierReleve.itemsSeen} comptes.`
              : "Jamais lu."}
          </p>

          {/* Le détail du contrat se replie : ce qu'un opérateur vient voir ici est l'état des
              lectures, et cette référence se lit une fois, le jour où l'on branche le système.
              Dépliée pour trois systèmes, elle faisait à elle seule quatre mille pixels. */}
          <Accordion titleAs="h3" label={`Ce que ${contrat.label} sait faire, et ce qu'il attend`}>
            <Table
              fixed
              caption={`Capacités sur ${contrat.label}`}
              headers={["Capacité", "Aujourd'hui", "Ce qui manque pour faire mieux"]}
              data={capacites.map(({ libelle, quoi, resolue }) => [
                <span key="c">
                  <strong>{libelle}</strong>
                  <br />
                  <span className={fr.cx("fr-text--sm")}>{quoi}</span>
                </span>,
                <Badge key="t" severity={LIBELLE_TIER[resolue.tier].severite} small noIcon>
                  {LIBELLE_TIER[resolue.tier].libelle}
                </Badge>,
                resolue.degradedFrom ? (
                  <span key="m" className={fr.cx("fr-text--sm")}>
                    {LIBELLE_TIER[resolue.degradedFrom.tier].libelle} si :{" "}
                    {resolue.degradedFrom.missing.join(", ")}
                  </span>
                ) : (
                  <span key="m" className={fr.cx("fr-text--sm")}>
                    sans objet
                  </span>
                ),
              ])}
            />

            {/* Hors du tableau, et replié : ces marches à suivre font plus de cent mots chacune,
                et les porter en cellule donnait des lignes de 233 pixels pour un écran de cinq
                mille. On les lit une fois, le jour où l'on branche le système. Le DSFR n'autorise
                pas l'accordéon en cellule, et le journal donne déjà cette forme à sa charge utile. */}
            {capacites
              .filter(({ resolue }) => resolue.decl || resolue.degradedFrom)
              .map(({ libelle, resolue }) => (
                <div key={libelle} className={fr.cx("fr-mt-2w")}>
                  <h4 className={fr.cx("fr-text--sm", "fr-text--bold", "fr-mb-1v")}>
                    Comment faire « {libelle.toLowerCase()} »
                  </h4>
                  <p className={fr.cx("fr-text--sm", "fr-mb-0")}>{resolue.runbook}</p>
                </div>
              ))}

            <Scope systeme={contrat.label} octroiDeclare={octroiDeclare} scope={scope} />

            {profils.etat === "lus" ? (
              <Profils acces={profils.parSysteme.get(contrat.key) ?? []} />
            ) : null}

            <p className={fr.cx("fr-text--sm", "fr-mt-1w")}>
              Credentials :{" "}
              {sondes.length === 0
                ? "aucun requis"
                : sondes
                    .map(
                      (sonde) =>
                        `${sonde.id} ${sonde.available ? "présent" : `absent (${sonde.unavailableReason ?? "raison non précisée"})`}`,
                    )
                    .join(" / ")}
            </p>
          </Accordion>

          {page ? (
            <p className={fr.cx("fr-text--sm")}>
              <Link href={`/systemes/${contrat.key}`}>
                Ce que {contrat.label} regarde, et ce qu'il sait faire hors du socle
              </Link>
            </p>
          ) : null}
        </section>
      ))}

      {profils.etat === "lus" && profils.horsCatalogue.length > 0 ? (
        <section className={fr.cx("fr-mt-4w")}>
          <h2 className={fr.cx("fr-h5")}>Des profils visent un système que rien ne porte</h2>
          <p className={fr.cx("fr-text--sm")}>
            Ces accès ne s'ouvriront jamais. Ils se corrigent dans <code>profiles</code>.
          </p>
          {profils.horsCatalogue.map(({ systeme, acces }) => (
            <div key={systeme} className={fr.cx("fr-mt-2w")}>
              <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                <code>{systeme}</code> :
              </p>
              <Profils acces={acces} />
            </div>
          ))}
        </section>
      ) : null}

      <Alert
        severity="info"
        className={fr.cx("fr-mt-4w")}
        small
        description="Un système absent de cette page n'est pas couvert, ni lu ni signalé. Dans la politique, c'est la clé connectors qui le déclare."
      />
    </main>
  );
}

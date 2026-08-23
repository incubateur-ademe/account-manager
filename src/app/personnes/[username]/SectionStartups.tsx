import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";

import { LIBELLE_PHASE } from "@/core/libelle-startup";
import { dateFr } from "@/ui/dates";
import { TableCustom } from "@/ui/TableCustom";

import { Absent } from "./Champs";
import { ModaleRattacherStartup } from "./ModaleRattacherStartup";
import type { StartupProposable } from "./RattacherStartup";
import { RetirerRattachement } from "./RetirerRattachement";

export interface RattachementManuelAffiche {
  id: string;
  until: Date;
  createdBy: string;
}

export interface LigneStartup {
  ghid: string;
  nom: string | null;
  phase: string | null;
  phaseStart: Date | null;
  terminale: boolean;
  connue: boolean;
  collectee: boolean;
  manuel: RattachementManuelAffiche | null;
}

export interface RattachementClos {
  id: string;
  startup: string;
  until: Date;
  createdBy: string;
  endedAt: Date | null;
  endedBy: string | null;
  reason: string | null;
}

export function SectionStartups({
  personne,
  lignes,
  clos,
  startupsProposables,
  toutesTerminees,
  parEquipe,
  inconnues,
}: {
  personne: { username: string; fullname: string; missionEnd: Date | null };
  lignes: readonly LigneStartup[];
  clos: readonly RattachementClos[];
  startupsProposables: readonly StartupProposable[];
  toutesTerminees: boolean;
  parEquipe: boolean;
  inconnues: number;
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--middle")}>
        <div className={fr.cx("fr-col")}>
          <h2 className={fr.cx("fr-h5", "fr-mb-0")}>Startups</h2>
        </div>
        <ModaleRattacherStartup
          username={personne.username}
          missionEnd={personne.missionEnd?.toISOString().slice(0, 10) ?? null}
          startups={startupsProposables}
        />
      </div>

      {lignes.length === 0 ? (
        <p className={fr.cx("fr-mt-2w")}>Aucune startup ne lui est rattachée.</p>
      ) : (
        <>
          <TableCustom
            className={fr.cx("fr-mt-2w")}
            header={[
              { children: "Startup" },
              { children: "Phase" },
              { children: "Depuis" },
              { children: "Justifie des accès" },
              { children: "Origine" },
              { children: "" },
            ]}
            body={lignes.map((ligne) => ({
              key: ligne.ghid,
              row: [
                {
                  children: (
                    <span>
                      {/* Un ghid que le référentiel ne porte pas n'a pas de fiche : la
                          collecte l'a rendu sur une personne sans jamais rendre la
                          startup, et le lien tomberait sur une page introuvable. */}
                      {ligne.nom === null ? (
                        ligne.ghid
                      ) : (
                        <Link href={`/startups/${encodeURIComponent(ligne.ghid)}`}>
                          {ligne.nom}
                        </Link>
                      )}
                      <br />
                      <span className={fr.cx("fr-text--sm")}>{ligne.ghid}</span>
                    </span>
                  ),
                },
                {
                  children:
                    ligne.phase === null ? (
                      <Absent mention="phase inconnue" />
                    ) : (
                      (LIBELLE_PHASE[ligne.phase] ?? ligne.phase)
                    ),
                },
                { children: ligne.phaseStart ? dateFr.format(ligne.phaseStart) : <Absent /> },
                {
                  children: ligne.connue ? (
                    <Badge severity={ligne.terminale ? "error" : "success"} noIcon>
                      {ligne.terminale ? "Non, phase terminale" : "Oui"}
                    </Badge>
                  ) : (
                    <Badge severity="info" noIcon>
                      On ne sait pas
                    </Badge>
                  ),
                },
                {
                  children: (
                    <span>
                      {ligne.collectee ? "Collecté" : null}
                      {ligne.collectee && ligne.manuel ? <br /> : null}
                      {ligne.manuel ? (
                        <>
                          Manuel, jusqu'au {dateFr.format(ligne.manuel.until)}
                          <br />
                          <span className={fr.cx("fr-text--sm")}>
                            posé par {ligne.manuel.createdBy}
                          </span>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                {
                  children: ligne.manuel ? (
                    <RetirerRattachement id={ligne.manuel.id} cible={ligne.nom ?? ligne.ghid} />
                  ) : null,
                },
              ],
            }))}
          />

          {/* Le constat de startups terminées épargne les rattachés par équipe : la
              fiche doit dire la même chose que la file, sans quoi elle lèverait ici
              ce que la file refuse de lever. */}
          {toutesTerminees && parEquipe ? (
            <Alert
              className={fr.cx("fr-mt-2w")}
              severity="info"
              small
              description="Toutes ses startups sont dans une phase terminale. Son rattachement à l'incubateur passe par une équipe : il ne dépend d'aucune d'elles."
            />
          ) : null}

          {inconnues > 0 ? (
            <Alert
              className={fr.cx("fr-mt-2w")}
              severity="info"
              small
              description={`La phase de ${inconnues} startup${inconnues > 1 ? "s" : ""} n'est pas connue. Tant qu'elle le reste, on ne peut pas conclure que toutes ses startups sont terminées.`}
            />
          ) : null}
        </>
      )}

      {/* Sans eux, un constat levé la veille deviendrait inexplicable. */}
      {clos.length > 0 ? (
        <Accordion
          className={fr.cx("fr-mt-2w")}
          titleAs="h3"
          label={`Rattachements manuels clos ou expirés (${clos.length})`}
        >
          <TableCustom
            compact
            header={[
              { children: "Startup" },
              { children: "Jusqu'au" },
              { children: "Posé par" },
              { children: "Fin" },
              { children: "Motif" },
            ]}
            body={clos.map((rattachement) => [
              { children: rattachement.startup },
              { children: dateFr.format(rattachement.until) },
              { children: rattachement.createdBy },
              {
                children: rattachement.endedAt
                  ? `retiré le ${dateFr.format(rattachement.endedAt)} par ${rattachement.endedBy ?? "?"}`
                  : "expiré",
              },
              { children: rattachement.reason ?? <Absent /> },
            ])}
          />
        </Accordion>
      ) : null}
    </section>
  );
}

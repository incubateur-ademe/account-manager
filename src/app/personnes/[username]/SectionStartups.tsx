import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import { Absent } from "./Champs";
import { dateFr, LIBELLE_PHASE } from "./libelles";
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
          <Table
            className={fr.cx("fr-mt-2w")}
            caption={`Startups de ${personne.fullname} et phase de chacune`}
            noCaption
            headers={["Startup", "Phase", "Depuis", "Justifie des accès", "Origine", ""]}
            data={lignes.map((ligne) => [
              <span key="s">
                {ligne.nom ?? ligne.ghid}
                <br />
                <span className={fr.cx("fr-text--sm")}>{ligne.ghid}</span>
              </span>,
              ligne.phase === null ? (
                <Absent key="p" mention="phase inconnue" />
              ) : (
                (LIBELLE_PHASE[ligne.phase] ?? ligne.phase)
              ),
              ligne.phaseStart ? dateFr.format(ligne.phaseStart) : <Absent key="d" />,
              ligne.connue ? (
                <Badge key="j" severity={ligne.terminale ? "error" : "success"} noIcon>
                  {ligne.terminale ? "Non, phase terminale" : "Oui"}
                </Badge>
              ) : (
                <Badge key="j" severity="info" noIcon>
                  On ne sait pas
                </Badge>
              ),
              <span key="o">
                {ligne.collectee ? "Collecté" : null}
                {ligne.collectee && ligne.manuel ? <br /> : null}
                {ligne.manuel ? (
                  <>
                    Manuel, jusqu'au {dateFr.format(ligne.manuel.until)}
                    <br />
                    <span className={fr.cx("fr-text--sm")}>posé par {ligne.manuel.createdBy}</span>
                  </>
                ) : null}
              </span>,
              ligne.manuel ? (
                <RetirerRattachement
                  key="r"
                  id={ligne.manuel.id}
                  startup={ligne.nom ?? ligne.ghid}
                />
              ) : (
                <span key="r" />
              ),
            ])}
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
          <Table
            caption={`Rattachements manuels passés de ${personne.fullname}`}
            noCaption
            headers={["Startup", "Jusqu'au", "Posé par", "Fin", "Motif"]}
            data={clos.map((rattachement) => [
              rattachement.startup,
              dateFr.format(rattachement.until),
              rattachement.createdBy,
              rattachement.endedAt ? (
                `retiré le ${dateFr.format(rattachement.endedAt)} par ${rattachement.endedBy ?? "?"}`
              ) : (
                <span key="f">expiré</span>
              ),
              rattachement.reason ?? <Absent key="m" />,
            ])}
          />
        </Accordion>
      ) : null}
    </section>
  );
}

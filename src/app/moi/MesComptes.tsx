import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import type { MesComptes as MesComptesConnus } from "@/lib/espace-perso";
import { dateFr } from "@/ui/dates";
import { RATTACHEMENT_IDENTITE } from "@/ui/severites";

import { MES_COMPTES } from "./redaction";

export function MesComptes({ mesComptes }: { mesComptes: MesComptesConnus }) {
  const { observation } = mesComptes;
  const incertains =
    mesComptes.fiche === "connue" &&
    mesComptes.comptes.some((compte) => !RATTACHEMENT_IDENTITE[compte.matchMethod].sur);

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h4")}>{MES_COMPTES.titre}</h2>

      {observation.muets.length > 0 ? (
        <Alert
          as="h3"
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title={MES_COMPTES.muets.titre(observation.muets.length)}
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>{MES_COMPTES.muets.entete}</p>
              <ul className={fr.cx("fr-mb-0")}>
                {observation.muets.map((muet) => (
                  <li key={muet.cle}>
                    <strong>{muet.systeme}</strong> {MES_COMPTES.muets.raison(muet)}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      ) : null}

      {mesComptes.fiche === "absente" ? (
        <p>
          {observation.perimetre.heures === null
            ? MES_COMPTES.jamaisCollecte
            : MES_COMPTES.ficheInconnue}
        </p>
      ) : mesComptes.comptes.length === 0 ? (
        <p>{MES_COMPTES.aucunCompte(observation.observes)}</p>
      ) : (
        <>
          <Table
            headers={["Système", "Compte", "Vu pour la dernière fois"]}
            data={mesComptes.comptes.map((compte) => [
              compte.systeme,
              <span key={compte.id}>
                {compte.handle}
                {RATTACHEMENT_IDENTITE[compte.matchMethod].sur ? null : (
                  <>
                    <br />
                    <Badge severity="warning" small noIcon>
                      {MES_COMPTES.rattachementIncertain}
                    </Badge>
                  </>
                )}
                {compte.vanishedAt ? (
                  <>
                    <br />
                    <Badge severity="info" small noIcon>
                      {MES_COMPTES.disparu(dateFr.format(compte.vanishedAt))}
                    </Badge>
                  </>
                ) : null}
              </span>,
              dateFr.format(compte.lastSeenAt),
            ])}
          />
          {incertains ? (
            <p className={fr.cx("fr-text--sm")}>{MES_COMPTES.consequenceDuRattachementIncertain}</p>
          ) : null}
          {observation.muets.length === 0 ? (
            <p className={fr.cx("fr-text--sm")}>{MES_COMPTES.toutEstLu(observation.observes)}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

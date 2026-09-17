import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";

import { dateFr } from "@/ui/dates";
import { RATTACHEMENT_IDENTITE } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";
import { lireLeParc } from "./lecture";
import { ParcScalingo } from "./ParcScalingo";
import { assemblerLeParc } from "./parc";
import { libelleDuRole, MOTS_DE_SCALINGO } from "./redaction";

/**
 * Déclaré pour la page de système, qui n'affirme « cet écran ne modifie rien » qu'au
 * dessus d'écrans qui ne portent aucun geste. Celui-ci en porte un, qui journalise au
 * nom de l'opérateur et écrit un plan.
 */
export const porteUnGeste = true;

/**
 * Ce que la collecte a constaté du parc Scalingo, dans les deux sens.
 *
 * Il lit la base et jamais l'API distante : ce qu'on voit ici est ce sur quoi une coupure
 * se décide, et une tuile qui interroge le système en direct ne fonde aucune décision. La
 * date du dernier constat s'affiche donc en clair, parce que c'est elle qui dit ce que
 * vaut ce qu'on lit.
 */
export default async function EcranScalingo() {
  const { ressources, comptes } = await lireLeParc();

  const { groupes, detenteurs, dernierConstat } = assemblerLeParc(ressources, comptes);

  return (
    <>
      <Alert
        className={fr.cx("fr-mt-4w")}
        severity="info"
        small
        description={
          dernierConstat === null
            ? MOTS_DE_SCALINGO.parc.rienDeVivant
            : `${MOTS_DE_SCALINGO.parc.datation} Le dernier constat de ce système date du ${dateFr.format(dernierConstat)}.`
        }
      />

      <ParcScalingo groupes={groupes} />

      <section className={fr.cx("fr-mt-4w")}>
        <h2 className={fr.cx("fr-h5")}>{MOTS_DE_SCALINGO.comptes.titre}</h2>

        {detenteurs.length === 0 ? (
          <Alert severity="info" small description={MOTS_DE_SCALINGO.comptes.vide} />
        ) : (
          <TableCustom
            header={[
              { children: "Compte" },
              { children: "Personne" },
              { children: "Rattachement" },
              { children: "Applications" },
            ]}
            body={detenteurs.map((detenteur) => ({
              key: detenteur.cle,
              row: [
                {
                  children: (
                    <span>
                      <strong>{detenteur.handle}</strong>
                      {detenteur.enAttente ? (
                        <>
                          <br />
                          <Badge severity="warning" small noIcon>
                            {MOTS_DE_SCALINGO.comptes.invitation}
                          </Badge>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                {
                  children: detenteur.personne ? (
                    <Link href={`/personnes/${encodeURIComponent(detenteur.personne.username)}`}>
                      {detenteur.personne.fullname}
                    </Link>
                  ) : detenteur.machine ? (
                    <span className={fr.cx("fr-text--sm")}>
                      {detenteur.machine.libelle}
                      <br />
                      <Link className={fr.cx("fr-link", "fr-text--sm")} href="/comptes-de-service">
                        Voir les comptes de service
                      </Link>
                    </span>
                  ) : (
                    <span className={fr.cx("fr-text--sm", "fr-hint-text")}>
                      {MOTS_DE_SCALINGO.comptes.isole}{" "}
                      <Link className={fr.cx("fr-link", "fr-text--sm")} href="/comptes-isoles">
                        Voir la file des comptes isolés
                      </Link>
                    </span>
                  ),
                },
                {
                  children: (
                    <Badge
                      severity={
                        RATTACHEMENT_IDENTITE[detenteur.matchMethod].sur ? "success" : "warning"
                      }
                      small
                      noIcon
                    >
                      {RATTACHEMENT_IDENTITE[detenteur.matchMethod].libelle}
                    </Badge>
                  ),
                },
                {
                  children:
                    detenteur.parProjet.length === 0 ? (
                      <span className={fr.cx("fr-text--sm", "fr-hint-text")}>
                        {MOTS_DE_SCALINGO.comptes.sansAcces}
                      </span>
                    ) : (
                      <div className={fr.cx("fr-text--sm")}>
                        {detenteur.parProjet.map((groupe) => (
                          <div key={groupe.cle}>
                            <strong>
                              {groupe.projet ?? MOTS_DE_SCALINGO.parc.horsProjetTitre}
                            </strong>
                            <ul className={fr.cx("fr-mb-1w")}>
                              {groupe.acces.map((acces) => (
                                <li key={`${acces.libelle}:${acces.role}`}>
                                  {acces.libelle} : {libelleDuRole(acces.role)}, vu le{" "}
                                  {dateFr.format(acces.vuLe)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ),
                },
              ],
            }))}
          />
        )}
      </section>
    </>
  );
}

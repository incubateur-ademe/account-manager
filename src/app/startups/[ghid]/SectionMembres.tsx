import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";

import { RetirerRattachement } from "@/app/personnes/[username]/RetirerRattachement";
import type { MembreDeStartup, RattachementEchu } from "@/core/startups";
import { LIBELLE_STATUT } from "@/core/statut";
import type { MatchMethod } from "@/generated/prisma/enums";
import { dateFr } from "@/ui/dates";
import { RATTACHEMENT_IDENTITE, SEVERITE_STATUT } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";

import { type PersonneProposable, RattacherPersonne } from "./RattacherPersonne";

export interface ComptesParFournisseur {
  provider: string;
  total: number;
  incertains: readonly { methode: MatchMethod; nombre: number }[];
}

export interface LigneMembre extends MembreDeStartup {
  comptes: readonly ComptesParFournisseur[];
  /**
   * Celui du rattachement manuel que le noyau a retenu pour cette ligne, seul champ
   * que `RattachementManuel` ne porte pas et sans lequel le retrait n'a pas de prise.
   */
  idManuel: string | null;
}

export function SectionMembres({
  ghid,
  nomStartup,
  membres,
  echus,
  collecteJamaisFaite,
  sortieLe,
  systemesCollectes,
  personnesProposables,
}: {
  ghid: string;
  nomStartup: string;
  membres: readonly LigneMembre[];
  echus: readonly RattachementEchu[];
  collecteJamaisFaite: boolean;
  /** Date à laquelle l'incubateur a cessé de rendre cette startup, s'il l'a fait. */
  sortieLe: Date | null;
  systemesCollectes: readonly string[];
  personnesProposables: readonly PersonneProposable[];
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--middle")}>
        <div className={fr.cx("fr-col")}>
          <h2 className={fr.cx("fr-h5", "fr-mb-0")}>Membres</h2>
        </div>
        <RattacherPersonne ghid={ghid} nomStartup={nomStartup} personnes={personnesProposables} />
      </div>

      {membres.length === 0 ? (
        collecteJamaisFaite ? (
          <Alert
            className={fr.cx("fr-mt-2w")}
            severity="info"
            small
            description="Aucune collecte du référentiel n'a jamais eu lieu : cette liste est vide faute d'observation, ce qui ne dit rien des personnes réellement rattachées à cette startup."
          />
        ) : sortieLe ? (
          // Le vide d'une startup sortie ne prouve rien, et c'est arithmétique : la
          // collecte ne retient d'une personne que les startups de l'incubateur, donc
          // le passage même qui a daté cette sortie a retiré ce ghid de tous ceux
          // qu'elle voit encore. Ne survivent ici que les personnes elles-mêmes sorties
          // du référentiel, dont la fiche a cessé d'être réécrite, et les rattachements
          // posés à la main.
          <Alert
            className={fr.cx("fr-mt-2w")}
            severity="warning"
            small
            description="Cette startup a quitté l'incubateur, et la collecte a du même coup cessé de rattacher qui que ce soit à elle. Cette liste ne peut donc plus contenir que les personnes elles-mêmes sorties du référentiel et celles rattachées à la main : son silence ne dit rien des accès qui survivent sur ce produit. Passez par la file des constats ou par les fiches des personnes concernées."
          />
        ) : (
          <p className={fr.cx("fr-mt-2w")}>Aucune personne n'est rattachée à cette startup.</p>
        )
      ) : (
        <>
          <TableCustom
            className={fr.cx("fr-mt-2w")}
            header={[
              { children: "Personne" },
              { children: "Statut" },
              { children: "Échéance" },
              { children: "Origine" },
              { children: "Comptes" },
              { children: "" },
            ]}
            body={membres.map((membre) => ({
              key: membre.username,
              row: [
                {
                  children: (
                    <span>
                      <Link href={`/personnes/${encodeURIComponent(membre.username)}`}>
                        {membre.fullname}
                      </Link>
                      <br />
                      <span className={fr.cx("fr-text--sm")}>{membre.username}</span>
                    </span>
                  ),
                },
                {
                  children: (
                    <Badge severity={SEVERITE_STATUT[membre.statut]} noIcon>
                      {LIBELLE_STATUT[membre.statut]}
                    </Badge>
                  ),
                },
                {
                  children: membre.echeance ? (
                    dateFr.format(membre.echeance)
                  ) : (
                    <span className={fr.cx("fr-hint-text")}>-</span>
                  ),
                },
                {
                  children: (
                    <span>
                      {membre.origine === "manuel" ? null : "Collecté"}
                      {membre.origine === "les-deux" ? <br /> : null}
                      {membre.manuel ? (
                        <>Manuel, jusqu'au {dateFr.format(membre.manuel.until)}</>
                      ) : null}
                      {/* Il n'ajoute pas la qualité de membre, que la collecte porte
                          déjà, mais l'échéance affichée à gauche est bien la plus
                          lointaine des deux : le retirer peut donc avancer une coupure. */}
                      {membre.origine === "les-deux" ? (
                        <>
                          <br />
                          <span className={fr.cx("fr-text--sm")}>
                            La collecte la rattache déjà : ce rattachement manuel ne change que son
                            échéance.
                          </span>
                        </>
                      ) : null}
                      {/* Couper ce rattachement ne la sortirait pas de l'incubateur : son
                          appartenance passe aussi par une équipe, qui ne dépend d'aucune
                          startup. */}
                      {membre.parEquipe ? (
                        <>
                          <br />
                          <span className={fr.cx("fr-text--sm")}>
                            Rattachée aussi par une équipe transverse.
                          </span>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                {
                  children:
                    membre.comptes.length === 0 ? (
                      <span className={fr.cx("fr-hint-text")}>aucun</span>
                    ) : (
                      <span>
                        {membre.comptes.map((compte, rang) => (
                          <span key={compte.provider}>
                            {rang > 0 ? <br /> : null}
                            {compte.provider} {compte.total}
                            {compte.incertains.map((incertain) => (
                              <span key={incertain.methode}>
                                {" "}
                                <Badge severity="warning" small noIcon>
                                  {RATTACHEMENT_IDENTITE[incertain.methode].libelle} :{" "}
                                  {incertain.nombre}
                                </Badge>
                              </span>
                            ))}
                          </span>
                        ))}
                      </span>
                    ),
                },
                {
                  children:
                    membre.idManuel === null ? null : (
                      <RetirerRattachement id={membre.idManuel} cible={membre.fullname} />
                    ),
                },
              ],
            }))}
          />

          <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
            Les comptes sont ceux qui n'ont pas disparu du dernier relevé de chaque système, repliés
            par système : la fiche de la personne les détaille un par un. Systèmes collectés à ce
            jour : {systemesCollectes.length === 0 ? "aucun" : systemesCollectes.join(", ")}. Tout
            système absent de cette liste n'a jamais été lu : une colonne vide s'y lit comme une
            absence de compte alors qu'elle est une absence de lecture. Un rattachement heuristique
            ou absent ne peut jamais produire de révocation.
          </p>
        </>
      )}

      {/* Sans cette phrase, l'absence d'une personne se lirait comme la preuve qu'elle
          ne travaille pas ici, alors que la collecte ne rend que ce que l'espace-membre
          range sous cette startup. */}
      <p className={fr.cx("fr-text--sm")}>
        Cette liste dit qui l'espace-membre rattache à cette startup, plus qui y a été rattaché à la
        main. Une personne que seule une équipe transverse rattache à l'incubateur n'a aucune
        startup collectée : elle ne figure ici que si quelqu'un l'y a rattachée à la main, même si
        elle travaille sur cette startup. Ce n'est donc pas la liste de qui y travaille.
      </p>

      {/* Un rattachement que le temps a rattrapé ne se retrouve nulle part ailleurs :
          la personne a simplement quitté la liste, sans que rien ne le date. */}
      {echus.length > 0 ? (
        <Accordion
          className={fr.cx("fr-mt-2w")}
          titleAs="h3"
          label={`Rattachements manuels expirés (${echus.length})`}
        >
          <TableCustom
            compact
            header={[{ children: "Personne" }, { children: "Jusqu'au" }]}
            body={echus.map((echu) => ({
              key: echu.username,
              row: [
                {
                  children: (
                    <span>
                      <Link href={`/personnes/${encodeURIComponent(echu.username)}`}>
                        {echu.fullname}
                      </Link>
                      <br />
                      <span className={fr.cx("fr-text--sm")}>{echu.username}</span>
                    </span>
                  ),
                },
                { children: dateFr.format(echu.rattachement.until) },
              ],
            }))}
          />
        </Accordion>
      ) : null}
    </section>
  );
}

"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { type EtatDUnGeste, ouvrirGeste } from "@/app/gestes/actions";
import type { ScopeCollaboration } from "@/connectors/scalingo";
import { dateFr } from "@/ui/dates";
import { useCleDOuverture } from "@/ui/modale";
import { RATTACHEMENT_IDENTITE } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";

import type { AccesAffiche, ApplicationAffichee, GroupeAffiche } from "./parc";
import { libelleDuRole, MOTS_DE_SCALINGO, ROLES_DEMANDABLES, type RoleScalingo } from "./redaction";

/**
 * Le parc porte le seul geste de l'écran, donc il porte la modale, donc il est client.
 *
 * Une modale du système de design s'enregistre au niveau du module et son identifiant
 * devient l'`id` d'un `<dialog>` : une modale par ligne produirait autant de `<dialog>`
 * de même `id`, ce qui est du HTML invalide. La table vit donc ici, avec l'unique modale
 * qu'elle ouvre, et ne reçoit que des chaînes et des dates.
 */
const modale = createModal({ id: "changer-role-scalingo", isOpenedByDefault: false });

const SYSTEME = "scalingo";

const ROLE_PLEIN = "collaborator";

type RoleDemandable = Exclude<RoleScalingo, "owner">;

const EXPLICATION: Record<RoleDemandable, string> = {
  collaborator: MOTS_DE_SCALINGO.role.plein,
  limited: MOTS_DE_SCALINGO.role.limite,
};

export interface CibleDuGeste {
  application: ApplicationAffichee;
  acces: AccesAffiche;
  username: string;
}

export function ParcScalingo({ groupes }: { groupes: readonly GroupeAffiche[] }) {
  const [cible, setCible] = useState<CibleDuGeste | null>(null);
  const ouverture = useCleDOuverture(modale);

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>{MOTS_DE_SCALINGO.parc.titre}</h2>

      <p>{MOTS_DE_SCALINGO.parc.regroupement}</p>

      {groupes.length === 0 ? (
        <Alert severity="info" small description={MOTS_DE_SCALINGO.parc.vide} />
      ) : (
        groupes.map((groupe) => (
          <Accordion
            key={groupe.cle}
            titleAs="h3"
            label={`${groupe.projet ?? MOTS_DE_SCALINGO.parc.horsProjetTitre} (${groupe.applications.length})`}
          >
            {groupe.projet === null ? (
              <p className={fr.cx("fr-text--sm")}>{MOTS_DE_SCALINGO.parc.horsProjet}</p>
            ) : null}

            {groupe.applications.map((application) => (
              <div key={application.id} className={fr.cx("fr-mb-3w")}>
                <p className={fr.cx("fr-mb-1v")}>
                  <strong>{application.libelle}</strong>
                </p>
                {application.url === null ? null : (
                  <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>
                    {/* Sans `title` : identique au texte visible, il ne fait que le
                        redire à qui l'entend déjà, ce que le RGAA compte comme un title
                        redondant. Le texte porte déjà l'annonce de la nouvelle fenêtre. */}
                    <a href={application.url} target="_blank" rel="noreferrer">
                      {MOTS_DE_SCALINGO.parc.collaborateurs}
                    </a>
                  </p>
                )}

                {application.acces.length === 0 ? (
                  <p className={fr.cx("fr-text--sm", "fr-hint-text")}>
                    {MOTS_DE_SCALINGO.parc.sansAcces}
                  </p>
                ) : (
                  <TableCustom
                    compact
                    header={[
                      { children: "Détenteur" },
                      { children: "Rôle" },
                      { children: "Dernier constat" },
                      { children: "Rattachement" },
                      { children: "" },
                    ]}
                    body={application.acces.map((acces) => ({
                      key: acces.cle,
                      row: [
                        {
                          children: (
                            <span>
                              {acces.personne ? (
                                <Link
                                  href={`/personnes/${encodeURIComponent(acces.personne.username)}`}
                                >
                                  {acces.personne.fullname}
                                </Link>
                              ) : (
                                <strong>{acces.machine?.libelle ?? acces.handle}</strong>
                              )}
                              <br />
                              <span className={fr.cx("fr-text--sm")}>{acces.handle}</span>
                            </span>
                          ),
                        },
                        {
                          children: (
                            <span>
                              {libelleDuRole(acces.role)}
                              {acces.enAttente ? (
                                <>
                                  <br />
                                  <Badge severity="warning" small noIcon>
                                    {MOTS_DE_SCALINGO.comptes.invitation}
                                  </Badge>
                                </>
                              ) : null}
                              {acces.autresDetails.map((detail) => (
                                <span
                                  key={`${detail.libelle}:${detail.valeur}`}
                                  className={fr.cx("fr-text--sm")}
                                >
                                  <br />
                                  {detail.libelle} : {detail.valeur}
                                </span>
                              ))}
                            </span>
                          ),
                        },
                        { children: dateFr.format(acces.vuLe) },
                        {
                          children: (
                            <Badge
                              severity={
                                RATTACHEMENT_IDENTITE[acces.matchMethod].sur ? "success" : "warning"
                              }
                              small
                              noIcon
                            >
                              {RATTACHEMENT_IDENTITE[acces.matchMethod].libelle}
                            </Badge>
                          ),
                        },
                        {
                          children: (
                            <Geste
                              application={application}
                              acces={acces}
                              onChoix={(choisie) => {
                                setCible(choisie);
                              }}
                            />
                          ),
                        },
                      ],
                    }))}
                  />
                )}
              </div>
            ))}
          </Accordion>
        ))
      )}

      <modale.Component titleAs="h2" title={MOTS_DE_SCALINGO.role.titreModale} size="large">
        {cible === null ? null : (
          // La clé remonte le formulaire à chaque ouverture et à chaque changement de
          // ligne : sans elle, une modale rouverte rejouerait l'issue du geste précédent,
          // qui peut porter sur une autre application que celle qu'on vient de choisir.
          <FormulaireDeRole key={`${ouverture}:${cible.acces.cle}`} cible={cible} />
        )}
      </modale.Component>
    </section>
  );
}

function FormulaireDeRole({ cible }: { cible: CibleDuGeste }) {
  const idChamp = useId();
  const [roleDemande, setRoleDemande] = useState<RoleDemandable>(
    cible.acces.role === ROLE_PLEIN ? "limited" : ROLE_PLEIN,
  );
  const [etat, action, envoiEnCours] = useActionState<EtatDUnGeste | null, FormData>(
    ouvrirGeste,
    null,
  );

  return (
    <form action={action}>
      {/* Un `div` et non un `p` : le badge du système de design rend lui-même un `p`, et
          l'imbriquer dans un autre est du HTML invalide que React refuse d'hydrater.
          Dans une phrase, il prend `as="span"` et le règle dans l'autre sens. */}
      <div className={fr.cx("fr-mb-1w")}>
        <strong>{cible.application.libelle}</strong>{" "}
        <Badge as="span" severity="info" small noIcon>
          {libelleDuRole(cible.acces.role)}
        </Badge>
      </div>
      <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>{cible.acces.handle}</p>

      <input type="hidden" name="systeme" value={SYSTEME} />
      <input type="hidden" name="username" value={cible.username} />
      <input type="hidden" name="scope" value={perimetre(cible, roleDemande)} />

      <fieldset className={fr.cx("fr-fieldset")}>
        <legend className={fr.cx("fr-fieldset__legend")}>{MOTS_DE_SCALINGO.role.choix}</legend>
        {ROLES_DEMANDABLES.map((role) => (
          <div key={role} className={fr.cx("fr-fieldset__element")}>
            <div className={fr.cx("fr-radio-group")}>
              <input
                type="radio"
                id={`${idChamp}-${role}`}
                name="role-demande"
                value={role}
                checked={roleDemande === role}
                onChange={() => {
                  setRoleDemande(role);
                }}
              />
              <label className={fr.cx("fr-label")} htmlFor={`${idChamp}-${role}`}>
                {libelleDuRole(role)}
                <span className={fr.cx("fr-hint-text")}>{EXPLICATION[role]}</span>
              </label>
            </div>
          </div>
        ))}
      </fieldset>

      {/* Exigée pour le seul rôle qui l'exige, et son aide avec : le refus de l'octroi
          ne porte que sur le rôle plein, et le rendre sur le rôle limité annoncerait une
          contrainte que rien n'oppose. */}
      <div className={fr.cx("fr-input-group")}>
        <label className={fr.cx("fr-label")} htmlFor={`${idChamp}-terme`}>
          {MOTS_DE_SCALINGO.role.terme}
          {roleDemande === ROLE_PLEIN ? (
            <span className={fr.cx("fr-hint-text")}>{MOTS_DE_SCALINGO.role.termeAide}</span>
          ) : null}
        </label>
        <input
          className={fr.cx("fr-input")}
          id={`${idChamp}-terme`}
          name="expiresInDays"
          type="number"
          min={1}
          required={roleDemande === ROLE_PLEIN}
        />
      </div>

      <div className={fr.cx("fr-input-group")}>
        <label className={fr.cx("fr-label")} htmlFor={`${idChamp}-justification`}>
          {MOTS_DE_SCALINGO.role.justification}
          <span className={fr.cx("fr-hint-text")}>{MOTS_DE_SCALINGO.role.justificationAide}</span>
        </label>
        <input
          className={fr.cx("fr-input")}
          id={`${idChamp}-justification`}
          name="justification"
          type="text"
          required
        />
      </div>

      {etat?.erreur === undefined ? null : (
        <p className={fr.cx("fr-error-text")} role="alert">
          {etat.erreur}
        </p>
      )}
      {etat?.planId === undefined ? null : (
        <p className={fr.cx("fr-valid-text")} role="status">
          {MOTS_DE_SCALINGO.role.brouillon}
        </p>
      )}

      <Button priority="primary" type="submit" disabled={envoiEnCours}>
        {envoiEnCours ? MOTS_DE_SCALINGO.role.attente : MOTS_DE_SCALINGO.role.envoi}
      </Button>
    </form>
  );
}

/**
 * Le périmètre part typé du connecteur : un champ renommé là-bas casse le typecheck ici,
 * plutôt que de partir en JSON que le schéma refusera après le clic.
 */
function perimetre(cible: CibleDuGeste, role: RoleDemandable): string {
  const scope: ScopeCollaboration = {
    nature: "collaboration",
    region: cible.application.region,
    application: cible.application.nom,
    role,
  };
  return JSON.stringify(scope);
}

/**
 * Le bouton, ou la raison de son absence. Un bouton absent sans explication est une
 * énigme, sur un écran d'où l'on décide de couper un accès.
 */
function Geste({
  application,
  acces,
  onChoix,
}: {
  application: ApplicationAffichee;
  acces: AccesAffiche;
  onChoix: (cible: CibleDuGeste) => void;
}) {
  if (acces.refus === "proprietaire") {
    return (
      <span className={fr.cx("fr-text--sm", "fr-hint-text")}>
        {MOTS_DE_SCALINGO.role.proprietaire}
      </span>
    );
  }

  if (acces.refus === "machine") {
    return (
      <span className={fr.cx("fr-text--sm", "fr-hint-text")}>
        {MOTS_DE_SCALINGO.comptes.machine}{" "}
        <Link className={fr.cx("fr-link", "fr-text--sm")} href="/comptes-de-service">
          Voir les comptes de service
        </Link>
      </span>
    );
  }

  if (acces.refus === "isole" || acces.refus === "ressemblance") {
    return (
      <span className={fr.cx("fr-text--sm", "fr-hint-text")}>
        {acces.refus === "isole"
          ? MOTS_DE_SCALINGO.comptes.isole
          : MOTS_DE_SCALINGO.role.ressemblance}{" "}
        <Link className={fr.cx("fr-link", "fr-text--sm")} href="/comptes-isoles">
          Voir la file des comptes isolés
        </Link>
      </span>
    );
  }

  // Le refus est nul, donc une personne est rattachée de façon sûre : c'est la seule
  // branche qui offre un geste, et la seule où un nom d'utilisateur existe.
  const username = acces.personne?.username;
  if (username === undefined) {
    return null;
  }

  return (
    <Button
      priority="tertiary"
      size="small"
      nativeButtonProps={{
        ...modale.buttonProps,
        onClick: () => {
          onChoix({ application, acces, username });
        },
      }}
    >
      {MOTS_DE_SCALINGO.role.bouton}
    </Button>
  );
}

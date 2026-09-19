"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { type CandidatDeLot, LIBELLE_ECARTE, type ResumeDeLot } from "@/core/startups";
import { LIBELLE_STATUT } from "@/core/statut";
import { Absent } from "@/ui/Absent";
import { SEVERITE_STATUT } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";

import {
  cloreConstatsEnLot,
  declarerHorsIncubateurEnLot,
  type EtatLot,
  ouvrirDepartsEnLot,
} from "./actions";
import { LOT } from "./redaction-lot";

type Geste = "sortie" | "depart" | "cloture";

function Recapitulatif({ titre, resume }: { titre: string; resume: ResumeDeLot }) {
  // Trois blocs et jamais une alerte unique : « une personne en échec » rendu comme une
  // erreur laisserait croire que les quatorze autres ont échoué aussi.
  const nommer = (liste: ResumeDeLot["traitees"]) =>
    liste.map((resultat) => resultat.fullname).join(", ");

  return (
    <Alert
      as="h3"
      className={fr.cx("fr-mt-2w")}
      severity={resume.echecs.length > 0 ? "warning" : "success"}
      title={`${titre} : ${resume.total} personne${resume.total > 1 ? "s" : ""} soumise${resume.total > 1 ? "s" : ""}`}
      description={
        <>
          <p className={fr.cx("fr-mb-1w")}>
            {resume.traitees.length} traitée{resume.traitees.length > 1 ? "s" : ""}
            {resume.traitees.length > 0 ? ` : ${nommer(resume.traitees)}` : ""}.
          </p>
          {resume.deja.length > 0 ? (
            <p className={fr.cx("fr-mb-1w")}>
              {resume.deja.length} sans changement, un geste équivalent était déjà en place :{" "}
              {nommer(resume.deja)}.
            </p>
          ) : null}
          {resume.echecs.length > 0 ? (
            <ul className={fr.cx("fr-mb-1w")}>
              {resume.echecs.map((echec) => (
                <li key={echec.username}>
                  {echec.fullname} : {echec.detail ?? "échec inattendu"}
                </li>
              ))}
            </ul>
          ) : null}
          <p className={fr.cx("fr-mb-0")}>
            {LOT.traces}{" "}
            <Link className={fr.cx("fr-link")} href="/journal">
              Voir le journal
            </Link>
          </p>
        </>
      }
    />
  );
}

/**
 * Le traitement groupé des membres d'une startup qui s'arrête.
 *
 * Trois gestes, trois boutons, un seul formulaire : la sélection et la raison se
 * saisissent une fois, mais rien ne les enchaîne. Déclarer quelqu'un hors incubateur
 * n'ouvre pas son départ, et surtout ne ferme aucun constat : ce dernier geste existe
 * parce que le moteur ne lit pas la surcharge d'appartenance, mais il reste un acte
 * distinct, faute de quoi la sortie forcée deviendrait le moyen le plus rapide de faire
 * disparaître un écart gênant.
 */
export function TraitementDuLot({
  ghid,
  nomStartup,
  candidats,
}: {
  ghid: string;
  nomStartup: string;
  candidats: readonly CandidatDeLot[];
}) {
  const idRaison = useId();
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(candidats.filter((c) => c.proposeParDefaut).map((c) => c.username)),
  );

  const [etatSortie, actionSortie, sortieEnCours] = useActionState<EtatLot, FormData>(
    declarerHorsIncubateurEnLot,
    null,
  );
  const [etatDepart, actionDepart, departEnCours] = useActionState<EtatLot, FormData>(
    ouvrirDepartsEnLot,
    null,
  );
  const [etatCloture, actionCloture, clotureEnCours] = useActionState<EtatLot, FormData>(
    cloreConstatsEnLot,
    null,
  );

  const pending = sortieEnCours || departEnCours || clotureEnCours;

  // Les trois états vivent séparément et aucun ne s'efface quand un autre répond : sans
  // savoir quel bouton a été pressé en dernier, l'échec d'un geste resterait affiché
  // sous le suivant, qui a pourtant réussi.
  const [dernierGeste, setDernierGeste] = useState<Geste | null>(null);
  const etatDuDernier =
    dernierGeste === "sortie"
      ? etatSortie
      : dernierGeste === "depart"
        ? etatDepart
        : dernierGeste === "cloture"
          ? etatCloture
          : null;
  const erreur = etatDuDernier !== null && "erreur" in etatDuDernier ? etatDuDernier.erreur : null;

  const basculer = (username: string) => {
    setSelection((avant) => {
      const apres = new Set(avant);
      if (apres.has(username)) {
        apres.delete(username);
      } else {
        apres.add(username);
      }
      return apres;
    });
  };

  const avecConstat = candidats.filter(
    (candidat) => selection.has(candidat.username) && candidat.constatOuvert !== null,
  ).length;

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>{LOT.titre}</h2>

      <p>{LOT.intro(nomStartup)}</p>

      <form>
        <input type="hidden" name="startup" value={ghid} />

        <TableCustom
          className={fr.cx("fr-mt-2w")}
          header={[
            { children: "" },
            { children: "Personne" },
            { children: "Statut" },
            { children: LOT.colonneRetient },
            { children: "Constat ouvert" },
          ]}
          body={candidats.map((candidat) => ({
            key: candidat.username,
            row: [
              {
                children: (
                  <div className={fr.cx("fr-checkbox-group", "fr-checkbox-group--sm")}>
                    <input
                      type="checkbox"
                      id={`${idRaison}-${candidat.username}`}
                      name="username"
                      value={candidat.username}
                      checked={selection.has(candidat.username)}
                      onChange={() => {
                        basculer(candidat.username);
                      }}
                    />
                    <label
                      className={fr.cx("fr-label")}
                      htmlFor={`${idRaison}-${candidat.username}`}
                    >
                      <span className={fr.cx("fr-sr-only")}>Traiter {candidat.fullname}</span>
                    </label>
                  </div>
                ),
              },
              {
                children: (
                  <span>
                    <Link href={`/personnes/${encodeURIComponent(candidat.username)}`}>
                      {candidat.fullname}
                    </Link>
                    <br />
                    <span className={fr.cx("fr-text--sm")}>{candidat.username}</span>
                  </span>
                ),
              },
              {
                children: (
                  <Badge severity={SEVERITE_STATUT[candidat.statut]} noIcon>
                    {LIBELLE_STATUT[candidat.statut]}
                  </Badge>
                ),
              },
              {
                children:
                  candidat.ecarte === null ? (
                    <Absent mention="rien" />
                  ) : (
                    <span className={fr.cx("fr-text--sm")}>
                      {LIBELLE_ECARTE[candidat.ecarte]}
                      {candidat.autresStartupsVivantes.length > 0
                        ? ` : ${candidat.autresStartupsVivantes.join(", ")}`
                        : ""}
                    </span>
                  ),
              },
              {
                children:
                  candidat.constatOuvert === null ? (
                    <Absent mention="aucun" />
                  ) : (
                    LIBELLE_CONSTAT.INACTIVE_STARTUP.titre
                  ),
              },
            ],
          }))}
        />

        <div className={fr.cx("fr-input-group", "fr-mt-2w")}>
          <label className={fr.cx("fr-label")} htmlFor={idRaison}>
            {LOT.raison.label}
            <span className={fr.cx("fr-hint-text")}>{LOT.raison.aide}</span>
          </label>
          <input className={fr.cx("fr-input")} id={idRaison} name="raison" type="text" required />
        </div>

        {erreur === null ? null : (
          <p className={fr.cx("fr-error-text")} role="alert">
            {erreur}
          </p>
        )}

        <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
          {selection.size} personne{selection.size > 1 ? "s" : ""} sélectionnée
          {selection.size > 1 ? "s" : ""}.
        </p>

        {/* Trois boutons dans un seul formulaire : la sélection et la raison ne se
            resaisissent pas, mais aucun geste n'en déclenche un autre. */}
        <ul className={fr.cx("fr-btns-group", "fr-btns-group--inline", "fr-btns-group--sm")}>
          <li>
            <Button
              type="submit"
              priority="secondary"
              disabled={pending || selection.size === 0}
              nativeButtonProps={{
                formAction: actionSortie,
                onClick: () => {
                  setDernierGeste("sortie");
                },
              }}
            >
              {LOT.sortie.bouton}
            </Button>
          </li>
          <li>
            <Button
              type="submit"
              priority="secondary"
              disabled={pending || selection.size === 0}
              nativeButtonProps={{
                formAction: actionDepart,
                onClick: () => {
                  setDernierGeste("depart");
                },
              }}
            >
              {LOT.depart.bouton}
            </Button>
          </li>
          <li>
            <Button
              type="submit"
              priority="tertiary"
              disabled={pending || avecConstat === 0}
              nativeButtonProps={{
                formAction: actionCloture,
                onClick: () => {
                  setDernierGeste("cloture");
                },
              }}
            >
              {LOT.cloture.bouton(avecConstat)}
            </Button>
          </li>
        </ul>
      </form>

      <p className={fr.cx("fr-text--sm")}>{LOT.ceQueLaSortieNeFaitPas}</p>

      {etatSortie !== null && "resume" in etatSortie ? (
        <Recapitulatif titre={LOT.sortie.recapitulatif} resume={etatSortie.resume} />
      ) : null}
      {etatDepart !== null && "resume" in etatDepart ? (
        <Recapitulatif titre={LOT.depart.recapitulatif} resume={etatDepart.resume} />
      ) : null}
      {etatCloture !== null && "resume" in etatCloture ? (
        <Recapitulatif titre={LOT.cloture.recapitulatif} resume={etatCloture.resume} />
      ) : null}
    </section>
  );
}

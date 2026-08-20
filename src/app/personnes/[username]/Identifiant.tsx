"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState, useState } from "react";

import { messageObligatoire } from "@/ui/validation";

import type { ApercuFusion, EtatIdentifiant } from "./edition";
import { renommerFiche } from "./edition";

function Inventaire({ fusion }: { fusion: ApercuFusion }) {
  const lignes = [
    `${fusion.comptes.length} compte${fusion.comptes.length > 1 ? "s" : ""} externe${fusion.comptes.length > 1 ? "s" : ""} : ${
      fusion.comptes.length === 0
        ? "aucun"
        : fusion.comptes
            .map((compte) => `${compte.provider} ${compte.handle} (${compte.methode})`)
            .join(", ")
    }`,
    `${fusion.constatsMigres} constat${fusion.constatsMigres > 1 ? "s" : ""} déplacé${fusion.constatsMigres > 1 ? "s" : ""}, dont ${fusion.clesReecrites} réattribué${fusion.clesReecrites > 1 ? "s" : ""} au nouvel identifiant et ${fusion.constatsFermes} fermé${fusion.constatsFermes > 1 ? "s" : ""} faute de place, leur clé étant déjà prise`,
    `${fusion.dossiers} dossier${fusion.dossiers > 1 ? "s" : ""} de départ`,
    `${fusion.rattachements} rattachement${fusion.rattachements > 1 ? "s" : ""} manuel${fusion.rattachements > 1 ? "s" : ""} à une startup, dont ${fusion.rattachementsEnCours} en cours`,
    `${fusion.references} référence${fusion.references > 1 ? "s" : ""} déplacée${fusion.references > 1 ? "s" : ""}, ${fusion.referencesSupprimees} déjà portée${fusion.referencesSupprimees > 1 ? "s" : ""} par la fiche cible`,
  ];

  return (
    <>
      <ul className={fr.cx("fr-mb-1w")}>
        {lignes.map((ligne) => (
          <li key={ligne}>{ligne}</li>
        ))}
      </ul>
      {fusion.doublons.length > 0 ? (
        <p className={fr.cx("fr-mb-1w")}>
          Les deux fiches ont un compte sur{" "}
          {fusion.doublons.map((doublon) => doublon.provider).join(", ")} : la fiche cible en
          portera plusieurs sur le même système, ce qui est permis mais assez rare pour être dit.
        </p>
      ) : null}
      {fusion.prolongation ? (
        <p className={fr.cx("fr-mb-1w")}>
          <strong>
            Ses accès courront jusqu'au {fusion.prolongation.apres}
            {fusion.prolongation.avant === null
              ? ", alors que rien ne leur donnait de terme aujourd'hui"
              : `, au lieu du ${fusion.prolongation.avant}`}
            .
          </strong>{" "}
          Le rattachement déplacé repousse l'échéance de la fiche cible.
        </p>
      ) : null}
      {fusion.surchargeAbandonnee ? (
        <p className={fr.cx("fr-mb-1w")}>
          La fiche cible porte déjà une surcharge d'appartenance et n'en garde qu'une : celle-ci
          sera perdue, et le journal en gardera seul la trace. {fusion.surchargeAbandonnee}.
        </p>
      ) : null}
      {fusion.surchargeSuit ? (
        <p className={fr.cx("fr-mb-1w")}>Sa surcharge d'appartenance suit sur la fiche cible.</p>
      ) : null}
      <p className={fr.cx("fr-mb-0")}>
        Les méthodes de rapprochement sont conservées : un compte rattaché par ressemblance le
        reste, et ne pourra toujours pas justifier une coupure.
      </p>
    </>
  );
}

export function Identifiant({ username }: { username: string }) {
  const [etat, formAction, pending] = useActionState<EtatIdentifiant, FormData>(
    renommerFiche,
    null,
  );

  // Contrôlé, contrairement au motif copié depuis le rattachement d'un compte : le
  // flux se joue en deux soumissions, et un champ que React réinitialiserait entre
  // les deux renverrait un identifiant vide à la confirmation de fusion.
  const [nouveau, setNouveau] = useState("");

  const erreur = etat !== null && "erreur" in etat ? etat.erreur : undefined;
  const fusion = etat !== null && "fusion" in etat ? etat.fusion : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="username" value={username} />

      <Input
        label="Corriger l'identifiant"
        hintText="Cet identifiant a été fabriqué ici, faute de fiche beta.gouv. Le corriger vers un vrai username beta.gouv fera adopter la fiche par la collecte, qui réécrira alors nom, login et adresses avec la version de l'espace-membre."
        nativeInputProps={{
          name: "nouveau",
          required: true,
          ...messageObligatoire("Indiquez le nouvel identifiant."),
          autoComplete: "off",
          value: nouveau,
          onChange: (event) => setNouveau(event.target.value),
        }}
        state={erreur ? "error" : "default"}
        stateRelatedMessage={erreur}
      />

      {fusion === null ? null : fusion.blocage !== null ? (
        <Alert
          className={fr.cx("fr-mb-2w")}
          severity="error"
          small
          title="Cette fusion perdrait quelque chose"
          description={fusion.blocage}
        />
      ) : (
        <>
          <Alert
            className={fr.cx("fr-mb-2w")}
            severity="warning"
            title={`« ${fusion.cible} » existe déjà`}
            description={
              <>
                <p className={fr.cx("fr-mb-1w")}>
                  Confirmer fusionne les deux fiches : tout ce qui suit passe sur « {fusion.cible} »
                  et « {fusion.source} » disparaît. Le geste est tracé et ne se défait pas.
                </p>
                <Inventaire fusion={fusion} />
              </>
            }
          />
          <Checkbox
            small
            options={[
              {
                label: "Oui, c'est la même personne : fusionner",
                nativeInputProps: { name: "confirme", value: "oui" },
              },
            ]}
          />
        </>
      )}

      <Button type="submit" priority="secondary" disabled={pending}>
        {pending
          ? "En cours…"
          : fusion !== null && fusion.blocage === null
            ? "Fusionner"
            : "Corriger l'identifiant"}
      </Button>
    </form>
  );
}

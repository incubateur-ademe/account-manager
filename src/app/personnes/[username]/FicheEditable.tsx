"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { useActionState } from "react";

import { messageObligatoire } from "@/ui/validation";

import { type EtatEdition, modifierFiche } from "./edition";

export interface ChampsSaisis {
  username: string;
  fullname: string;
  githubLogin: string | null;
  primaryEmail: string | null;
  communicationEmail: string | null;
}

export function FicheEditable({ fiche }: { fiche: ChampsSaisis }) {
  const [etat, formAction, pending] = useActionState<EtatEdition, FormData>(modifierFiche, null);
  const erreur = etat !== null && "erreur" in etat ? etat.erreur : undefined;

  return (
    <form action={formAction}>
      <input type="hidden" name="username" value={fiche.username} />

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Nom complet"
            nativeInputProps={{
              name: "fullname",
              defaultValue: fiche.fullname,
              required: true,
              ...messageObligatoire("Le nom complet ne peut pas être vide."),
              autoComplete: "off",
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Compte GitHub"
            hintText="Login, arobase et adresse complète du profil acceptées : la saisie est réduite avant comparaison."
            nativeInputProps={{
              name: "githubLogin",
              defaultValue: fiche.githubLogin ?? "",
              autoComplete: "off",
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Adresse principale"
            nativeInputProps={{
              name: "primaryEmail",
              defaultValue: fiche.primaryEmail ?? "",
              autoComplete: "off",
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Adresse de communication"
            nativeInputProps={{
              name: "communicationEmail",
              defaultValue: fiche.communicationEmail ?? "",
              autoComplete: "off",
            }}
          />
        </div>
      </div>

      <p className={fr.cx("fr-text--sm")}>
        Le login et les adresses alimentent le rapprochement automatique : tant que sa fiche est
        suivie, les corriger rebranche les comptes encore isolés et ceux à venir, jamais ceux déjà
        rattachés à quelqu'un d'autre, qui se détachent à la main.
      </p>

      <Button type="submit" priority="secondary" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>

      {erreur ? (
        <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
          {erreur}
        </p>
      ) : null}
      {etat !== null && "modifie" in etat ? (
        <p className={fr.cx("fr-valid-text", "fr-mt-1v")} role="status">
          Fiche enregistrée.
        </p>
      ) : null}
    </form>
  );
}

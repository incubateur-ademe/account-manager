"use client";

import { fr } from "@codegouvfr/react-dsfr";
import Autocomplete from "@mui/material/Autocomplete";
import { useId, useState } from "react";

export interface Suggestion {
  /** Ce qui part au serveur. */
  valeur: string;
  /** Ce qui se lit à l'écran, sous la valeur. */
  libelle: string;
  /** Nuance affichée à droite, pour départager deux entrées qui se ressemblent. */
  mention?: string;
}

/**
 * Un champ de saisie adossé à une liste connue.
 *
 * Le `datalist` natif rendait la main sur une liste de deux cent quarante entrées :
 * il n'affiche qu'un préfixe, ne cherche pas dans le libellé, et déroule un menu que
 * rien ne borne. `Autocomplete` filtre sur les deux champs et coupe la liste à ce qui
 * tient à l'écran.
 *
 * La saisie libre reste permise : le serveur refuse une cible inconnue avec un
 * message qui dit laquelle, et c'est lui qui fait foi. L'empêcher ici transformerait
 * une aide à la frappe en verrou.
 */
export function ChampAvecListe({
  nom,
  label,
  hintText,
  suggestions,
  requis = false,
  erreur,
  placeholder,
  onValeur,
}: {
  nom: string;
  label: string;
  hintText?: string;
  suggestions: readonly Suggestion[];
  requis?: boolean;
  erreur?: string;
  placeholder?: string;
  /** Pour les formulaires qui réagissent à la saisie avant même l'envoi. */
  onValeur?: (valeur: string) => void;
}) {
  const [valeur, setValeur] = useState("");
  const id = useId();

  return (
    <div className={fr.cx("fr-input-group", erreur ? "fr-input-group--error" : undefined)}>
      <label className={fr.cx("fr-label")} htmlFor={id}>
        {label}
        {hintText ? <span className={fr.cx("fr-hint-text")}>{hintText}</span> : null}
      </label>

      <Autocomplete
        freeSolo
        autoHighlight
        // Sans portail, le menu reste dans la modale, donc dans son piège à focus :
        // ailleurs, il serait hors d'atteinte au clavier.
        disablePortal
        options={[...suggestions]}
        inputValue={valeur}
        onInputChange={(_evenement, saisie) => {
          setValeur(saisie);
          onValeur?.(saisie);
        }}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.valeur)}
        filterOptions={(options, { inputValue }) => {
          const recherche = inputValue.trim().toLowerCase();
          if (recherche === "") {
            return options.slice(0, 8);
          }
          return options
            .filter(
              (option) =>
                option.valeur.toLowerCase().includes(recherche) ||
                option.libelle.toLowerCase().includes(recherche),
            )
            .slice(0, 8);
        }}
        renderOption={({ key, ...props }, option) => (
          <li key={key} {...props}>
            <span>
              <strong>{option.valeur}</strong>
              <br />
              <span className={fr.cx("fr-text--sm")}>
                {option.libelle}
                {option.mention ? ` · ${option.mention}` : null}
              </span>
            </span>
          </li>
        )}
        renderInput={({ slotProps }) => (
          <div ref={slotProps.input.ref}>
            <input
              {...slotProps.htmlInput}
              id={id}
              name={nom}
              // Obligatoire, et pas seulement par correction : le piège à focus du
              // DSFR ne laisse passer un `input` que si son `type` est présent et
              // vaut autre chose que `radio`. Sans attribut, il le cherche parmi les
              // groupes de boutons radio, n'y trouve rien et lève, ce qui interrompt
              // le JS du système de design et laisse la page entière sans style.
              type="text"
              required={requis}
              placeholder={placeholder}
              autoComplete="off"
              className={fr.cx("fr-input")}
            />
          </div>
        )}
      />

      {erreur ? (
        <p className={fr.cx("fr-error-text")} role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

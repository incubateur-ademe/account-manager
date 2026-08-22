"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { Tag } from "@codegouvfr/react-dsfr/Tag";
import { useActionState, useState } from "react";

import type { SuggestionRattachement } from "@/core/suggestion-rattachement";
import { ChampAvecListe, type Suggestion } from "@/ui/ChampAvecListe";
import { useFermetureApresSucces } from "@/ui/modale";

import { type EtatRattachement, rattacherIdentite } from "./actions";
import { creerFichePourCompte, type EtatCreation } from "./creer";

export function Rattacher({
  id,
  cibles,
  propositions,
  onSucces,
}: {
  id: string;
  cibles: readonly Suggestion[];
  propositions: readonly SuggestionRattachement[];
  onSucces?: () => void;
}) {
  const [etat, formAction, pending] = useActionState<EtatRattachement, FormData>(
    rattacherIdentite,
    null,
  );
  const [creation, creerAction, enCreation] = useActionState<EtatCreation, FormData>(
    creerFichePourCompte,
    null,
  );
  const [cible, setCible] = useState("");

  // Le refus n'est pas une erreur de saisie mais une question posée : la case ne
  // s'affiche qu'une fois qu'elle a un sens, pour ne pas proposer d'emblée de passer
  // outre un garde-fou qu'on n'a pas encore rencontré.
  const demandeConfirmation = etat?.confirmationRequise === true;

  useFermetureApresSucces(pending, etat?.erreur, onSucces);
  useFermetureApresSucces(enCreation, creation?.erreur, onSucces);

  // Les propositions arrivent déjà rangées par motif : le regroupement se fait donc
  // sur des voisines, sans index intermédiaire ni second tri.
  const groupes: { motif: string; membres: SuggestionRattachement[] }[] = [];
  for (const proposition of propositions) {
    const courant = groupes.at(-1);
    if (courant?.motif === proposition.motif) {
      courant.membres.push(proposition);
    } else {
      groupes.push({ motif: proposition.motif, membres: [proposition] });
    }
  }

  return (
    <>
      {groupes.length > 0 ? (
        // Formulaire distinct, et non des vignettes de plus dans le suivant : la touche
        // Entrée soumet le premier bouton de son propre formulaire, si bien qu'une
        // proposition posée à côté du champ serait rattachée à chaque validation au
        // clavier, sans que personne ne l'ait choisie.
        <form action={formAction} className={fr.cx("fr-mb-2w")}>
          <input type="hidden" name="id" value={id} />
          <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
            <strong>Rattacher directement à</strong>
          </p>
          {/* La mise en garde vit ici plutôt que sur chaque vignette : une vignette se
              lit comme une étiquette ou un filtre, pas comme une action, et rien dans
              sa forme ne dit qu'un clic tranche pour de bon. */}
          <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>
            Un clic vaut décision : elle est journalisée à votre nom, et le compte pourra dès lors
            justifier une révocation.
          </p>
          {groupes.map((groupe) => (
            <div className={fr.cx("fr-mb-1w")} key={groupe.motif}>
              <p className={fr.cx("fr-text--xs", "fr-mb-1v")}>{groupe.motif}</p>
              <ul className={fr.cx("fr-tags-group")}>
                {groupe.membres.map((proposition) => (
                  <li key={proposition.username}>
                    <Tag
                      as="button"
                      small
                      // La cible part avec le bouton, et l'état suit pour l'affichage :
                      // un refus qui demande confirmation renvoie vers le champ, qui
                      // doit alors porter la personne choisie plutôt que le vide.
                      onClick={() => {
                        setCible(proposition.username);
                      }}
                      nativeButtonProps={{
                        type: "submit",
                        name: "cible",
                        value: proposition.username,
                        disabled: pending,
                      }}
                    >
                      {proposition.fullname} ({proposition.username})
                    </Tag>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </form>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <ChampAvecListe
          nom="cible"
          label="Rattacher à"
          hintText="Username beta.gouv, même hors incubateur, ou clé d'un compte de service."
          suggestions={cibles}
          requis
          erreur={etat?.erreur}
          valeur={cible}
          onValeur={setCible}
        />
        {demandeConfirmation ? (
          <Checkbox
            small
            options={[
              {
                label: "Oui, c'est la même personne",
                nativeInputProps: { name: "confirme", value: "oui" },
              },
            ]}
          />
        ) : null}
        <Button type="submit" priority="secondary" size="small" disabled={pending}>
          {pending ? "Rattachement…" : "Rattacher"}
        </Button>
      </form>

      <form action={creerAction} className={fr.cx("fr-mt-2w")}>
        <input type="hidden" name="id" value={id} />
        <Input
          label="Ou créer une fiche"
          hintText="Nom, en dernier recours : pour qui n'a aucune fiche beta.gouv."
          nativeInputProps={{ name: "nom", autoComplete: "off" }}
          state={creation ? "error" : "default"}
          stateRelatedMessage={creation?.erreur}
        />
        <Button type="submit" priority="tertiary" size="small" disabled={enCreation}>
          {enCreation ? "Création…" : "Créer la fiche"}
        </Button>
      </form>
    </>
  );
}

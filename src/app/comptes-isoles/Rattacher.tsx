"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { RadioButtons } from "@codegouvfr/react-dsfr/RadioButtons";
import { Tag } from "@codegouvfr/react-dsfr/Tag";
import { useActionState, useState } from "react";

import type { PropositionDeMachine } from "@/core/compte-de-service";
import type { SuggestionRattachement } from "@/core/suggestion-rattachement";
import { ChampAvecListe, type Suggestion } from "@/ui/ChampAvecListe";
import { useFermetureApresSucces } from "@/ui/modale";

import { type EtatRattachement, rattacherIdentite } from "./actions";
import {
  creerFichePourCompte,
  declarerCompteDeServicePourCompte,
  type EtatCreation,
} from "./creer";

type Nature = "personne" | "machine";

export function Rattacher({
  id,
  cibles,
  propositions,
  machine,
  onSucces,
}: {
  id: string;
  cibles: readonly Suggestion[];
  propositions: readonly SuggestionRattachement[];
  machine: PropositionDeMachine | null;
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
  const [declaration, declarerAction, enDeclaration] = useActionState<EtatCreation, FormData>(
    declarerCompteDeServicePourCompte,
    null,
  );
  const [cible, setCible] = useState("");

  // Sans défaut, et c'est tout l'objet de ce choix. Un formulaire de création déjà ouvert
  // est la réponse « une personne » donnée d'avance, et c'est ainsi qu'un bot finit avec
  // une fiche fabriquée qu'aucun écran ne sait supprimer.
  const [nature, setNature] = useState<Nature | null>(null);

  // Le refus n'est pas une erreur de saisie mais une question posée : la case ne
  // s'affiche qu'une fois qu'elle a un sens, pour ne pas proposer d'emblée de passer
  // outre un garde-fou qu'on n'a pas encore rencontré.
  const demandeConfirmation = etat?.confirmationRequise === true;

  useFermetureApresSucces(pending, etat?.erreur, onSucces);
  useFermetureApresSucces(enCreation, creation?.erreur, onSucces);
  useFermetureApresSucces(enDeclaration, declaration?.erreur, onSucces);

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
          hintText="Identifiant beta.gouv, même hors incubateur, ou clé d'un compte de service."
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

      <div className={fr.cx("fr-mt-2w")}>
        <RadioButtons
          small
          orientation="horizontal"
          legend="Ou déclarer ce compte, si rien ne le porte encore"
          hintText="Un bot et une personne ne se déclarent pas au même endroit, et se confondent facilement."
          options={[
            {
              label: "C'est une personne",
              nativeInputProps: {
                checked: nature === "personne",
                onChange: () => {
                  setNature("personne");
                },
              },
            },
            {
              label: "C'est une machine",
              // Offert seulement quand un connecteur sert ce système : sans lui, ni clé à
              // proposer ni système où ranger la machine, et le formulaire se refuserait
              // après coup plutôt que de ne pas s'ouvrir.
              nativeInputProps: {
                checked: nature === "machine",
                disabled: machine === null,
                onChange: () => {
                  setNature("machine");
                },
              },
            },
          ]}
        />

        {nature === "personne" ? (
          <form action={creerAction}>
            <input type="hidden" name="id" value={id} />
            <Input
              label="Nom de la personne"
              hintText="En dernier recours : pour qui n'a aucune fiche beta.gouv."
              nativeInputProps={{ name: "nom", autoComplete: "off", required: true }}
              state={creation ? "error" : "default"}
              stateRelatedMessage={creation?.erreur}
            />
            <Button type="submit" priority="tertiary" size="small" disabled={enCreation}>
              {enCreation ? "Création…" : "Créer la fiche"}
            </Button>
          </form>
        ) : null}

        {nature === "machine" && machine !== null ? (
          <form action={declarerAction}>
            <input type="hidden" name="id" value={id} />
            {/* Le système ne se saisit pas : ce compte y a été relevé. Affiché quand même,
                parce qu'il décide de la clé proposée et du système sous lequel la machine
                se rangera, et qu'un champ absent se découvre après coup. L'action le relit
                du compte et jamais du formulaire. */}
            <Input
              label="Système"
              hintText="Celui sur lequel ce compte a été relevé."
              disabled
              nativeInputProps={{ value: machine.systemeLibelle, readOnly: true }}
            />
            <Input
              label="Clé"
              hintText="Identifiant court et stable, en minuscules"
              nativeInputProps={{
                name: "key",
                autoComplete: "off",
                required: true,
                defaultValue: machine.key,
              }}
            />
            <Input
              label="Libellé"
              nativeInputProps={{ name: "label", required: true, defaultValue: machine.label }}
            />
            <Input
              label="Usage"
              hintText="Ce que ce compte fait, en une phrase lisible dans deux ans"
              nativeInputProps={{ name: "purpose", required: true }}
            />
            <Input
              label="Propriétaire"
              hintText="Username beta.gouv de qui en répond"
              nativeInputProps={{
                name: "ownerUsername",
                required: true,
                defaultValue: machine.ownerUsername,
              }}
            />
            <Input
              label="Revue tous les"
              hintText="En jours. Un compte machine n'a pas de fin de mission, c'est la revue qui le remet en question."
              nativeInputProps={{
                name: "reviewEveryDays",
                type: "number",
                defaultValue: machine.reviewEveryDays,
                min: 1,
              }}
            />
            {/* Au formulaire et non à un champ : une clé déjà prise ne concerne ni la
                revue ni le propriétaire, et l'y accrocher désignerait le mauvais endroit,
                aux lecteurs d'écran comme aux autres. */}
            {declaration?.erreur ? (
              <p className={fr.cx("fr-error-text", "fr-mb-1w")}>{declaration.erreur}</p>
            ) : null}
            <Button type="submit" priority="tertiary" size="small" disabled={enDeclaration}>
              {enDeclaration ? "Déclaration…" : "Déclarer le compte de service"}
            </Button>
          </form>
        ) : null}
      </div>
    </>
  );
}

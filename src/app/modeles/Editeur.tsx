"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Accordion } from "@codegouvfr/react-dsfr/Accordion";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { Select } from "@codegouvfr/react-dsfr/Select";
import { useActionState, useCallback, useState } from "react";

import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";
import { useFermetureApresSucces } from "@/ui/modale";
import { messageObligatoire } from "@/ui/validation";

import {
  ajouterEtapeAuModele,
  basculerAutorisationDesStartups,
  type EtatModele,
  modifierEtapeDuModele,
  retirerEtapeDuModele,
} from "./actions";
import type { EtapeAffichee } from "./lecture";

const RISQUE: Record<RiskLevel, string> = {
  LOW: "Ordinaire",
  MEDIUM: "Sensible",
  HIGH: "Élevé",
};

function Erreur({ etat }: { etat: EtatModele | null }) {
  return etat?.erreur ? (
    <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
      {etat.erreur}
    </p>
  ) : null;
}

/** Ce qu'un formulaire d'étape tient pendant qu'on le remplit. */
interface Valeurs {
  titre: string;
  critere: string;
  marcheASuivre: string;
  lien: string;
  risque: RiskLevel;
  saisieLibelle: string;
  saisieObligatoire: boolean;
}

function valeursDe(defaut?: EtapeAffichee): Valeurs {
  return {
    titre: defaut?.titre ?? "",
    critere: defaut?.critere ?? "",
    marcheASuivre: defaut?.marcheASuivre ?? "",
    lien: defaut?.lien ?? "",
    risque: defaut?.risque ?? "LOW",
    saisieLibelle: defaut?.saisie?.libelle ?? "",
    saisieObligatoire: defaut?.saisie?.obligatoire ?? true,
  };
}

/**
 * Les champs d'une étape déclarée, les mêmes à l'ajout et à la réécriture : deux jeux
 * de champs finiraient par diverger, et la clé d'une étape suit son titre dans les
 * deux cas.
 *
 * Contrôlés, et ce n'est pas un détail de style : React vide les champs non contrôlés
 * d'un formulaire dès qu'une action rend la main, succès ou refus. Or le refus d'une
 * étape que l'incubateur n'admet pas est un chemin prévu, pas un accident, et il ferait
 * ici perdre tout ce qui vient d'être écrit.
 */
function ChampsDeLEtape({
  valeurs,
  changer,
}: {
  valeurs: Valeurs;
  changer: (modification: Partial<Valeurs>) => void;
}) {
  return (
    <>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Ce qu'il y a à faire"
            hintText="Le titre de l'étape. C'est lui qui fait sa clé : deux modèles qui écrivent le même titre demandent le même geste, et il ne se fait qu'une fois."
            nativeInputProps={{
              name: "titre",
              required: true,
              value: valeurs.titre,
              autoComplete: "off",
              ...messageObligatoire("Donnez un titre à cette étape.", (evenement) => {
                changer({ titre: evenement.target.value });
              }),
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="C'est fait quand"
            hintText="Ce qu'il faut constater pour cocher. Obligatoire : sans lui, « fait » ne veut rien dire."
            nativeInputProps={{
              name: "critere",
              required: true,
              value: valeurs.critere,
              autoComplete: "off",
              ...messageObligatoire(
                "Dites ce qu'il faut constater pour cocher cette étape.",
                (evenement) => {
                  changer({ critere: evenement.target.value });
                },
              ),
            }}
          />
        </div>
      </div>

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-8")}>
          <Input
            label="Marche à suivre"
            hintText="Facultatif. Ce qu'il faut faire, pour quelqu'un qui ne l'a jamais fait."
            textArea
            nativeTextAreaProps={{
              name: "marcheASuivre",
              value: valeurs.marcheASuivre,
              onChange: (evenement) => {
                changer({ marcheASuivre: evenement.target.value });
              },
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-4")}>
          <Input
            label="Lien"
            hintText="Facultatif. L'adresse de la page où le geste se fait."
            nativeInputProps={{
              name: "lien",
              type: "url",
              value: valeurs.lien,
              autoComplete: "off",
              onChange: (evenement) => {
                changer({ lien: evenement.target.value });
              },
            }}
          />
          <Select
            label="Risque"
            nativeSelectProps={{
              name: "risque",
              value: valeurs.risque,
              onChange: (evenement) => {
                changer({ risque: evenement.target.value as RiskLevel });
              },
            }}
          >
            {(["LOW", "MEDIUM", "HIGH"] as const).map((risque) => (
              <option key={risque} value={risque}>
                {RISQUE[risque]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Valeur demandée au pointage"
            hintText="Facultatif. Le libellé de ce qu'on demandera de saisir, par exemple « Date de signature ». Laissez vide si cocher suffit."
            nativeInputProps={{
              name: "saisieLibelle",
              value: valeurs.saisieLibelle,
              autoComplete: "off",
              onChange: (evenement) => {
                changer({ saisieLibelle: evenement.target.value });
              },
            }}
          />
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Checkbox
            small
            options={[
              {
                label: "Sans cette valeur, l'étape ne peut pas être déclarée faite",
                nativeInputProps: {
                  name: "saisieObligatoire",
                  value: "oui",
                  checked: valeurs.saisieObligatoire,
                  onChange: (evenement) => {
                    changer({ saisieObligatoire: evenement.target.checked });
                  },
                },
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}

/** L'état d'un formulaire d'étape, et le geste qui en modifie un champ. */
function useValeurs(defaut?: EtapeAffichee) {
  const [valeurs, setValeurs] = useState(() => valeursDe(defaut));

  const changer = useCallback((modification: Partial<Valeurs>) => {
    setValeurs((precedentes) => ({ ...precedentes, ...modification }));
  }, []);

  return { valeurs, changer, setValeurs };
}

/**
 * L'ajout d'une étape. Le formulaire se vide au succès et pas avant : conservé rempli,
 * il ferait rejouer la même déclaration au clic suivant, que l'unicité de la clé
 * refuserait sans que la raison saute aux yeux.
 */
function FormulaireDAjout({
  proprietaire,
  moment,
}: {
  proprietaire: string;
  moment: TemplateKind;
}) {
  const [etat, formAction, pending] = useActionState<EtatModele | null, FormData>(
    ajouterEtapeAuModele,
    null,
  );
  const { valeurs, changer, setValeurs } = useValeurs();
  const vider = useCallback(() => {
    setValeurs(valeursDe());
  }, [setValeurs]);

  useFermetureApresSucces(pending, etat?.erreur, vider);

  return (
    <form action={formAction}>
      <input type="hidden" name="proprietaire" value={proprietaire} />
      <input type="hidden" name="moment" value={moment} />

      <ChampsDeLEtape valeurs={valeurs} changer={changer} />

      <Button type="submit" priority="secondary" disabled={pending}>
        {pending ? "Ajout…" : "Ajouter cette étape"}
      </Button>
      <Erreur etat={etat} />
    </form>
  );
}

function FormulaireDeModification({ etape }: { etape: EtapeAffichee }) {
  const [etat, formAction, pending] = useActionState<EtatModele | null, FormData>(
    modifierEtapeDuModele,
    null,
  );
  const { valeurs, changer } = useValeurs(etape);

  return (
    <form action={formAction}>
      <input type="hidden" name="etapeId" value={etape.id} />

      <ChampsDeLEtape valeurs={valeurs} changer={changer} />

      <Button type="submit" priority="secondary" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
      <Erreur etat={etat} />
    </form>
  );
}

/**
 * Le retrait d'une étape, en deux clics et sans dialogue : la suppression est franche
 * et sans retour, le journal en gardant seul l'historique. Un bouton unique la rendrait
 * atteignable par un clic mal placé sur une liste dépliée.
 */
function BoutonDeRetrait({ etape }: { etape: EtapeAffichee }) {
  const [etat, formAction, pending] = useActionState<EtatModele | null, FormData>(
    retirerEtapeDuModele,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  if (!confirme) {
    return (
      <Button
        className={fr.cx("fr-mt-2w")}
        priority="tertiary no outline"
        size="small"
        onClick={() => {
          setConfirme(true);
        }}
      >
        Retirer cette étape
      </Button>
    );
  }

  return (
    <form action={formAction} className={fr.cx("fr-mt-2w")}>
      <input type="hidden" name="etapeId" value={etape.id} />
      <p className={fr.cx("fr-text--sm", "fr-mb-1w")}>
        « {etape.titre} » disparaîtra de ce modèle sans retour. Les plans déjà calculés la gardent :
        leurs étapes sont figées, et le journal garde le détail de celle-ci.
      </p>
      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending ? "Retrait…" : "Confirmer le retrait"}
      </Button>{" "}
      <Button
        priority="tertiary no outline"
        size="small"
        onClick={() => {
          setConfirme(false);
        }}
      >
        Garder
      </Button>
      <Erreur etat={etat} />
    </form>
  );
}

/**
 * L'ouverture ou la fermeture du droit des startups de compléter un moment.
 *
 * Le compte des étapes neutralisées se donne ici, et il est obligatoire : refermer ne
 * supprime rien, si bien que sans lui des étapes déclarées cesseraient d'être
 * demandées sans que personne ne l'apprenne.
 */
export function BasculeAutorisation({
  moment,
  autorise,
  neutralisees,
}: {
  moment: TemplateKind;
  autorise: boolean;
  neutralisees: number;
}) {
  const [etat, formAction, pending] = useActionState<EtatModele | null, FormData>(
    basculerAutorisationDesStartups,
    null,
  );

  return (
    <form action={formAction} className={fr.cx("fr-mb-3w")}>
      <input type="hidden" name="moment" value={moment} />
      <input type="hidden" name="autorise" value={autorise ? "non" : "oui"} />

      <Badge severity={autorise ? "success" : "warning"} noIcon>
        {autorise ? "Les startups peuvent compléter" : "Les startups ne complètent pas"}
      </Badge>

      <p className={fr.cx("fr-mt-1w", "fr-mb-1w")}>
        {autorise
          ? "Les étapes déclarées par les modèles des startups entrent dans les plans, à la suite de celles-ci."
          : neutralisees === 0
            ? "Aucune étape de startup n'est déclarée pour ce moment : refermer n'y neutralise rien aujourd'hui."
            : `${neutralisees} étape${neutralisees > 1 ? "s" : ""} déclarée${neutralisees > 1 ? "s" : ""} par des startups ${neutralisees > 1 ? "sont neutralisées" : "est neutralisée"} : ${neutralisees > 1 ? "elles restent" : "elle reste"} en base et ${neutralisees > 1 ? "n'entrent" : "n'entre"} dans aucun plan. Rouvrir ${neutralisees > 1 ? "les rend" : "la rend"} à l'identique.`}
      </p>

      <Button type="submit" priority="secondary" size="small" disabled={pending}>
        {pending
          ? "Enregistrement…"
          : autorise
            ? "Refermer l'autorisation"
            : "Ouvrir l'autorisation aux startups"}
      </Button>
      <Erreur etat={etat} />
    </form>
  );
}

/**
 * La liste des étapes d'un modèle et ses deux gestes d'écriture.
 *
 * Le formulaire d'ajout reste offert même là où l'incubateur n'admet pas les étapes
 * de startup : le refus se joue au serveur, avec une phrase qui nomme le modèle qui
 * décide et dit les deux façons d'en sortir. Un bouton grisé, lui, ne dit rien.
 */
export function Editeur({
  proprietaire,
  moment,
  etapes,
}: {
  proprietaire: string;
  moment: TemplateKind;
  etapes: readonly EtapeAffichee[];
}) {
  return (
    <>
      {etapes.length === 0 ? (
        <p>
          Aucune étape déclarée pour ce moment. Un plan calculé aujourd'hui n'en porterait aucune de
          la part de ce modèle.
        </p>
      ) : (
        <ol className={fr.cx("fr-mb-4w")}>
          {etapes.map((etape) => (
            <li key={etape.id} className={fr.cx("fr-mb-2w")}>
              <strong>{etape.titre}</strong>{" "}
              {etape.risque === "HIGH" ? (
                <Badge severity="error" small noIcon>
                  risque élevé
                </Badge>
              ) : null}{" "}
              {etape.saisie ? (
                <Badge severity="info" small noIcon>
                  {etape.saisie.obligatoire ? "valeur exigée" : "valeur demandée"}
                </Badge>
              ) : null}
              <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>
                <em>C'est fait quand : {etape.critere}</em>
              </p>
              {etape.saisieIllisible ? (
                <Alert
                  className={fr.cx("fr-my-1w")}
                  severity="warning"
                  small
                  description="La valeur demandée au pointage est illisible en base : tout dossier qui porterait cette étape l'écarterait de son plan. Réécrivez-la ci-dessous, ou videz son libellé."
                />
              ) : null}
              <Accordion titleAs="h3" label={`Modifier « ${etape.titre} »`}>
                <FormulaireDeModification etape={etape} />
                <BoutonDeRetrait etape={etape} />
              </Accordion>
            </li>
          ))}
        </ol>
      )}

      <h3 className={fr.cx("fr-h6")}>Ajouter une étape</h3>
      <FormulaireDAjout proprietaire={proprietaire} moment={moment} />
    </>
  );
}

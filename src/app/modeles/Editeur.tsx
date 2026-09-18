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

import { type Acteur, combinaisonValide } from "@/core/dossier";
import { LIBELLE_ACTEUR } from "@/core/libelle-dossier";
import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";
import { useListesApresEnvoi } from "@/ui/formulaire";
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
import { MODELE } from "./redaction";

const RISQUE: Record<RiskLevel, string> = {
  LOW: "Ordinaire",
  MEDIUM: "Sensible",
  HIGH: "Élevé",
};

/**
 * Les rôles offerts au choix, plus celui que l'étape porte déjà quand il n'en est pas.
 *
 * `DELEGATE` y entre depuis qu'un droit par dossier existe : `roleSurDossier` le rend
 * à qui en détient un, si bien qu'une étape qui l'attend nomme quelqu'un au lieu
 * d'attendre une désignation impossible. Une ligne qui porte un rôle absent de cette
 * liste le garde en revanche, comme elle garde une paire que le serveur refusera : un
 * choix absent ferait afficher le premier venu et le réécrirait au premier
 * enregistrement, sans que personne ne l'ait demandé.
 */
const OFFERTS: readonly Acteur[] = ["OPERATOR", "SUBJECT", "DELEGATE"];

function choix(retenu: Acteur | null, admis: (candidat: Acteur) => boolean): readonly Acteur[] {
  const liste = OFFERTS.filter(admis);
  return retenu !== null && !liste.includes(retenu) ? [...liste, retenu] : liste;
}

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
  acteur: Acteur;
  controleur: Acteur | null;
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
    acteur: defaut?.acteur ?? "OPERATOR",
    controleur: defaut?.controleur ?? null,
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
function ChampsDeLEtape({ formulaire, pending }: { formulaire: Formulaire; pending: boolean }) {
  const { valeurs, changer, choisirLActeur, choisirLeControleur, controleurRetire } = formulaire;
  const envoi = useListesApresEnvoi(pending);

  return (
    <>
      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label="Ce qu'il y a à faire"
            hintText={MODELE.champs.titre}
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
            hintText={MODELE.champs.critere}
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
            key={`risque-${envoi}`}
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
          <Select
            key={`acteur-${envoi}`}
            label="Qui fait cette étape"
            hint={MODELE.champs.acteur}
            nativeSelectProps={{
              name: "acteur",
              value: valeurs.acteur,
              onChange: (evenement) => {
                choisirLActeur(evenement.target.value as Acteur);
              },
            }}
          >
            {choix(valeurs.acteur, () => true).map((acteur) => (
              <option key={acteur} value={acteur}>
                {LIBELLE_ACTEUR[acteur]}
              </option>
            ))}
          </Select>
        </div>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Select
            key={`controleur-${envoi}`}
            label="Qui contrôle ce qui y sera déclaré"
            hint={MODELE.champs.controleur(valeurs.controleur === valeurs.acteur)}
            state={controleurRetire === null ? "default" : "info"}
            stateRelatedMessage={
              controleurRetire === null
                ? undefined
                : MODELE.champs.controleurRetire(controleurRetire, valeurs.acteur)
            }
            nativeSelectProps={{
              name: "controleur",
              value: valeurs.controleur ?? "",
              onChange: (evenement) => {
                choisirLeControleur((evenement.target.value || null) as Acteur | null);
              },
            }}
          >
            <option value="">Personne, cette étape se croit sur parole</option>
            {choix(valeurs.controleur, (candidat) =>
              combinaisonValide(valeurs.acteur, candidat),
            ).map((candidat) => (
              <option key={candidat} value={candidat}>
                {LIBELLE_ACTEUR[candidat]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className={fr.cx("fr-grid-row", "fr-grid-row--gutters")}>
        <div className={fr.cx("fr-col-12", "fr-col-md-6")}>
          <Input
            label={MODELE.champs.saisieLibelle}
            hintText={MODELE.champs.saisie}
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
          {valeurs.saisieLibelle.trim() === "" ? (
            <p className={fr.cx("fr-hint-text", "fr-mt-4w")}>{MODELE.champs.saisieSansValeur}</p>
          ) : (
            <Checkbox
              small
              className={fr.cx("fr-mt-4w")}
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
          )}
        </div>
      </div>
    </>
  );
}

/**
 * L'état d'un formulaire d'étape, les gestes qui en modifient un champ, et le
 * contrôle qu'un changement d'acteur a retiré.
 *
 * Ce dernier n'est pas une valeur du formulaire, c'est ce qu'il vient de faire sans
 * qu'on le lui demande : il se dit une fois, puis s'efface au choix suivant.
 */
function useValeurs(defaut?: EtapeAffichee) {
  const [valeurs, setValeurs] = useState(() => valeursDe(defaut));
  const [controleurRetire, setControleurRetire] = useState<Acteur | null>(null);

  const changer = useCallback((modification: Partial<Valeurs>) => {
    setValeurs((precedentes) => ({ ...precedentes, ...modification }));
  }, []);

  const choisirLActeur = (acteur: Acteur) => {
    // Le contrôleur déjà choisi peut devenir impossible : le laisser ferait soumettre
    // une paire que le serveur refuse, sur un formulaire contrôlé dont le refus est un
    // chemin prévu.
    const retire =
      valeurs.controleur !== null && !combinaisonValide(acteur, valeurs.controleur)
        ? valeurs.controleur
        : null;

    setControleurRetire(retire);
    changer({ acteur, ...(retire === null ? {} : { controleur: null }) });
  };

  const choisirLeControleur = (controleur: Acteur | null) => {
    setControleurRetire(null);
    changer({ controleur });
  };

  const vider = useCallback(() => {
    setControleurRetire(null);
    setValeurs(valeursDe());
  }, []);

  return { valeurs, changer, choisirLActeur, choisirLeControleur, controleurRetire, vider };
}

type Formulaire = ReturnType<typeof useValeurs>;

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
  const formulaire = useValeurs();

  useFermetureApresSucces(pending, etat?.erreur, formulaire.vider);

  return (
    <form action={formAction}>
      <input type="hidden" name="proprietaire" value={proprietaire} />
      <input type="hidden" name="moment" value={moment} />

      <ChampsDeLEtape formulaire={formulaire} pending={pending} />

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
  const formulaire = useValeurs(etape);

  return (
    <form action={formAction}>
      <input type="hidden" name="etapeId" value={etape.id} />

      <ChampsDeLEtape formulaire={formulaire} pending={pending} />

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
        « {etape.titre} » disparaîtra de ce modèle sans retour. Les plans déjà calculés la gardent,
        et le journal en garde le détail.
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
            ? "Aucune étape de startup n'est déclarée pour ce moment. Cette fermeture ne neutralise rien aujourd'hui."
            : MODELE.neutralisees(neutralisees, "par des startups")}
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
        <p>Aucune étape déclarée pour ce moment.</p>
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
              ) : null}{" "}
              {etape.acteur === "OPERATOR" ? null : (
                <Badge severity="info" small noIcon>
                  à {LIBELLE_ACTEUR[etape.acteur]}
                </Badge>
              )}{" "}
              {etape.controleur ? (
                <Badge severity="new" small noIcon>
                  relue par {LIBELLE_ACTEUR[etape.controleur]}
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
                  description={MODELE.saisieIllisible}
                />
              ) : null}
              {/* Constaté et non corrigé, à reprendre quand cet écran se refera :
                  enregistrer une étape referme son dépliant, et celui de l'étape
                  suivante vient occuper la place laissée libre. Qui vient de
                  sauvegarder croit relire son étape, lit celle d'après, et conclut que
                  ses valeurs se sont perdues. Rien n'est perdu, mais le doute suffit à
                  faire réenregistrer plusieurs fois de suite. Ce qu'il y a à trancher
                  est le partage de la place entre la liste et le formulaire, pas la
                  position du dépliant. */}
              <Accordion titleAs="h3" label={`Modifier « ${etape.titre} »`}>
                <FormulaireDeModification etape={etape} />
                <BoutonDeRetrait etape={etape} />
              </Accordion>
            </li>
          ))}
        </ol>
      )}

      {/* Replié : l'écran monte cet éditeur une fois par moment, donc le formulaire s'y rendait
          deux ou trois fois, à 628 pixels pièce, sur une page qui ne déclare parfois aucune
          étape. Ajouter est un geste, la liste est ce qu'on vient lire. */}
      <Accordion titleAs="h3" label="Ajouter une étape">
        <FormulaireDAjout proprietaire={proprietaire} moment={moment} />
      </Accordion>
    </>
  );
}

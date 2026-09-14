/**
 * Ce que les trois écrans des modèles promettent.
 *
 * Trois phrases s'y disaient déjà deux fois chacune, dans des termes voisins : l'effet
 * d'une modification sur les plans déjà calculés, le sort des étapes qu'une
 * autorisation fermée neutralise, et ce qu'un modèle sans startup connue devient. Une
 * promesse qui existe en deux exemplaires finit par ne plus être tenue qu'à moitié.
 */

import type { Acteur } from "@/core/dossier";
import { LIBELLE_ACTEUR } from "@/core/libelle-dossier";

const CAUSE_ORPHELIN =
  "Un renommage amont, une sortie de l'incubateur ou une faute de frappe donnent ici le même symptôme.";

export const MODELE = {
  /** Ce qu'une modification fait, et ce qu'elle ne fait pas, aux plans qui existent. */
  effetSurLesPlans:
    "Modifier un modèle ne change aucun plan déjà calculé : ses étapes ont été figées au moment où il a été créé. Un brouillon en cours se découvrira obsolète et se réparera par un recalcul ; un plan confirmé gardera les siennes et dira ce qui n'y figure pas.",

  /**
   * Ce que devient une étape de startup quand l'incubateur ferme le moment. Le nombre
   * est obligatoire : refermer ne supprime rien, et sans lui des étapes déclarées
   * cesseraient d'être demandées sans que personne ne l'apprenne.
   */
  neutralisees: (nombre: number, ou: "ici" | "par des startups"): string => {
    const pluriel = nombre > 1;
    return (
      `${nombre} étape${pluriel ? "s" : ""} déclarée${pluriel ? "s" : ""} ${ou} ` +
      `${pluriel ? "sont neutralisées" : "est neutralisée"} : ` +
      `${pluriel ? "elles restent" : "elle reste"} en base et ` +
      `${pluriel ? "n'entrent" : "n'entre"} dans aucun plan. ` +
      `Rouvrir l'autorisation ${pluriel ? "les rend" : "la rend"} à l'identique.`
    );
  },

  orphelins: {
    plusieurs: `Les plans déjà calculés gardent leurs étapes, aucun nouveau ne les reprendra : leur identifiant n'est plus rendu par le référentiel des startups. ${CAUSE_ORPHELIN} Rien d'autre que cette liste ne mène plus à eux.`,
    seul: `Aucun plan ne portera ses étapes : cet identifiant n'est plus rendu par le référentiel des startups. ${CAUSE_ORPHELIN} Redéclarez ces étapes sous le bon identifiant, puis retirez celles-ci.`,
  },

  champs: {
    titre:
      "Le titre de l'étape. Deux modèles qui écrivent le même titre demandent le même geste : il n'entrera qu'une fois dans un plan.",
    critere:
      "Ce qu'il faut constater pour cocher. Obligatoire : sans lui, « fait » ne veut rien dire.",
    acteur:
      "Quel que soit ce choix, un opérateur pourra toujours cocher à sa place : aucune étape ne devient impossible à cocher.",
    controleur: (memeRole: boolean): string =>
      memeRole
        ? "Tant que ce regard n'a pas eu lieu, l'étape n'est pas terminée et le dossier ne se clôt pas. Vous avez choisi le même rôle des deux côtés : il faudra deux opérateurs différents pour la terminer, sur n'importe quel dossier."
        : "Tant que ce regard n'a pas eu lieu, l'étape n'est pas terminée et le dossier ne se clôt pas.",
    /**
     * Le contrôle qu'un changement d'acteur vient de rendre impossible, et que le
     * formulaire retire donc de lui-même. Sans cette phrase, le retrait passe pour une
     * valeur qui bouge toute seule, et l'étape s'enregistre sans le regard qu'on
     * croyait lui avoir posé.
     */
    controleurRetire: (controleur: Acteur, acteur: Acteur): string =>
      `Le contrôle par ${LIBELLE_ACTEUR[controleur]} a été retiré : il ne s'applique pas à ce que fait ${LIBELLE_ACTEUR[acteur]}. Choisissez-en un autre, ou laissez cette étape se croire sur parole.`,

    /**
     * Ce qui remplace la case « sans cette valeur » tant qu'aucun libellé n'est saisi.
     * Le serveur ne garde aucune saisie sans libellé, donc la case n'y changerait rien :
     * offerte quand même, elle se décoche sous le doigt puis revient cochée au
     * rechargement, ce qui est exactement le geste d'un réglage qui ne prend pas.
     */
    saisieSansValeur:
      "Aucune valeur n'est demandée au moment de cocher : la case suffira à déclarer cette étape faite. Donnez un libellé à gauche pour en attendre une.",

    saisieLibelle: "Valeur demandée au moment de cocher",
    saisie:
      "Facultatif. Le libellé de ce qu'on demandera de saisir, par exemple « Date de signature ». Laissez vide si cocher suffit.",
  },

  saisieIllisible:
    "La valeur demandée est illisible en base : aucun plan calculé aujourd'hui ne retiendrait cette étape. Réécrivez-la ci-dessous, ou videz son libellé.",
} as const;

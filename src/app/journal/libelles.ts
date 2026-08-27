export const RESULTATS = [
  { valeur: "SUCCESS", libelle: "Succès" },
  { valeur: "FAILURE", libelle: "Échec" },
  { valeur: "SKIPPED", libelle: "Ignoré" },
] as const;

export type Resultat = (typeof RESULTATS)[number]["valeur"];

const LIBELLE_ACTION: Record<string, string> = {
  "auth.signin": "Connexion",
  "auth.signin.break_glass": "Connexion par accès de secours",
  "sync.perimetre": "Collecte du périmètre",
  "sync.comptes-service": "Report des comptes de service",
  "finding.open": "Ouverture d'un constat",
  "finding.close": "Fermeture d'un constat",
  "service-account.review": "Revue d'un compte de service",
  "sync.lancement": "Collecte lancée à la main",
  "dossier.ouverture": "Ouverture d'un dossier d'accès",
  "dossier.confirmation": "Confirmation d'un plan",
  "dossier.pointage": "Pointage d'une étape",
  "dossier.cloture": "Clôture d'un dossier d'accès",
  "dossier.recalcul": "Recalcul d'un plan",
  "dossier.annulation": "Annulation d'un dossier d'accès",
  "dossier.validation": "Validation d'une étape",
  // Les six verbes que le dossier d'accès remplace. Le journal est en écriture seule
  // à rétention indéfinie : une ligne d'il y a six mois doit rester lisible telle
  // qu'elle a été écrite, et ces libellés ne s'effacent donc jamais.
  "depart.ouverture": "Ouverture d'un dossier de départ",
  "depart.confirmation": "Confirmation d'un plan de départ",
  "depart.pointage": "Pointage d'une étape de départ",
  "depart.cloture": "Clôture d'un dossier de départ",
  "depart.recalcul": "Recalcul d'un plan de départ",
  "depart.annulation": "Annulation d'un dossier de départ",
  "modele.creation": "Création d'un modèle de plan",
  "modele.autorisation": "Autorisation des startups à compléter un modèle",
  "modele.etape.ajout": "Ajout d'une étape à un modèle",
  "modele.etape.modification": "Modification d'une étape d'un modèle",
  "modele.etape.retrait": "Retrait d'une étape d'un modèle",
  "identite.rattachement": "Rattachement d'un compte à une personne",
  "identite.detachement": "Détachement d'un compte",
  "identite.rapprochement": "Rapprochement automatique d'un compte",
  "identite.reattribution": "Réattribution d'un compte à une autre fiche",
  "personne.creation": "Création d'une fiche personne",
  "personne.edition": "Édition d'une fiche personne",
  "personne.renommage": "Renommage d'une fiche personne",
  "personne.fusion": "Fusion de deux fiches personne",
  "personne.appartenance.forcee": "Appartenance forcée",
  "personne.appartenance.liberee": "Surcharge d'appartenance retirée",
  "rattachement.pose": "Rattachement manuel à une startup",
  "rattachement.retrait": "Retrait d'un rattachement manuel",
  "retirer-de-l-organisation": "Retrait d'une organisation",
};

const LIBELLE_CIBLE: Record<string, string> = {
  session: "Session",
  perimetre: "Périmètre",
  finding: "Constat",
  "service-account": "Compte de service",
  collecte: "Collecte",
  personne: "Personne",
  rattachement: "Rattachement à une startup",
  plan: "Plan",
  etape: "Étape",
  modele: "Modèle de plan",
};

const SEVERITE_RESULTAT: Record<string, "success" | "error" | "info"> = {
  SUCCESS: "success",
  FAILURE: "error",
  SKIPPED: "info",
};

/**
 * Repli sur la valeur brute plutôt que sur une chaîne vide : une action ajoutée
 * ailleurs dans le code apparaît telle quelle au lieu de laisser une case muette,
 * ce qui trahirait le journal au moment précis où il sert de preuve.
 */
export function libelleAction(action: string): string {
  const connu = LIBELLE_ACTION[action];
  if (connu) {
    return connu;
  }

  // Les collectes portent le nom de leur système : les énumérer ici obligerait à
  // penser au journal chaque fois qu'un connecteur arrive, et personne n'y pense.
  if (action.startsWith("sync.")) {
    return `Collecte du système ${action.slice("sync.".length)}`;
  }

  return action;
}

export function libelleCible(targetType: string): string {
  return LIBELLE_CIBLE[targetType] ?? targetType;
}

export function libelleResultat(result: string): string {
  return RESULTATS.find((resultat) => resultat.valeur === result)?.libelle ?? result;
}

export function severiteResultat(result: string): "success" | "error" | "info" {
  return SEVERITE_RESULTAT[result] ?? "info";
}

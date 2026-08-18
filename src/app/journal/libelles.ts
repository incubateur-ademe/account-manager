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
  "depart.ouverture": "Ouverture d'un dossier de départ",
  "depart.confirmation": "Confirmation d'un plan de départ",
  "depart.pointage": "Pointage d'une étape de départ",
  "depart.cloture": "Clôture d'un dossier de départ",
  "depart.recalcul": "Recalcul d'un plan de départ",
  "identite.rattachement": "Rattachement d'un compte à une personne",
  "identite.detachement": "Détachement d'un compte",
  "identite.rapprochement": "Rapprochement automatique d'un compte",
  "personne.creation": "Création d'une fiche personne",
  "retirer-de-l-organisation": "Retrait d'une organisation",
};

const LIBELLE_CIBLE: Record<string, string> = {
  session: "Session",
  perimetre: "Périmètre",
  finding: "Constat",
  "service-account": "Compte de service",
  collecte: "Collecte",
  personne: "Personne",
  plan: "Plan",
  etape: "Étape",
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

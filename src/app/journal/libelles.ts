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
};

const LIBELLE_CIBLE: Record<string, string> = {
  session: "Session",
  perimetre: "Périmètre",
  finding: "Constat",
  "service-account": "Compte de service",
  collecte: "Collecte",
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
  return LIBELLE_ACTION[action] ?? action;
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

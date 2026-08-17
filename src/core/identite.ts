export interface AuthUserShape {
  id?: string | null;
  username?: string | null;
  email?: string | null;
}

/**
 * Le username beta.gouv change de champ selon l'étape de la connexion :
 * dans `id` à l'envoi du lien, dans `email` sur l'utilisateur provisoire du premier
 * retour de lien, et enfin dans `username` une fois le compte créé. Les trois formes
 * étant indiscernables par leur forme, on ne devine pas : on remonte tous les
 * candidats plausibles et c'est l'allowlist qui tranche.
 */
export function candidateUsernames(user: AuthUserShape): string[] {
  const candidates = [user.username, user.email, user.id]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .filter((value) => !value.includes("@"));

  return [...new Set(candidates)];
}

export interface OperatorMatch {
  username: string;
  viaBreakGlass: boolean;
}

export function resolveOperator(
  user: AuthUserShape,
  operators: readonly string[],
  breakGlass: readonly string[],
): OperatorMatch | null {
  for (const candidate of candidateUsernames(user)) {
    if (operators.includes(candidate)) {
      return { username: candidate, viaBreakGlass: false };
    }
    if (breakGlass.includes(candidate)) {
      return { username: candidate, viaBreakGlass: true };
    }
  }
  return null;
}

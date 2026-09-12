/**
 * Ce qu'aucun étage de test n'a le droit d'atteindre, quel que soit son étage.
 *
 * La base fait exception et se règle à part : l'unitaire s'en interdit une, l'intégration
 * en exige une, dédiée. Tout le reste est mort pour les deux, parce qu'aucun test de ce
 * dépôt n'a de raison de parler à quoi que ce soit d'extérieur.
 *
 * Le cas qui justifie ce passage à lui seul est `ESPACE_MEMBRE_URL`, dont le schéma pose
 * par défaut l'adresse de production : un test qui oublie de piéger `fetch` interroge le
 * vrai référentiel des personnes, sur une route dont rien ne restreint la portée à
 * l'incubateur. Le défaut est silencieux, puisque l'appel réussit.
 *
 * Les valeurs satisfont le schéma Zod de `src/lib/env.ts`, qui refuse de démarrer sur
 * une chaîne vide, et ne mènent nulle part : le port 1 n'écoute jamais.
 */

export const MORT = "127.0.0.1:1";

export function poserLesAdressesMortes(): void {
  process.env["ESPACE_MEMBRE_URL"] = `http://${MORT}`;
  process.env["ESPACE_MEMBRE_API_KEY"] = "aucune-cle-en-test";
  process.env["AUTH_SECRET"] = "aucun-secret-en-test";
  process.env["SMTP_URL"] = `smtp://${MORT}`;
  process.env["SMTP_EMAIL_FROM"] = "personne@exemple.invalid";
}

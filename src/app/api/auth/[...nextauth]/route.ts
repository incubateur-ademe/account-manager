import { handlers } from "@/lib/auth";

export const { GET } = handlers;

/**
 * Le POST du paquet est refusé ici, et le GET passe entier.
 *
 * `POST /api/auth/signin/<fournisseur>` atteint `sendToken`, dont la destination
 * distingue l'adresse qui ouvre un accès de celle qui n'en ouvre aucun,
 * `verify-request` contre `error?error=AccessDenied`, une saisie malformée en donnant
 * une troisième. Aucune des fermetures de l'écran de connexion ne porte sur ce chemin,
 * qui ne passe pas par `loginAction`, et la barrière ne suffit pas : elle constate un
 * cookie de session sans le valider, si bien qu'un cookie inventé la franchit et repose
 * la question adresse par adresse.
 *
 * Rien n'y perd d'appelant. `signIn`, `signOut`, `auth` et `update` fabriquent une
 * requête et appellent `Auth()` en processus, sans traverser ce gestionnaire, et le
 * client React du paquet, seul à poster sur ces chemins depuis un navigateur, n'est
 * importé nulle part ici. La connexion par lien, elle, ne poste jamais : le courriel
 * porte un lien ordinaire, et son retour comme la page d'erreur du paquet sont des GET
 * que ce refus ne touche pas.
 *
 * Le refus ne reçoit pas la requête, et c'est la raison d'être de sa signature : une
 * réponse qui varierait selon l'adresse postée remplacerait un oracle par un autre. Un
 * fournisseur à identifiants ou une clé d'accès, qui postent l'un et l'autre sous
 * `/api/auth`, se rouvrent ici en même temps qu'on les ajoute.
 */
export function POST(): Response {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}

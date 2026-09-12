/**
 * Ce qu'un test unitaire a le droit d'atteindre : rien.
 *
 * Les valeurs sont posées sans condition, et c'est le point. Un test unitaire qui
 * oublie de doubler la base ou le réseau doit échouer bruyamment, tout de suite, sur
 * une adresse morte. Sans ça il échouerait ailleurs et plus tard, ou pire, il
 * réussirait en atteignant pour de vrai ce qu'il croyait doubler.
 *
 * Le cas le plus dangereux est `ESPACE_MEMBRE_URL`, dont le schéma pose par défaut
 * l'adresse de production : un test qui oublie de piéger `fetch` interroge le vrai
 * référentiel des personnes, sur une route qui n'est pas restreinte à l'incubateur.
 *
 * Les valeurs satisfont le schéma Zod de `src/lib/env.ts`, qui refuserait de démarrer
 * sur une chaîne vide, mais ne mènent nulle part : le port 1 n'écoute jamais.
 *
 * Ces lignes existaient déjà, recopiées en tête de six fichiers de test avec `??=`.
 * Elles y restent sans effet, ce passage s'exécutant avant eux, et se retireront quand
 * la branche du vocabulaire aura rejoint le tronc : les supprimer aujourd'hui
 * fabriquerait un conflit sans rien tenir de plus.
 */

const MORT = "127.0.0.1:1";

process.env["DATABASE_URL"] = `postgresql://interdit:interdit@${MORT}/aucune-base-en-unitaire`;
process.env["ESPACE_MEMBRE_URL"] = `http://${MORT}`;
process.env["ESPACE_MEMBRE_API_KEY"] = "aucune-cle-en-unitaire";
process.env["AUTH_SECRET"] = "aucun-secret-en-unitaire";
process.env["SMTP_URL"] = `smtp://${MORT}`;
process.env["SMTP_EMAIL_FROM"] = "personne@exemple.invalid";

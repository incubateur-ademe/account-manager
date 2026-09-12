import { MORT, poserLesAdressesMortes } from "./vitest.adresses-mortes";

/**
 * Ce qu'un test unitaire a le droit d'atteindre : rien, base comprise.
 *
 * Les valeurs sont posées sans condition, et c'est le point. Un test unitaire qui
 * oublie de doubler la base doit échouer bruyamment, tout de suite, sur une adresse
 * morte. Sans ça il échouerait ailleurs et plus tard, ou pire, il réussirait en
 * trouvant la base de développement de qui joue les tests.
 *
 * Ces lignes existaient déjà, recopiées en tête de six fichiers de test avec `??=`.
 * Elles y restent sans effet, ce passage s'exécutant avant eux, et se retireront quand
 * la branche du vocabulaire aura rejoint le tronc : les supprimer aujourd'hui
 * fabriquerait un conflit sans rien tenir de plus.
 */

poserLesAdressesMortes();

process.env["DATABASE_URL"] = `postgresql://interdit:interdit@${MORT}/aucune-base-en-unitaire`;

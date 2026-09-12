import { poserLesAdressesMortes } from "./vitest.adresses-mortes";

/**
 * Ce qu'un test d'intégration exige avant de toucher quoi que ce soit : une base à lui,
 * et rien d'autre.
 *
 * Un test de cet étage écrit et efface pour de vrai. Il remet des tables à zéro entre
 * deux scénarios, `AuditEvent` compris, qui est à rétention indéfinie et porte la trace
 * nominative de tout ce que l'outil a jamais fait. Une variable d'environnement mal
 * chargée suffirait donc à vider le journal d'une vraie instance, et ce serait
 * irréparable : c'est le seul endroit du produit où l'effacement ne se rattrape pas.
 *
 * D'où ce refus, posé avant le premier scénario plutôt que dans la fonction qui efface.
 * Le nom de la base doit finir par `_test`, et rien d'autre ne sert de garde : ni le nom
 * de l'hôte, qu'un tunnel déguise, ni `NODE_ENV`, qu'un lanceur pose à côté de la
 * plaque.
 *
 * Une vraie base ne donne pas droit au reste : le référentiel des personnes et le relais
 * d'envoi restent morts pour cet étage comme pour l'autre.
 */

const url = process.env["DATABASE_URL"];

if (!url) {
  throw new Error(
    "Aucune base pour les tests d'intégration. Posez DATABASE_URL sur une base dédiée dont le nom finit par `_test`.",
  );
}

const nom = new URL(url).pathname.replace(/^\//, "");

if (!nom.endsWith("_test")) {
  throw new Error(
    `Refus de jouer les tests d'intégration sur la base « ${nom} » : cet étage efface des tables entre deux scénarios, le journal d'audit compris, et seule une base dont le nom finit par « _test » peut l'accepter.`,
  );
}

poserLesAdressesMortes();

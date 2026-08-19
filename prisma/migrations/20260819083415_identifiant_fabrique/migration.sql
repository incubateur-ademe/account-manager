-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "usernameFabricated" BOOLEAN NOT NULL DEFAULT false;

-- Reprise des fiches deja en base. Sans elle, aucune des fiches fautives deja
-- creees ne serait renommable, c'est-a-dire precisement celles pour lesquelles ce
-- geste existe, et rien ne le dirait : le bouton serait simplement absent.
--
-- Trois familles portent source LOCAL : une fiche fabriquee ici, une personne
-- declaree dans scope.local, et une fiche hors incubateur recopiee depuis
-- l'espace-membre. Les deux dernieres portent un identifiant qu'aucun code n'a le
-- droit de toucher, et « LOCAL sans uuid » ne suffit pas a les ecarter : une fiche
-- hors incubateur porte un vrai username beta.gouv meme quand l'API n'a rendu aucun
-- uuid. Marquer celles-la ouvrirait le renommage d'un vrai pivot, et comme elles
-- sont hors perimetre la collecte ne les revoit jamais : le marquage serait
-- definitif.
--
-- Le filtre retient donc la forme exacte que produit creerFichePourCompte, seule a
-- ne renseigner ni login, ni adresse, ni echeance. L'edition d'une fiche n'existant
-- pas avant cette migration, une fiche fabriquee les a forcement tous a nul.
UPDATE "Person"
SET "usernameFabricated" = true
WHERE "source" = 'LOCAL'
  AND "attachment" = 'LOCAL'
  AND "betaUuid" IS NULL
  AND "githubLogin" IS NULL
  AND "primaryEmail" IS NULL
  AND "communicationEmail" IS NULL
  AND "missionEnd" IS NULL;

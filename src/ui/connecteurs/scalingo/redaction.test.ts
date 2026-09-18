import { describe, expect, it } from "vitest";

import { CONNECTEURS } from "@/connectors";

import { aUnePage, ecranDe } from "../registre";
import { scopeAttendu } from "../scope-attendu";
import {
  LIBELLE_ROLE_SCALINGO,
  libelleDuRole,
  MOTS_DE_SCALINGO,
  ROLES_DEMANDABLES,
} from "./redaction";

/**
 * Ce que l'écran Scalingo dit, relu sans lui.
 *
 * Un projet Scalingo n'a pas de membres : le fournisseur laisse la gestion des
 * utilisateurs au niveau de l'application. L'écran présente donc un regroupement, jamais
 * une appartenance, et c'est la promesse la plus facile à trahir de tout ce lot : un titre
 * de groupe suivi d'une liste de personnes ressemble trait pour trait à une liste de
 * membres, et celui qui lit cet écran est celui qui décide d'une coupure. Promettre là un
 * droit que Scalingo ne sait pas poser, c'est faire cliquer sur un geste qui échoue
 * toujours, ou pire, faire croire qu'un accès a été retiré.
 *
 * Épinglé au plus bas étage qui sache le tenir : des phrases sont des valeurs, et rien
 * ici n'a besoin d'une base, d'un serveur ni d'un navigateur.
 */

/** Les phrases seules : un nom de champ n'est pas du texte que quelqu'un lit. */
function phrases(valeur: unknown): string[] {
  if (typeof valeur === "string") {
    return [valeur];
  }
  if (valeur === null || typeof valeur !== "object") {
    return [];
  }
  return Object.values(valeur).flatMap(phrases);
}

const TOUTES = phrases(MOTS_DE_SCALINGO);
const DU_PARC = phrases(MOTS_DE_SCALINGO.parc);

/**
 * Les formes qui affirmeraient qu'on entre dans un projet ou qu'on en sort. Elles sont
 * affirmatives, et la négation ne les déclenche pas : « il n'a pas de membres » est
 * précisément ce que l'écran doit dire.
 */
const PROMESSES_INTERDITES = [
  "membre du projet",
  "membres du projet",
  "membre d'un projet",
  "membres d'un projet",
  "accès au projet",
  "accès du projet",
  "accès à un projet",
  "ajouter au projet",
  "ajouter à un projet",
  "retirer du projet",
  "retirer d'un projet",
  "appartenance",
  "adhésion",
  "adhérer",
  "rejoindre",
];

/**
 * Les formes qui affirmeraient que ce qui s'affiche vient d'une lecture faite maintenant.
 * Elles sont affirmatives, et la négation ne les déclenche pas : « et non d'une lecture
 * faite à l'instant » est précisément ce que l'écran doit dire.
 *
 * Épinglé en interdiction et non en contenu attendu : une phrase de fraîcheur peut se
 * réécrire de mille façons vraies, et une seule fausse suffit à faire décider faux. Le
 * mensonge coûte ici le plus cher de tout l'écran, puisque personne ne va vérifier la
 * date de ce qu'on lui dit frais.
 */
const AFFIRMATIONS_DE_FRAICHEUR = [
  "est à jour",
  "sont à jour",
  "vient d'une lecture",
  "viennent d'une lecture",
  "en temps réel",
  "en direct",
  "lue à l'instant",
  "lues à l'instant",
  "état actuel",
  "interroge scalingo",
];

describe("un projet regroupe, il n'accueille personne", () => {
  it("dit ce qu'un projet fait et où le geste se lit, sans jamais promettre une appartenance", () => {
    // Given la table de rédaction entière, aplatie en phrases.
    expect(TOUTES.length).toBeGreaterThan(15);

    // Then aucune phrase n'affirme qu'on entre dans un projet ni qu'on en sort. Un
    // titre de groupe suivi d'une liste de personnes suffit déjà à le faire croire :
    // la rédaction est le seul endroit où cela se démente.
    const promesses = TOUTES.flatMap((phrase) =>
      PROMESSES_INTERDITES.filter((interdite) => phrase.toLowerCase().includes(interdite)).map(
        (interdite) => `« ${interdite} » dans « ${phrase} »`,
      ),
    );
    expect(promesses).toEqual([]);

    // Then la phrase de regroupement porte ses deux moitiés : ce qu'un projet fait, et
    // où le geste se lit. La première seule laisserait chercher le geste, la seconde
    // seule laisserait croire qu'un projet en porte un aussi.
    expect(MOTS_DE_SCALINGO.parc.regroupement).toContain("ne fait que regrouper");
    expect(MOTS_DE_SCALINGO.parc.regroupement).toContain("n'a pas de membres");
    expect(MOTS_DE_SCALINGO.parc.regroupement).toContain("la ligne d'une application");

    // Then le libellé du bouton de rôle n'apparaît dans aucune phrase du parc : le geste
    // vit sur la ligne d'une application, et nulle part au niveau d'un projet.
    expect(DU_PARC.filter((phrase) => phrase.includes(MOTS_DE_SCALINGO.role.bouton))).toEqual([]);

    // Then le reste se nomme pour ce qu'il est, et ne se présente ni comme un projet ni
    // comme une anomalie.
    expect(MOTS_DE_SCALINGO.parc.horsProjet).toContain("se lisent comme les autres");

    // Then une liste vide dit qu'elle ne dit rien du parc réel : sans cette moitié de
    // phrase, un écran sans collecte se lit comme un parc sans application.
    expect(MOTS_DE_SCALINGO.parc.vide).toContain("faute de collecte");
    expect(MOTS_DE_SCALINGO.parc.datation).toContain("dernière collecte");

    // Then les trois refus que l'écran oppose sans attendre le clic donnent chacun leur
    // raison. Celui de la ressemblance donne en plus la conséquence et l'endroit où
    // trancher : un bouton absent sans explication est une énigme.
    expect(MOTS_DE_SCALINGO.role.ressemblance).toContain("ressemblance de nom");
    expect(MOTS_DE_SCALINGO.role.ressemblance).toContain("coupe une partie de son accès");
    expect(MOTS_DE_SCALINGO.role.ressemblance).toContain("comptes isolés");
    expect(MOTS_DE_SCALINGO.role.ressemblance).not.toContain(MOTS_DE_SCALINGO.role.bouton);
    expect(MOTS_DE_SCALINGO.role.proprietaire).toContain("ne se change pas ici");
    expect(MOTS_DE_SCALINGO.comptes.isole).toContain("comptes isolés");

    // Then la phrase du succès s'arrête à ce qui a été écrit. Un brouillon n'est pas un
    // geste exécuté, et aucun écran ne porte encore sa confirmation : annoncer un lien
    // ou une exécution serait la seule phrase de cet écran qui mentirait.
    expect(MOTS_DE_SCALINGO.role.brouillon).toContain("rien n'est parti sur Scalingo");
    expect(MOTS_DE_SCALINGO.role.brouillon).toContain("après confirmation");
    for (const mot of ["exécuté", "envoyé", "appliqué", "retiré", "accordé"]) {
      expect(MOTS_DE_SCALINGO.role.brouillon).not.toContain(mot);
    }
  });

  it("ne promet aucune fraîcheur qu'elle n'a pas, et dit ce que chaque absence vaut", () => {
    // Given la table entière, aplatie en phrases.

    // Then aucune n'affirme que ce qui s'affiche vient d'une lecture faite maintenant.
    const fraicheurs = TOUTES.flatMap((phrase) =>
      AFFIRMATIONS_DE_FRAICHEUR.filter((interdite) => phrase.toLowerCase().includes(interdite)).map(
        (interdite) => `« ${interdite} » dans « ${phrase} »`,
      ),
    );
    expect(fraicheurs).toEqual([]);

    // Then la phrase de datation dit les deux choses qui décident : d'où vient ce qu'on
    // lit, et que la date est celle d'un constat. Sans elle, l'écran central du lot ne
    // dirait plus ce que vaut ce qu'on y lit.
    expect(MOTS_DE_SCALINGO.parc.datation).toContain("dernière collecte");
    expect(MOTS_DE_SCALINGO.parc.datation).toContain("dernier constat");

    // Then celle de l'absence ne prétend pas qu'aucune collecte n'a tourné : l'écran ne
    // lit que ce sur quoi une coupure se décide, et il ne sait pas distinguer un système
    // jamais collecté d'un système où plus rien ne vit. Elle dit donc laquelle des deux
    // ignorances est la sienne, plutôt que de trancher à la place de qui lit.
    expect(MOTS_DE_SCALINGO.parc.rienDeVivant).toContain("Aucun accès ni aucun compte vivant");
    expect(MOTS_DE_SCALINGO.parc.rienDeVivant).toContain("ne distingue pas");
    expect(MOTS_DE_SCALINGO.parc.rienDeVivant).toContain("ne dit rien du parc réel");
    expect(MOTS_DE_SCALINGO.parc.rienDeVivant).not.toContain("Aucune collecte n'a");

    // Then les trois phrases d'absence disent chacune qu'elles ne disent rien du réel :
    // une liste vide se lit sinon comme un parc vide, et un compte sans accès comme un
    // compte sans risque.
    expect(MOTS_DE_SCALINGO.parc.sansAcces).toContain("Aucun accès vivant");
    expect(MOTS_DE_SCALINGO.comptes.vide).toContain("Rien ne dit pour autant");
    expect(MOTS_DE_SCALINGO.comptes.vide).toContain("dernier constat");
    expect(MOTS_DE_SCALINGO.comptes.sansAcces).toContain("Le compte existe");
    expect(MOTS_DE_SCALINGO.comptes.sansAcces).toContain("dernier constat");

    // Then la marque de l'invitation dit l'attente et rien d'autre : la présenter comme
    // un accès en place ferait couper là où rien n'a encore été accordé.
    expect(MOTS_DE_SCALINGO.comptes.invitation).toContain("attente");
    for (const mot of ["accepté", "accordé", "actif", "en place"]) {
      expect(MOTS_DE_SCALINGO.comptes.invitation).not.toContain(mot);
    }

    // Then le refus opposé à une identité déclarée machine la nomme pour ce qu'elle est
    // et l'envoie là où elle se traite. La file des comptes isolés l'exclut par
    // construction, son couple de détenteurs n'étant pas nul des deux côtés : lui dire
    // qu'elle n'est rattachée à personne, puis l'y envoyer, serait faux deux fois.
    expect(MOTS_DE_SCALINGO.comptes.machine).toContain("compte de service");
    expect(MOTS_DE_SCALINGO.comptes.machine).toContain("comptes de service");
    expect(MOTS_DE_SCALINGO.comptes.machine).not.toContain("isolés");
    expect(MOTS_DE_SCALINGO.comptes.machine).not.toContain("rattaché à personne");
    expect(MOTS_DE_SCALINGO.comptes.machine).not.toBe(MOTS_DE_SCALINGO.comptes.isole);

    // And celui du compte que personne ne réclame continue, lui, d'y envoyer.
    expect(MOTS_DE_SCALINGO.comptes.isole).toContain("rattaché à personne");
    expect(MOTS_DE_SCALINGO.comptes.isole).toContain("comptes isolés");
  });

  it("n'offre en français que les rôles que le connecteur accepte, et n'en laisse aucun en anglais", () => {
    // Given le schéma de périmètre du connecteur, qui est ce qui validera la saisie.
    const scalingo = CONNECTEURS.find(({ contract }) => contract.key === "scalingo");

    if (!scalingo) {
      throw new Error("le registre devrait porter scalingo");
    }

    // Then l'écran est enregistré, donc l'adresse existe : sans cette déclaration, le
    // contrat n'a ni configuration ni fonctionnalité, et la page refuse l'adresse pendant
    // que l'écran Systèmes ne pose aucun lien.
    expect(ecranDe("scalingo")).toBeDefined();
    expect(aUnePage(scalingo.contract)).toBe(true);

    const lu = scopeAttendu(scalingo.contract.scopeSchema);

    if (lu.etat !== "lu") {
      throw new Error("le scope de scalingo devrait se lire");
    }

    const collaboration = lu.variantes.find(({ libelle }) => libelle === "nature = collaboration");
    const role = collaboration?.champs.find(({ nom }) => nom === "role");

    // Then les deux rôles que l'écran propose sont exactement ceux que le connecteur
    // admet. Un troisième proposé ici décrirait un droit que Scalingo ne sait pas poser,
    // et le refus n'arriverait qu'après le clic. L'ordre, lui, appartient à l'écran :
    // il propose du moindre pouvoir au plus grand.
    const admis = (role?.attendu ?? "").replace("l'une de : ", "").split(", ");
    expect([...admis].sort()).toEqual([...ROLES_DEMANDABLES].sort());
    expect(ROLES_DEMANDABLES).not.toContain("owner");

    // Then la propriété se dit quand même, parce que la collecte l'écrit : elle se lit
    // sur une ligne sans jamais se demander.
    expect(Object.keys(LIBELLE_ROLE_SCALINGO)).toEqual(["owner", "collaborator", "limited"]);

    // Then aucun mot français n'est égal à sa clé : c'est la seule chose qui empêche
    // « limited » d'arriver tel quel sous les yeux de qui décide d'une coupure.
    const bruts = Object.entries(LIBELLE_ROLE_SCALINGO).filter(([cle, mot]) => cle === mot);
    expect(bruts).toEqual([]);
    expect(libelleDuRole("limited")).toBe("Collaborateur limité");

    // Then un rôle que la table ne connaît pas se rend tel quel plutôt que de faire
    // tomber l'écran : le rôle est une chaîne libre que le connecteur choisit.
    expect(libelleDuRole("inconnu")).toBe("inconnu");

    // Given les deux phrases qui disent ce que chaque rôle ouvre.
    const variables = [MOTS_DE_SCALINGO.role.plein, MOTS_DE_SCALINGO.role.limite].filter((phrase) =>
      phrase.includes("variables d'environnement"),
    );

    // Then les deux la nomment, et une seule l'accorde : c'est cette différence-là que
    // le connecteur transforme en cran de risque, et deux phrases qui la gommeraient
    // rendraient le risque inexplicable.
    expect(variables).toHaveLength(2);
    expect(MOTS_DE_SCALINGO.role.plein).toContain("lit les variables d'environnement");
    expect(MOTS_DE_SCALINGO.role.limite).toContain("rien des variables d'environnement");

    // Then le rôle plein annonce l'échéance qu'un accès à risque élevé exige, faute de
    // quoi le refus n'arriverait qu'après la saisie.
    expect(MOTS_DE_SCALINGO.role.termeAide).toContain("risque élevé");
    expect(MOTS_DE_SCALINGO.role.termeAide).toContain("échéance");
  });
});

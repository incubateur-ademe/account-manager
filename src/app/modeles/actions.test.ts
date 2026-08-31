import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EtapeSaisie } from "@/lib/modele-plan-edition";

import { ajouterEtapeAuModele } from "./actions";

const recu = vi.hoisted(() => ({ saisies: [] as EtapeSaisie[] }));

vi.mock("@/lib/session", () => ({
  requireOperateur: () => Promise.resolve({ username: "operatrice.exemple" }),
}));

vi.mock("@/lib/modele-plan-edition", () => ({
  ajouterEtape: (_proprietaire: string, _moment: string, valeurs: EtapeSaisie) => {
    recu.saisies.push(valeurs);
    return Promise.resolve({ ok: true });
  },
}));

function formulaire(champs: Record<string, string>): FormData {
  const donnees = new FormData();
  donnees.set("proprietaire", "*incubateur");
  donnees.set("moment", "OFFBOARDING");
  donnees.set("titre", "Signer la décharge");
  donnees.set("critere", "La décharge signée est au dossier.");
  for (const [nom, valeur] of Object.entries(champs)) {
    donnees.set(nom, valeur);
  }
  return donnees;
}

beforeEach(() => {
  recu.saisies.length = 0;
});

/**
 * Un formulaire est ce qu'un navigateur veut bien poster, et il se trafique. Ce qui se
 * joue ici est le sens du doute : une valeur illisible ne doit jamais retirer un
 * contrôle que quelqu'un croit avoir posé.
 */
describe("les deux rôles, tels que le formulaire des modèles les exprime", () => {
  it("refuse un rôle illisible au lieu de retomber sur un défaut, et ne fabrique rien", async () => {
    // Given un formulaire dont le champ de l'acteur porte une valeur qui n'existe pas
    const acteurInconnu = await ajouterEtapeAuModele(
      null,
      formulaire({ acteur: "PORTEUR", controleur: "" }),
    );

    // Then l'écriture est refusée, et rien n'est parti vers la base : retomber sur
    // « à l'opérateur » ferait écrire une étape que personne n'a demandée, à la
    // différence du risque, dont le défaut ne retire aucune garantie.
    expect(acteurInconnu.erreur).toContain("Acteur inconnu");
    expect(recu.saisies).toHaveLength(0);

    // Given le même formulaire, mais dont c'est le contrôleur qui est illisible
    const controleurInconnu = await ajouterEtapeAuModele(
      null,
      formulaire({ acteur: "SUBJECT", controleur: "LE_CHEF" }),
    );

    // Then refus là aussi, et c'est le refus qui compte le plus des deux : retomber en
    // silence sur « personne » retirerait le second regard sur une étape sensible sans
    // que rien ne le dise, et l'étape se solderait ensuite d'un mot.
    expect(controleurInconnu.erreur).toContain("Contrôleur inconnu");
    expect(recu.saisies).toHaveLength(0);

    // When le formulaire dit ce qu'il faut
    const posee = await ajouterEtapeAuModele(
      null,
      formulaire({ acteur: "SUBJECT", controleur: "OPERATOR" }),
    );

    // Then les deux rôles arrivent tels quels à l'écriture
    expect(posee.erreur).toBeUndefined();
    expect(recu.saisies.at(-1)).toMatchObject({ acteur: "SUBJECT", controleur: "OPERATOR" });

    // When le champ du contrôleur est vide, ce que dit l'option « personne »
    const surParole = await ajouterEtapeAuModele(
      null,
      formulaire({ acteur: "SUBJECT", controleur: "" }),
    );

    // Then l'absence de contrôleur est un choix normal et non un refus : c'est le cas
    // de tout ce qui se croit sur parole, et l'écran l'offre en premier.
    expect(surParole.erreur).toBeUndefined();
    expect(recu.saisies.at(-1)).toMatchObject({ acteur: "SUBJECT", controleur: null });
  });
});

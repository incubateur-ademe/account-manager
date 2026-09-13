// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MODELE } from "@/app/modeles/redaction";

/**
 * L'écran importe ses actions serveur, qui tirent la session puis NextAuth, que rien
 * ne sait résoudre sous jsdom. La chaîne se coupe ici, et le double de l'ajout décide
 * de l'issue scénario par scénario : le refus d'une étape que l'incubateur n'admet pas
 * est un chemin prévu, pas un accident.
 */
const doubles = vi.hoisted(() => ({ ajouter: vi.fn(), modifier: vi.fn() }));

vi.mock("@/app/modeles/actions", () => ({
  ajouterEtapeAuModele: doubles.ajouter,
  modifierEtapeDuModele: doubles.modifier,
  retirerEtapeDuModele: () => Promise.resolve({}),
  basculerAutorisationDesStartups: () => Promise.resolve({}),
}));

const { Editeur } = await import("@/app/modeles/Editeur");

afterEach(cleanup);

function monterLeFormulaireDAjout() {
  render(<Editeur proprietaire="incubateur" moment="ONBOARDING" etapes={[]} />);

  return {
    acteur: screen.getByLabelText(/Qui fait cette étape/) as HTMLSelectElement,
    controleur: screen.getByLabelText(/Qui contrôle ce qui y sera déclaré/) as HTMLSelectElement,
    titre: screen.getByLabelText(/y a à faire/) as HTMLInputElement,
    critere: screen.getByLabelText(/est fait quand/) as HTMLInputElement,
    saisieLibelle: screen.getByLabelText(MODELE.champs.saisieLibelle, {
      exact: false,
    }) as HTMLInputElement,
    ajouter: screen.getByRole("button", { name: "Ajouter cette étape" }),
  };
}

function caseSansCetteValeur(): HTMLInputElement | null {
  return screen.queryByLabelText(/Sans cette valeur/) as HTMLInputElement | null;
}

describe("L'éditeur d'un modèle de plan", () => {
  it("dit le contrôle qu'un changement d'acteur vient de retirer, et se tait quand il n'en retire aucun", async () => {
    const utilisateur = userEvent.setup();
    const { acteur, controleur } = monterLeFormulaireDAjout();

    // Given une répartition que le serveur admet : un délégué au contrôle ne relit
    // que ce que fait la personne concernée.
    await utilisateur.selectOptions(acteur, "SUBJECT");
    await utilisateur.selectOptions(controleur, "DELEGATE");
    expect(controleur.value).toBe("DELEGATE");
    expect(screen.queryByText(/a été retiré/)).toBeNull();

    // When on confie l'étape à un opérateur, ce que ce contrôle ne peut plus relire.
    await utilisateur.selectOptions(acteur, "OPERATOR");

    // Then le contrôle est retiré, et le retrait se dit en nommant les deux rôles :
    // sans cette phrase, l'étape s'enregistre sans le regard qu'on croyait lui poser.
    expect(controleur.value).toBe("");
    expect(screen.getByText(MODELE.champs.controleurRetire("DELEGATE", "OPERATOR"))).not.toBeNull();

    // When on choisit un autre contrôle, la phrase a fait son office.
    await utilisateur.selectOptions(controleur, "OPERATOR");
    expect(controleur.value).toBe("OPERATOR");
    expect(screen.queryByText(/a été retiré/)).toBeNull();

    // When l'acteur change encore, mais sur une paire qui reste admise : un opérateur
    // relit n'importe qui.
    await utilisateur.selectOptions(acteur, "SUBJECT");

    // Then rien n'est retiré et rien n'est annoncé. Une phrase qui paraîtrait ici
    // ferait douter d'un réglage que personne n'a touché.
    expect(controleur.value).toBe("OPERATOR");
    expect(screen.queryByText(/a été retiré/)).toBeNull();
  });

  it("n'offre la case « sans cette valeur » qu'à partir d'un libellé, et garde le choix déjà fait", async () => {
    const utilisateur = userEvent.setup();
    const { saisieLibelle } = monterLeFormulaireDAjout();

    // Given aucun libellé : le serveur ne garderait aucune saisie, donc la case ne
    // réglerait rien. Une phrase prend sa place.
    expect(caseSansCetteValeur()).toBeNull();
    expect(screen.getByText(MODELE.champs.saisieSansValeur)).not.toBeNull();

    // When une valeur est demandée.
    await utilisateur.type(saisieLibelle, "Date de signature");

    // Then la case paraît, exigeante par défaut.
    const exigee = caseSansCetteValeur();
    expect(exigee).not.toBeNull();
    expect(exigee?.checked).toBe(true);
    expect(screen.queryByText(MODELE.champs.saisieSansValeur)).toBeNull();

    // When on desserre l'exigence, puis qu'on efface le libellé et qu'on le retape.
    await utilisateur.click(exigee as HTMLInputElement);
    expect(caseSansCetteValeur()?.checked).toBe(false);

    await utilisateur.clear(saisieLibelle);
    expect(caseSansCetteValeur()).toBeNull();
    expect(screen.getByText(MODELE.champs.saisieSansValeur)).not.toBeNull();

    await utilisateur.type(saisieLibelle, "Date de départ");

    // Then le choix déjà fait a survécu : c'est exactement le geste d'un réglage qui
    // ne prend pas que la case revenue cochée imitait.
    expect(caseSansCetteValeur()?.checked).toBe(false);
  });

  it("vide le formulaire d'ajout au succès, et conserve tout ce qui a été écrit au refus", async () => {
    const utilisateur = userEvent.setup();
    const champs = monterLeFormulaireDAjout();

    // Given une étape entièrement renseignée, contrôle et valeur demandée compris.
    await utilisateur.type(champs.titre, "Ouvrir le compte de messagerie");
    await utilisateur.type(champs.critere, "La boîte reçoit un premier message");
    await utilisateur.selectOptions(champs.acteur, "SUBJECT");
    await utilisateur.selectOptions(champs.controleur, "DELEGATE");
    await utilisateur.type(champs.saisieLibelle, "Adresse retenue");

    // When le serveur refuse, ce que fait l'incubateur qui n'admet pas cette étape.
    doubles.ajouter.mockResolvedValueOnce({
      erreur: "Ce modèle n'admet pas d'étape déclarée ici.",
    });
    await utilisateur.click(champs.ajouter);

    // Then le refus se lit, et rien de ce qui vient d'être écrit n'est perdu : un
    // formulaire vidé par un refus ferait tout retaper.
    expect(await screen.findByText("Ce modèle n'admet pas d'étape déclarée ici.")).not.toBeNull();
    expect(champs.titre.value).toBe("Ouvrir le compte de messagerie");
    expect(champs.critere.value).toBe("La boîte reçoit un premier message");
    expect(champs.saisieLibelle.value).toBe("Adresse retenue");
    // La case ne se rend que sur un libellé tenu par l'état : sa présence dit que le
    // refus n'a rien remis à zéro, là où les valeurs relues dans le DOM ne diraient
    // que ce que React vient d'y réécrire.
    expect(caseSansCetteValeur()).not.toBeNull();

    // Then les listes déroulantes tiennent aussi, et elles se lisent ici dans le DOM
    // plutôt que dans l'état. React remet un formulaire à zéro quand son action rend la
    // main, et c'est son comportement documenté : les champs contrôlés s'en relèvent au
    // commit suivant, mais rien ne le garantit par écrit pour une liste. Or un
    // `FormData` se lit dans le DOM : si une liste y retombait sur sa première option,
    // corriger sa saisie après ce refus et renvoyer expédierait un rôle que personne
    // n'a choisi, sans que rien ne le dise.
    const apresRefus = Object.fromEntries(
      new FormData(champs.titre.closest("form") as HTMLFormElement),
    );
    expect(apresRefus).toMatchObject({ acteur: "SUBJECT", controleur: "DELEGATE" });

    // When la même déclaration est acceptée.
    doubles.ajouter.mockResolvedValueOnce({});
    await utilisateur.click(champs.ajouter);

    // Then tout revient à neuf : conservé rempli, le formulaire ferait rejouer la même
    // déclaration au clic suivant, que l'unicité de la clé refuserait sans que la
    // raison saute aux yeux.
    await vi.waitFor(() => {
      expect(champs.titre.value).toBe("");
    });
    expect(champs.critere.value).toBe("");
    expect(champs.saisieLibelle.value).toBe("");
    expect(screen.getByText(MODELE.champs.saisieSansValeur)).not.toBeNull();
  });

  it("porte jusqu'au serveur exactement ce qui a été saisi, sous les noms que l'action lit", async () => {
    // Given un formulaire d'ajout entièrement rempli, listes déroulantes comprises.
    const { acteur, controleur, titre, critere, saisieLibelle } = monterLeFormulaireDAjout();
    await userEvent.type(titre, "Ouvrir le compte de messagerie");
    await userEvent.type(critere, "La boîte répond");
    await userEvent.selectOptions(acteur, "SUBJECT");
    await userEvent.selectOptions(controleur, "OPERATOR");
    await userEvent.type(saisieLibelle, "Date d'ouverture");

    // When on lit ce que la soumission emporterait, c'est-à-dire le DOM et non l'état.
    // C'est la seule façon de voir ce que l'action recevra : `lireEtape` construit son
    // étape depuis le `FormData`, et un champ mal nommé lui rend une valeur vide sans
    // que rien ne proteste.
    const formulaire = titre.closest("form");
    const porte = Object.fromEntries(new FormData(formulaire as HTMLFormElement));

    // Then chaque nom est celui que l'action serveur lit, et chaque valeur est celle
    // qui a été choisie. La case, elle, porte « oui » : l'action compare à cette
    // chaîne, et une case retombée sur le `on` par défaut du HTML ferait qu'aucune
    // valeur demandée ne serait plus jamais exigée, sans un mot.
    expect(porte).toMatchObject({
      proprietaire: "incubateur",
      moment: "ONBOARDING",
      titre: "Ouvrir le compte de messagerie",
      critere: "La boîte répond",
      acteur: "SUBJECT",
      controleur: "OPERATOR",
      saisieLibelle: "Date d'ouverture",
      saisieObligatoire: "oui",
    });

    // Then une case décochée ne porte rien du tout, plutôt qu'une valeur fausse : c'est
    // ainsi que le HTML dit non, et l'action lit l'absence.
    await userEvent.click(caseSansCetteValeur() as HTMLInputElement);
    expect(Object.fromEntries(new FormData(formulaire as HTMLFormElement))).not.toHaveProperty(
      "saisieObligatoire",
    );
  });

  it("ne prend pas une espace pour un libellé", async () => {
    // Given un libellé fait d'une seule espace. Le serveur le rejette, `texte()` le
    // passant par `trim()` avant de décider qu'aucune valeur n'est demandée.
    const { saisieLibelle } = monterLeFormulaireDAjout();
    await userEvent.type(saisieLibelle, " ");

    // Then l'écran dit la même chose que le serveur : aucune valeur n'est attendue,
    // donc la case ne paraît pas. Sans ce `trim()`, l'écran offrirait un réglage que
    // l'enregistrement jetterait, ce qui est très exactement le défaut que cet écran
    // vient de corriger.
    expect(caseSansCetteValeur()).toBeNull();
    expect(screen.getByText(MODELE.champs.saisieSansValeur)).toBeDefined();
  });

  it("ne vide jamais le formulaire de modification, même quand l'enregistrement réussit", async () => {
    // Given une étape déjà déclarée, dont le dépliant de modification porte ses valeurs.
    // Ce formulaire partage ses champs avec celui d'ajout, mais pas son sort : l'ajout se
    // vide au succès pour ne pas rejouer la même déclaration au clic suivant, la
    // modification ne le doit jamais. Un copier-coller du vidage d'un formulaire à
    // l'autre montrerait une étape vide là où elle vient d'être enregistrée, et c'est
    // très exactement le geste qu'un lecteur pressé ferait.
    doubles.modifier.mockResolvedValue({});
    render(
      <Editeur
        proprietaire="incubateur"
        moment="ONBOARDING"
        etapes={[
          {
            id: "etp-1",
            titre: "Signer la charte",
            critere: "La charte est signée",
            marcheASuivre: null,
            lien: null,
            risque: "LOW",
            acteur: "SUBJECT",
            controleur: "OPERATOR",
            saisie: null,
            saisieIllisible: false,
          },
        ]}
      />,
    );

    const titre = screen.getByDisplayValue("Signer la charte") as HTMLInputElement;

    // When on enregistre sans rien changer, et que le serveur accepte
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    // Then tout est encore là. Le titre d'abord, qui se verrait tout de suite.
    expect(doubles.modifier).toHaveBeenCalledTimes(1);
    expect(titre.value).toBe("Signer la charte");

    // Then et l'identifiant que l'action lit pour savoir quelle étape réécrire : sans
    // lui, l'enregistrement suivant répondrait « Étape inconnue ».
    const porte = Object.fromEntries(new FormData(titre.closest("form") as HTMLFormElement));
    expect(porte).toMatchObject({ etapeId: "etp-1", titre: "Signer la charte" });
  });
});

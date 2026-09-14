// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EtapeAffichee } from "@/app/modeles/lecture";
import { MODELE } from "@/app/modeles/redaction";
import { LIBELLE_ACTEUR } from "@/core/libelle-dossier";
import type { TemplateKind } from "@/generated/prisma/enums";

/**
 * L'écran importe ses actions serveur, qui tirent la session puis NextAuth, que rien ne
 * sait résoudre sous jsdom. La chaîne se coupe ici. Aucun scénario n'envoie de
 * formulaire : ce qui est en jeu est ce que la liste et la bascule rendent, et ce
 * qu'elles porteraient au serveur si on cliquait.
 */
vi.mock("@/app/modeles/actions", () => ({
  ajouterEtapeAuModele: () => Promise.resolve({}),
  modifierEtapeDuModele: () => Promise.resolve({}),
  retirerEtapeDuModele: () => Promise.resolve({}),
  basculerAutorisationDesStartups: () => Promise.resolve({}),
}));

const { BasculeAutorisation, Editeur } = await import("@/app/modeles/Editeur");

afterEach(cleanup);

function etape(
  defaut: Partial<EtapeAffichee> & Pick<EtapeAffichee, "id" | "titre">,
): EtapeAffichee {
  return {
    critere: "Le geste est constaté",
    marcheASuivre: null,
    lien: null,
    risque: "LOW",
    acteur: "OPERATOR",
    controleur: null,
    saisie: null,
    saisieIllisible: false,
    ...defaut,
  };
}

/** Le badge qui nomme l'acteur, quel que soit celui qu'on lui a donné. */
const BADGE_ACTEUR = new RegExp(`^à (${Object.values(LIBELLE_ACTEUR).join("|")})$`, "u");

function lignes() {
  return screen.getAllByRole("listitem");
}

function monterLaBascule(etat: { moment: TemplateKind; autorise: boolean; neutralisees: number }) {
  cleanup();
  render(<BasculeAutorisation {...etat} />);

  const bouton = screen.getByRole("button");
  return {
    bouton,
    porte: Object.fromEntries(new FormData(bouton.closest("form") as HTMLFormElement)),
  };
}

describe("La liste des étapes d'un modèle", () => {
  it("sert à chaque étape les badges qu'elle mérite, son critère et son alerte de saisie illisible", () => {
    // Given trois étapes déclarées qui n'ont rien en commun : une étape à risque
    // confiée à la personne concernée et relue, une étape ordinaire d'opérateur dont
    // la valeur n'est que demandée, et une étape confiée à un délégué dont la saisie
    // est illisible en base.
    render(
      <Editeur
        proprietaire="incubateur"
        moment="OFFBOARDING"
        etapes={[
          etape({
            id: "etp-badge",
            titre: "Restituer le badge",
            critere: "Le badge est rendu à l'accueil",
            risque: "HIGH",
            acteur: "SUBJECT",
            controleur: "OPERATOR",
            saisie: { libelle: "Date de restitution", obligatoire: true },
          }),
          etape({
            id: "etp-charte",
            titre: "Archiver la charte signée",
            critere: "La charte est classée",
            saisie: { libelle: "Date de signature", obligatoire: false },
          }),
          etape({
            id: "etp-tour",
            titre: "Faire le tour des bureaux",
            critere: "Toute l'équipe a été prévenue",
            risque: "MEDIUM",
            acteur: "DELEGATE",
            saisieIllisible: true,
          }),
        ]}
      />,
    );

    // Then les trois étapes sont numérotées dans l'ordre où le modèle les donne. Une
    // liste non ordonnée ferait perdre le rang, qui est le seul moyen de désigner une
    // étape à l'oral quand deux titres se ressemblent.
    const [risquee, ordinaire, deleguee] = lignes();
    expect(lignes()).toHaveLength(3);
    expect(risquee?.parentElement?.tagName).toBe("OL");
    expect(lignes().map((ligne) => within(ligne).getByRole("strong").textContent)).toEqual([
      "Restituer le badge",
      "Archiver la charte signée",
      "Faire le tour des bureaux",
    ]);

    // Then l'étape à risque porte ses quatre badges, et chacun dit une chose que le
    // titre ne dit pas : le risque, l'exigence de la valeur, le rôle attendu puisqu'il
    // n'est pas celui d'un opérateur, et le regard qui la relira.
    const premiere = within(risquee as HTMLElement);
    expect(premiere.getByText("risque élevé")).not.toBeNull();
    expect(premiere.getByText("valeur exigée")).not.toBeNull();
    expect(premiere.getByText(`à ${LIBELLE_ACTEUR.SUBJECT}`)).not.toBeNull();
    expect(premiere.getByText(`relue par ${LIBELLE_ACTEUR.OPERATOR}`)).not.toBeNull();
    expect(premiere.getByText("C'est fait quand : Le badge est rendu à l'accueil")).not.toBeNull();
    expect(premiere.getByText("Modifier « Restituer le badge »")).not.toBeNull();

    // Then l'étape ordinaire ne porte que le badge de sa valeur, et « demandée » plutôt
    // qu'« exigée » : les deux mots décident si cocher sans rien saisir sera possible.
    // Aucun badge d'acteur non plus, l'opérateur étant le cas par défaut : un badge qui
    // paraîtrait pour tout le monde ne signalerait plus rien.
    const seconde = within(ordinaire as HTMLElement);
    expect(seconde.getByText("valeur demandée")).not.toBeNull();
    expect(seconde.queryByText("valeur exigée")).toBeNull();
    expect(seconde.queryByText("risque élevé")).toBeNull();
    expect(seconde.queryByText(BADGE_ACTEUR)).toBeNull();
    expect(seconde.queryByText(/^relue par /u)).toBeNull();
    expect(seconde.getByText("C'est fait quand : La charte est classée")).not.toBeNull();

    // Then l'étape déléguée nomme son acteur, ne porte aucun badge de valeur faute de
    // saisie, et ne prend pas « sensible » pour « élevé ».
    const troisieme = within(deleguee as HTMLElement);
    expect(troisieme.getByText(`à ${LIBELLE_ACTEUR.DELEGATE}`)).not.toBeNull();
    expect(troisieme.queryByText("risque élevé")).toBeNull();
    expect(troisieme.queryByText("valeur exigée")).toBeNull();
    expect(troisieme.queryByText("valeur demandée")).toBeNull();

    // Then l'alerte de saisie illisible paraît sous cette étape-là, et sous elle seule.
    // C'est depuis cette ligne que la réparation se fait : posée ailleurs, ou posée
    // partout, elle enverrait réécrire une étape qui n'a rien.
    expect(troisieme.getByText(MODELE.saisieIllisible)).not.toBeNull();
    expect(screen.getAllByText(MODELE.saisieIllisible)).toHaveLength(1);

    // When le modèle ne déclare plus rien.
    cleanup();
    render(<Editeur proprietaire="incubateur" moment="OFFBOARDING" etapes={[]} />);

    // Then la liste disparaît au profit d'une phrase qui dit la conséquence. Une liste
    // vide sans un mot laisserait croire à un écran qui n'a pas fini de charger.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/Aucune étape déclarée pour ce moment/u)).not.toBeNull();
  });

  it("donne à chaque dépliant l'étape dont il porte le nom, et pas celle d'à côté", () => {
    // Given trois étapes dans la liste. Chacune ouvre un dépliant qui la réécrit et un
    // bouton qui la retire, et les deux ne connaissent leur cible que par un champ
    // caché. Ce champ est le seul lien entre ce qu'on lit et ce qu'on touche.
    render(
      <Editeur
        proprietaire="incubateur"
        moment="OFFBOARDING"
        etapes={[
          etape({ id: "etp-un", titre: "Restituer le badge" }),
          etape({ id: "etp-deux", titre: "Rendre le poste" }),
          etape({ id: "etp-trois", titre: "Signer la décharge" }),
        ]}
      />,
    );

    // When on relève, pour chaque ligne, l'identifiant que ses formulaires emportent
    const cibles = screen
      .getAllByDisplayValue(/^etp-/u)
      .map((champ) => (champ as HTMLInputElement).value);

    // Then chaque étape est visée par les siens, et par personne d'autre. Un dépliant
    // câblé sur la première étape de la liste afficherait le bon titre, le bon critère
    // et les bons badges, tout en réécrivant et en supprimant une autre étape : aucune
    // lecture de l'écran ne le verrait, et le geste serait irréversible.
    // Un seul champ par ligne : le retrait ne rend le sien qu'une fois la confirmation
    // demandée, ce qui est le second clic que cet écran exige avant de supprimer.
    expect(cibles).toEqual(["etp-un", "etp-deux", "etp-trois"]);
  });
});

describe("La bascule de l'autorisation des startups", () => {
  it("dit l'état de l'autorisation, compte ce que refermer neutralise, et porte l'état inverse", () => {
    // Given l'autorisation ouverte sur le départ, avec des étapes de startup déclarées.
    const ouverte = monterLaBascule({ moment: "OFFBOARDING", autorise: true, neutralisees: 3 });

    // Then le badge dit que les startups complètent, et la phrase dit ce que leurs
    // étapes deviennent plutôt que d'en compter : rien n'est neutralisé tant que
    // l'autorisation est ouverte, et servir ce compte ici alarmerait pour rien.
    expect(screen.getByText("Les startups peuvent compléter")).not.toBeNull();
    expect(
      screen.getByText(/Les étapes déclarées par les modèles des startups entrent dans les plans/u),
    ).not.toBeNull();
    expect(screen.queryByText(MODELE.neutralisees(3, "par des startups"))).toBeNull();
    expect(screen.queryByText(/ne neutralise rien aujourd'hui/u)).toBeNull();

    // Then le bouton propose de refermer, et le formulaire porte l'état visé et non
    // l'état courant : une bascule qui renverrait ce qu'elle affiche déjà ne
    // basculerait rien, et le moment l'accompagne pour désigner le modèle à réécrire.
    expect(ouverte.bouton.textContent).toBe("Refermer l'autorisation");
    expect(ouverte.porte).toEqual({ moment: "OFFBOARDING", autorise: "non" });

    // When l'autorisation est refermée, et qu'une seule étape de startup existe.
    const uneSeule = monterLaBascule({ moment: "ONBOARDING", autorise: false, neutralisees: 1 });

    // Then le badge et le bouton s'inversent, et l'écran sert l'entrée de la table qui
    // parle des startups. L'entrée voisine, « ici », dirait que l'incubateur neutralise
    // ses propres étapes, ce qui est faux et alarmant sur cet écran-là.
    expect(screen.getByText("Les startups ne complètent pas")).not.toBeNull();
    expect(screen.getByText(MODELE.neutralisees(1, "par des startups"))).not.toBeNull();
    expect(screen.queryByText(MODELE.neutralisees(1, "ici"))).toBeNull();
    expect(uneSeule.bouton.textContent).toBe("Ouvrir l'autorisation aux startups");
    expect(uneSeule.porte).toEqual({ moment: "ONBOARDING", autorise: "oui" });

    // When plusieurs étapes sont neutralisées.
    monterLaBascule({ moment: "ONBOARDING", autorise: false, neutralisees: 4 });

    // Then le compte suit, accord compris, et la phrase du cas zéro ne paraît pas : la
    // servir ici affirmerait que la fermeture est sans effet alors qu'elle en a quatre.
    expect(screen.getByText(MODELE.neutralisees(4, "par des startups"))).not.toBeNull();
    expect(screen.queryByText(/ne neutralise rien aujourd'hui/u)).toBeNull();

    // When l'autorisation est refermée alors qu'aucune startup n'a rien déclaré.
    monterLaBascule({ moment: "ONBOARDING", autorise: false, neutralisees: 0 });

    // Then la phrase du cas zéro prend la place du compte. « 0 étape déclarée par des
    // startups est neutralisée » se lirait comme un décompte et ferait chercher ce qui
    // vient d'être cassé.
    expect(screen.getByText(/ne neutralise rien aujourd'hui/u)).not.toBeNull();
    expect(screen.queryByText(MODELE.neutralisees(0, "par des startups"))).toBeNull();
  });
});

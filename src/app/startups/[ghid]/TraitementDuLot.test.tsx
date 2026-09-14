// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import type { CandidatDeLot } from "@/core/startups";
import { LIBELLE_ECARTE } from "@/core/startups";

// Le composant tire ses actions serveur, qui remontent jusqu'à `next-auth` : cette
// chaîne ne se résout pas sous jsdom, et le double la coupe à sa racine.
vi.mock("./actions", () => ({
  declarerHorsIncubateurEnLot: vi.fn(() => Promise.resolve(null)),
  ouvrirDepartsEnLot: vi.fn(() => Promise.resolve(null)),
  cloreConstatsEnLot: vi.fn(() => Promise.resolve(null)),
}));

const { cloreConstatsEnLot, declarerHorsIncubateurEnLot, ouvrirDepartsEnLot } = await import(
  "./actions"
);
const { LOT } = await import("./redaction-lot");
const { TraitementDuLot } = await import("./TraitementDuLot");

const CAMILLE: CandidatDeLot = {
  username: "camille.dubreuil",
  fullname: "Camille Dubreuil",
  statut: "A_TRAITER",
  proposeParDefaut: true,
  ecarte: null,
  autresStartupsVivantes: [],
  constatOuvert: "camille.dubreuil:INACTIVE_STARTUP",
};

const NADIA: CandidatDeLot = {
  username: "nadia.fontaine",
  fullname: "Nadia Fontaine",
  statut: "ACTIF",
  proposeParDefaut: true,
  ecarte: null,
  autresStartupsVivantes: [],
  constatOuvert: null,
};

const YANN: CandidatDeLot = {
  username: "yann.peltier",
  fullname: "Yann Peltier",
  statut: "ACTIF",
  proposeParDefaut: false,
  ecarte: "AUTRE_STARTUP_VIVANTE",
  autresStartupsVivantes: ["Balade des friches"],
  constatOuvert: null,
};

const GHID = "suivi-des-friches";

function monter(candidats: readonly CandidatDeLot[] = [CAMILLE, NADIA, YANN]) {
  render(<TraitementDuLot ghid={GHID} nomStartup="Suivi des friches" candidats={candidats} />);
}

const caseDe = (fullname: string) =>
  screen.getByRole("checkbox", { name: `Traiter ${fullname}` }) as HTMLInputElement;
const boutonSortie = () =>
  screen.getByRole("button", { name: LOT.sortie.bouton }) as HTMLButtonElement;
const boutonDepart = () =>
  screen.getByRole("button", { name: LOT.depart.bouton }) as HTMLButtonElement;
/** Le libellé porte le compte : le chercher par lui, c'est épingler ce compte. */
const boutonCloture = (avecConstat: number) =>
  screen.getByRole("button", { name: LOT.cloture.bouton(avecConstat) }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TraitementDuLot", () => {
  it("annonce le compte de la sélection, l'accorde, et rend les trois gestes inertes quand elle se vide", async () => {
    // Given deux personnes proposées d'avance, dont une seule porte un constat ouvert,
    // et une troisième écartée de la présélection.
    const utilisateur = userEvent.setup();
    monter();

    // Then la présélection est celle que la répartition a décidée, et le geste de
    // clôture ne compte que les constats des lignes cochées.
    expect(caseDe("Camille Dubreuil").checked).toBe(true);
    expect(caseDe("Nadia Fontaine").checked).toBe(true);
    expect(caseDe("Yann Peltier").checked).toBe(false);
    expect(screen.getByText("2 personnes sélectionnées.")).toBeDefined();
    expect(boutonSortie().disabled).toBe(false);
    expect(boutonDepart().disabled).toBe(false);
    expect(boutonCloture(1).disabled).toBe(false);

    // When on décoche la personne sans constat.
    await utilisateur.click(caseDe("Nadia Fontaine"));

    // Then le compte descend et s'accorde au singulier, et la clôture garde son constat.
    expect(caseDe("Nadia Fontaine").checked).toBe(false);
    expect(screen.getByText("1 personne sélectionnée.")).toBeDefined();
    expect(boutonCloture(1).disabled).toBe(false);

    // When on décoche la dernière ligne restante.
    await utilisateur.click(caseDe("Camille Dubreuil"));

    // Then plus rien n'est soumissible : un geste de lot sur une sélection vide
    // écrirait une trace nominative au journal sans personne à traiter.
    expect(screen.getByText("0 personne sélectionnée.")).toBeDefined();
    expect(boutonSortie().disabled).toBe(true);
    expect(boutonDepart().disabled).toBe(true);
    expect(boutonCloture(0).disabled).toBe(true);

    await utilisateur.click(boutonSortie());
    await utilisateur.click(boutonDepart());
    await utilisateur.click(boutonCloture(0));
    expect(declarerHorsIncubateurEnLot).not.toHaveBeenCalled();
    expect(ouvrirDepartsEnLot).not.toHaveBeenCalled();
    expect(cloreConstatsEnLot).not.toHaveBeenCalled();

    // When on coche à la main la ligne que la présélection avait écartée.
    await utilisateur.click(caseDe("Yann Peltier"));

    // Then les deux gestes de sortie redeviennent possibles, mais pas la clôture :
    // elle porte sur des constats, et cette personne n'en a aucun d'ouvert.
    expect(screen.getByText("1 personne sélectionnée.")).toBeDefined();
    expect(boutonSortie().disabled).toBe(false);
    expect(boutonDepart().disabled).toBe(false);
    expect(boutonCloture(0).disabled).toBe(true);
  });

  it("dit ce qui retient une ligne non proposée, et donne à chaque case le nom que l'action attend", () => {
    // Given une personne écartée parce qu'elle travaille encore ailleurs.
    monter();
    const ligneDeYann = caseDe("Yann Peltier").closest("tr");
    const ligneDeCamille = caseDe("Camille Dubreuil").closest("tr");
    expect(ligneDeYann).not.toBeNull();
    expect(ligneDeCamille).not.toBeNull();

    // Then sa ligne nomme la raison ET la startup qui la retient : la raison seule
    // obligerait à quitter l'écran pour savoir quoi vérifier avant de la cocher.
    expect(
      within(ligneDeYann as HTMLElement).getByText(
        `${LIBELLE_ECARTE.AUTRE_STARTUP_VIVANTE} : Balade des friches`,
      ),
    ).toBeDefined();

    // And une ligne proposée d'avance ne retient rien, et montre son constat ouvert.
    expect(within(ligneDeCamille as HTMLElement).getByText("rien")).toBeDefined();
    expect(
      within(ligneDeCamille as HTMLElement).getByText(LIBELLE_CONSTAT.INACTIVE_STARTUP.titre),
    ).toBeDefined();
    expect(within(ligneDeYann as HTMLElement).getByText("aucun")).toBeDefined();

    // And chaque case porte le pivot d'identité sous le nom que la FormData attend :
    // un champ mal nommé soumettrait un lot vide sans que l'écran le signale.
    expect(caseDe("Yann Peltier").name).toBe("username");
    expect(caseDe("Yann Peltier").value).toBe("yann.peltier");
    expect(caseDe("Camille Dubreuil").value).toBe("camille.dubreuil");
  });

  it("envoie le geste demandé, et rien que lui, avec ce que la sélection a coché", async () => {
    // Given deux personnes cochées et une raison saisie. Trois boutons partagent un
    // seul formulaire, et chacun porte sa propre action : c'est le seul endroit où l'on
    // voit lequel part vraiment.
    monter();
    await userEvent.type(
      screen.getByLabelText(LOT.raison.label, { exact: false }),
      "convention finie",
    );

    // When on clique « déclarer hors incubateur »
    await userEvent.click(boutonSortie());

    // Then c'est cette action-là qui part, et elle seule. Sans cette assertion, deux
    // boutons qui échangeraient leur action resteraient verts, et l'écran ouvrirait des
    // départs là où on voulait seulement déclarer une sortie.
    expect(declarerHorsIncubateurEnLot).toHaveBeenCalledTimes(1);
    expect(ouvrirDepartsEnLot).not.toHaveBeenCalled();
    expect(cloreConstatsEnLot).not.toHaveBeenCalled();

    // Then et elle reçoit ce que l'action lit vraiment : le pivot d'identité de chaque
    // ligne cochée, la startup et la raison, sous les noms que `lireEntree` attend. Un
    // champ renommé rendrait « Startup introuvable » sur les trois gestes sans que rien
    // ici ne proteste.
    const porte = vi.mocked(declarerHorsIncubateurEnLot).mock.calls[0]?.[1] as FormData;
    expect(porte.getAll("username")).toEqual([CAMILLE.username, NADIA.username]);
    expect(porte.get("startup")).toBe(GHID);
    expect(porte.get("raison")).toBe("convention finie");
  });
});

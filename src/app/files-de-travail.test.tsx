// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LigneCompteIsole } from "@/app/comptes-isoles/FileDesComptesIsoles";
import type { LigneConstat } from "@/app/constats/FileDesConstats";
import { REVUE_PAR_DEFAUT } from "@/core/compte-de-service";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";

/**
 * Les deux files tirent leurs actions serveur, qui remontent jusqu'à `next-auth` :
 * cette chaîne ne se résout pas sous jsdom, et les doubles la coupent à sa racine.
 * La file des constats monte en plus le formulaire d'ouverture d'un dossier, dont
 * les actions vivent ailleurs : elles se doublent aussi, sans quoi le module entier
 * refuse de se charger.
 */
const doubles = vi.hoisted(() => ({
  rattacher: vi.fn(),
  creer: vi.fn(),
  declarer: vi.fn(),
  clore: vi.fn(),
  tolerer: vi.fn(),
  lever: vi.fn(),
}));

vi.mock("@/app/comptes-isoles/actions", () => ({ rattacherIdentite: doubles.rattacher }));
vi.mock("@/app/comptes-isoles/creer", () => ({
  creerFichePourCompte: doubles.creer,
  declarerCompteDeServicePourCompte: doubles.declarer,
}));
vi.mock("@/app/constats/actions", () => ({
  cloreConstat: doubles.clore,
  tolererConstat: doubles.tolerer,
  leverDerogation: doubles.lever,
}));
vi.mock("@/app/dossiers/actions", () => ({
  ouvrirArrivee: vi.fn(() => Promise.resolve(null)),
  ouvrirDepart: vi.fn(() => Promise.resolve(null)),
}));

/**
 * Le stockage local, que ni jsdom ni Node ne donnent ici.
 *
 * Node 26 déclare `localStorage` en global et le laisse vide sans son fichier
 * d'appoint, si bien qu'il masque celui de jsdom : `window.localStorage` vaut alors
 * `undefined`, et le mode d'aide tombe dès qu'une infobulle se rend. Ce n'est pas un
 * défaut du produit, c'est le navigateur qui manque.
 */
function poserLeStockageLocal() {
  if ((globalThis as { localStorage?: unknown }).localStorage !== undefined) {
    return;
  }

  const memoire = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (cle: string) => memoire.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => {
        memoire.set(cle, String(valeur));
      },
      removeItem: (cle: string) => {
        memoire.delete(cle);
      },
      clear: () => {
        memoire.clear();
      },
      key: () => null,
      length: 0,
    },
  });
}

poserLeStockageLocal();

/**
 * Le thème du système de design, qu'aucune coque ne pose ici.
 *
 * Le champ de saisie à liste passe par le pont MUI du DSFR, qui refuse de se rendre
 * tant que le thème clair ou sombre n'a pas été tranché. Seule cette amorce-là est
 * appelée, et non le démarrage complet : celui-ci charge le JS du DSFR et écrase
 * `window.dsfr`, c'est-à-dire la porte des modales que ce fichier tient lui-même.
 */
const { startClientSideIsDarkLogic } = await import("@codegouvfr/react-dsfr/useIsDark/client");

startClientSideIsDarkLogic({
  colorSchemeExplicitlyProvidedAsParameter: "light",
  doPersistDarkModePreferenceWithCookie: false,
  doCheckNonce: false,
  trustedTypesPolicyName: "react-dsfr",
  registerEffectAction: (action) => {
    action();
  },
});

const { FileDesComptesIsoles } = await import("@/app/comptes-isoles/FileDesComptesIsoles");
const { FileDesConstats } = await import("@/app/constats/FileDesConstats");

/**
 * Ce que le JS du système de design ferait, et que jsdom ne fera jamais.
 *
 * Une modale du DSFR s'ouvre et se ferme hors de React : son script bascule
 * l'attribut et émet `dsfr.disclose` ou `dsfr.conceal` sur le `dialog`, et c'est cet
 * évènement que `useCleDOuverture` écoute pour remonter le contenu. Sans ce relais,
 * une réouverture ne se distingue pas d'une modale jamais fermée, et le garde-fou
 * qu'on vient épingler ne pourrait pas se voir. `modale.close` passant par
 * `window.dsfr`, la même porte sert aux deux sens.
 */
function poserLeRuntimeDuSystemeDeDesign() {
  const dsfr = (element: HTMLElement | null) => ({
    modal: {
      disclose: () => {
        element?.setAttribute("open", "");
        element?.dispatchEvent(new Event("dsfr.disclose"));
      },
      conceal: () => {
        element?.removeAttribute("open");
        element?.dispatchEvent(new Event("dsfr.conceal"));
      },
    },
  });
  (window as unknown as { dsfr: typeof dsfr }).dsfr = dsfr;
}

function modaleDe(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`La modale ${id} n'est pas montée.`);
  }
  return element;
}

function ouvrir(id: string): void {
  act(() => {
    modaleDe(id).setAttribute("open", "");
    modaleDe(id).dispatchEvent(new Event("dsfr.disclose"));
  });
}

function fermer(id: string): void {
  act(() => {
    modaleDe(id).removeAttribute("open");
    modaleDe(id).dispatchEvent(new Event("dsfr.conceal"));
  });
}

const MODALE_RATTACHEMENT = "traiter-compte-isole";
const MODALE_CLOTURE = "clore-constat";
const MODALE_TOLERANCE = "tolerer-constat";

const ORPHELIN: LigneCompteIsole = {
  id: "id-marceau",
  provider: "github",
  handle: "m-marceau",
  tolere: null,
  ressemblance: false,
  propositions: [],
  acces: [],
  metadonnees: [],
  vuDepuis: "12/03/2025",
  vuEncore: "02/09/2025",
};

const RESSEMBLANT: LigneCompteIsole = {
  id: "id-brunel",
  provider: "notion",
  handle: "solene.brunel@exemple.org",
  tolere: null,
  ressemblance: true,
  propositions: [
    {
      username: "solene.brunel",
      fullname: "Solène Brunel",
      niveau: "forte",
      motif: "Ressemblance relevée par la collecte",
    },
    {
      username: "solene.brunet",
      fullname: "Solène Brunet",
      niveau: "faible",
      motif: "Fragment de nom ou d'identifiant retrouvé dans ce compte",
    },
  ],
  acces: ["membre sur Espace Suivi des friches", "invité sur Espace Incubateur"],
  metadonnees: [{ libelle: "Adresse", valeur: "solene.brunel@exemple.org" }],
  vuDepuis: "04/01/2025",
  vuEncore: "02/09/2025",
};

const CIBLES = [
  { valeur: "solene.brunel", libelle: "Solène Brunel" },
  { valeur: "solene.brunet", libelle: "Solène Brunet" },
];

function monterLaFileDesComptesIsoles(
  lignes: readonly LigneCompteIsole[] = [ORPHELIN, RESSEMBLANT],
) {
  render(<FileDesComptesIsoles lignes={lignes} cibles={CIBLES} />);
}

function ligneDe(handle: string): HTMLElement {
  const ligne = screen.getByText(handle).closest("tr");
  if (ligne === null) {
    throw new Error(`Aucune ligne pour ${handle}.`);
  }
  return ligne;
}

async function traiter(utilisateur: ReturnType<typeof userEvent.setup>, handle: string) {
  await utilisateur.click(within(ligneDe(handle)).getByRole("button", { name: "Traiter" }));
  ouvrir(MODALE_RATTACHEMENT);
}

/** Les libellés viennent de la table : c'est elle qui fait foi, jamais une copie. */
const ARRIVEE = LIBELLE_CONSTAT.SCOPE_ENTRY;
const COMPTE_PARTI = LIBELLE_CONSTAT.ORPHAN;

const CONSTAT_ARRIVEE: LigneConstat = {
  id: "constat-1",
  dedupKey: "tristan.valois:SCOPE_ENTRY",
  kind: "SCOPE_ENTRY",
  titre: ARRIVEE.titre,
  explication: ARRIVEE.explication,
  action: ARRIVEE.action,
  severity: "HIGH",
  ouvertLe: "01/09/2025",
  personne: { username: "tristan.valois", fullname: "Tristan Valois" },
  compte: null,
};

const CONSTAT_COMPTE_PARTI: LigneConstat = {
  id: "constat-2",
  dedupKey: "id-marceau:ORPHAN",
  kind: "ORPHAN",
  titre: COMPTE_PARTI.titre,
  explication: COMPTE_PARTI.explication,
  action: COMPTE_PARTI.action,
  severity: "MEDIUM",
  ouvertLe: "20/08/2025",
  personne: null,
  compte: { provider: "github", handle: "m-marceau" },
};

function monterLaFileDesConstats() {
  render(
    <FileDesConstats
      lignes={[CONSTAT_ARRIVEE, CONSTAT_COMPTE_PARTI]}
      profils={{ etat: "illisible" }}
      dernierJourTolere="2026-03-10"
    />,
  );
}

beforeEach(poserLeRuntimeDuSystemeDeDesign);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("La file des comptes isolés", () => {
  it("nomme le risque en ligne comme en modale, porte le refus du serveur, et repart vierge à la réouverture", async () => {
    // Given deux comptes sans détenteur connu : un que la collecte a rapproché sur une
    // simple ressemblance, un dont personne n'a rien supposé.
    const utilisateur = userEvent.setup();
    doubles.rattacher.mockResolvedValue({
      erreur: "Aucune personne ni compte de service ne porte « personne.inconnue ».",
    });
    monterLaFileDesComptesIsoles();

    // Then la file se monte, et le risque est nommé là où il se prend : la ligne
    // rapprochée par ressemblance le dit, celle qui n'a rien supposé se tait. Un badge
    // posé sur les deux reviendrait à ne rien signaler du tout.
    expect(
      within(ligneDe(RESSEMBLANT.handle)).getByText("Ressemblance non confirmée"),
    ).toBeDefined();
    expect(within(ligneDe(ORPHELIN.handle)).queryByText("Ressemblance non confirmée")).toBeNull();
    expect(within(ligneDe(ORPHELIN.handle)).getByText("aucun")).toBeDefined();

    // When on ouvre la modale sur le compte rapproché par ressemblance.
    await traiter(utilisateur, RESSEMBLANT.handle);
    const modale = modaleDe(MODALE_RATTACHEMENT);

    // Then elle redit sur quoi elle porte, reporte le risque, et déplie les accès
    // constatés : c'est en les regardant qu'on tranche, et la ligne ne les donne
    // qu'abrégés.
    expect(
      within(modale).getByText(`${RESSEMBLANT.provider} : ${RESSEMBLANT.handle}`),
    ).toBeDefined();
    expect(within(modale).getByText("Ressemblance non confirmée")).toBeDefined();
    for (const acces of RESSEMBLANT.acces) {
      expect(within(modale).getByText(acces)).toBeDefined();
    }

    // When on désigne une cible que le serveur ne connaît pas.
    const champ = within(modale).getByLabelText(/Rattacher à/) as HTMLInputElement;
    await utilisateur.type(champ, "personne.inconnue");
    const bouton = within(modale).getByRole("button", { name: "Rattacher" });
    await utilisateur.click(bouton);

    // Then l'action a reçu le compte et la cible sous les noms qu'elle lit : un champ
    // renommé ici refuserait « Compte introuvable » sans que rien ne le dise.
    const envoye = doubles.rattacher.mock.calls[0]?.[1] as FormData;
    expect(envoye.get("id")).toBe(RESSEMBLANT.id);
    expect(envoye.get("cible")).toBe("personne.inconnue");

    // And le refus du serveur s'affiche tel quel, en nommant la cible : le reformuler
    // ici ferait chercher dans la liste un identifiant qu'on vient de taper.
    const refus = await within(modale).findByText(
      "Aucune personne ni compte de service ne porte « personne.inconnue ».",
    );
    expect(refus).toBeDefined();

    // When on referme la modale et qu'on rouvre la même ligne.
    fermer(MODALE_RATTACHEMENT);
    await traiter(utilisateur, RESSEMBLANT.handle);

    // Then elle repart vierge. Une modale du système de design ne meurt jamais : sans
    // la clé d'ouverture, ce refus périmé coifferait un champ vide, et porterait sur
    // une saisie que plus personne n'a faite.
    const rouverte = modaleDe(MODALE_RATTACHEMENT);
    expect(
      within(rouverte).queryByText(
        "Aucune personne ni compte de service ne porte « personne.inconnue ».",
      ),
    ).toBeNull();
    expect((within(rouverte).getByLabelText(/Rattacher à/) as HTMLInputElement).value).toBe("");
  });

  it("rattache à la personne que la vignette nomme, et se ferme quand le serveur a tranché", async () => {
    // Given un compte dont deux personnes pourraient être le détenteur, rangées sous
    // deux motifs distincts.
    const utilisateur = userEvent.setup();
    doubles.rattacher.mockResolvedValue(null);
    monterLaFileDesComptesIsoles();
    await traiter(utilisateur, RESSEMBLANT.handle);
    const modale = modaleDe(MODALE_RATTACHEMENT);

    // Then chaque motif coiffe son groupe, et chaque vignette nomme la personne avec
    // son identifiant : deux homonymes proches ne se départagent que là.
    for (const proposition of RESSEMBLANT.propositions) {
      expect(within(modale).getByText(proposition.motif)).toBeDefined();
    }
    const vignette = within(modale).getByRole("button", {
      name: "Solène Brunet (solene.brunet)",
    }) as HTMLButtonElement;

    // When on clique la vignette de la seconde, et non celle que la collecte a supposée.
    await utilisateur.click(vignette);

    // Then c'est cette cible-là qui part, portée par le bouton lui-même : une vignette
    // qui n'emporterait pas sa valeur rattacherait le compte à la personne affichée en
    // premier, ce qui est un jugement que personne n'a rendu.
    expect(doubles.rattacher).toHaveBeenCalledTimes(1);
    const envoye = doubles.rattacher.mock.calls[0]?.[1] as FormData;
    expect(envoye.get("cible")).toBe("solene.brunet");
    expect(envoye.get("id")).toBe(RESSEMBLANT.id);

    // And le succès ferme la modale : la file rendue derrière ne porte plus la ligne,
    // et rester ouvert sur un compte déjà traité ferait rattacher deux fois.
    await vi.waitFor(() => {
      expect(modaleDe(MODALE_RATTACHEMENT).hasAttribute("open")).toBe(false);
    });
  });

  it("offre trois gestes, chacun vers son action, et fait porter à la confirmation la valeur que le serveur lit", async () => {
    // Given un compte rapproché par ressemblance, dont la création de fiche se heurtera
    // à un identifiant déjà pris, et dont le rattachement réclamera une confirmation.
    const utilisateur = userEvent.setup();
    doubles.creer.mockResolvedValue({
      erreur: "« camille.esteve » existe déjà : rattachez le compte à cette fiche.",
    });
    doubles.rattacher.mockResolvedValue({
      erreur:
        "« solene.brunel » n'est connue que par un compte déjà rattaché. Confirmez pour continuer.",
      confirmationRequise: true,
    });
    monterLaFileDesComptesIsoles();
    await traiter(utilisateur, RESSEMBLANT.handle);
    const modale = modaleDe(MODALE_RATTACHEMENT);

    // Then la modale offre trois gestes et non deux : rattacher d'un clic à une
    // personne proposée, rattacher à un identifiant saisi, ou déclarer ce que ce compte
    // est. Le troisième est le seul recours pour ce qu'aucune fiche ne porte, et sa
    // disparition laisserait ces comptes-là sans issue dans la file.
    const vignette = within(modale).getByRole("button", { name: "Solène Brunel (solene.brunel)" });
    const champ = within(modale).getByLabelText(/Rattacher à/) as HTMLInputElement;

    // And le troisième ne s'ouvre qu'une fois la nature du compte tranchée : un
    // formulaire de création déjà là répondrait « une personne » à la place de qui
    // traite, et c'est ainsi qu'un bot reçoit une fiche que rien ne sait supprimer.
    expect(within(modale).queryByLabelText(/Nom de la personne/)).toBeNull();
    await utilisateur.click(within(modale).getByLabelText("C'est une personne"));
    const nom = within(modale).getByLabelText(/Nom de la personne/) as HTMLInputElement;

    // And chacun a son propre formulaire : réunis, la touche Entrée frappée dans un
    // champ soumettrait le premier bouton du formulaire, c'est-à-dire une vignette que
    // personne n'a choisie.
    const formulaireDeLaCible = champ.closest("form") as HTMLFormElement;
    expect(vignette.closest("form")).not.toBe(formulaireDeLaCible);
    expect(nom.closest("form")).not.toBe(formulaireDeLaCible);

    // When on nomme quelqu'un dont l'espace-membre ne sait rien et qu'on crée sa fiche.
    await utilisateur.type(nom, "Camille Estève");
    await utilisateur.click(within(modale).getByRole("button", { name: "Créer la fiche" }));

    // Then c'est l'action de création qui part, et elle seule, avec le compte et le nom
    // sous les noms qu'elle lit : ce geste câblé sur le rattachement rattacherait le
    // compte au lieu d'ouvrir la fiche qui manque.
    expect(doubles.rattacher).not.toHaveBeenCalled();
    expect(doubles.creer).toHaveBeenCalledTimes(1);
    const creation = doubles.creer.mock.calls[0]?.[1] as FormData;
    expect(creation.get("id")).toBe(RESSEMBLANT.id);
    expect(creation.get("nom")).toBe("Camille Estève");

    // And son refus se lit, sans fermer la modale : la fiche n'a pas été créée.
    expect(
      await within(modale).findByText(
        "« camille.esteve » existe déjà : rattachez le compte à cette fiche.",
      ),
    ).toBeDefined();

    // And rien n'offre encore de passer outre : la case ne paraît qu'une fois le
    // garde-fou rencontré, sans quoi l'écran proposerait d'emblée de l'enjamber.
    expect(within(modale).queryByLabelText("Oui, c'est la même personne")).toBeNull();

    // When on désigne plutôt une personne connue, et que le serveur demande de
    // confirmer qu'il s'agit bien de la même.
    await utilisateur.type(champ, "solene.brunel");
    await utilisateur.click(within(modale).getByRole("button", { name: "Rattacher" }));
    const confirmation = await within(modale).findByLabelText("Oui, c'est la même personne");

    // Then tant qu'elle n'est pas cochée, le formulaire n'emporte rien sous ce nom :
    // c'est ainsi que le HTML dit non, et l'action lit l'absence.
    expect(Object.fromEntries(new FormData(formulaireDeLaCible))).not.toHaveProperty("confirme");

    // When on la coche.
    await utilisateur.click(confirmation);

    // Then le formulaire emporte « oui », la chaîne même que l'action compare. Une case
    // retombée sur le « on » par défaut du HTML ne serait jamais reçue comme une
    // confirmation, et ce rattachement se heurterait sans fin au même refus.
    expect(Object.fromEntries(new FormData(formulaireDeLaCible))).toMatchObject({
      id: RESSEMBLANT.id,
      cible: "solene.brunel",
      confirme: "oui",
    });

    // And c'est bien ce que l'action reçoit au renvoi.
    await utilisateur.click(within(modale).getByRole("button", { name: "Rattacher" }));
    expect(doubles.rattacher).toHaveBeenCalledTimes(2);
    const renvoi = doubles.rattacher.mock.calls[1]?.[1] as FormData;
    expect(renvoi.get("cible")).toBe("solene.brunel");
    expect(renvoi.get("confirme")).toBe("oui");
  });

  it("mène la machine à sa déclaration et non à une fiche, avec le compte et la revue que l'action lit", async () => {
    // Given un compte sans détenteur connu, qui se trouve être un bot.
    const utilisateur = userEvent.setup();
    doubles.declarer.mockResolvedValue(null);
    monterLaFileDesComptesIsoles();
    await utilisateur.click(
      within(ligneDe(ORPHELIN.handle)).getByRole("button", { name: "Traiter" }),
    );
    ouvrir(MODALE_RATTACHEMENT);
    const modale = modaleDe(MODALE_RATTACHEMENT);

    // Then aucune des deux natures n'est cochée d'avance : ni formulaire de fiche, ni
    // formulaire de compte de service. C'est le défaut absent qui fait poser la question.
    expect(within(modale).queryByLabelText(/Nom de la personne/)).toBeNull();
    expect(within(modale).queryByLabelText(/^Clé/)).toBeNull();

    // When on tranche que c'est une machine.
    await utilisateur.click(within(modale).getByLabelText("C'est une machine"));

    // Then c'est la déclaration d'un compte de service qui s'ouvre, et le formulaire de
    // fiche disparaît : offrir les deux à la fois ramènerait le geste qu'on vient
    // d'écarter.
    expect(within(modale).queryByLabelText(/Nom de la personne/)).toBeNull();
    await utilisateur.type(within(modale).getByLabelText(/^Clé/), "scalingo-deploy-bot");
    await utilisateur.type(within(modale).getByLabelText(/^Libellé/), "Bot de déploiement");
    await utilisateur.type(within(modale).getByLabelText(/^Usage/), "Déploie les applications");
    await utilisateur.type(within(modale).getByLabelText(/^Propriétaire/), "claire.durand");
    await utilisateur.click(
      within(modale).getByRole("button", { name: "Déclarer le compte de service" }),
    );

    // Then c'est l'action de déclaration qui part, et elle seule : câblée sur la création
    // de fiche, elle fabriquerait exactement la fiche qu'on cherche à ne plus créer.
    expect(doubles.creer).not.toHaveBeenCalled();
    expect(doubles.rattacher).not.toHaveBeenCalled();
    expect(doubles.declarer).toHaveBeenCalledTimes(1);

    // And elle emporte le compte traité et la saisie sous les noms qu'elle lit, la revue
    // comprise : sans elle, le serveur retomberait sur une périodicité que personne n'a
    // choisie, et un compte machine ne se remet en question que par sa revue.
    const declaration = doubles.declarer.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(declaration)).toMatchObject({
      id: ORPHELIN.id,
      key: "scalingo-deploy-bot",
      label: "Bot de déploiement",
      purpose: "Déploie les applications",
      ownerUsername: "claire.durand",
      reviewEveryDays: String(REVUE_PAR_DEFAUT),
    });
  });
});

describe("La file des constats", () => {
  it("sert le libellé de la table en colonne comme en modale, n'offre l'arrivée qu'au constat qui l'appelle, et repart vierge", async () => {
    // Given deux constats de types différents, dont une arrivée non préparée.
    const utilisateur = userEvent.setup();
    doubles.clore.mockResolvedValue({ erreur: "Ce constat est déjà clos." });
    monterLaFileDesConstats();

    const ligneArrivee = screen.getByText(ARRIVEE.titre).closest("tr") as HTMLElement;
    const ligneCompteParti = screen.getByText(COMPTE_PARTI.titre).closest("tr") as HTMLElement;
    expect(ligneArrivee).not.toBeNull();
    expect(ligneCompteParti).not.toBeNull();

    // Then chaque ligne porte le titre de son propre type, lu dans la table des
    // libellés. Une chaîne recopiée dans l'écran dirait la même chose sur les deux
    // lignes, et se mettrait à mentir le jour où la table se reformule.
    expect(within(ligneArrivee).queryByText(COMPTE_PARTI.titre)).toBeNull();
    expect(within(ligneCompteParti).queryByText(ARRIVEE.titre)).toBeNull();

    // And seul le constat d'arrivée offre de la préparer : c'est le type qui décide du
    // geste, et non le texte. Les autres n'ont que la clôture.
    expect(
      within(ligneArrivee).getByRole("button", { name: LIBELLE_DOSSIER.ONBOARDING.ouvrir }),
    ).toBeDefined();
    expect(
      within(ligneCompteParti).queryByRole("button", { name: LIBELLE_DOSSIER.ONBOARDING.ouvrir }),
    ).toBeNull();

    // When on ouvre la clôture sur le compte d'une personne partie.
    await utilisateur.click(within(ligneCompteParti).getByRole("button", { name: "Clore" }));
    ouvrir(MODALE_CLOTURE);
    const modale = modaleDe(MODALE_CLOTURE);

    // Then la modale redit la cible et sert les trois textes du même type que la
    // colonne, sans jamais servir ceux de l'autre constat de la file.
    expect(within(modale).getByText("m-marceau")).toBeDefined();
    expect(within(modale).getByText("github : m-marceau")).toBeDefined();
    expect(within(modale).getByText(COMPTE_PARTI.titre)).toBeDefined();
    expect(within(modale).getByText(COMPTE_PARTI.explication)).toBeDefined();
    expect(within(modale).getByText(COMPTE_PARTI.action, { exact: false })).toBeDefined();
    expect(within(modale).queryByText(ARRIVEE.titre)).toBeNull();
    expect(within(modale).queryByText(ARRIVEE.explication)).toBeNull();

    // When on dit ce qui a été fait et qu'on clôt.
    await utilisateur.type(
      within(modale).getByLabelText(/Ce qui a été fait/),
      "Accès coupés le 2 septembre",
    );
    await utilisateur.click(within(modale).getByRole("button", { name: "Clore" }));

    // Then l'action reçoit la clé de dédoublonnage du constat choisi et la raison, sous
    // les noms qu'elle lit : c'est la clé qui désigne le constat, jamais son rang dans
    // la file.
    const envoye = doubles.clore.mock.calls[0]?.[1] as FormData;
    expect(envoye.get("dedupKey")).toBe(CONSTAT_COMPTE_PARTI.dedupKey);
    expect(envoye.get("raison")).toBe("Accès coupés le 2 septembre");

    // And son refus s'affiche.
    expect(await within(modale).findByText("Ce constat est déjà clos.")).toBeDefined();

    // When on referme et qu'on rouvre sur le même constat, celui-là même qui vient
    // d'essuyer le refus. C'est la réouverture qui coûte : changer de ligne remonte le
    // formulaire de toute façon, rester sur la sienne ne le remonte que si l'ouverture
    // compte.
    fermer(MODALE_CLOTURE);
    await utilisateur.click(within(ligneCompteParti).getByRole("button", { name: "Clore" }));
    ouvrir(MODALE_CLOTURE);

    // Then le refus est parti, et la raison saisie avec lui : les rejouer ferait lire
    // le verdict de la tentative précédente au-dessus d'un champ que personne n'a
    // rempli.
    const rouverte = modaleDe(MODALE_CLOTURE);
    expect(within(rouverte).queryByText("Ce constat est déjà clos.")).toBeNull();
    expect((within(rouverte).getByLabelText(/Ce qui a été fait/) as HTMLInputElement).value).toBe(
      "",
    );
    expect(within(rouverte).getByText(COMPTE_PARTI.titre)).toBeDefined();
  });
});

describe("le geste de tolérance dans la file des constats", () => {
  it("ne s'offre qu'aux constats qui se tolèrent, et poste la clé du constat choisi", async () => {
    // Given une file où figure un constat qui ne se tolère pas : il porte sur ce qu'un
    // humain a déclaré et que la collecte dément, pas sur un compte ni sur quelqu'un.
    const utilisateur = userEvent.setup();
    doubles.tolerer.mockResolvedValue({ erreur: "Cet écart est déjà toléré." });
    const DEMENTI: LigneConstat = {
      id: "f-3",
      dedupKey: "OVERDUE_MANUAL_ACTION:github:m.marceau",
      kind: "OVERDUE_MANUAL_ACTION",
      titre: "Action déclarée démentie",
      explication: "La collecte revoit le compte que quelqu'un a déclaré avoir coupé.",
      action: "Vérifier ce qui a été fait.",
      severity: "HIGH",
      ouvertLe: "20/08/2025",
      personne: { username: "m.marceau", fullname: "M. Marceau" },
      compte: null,
    };
    render(
      <FileDesConstats
        lignes={[CONSTAT_COMPTE_PARTI, DEMENTI]}
        profils={{ etat: "illisible" }}
        dernierJourTolere="2026-03-10"
      />,
    );

    const ligneCompteParti = screen.getByText(COMPTE_PARTI.titre).closest("tr") as HTMLElement;
    const ligneDementi = screen.getByText(DEMENTI.titre).closest("tr") as HTMLElement;

    // Then le compte d'une personne partie se tolère, et la parole démentie non : c'est
    // le type du constat qui décide du geste, et le taire reviendrait à faire taire une
    // contradiction plutôt qu'un écart.
    expect(within(ligneCompteParti).getByRole("button", { name: "Tolérer" })).toBeDefined();
    expect(within(ligneDementi).queryByRole("button", { name: "Tolérer" })).toBeNull();

    // And les deux gardent la clôture, qui ne dit pas la même chose.
    expect(within(ligneDementi).getByRole("button", { name: "Clore" })).toBeDefined();

    // When on tolère le compte de la personne partie.
    await utilisateur.click(within(ligneCompteParti).getByRole("button", { name: "Tolérer" }));
    ouvrir(MODALE_TOLERANCE);
    const modale = modaleDe(MODALE_TOLERANCE);

    // Then la modale redit sur quoi elle porte, et dit ce que tolérer veut dire ici,
    // que la clôture ne dit pas.
    expect(within(modale).getByText("github : m-marceau")).toBeDefined();
    expect(within(modale).getByText(COMPTE_PARTI.titre)).toBeDefined();
    expect(
      within(modale).getByText(/Tolérer ne dit pas que la situation est traitée/),
    ).toBeDefined();

    // And le champ de date porte la borne que le serveur a calculée, plutôt qu'une
    // calculée au rendu : deux horloges qui ne tombent pas sur le même jour feraient
    // diverger le HTML servi de celui qu'on hydrate.
    const jusquAu = within(modale).getByLabelText(/Jusqu'au/) as HTMLInputElement;
    expect(jusquAu.max).toBe("2026-03-10");

    // When on dit pourquoi et jusqu'à quand.
    await utilisateur.type(
      within(modale).getByLabelText(/Pourquoi cet écart est admis/),
      "Compte partagé, repris en janvier",
    );
    await utilisateur.type(jusquAu, "2026-01-31");
    await utilisateur.click(within(modale).getByRole("button", { name: "Tolérer" }));

    // Then l'action reçoit la clé du constat choisi et les deux champs sous les noms
    // qu'elle lit, et surtout aucune cible : celle-ci se déduit du constat côté serveur,
    // et un champ de plus ici laisserait taire ce que personne n'a regardé.
    const envoye = doubles.tolerer.mock.calls[0]?.[1] as FormData;
    expect(envoye.get("dedupKey")).toBe(CONSTAT_COMPTE_PARTI.dedupKey);
    expect(envoye.get("raison")).toBe("Compte partagé, repris en janvier");
    expect(envoye.get("jusquAu")).toBe("2026-01-31");
    expect(envoye.get("cible")).toBeNull();

    // And son refus s'affiche, annoncé comme un refus du geste et non comme une erreur du
    // champ de date : il peut porter sur la raison, ou sur la cible que ce formulaire ne
    // montre pas, et le rattacher à la date le ferait annoncer de travers.
    const refus = await within(modale).findByRole("alert");
    expect(refus.textContent).toContain("Cet écart est déjà toléré.");
    expect(jusquAu.getAttribute("aria-describedby")).toBeNull();
  });
});

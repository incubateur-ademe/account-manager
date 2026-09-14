// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { MockedFunction } from "vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { RATTACHEMENT_IDENTITE } from "@/ui/severites";

// Le pont vers le thème MUI du système de design lit le schéma de couleurs par un
// singleton que seule la coque de l'application démarre, et lève au premier rendu sans
// elle. Il n'apporte que des couleurs : le champ à liste fonctionne sans.
vi.mock("@codegouvfr/react-dsfr/mui", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

// Les trois écrans tirent leurs actions serveur, qui remontent jusqu'à `next-auth` :
// cette chaîne ne se résout pas sous jsdom, et le double la coupe à sa racine. Tous
// les exports que ces écrans importent sont déclarés, un double incomplet laissant le
// composant appeler un `undefined`.
vi.mock("./actions", () => ({
  detacherIdentite: vi.fn(),
  forcerAppartenance: vi.fn(),
  libererAppartenance: vi.fn(),
  rattacherAStartup: vi.fn(),
}));

const { detacherIdentite, forcerAppartenance, rattacherAStartup } = await import("./actions");
const { Appartenance } = await import("./Appartenance");
const { ModaleRattacherStartup, modaleRattacherStartup } = await import("./ModaleRattacherStartup");
const { SectionComptesExternes } = await import("./SectionComptesExternes");

const detacher = vi.mocked(detacherIdentite);
const forcer = vi.mocked(forcerAppartenance);
const rattacher = vi.mocked(rattacherAStartup);

beforeAll(() => {
  // Node 24 pose son propre `localStorage` sur l'objet global, indisponible faute de
  // `--localstorage-file`, et il masque celui de jsdom que Vitest n'écrase pas. Le
  // mode d'aide le lit au premier rendu, donc toute modale qui porte une infobulle
  // lève sans ce relais.
  if (window.localStorage === undefined) {
    const memoire = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (cle: string) => memoire.get(cle) ?? null,
        setItem: (cle: string, valeur: string) => memoire.set(cle, valeur),
        removeItem: (cle: string) => memoire.delete(cle),
        clear: () => memoire.clear(),
      },
    });
  }

  // Le JS du système de design ne tourne pas ici, et c'est lui qui ouvre et referme
  // les modales, en émettant les deux événements auxquels la clé de remontage est
  // accrochée. On en pose le strict nécessaire, pour que `close()` passé en `onSucces`
  // referme pour de vrai plutôt que de lever.
  Object.defineProperty(window, "dsfr", {
    configurable: true,
    value: (element: HTMLElement) => ({
      modal: {
        disclose: () => element.dispatchEvent(new Event("dsfr.disclose")),
        conceal: () => element.dispatchEvent(new Event("dsfr.conceal")),
      },
    }),
  });
});

/** Ce que l'action serveur a réellement reçu, et non ce que l'état du composant croit. */
const envois: Array<Record<string, FormDataEntryValue>> = [];

type ActionDoublee<E> = MockedFunction<(precedent: E, donnees: FormData) => Promise<E>>;

/** Fait rendre une issue à l'action doublée, en relevant au passage son `FormData`. */
function repond<E>(double: ActionDoublee<E>, issue: E): void {
  double.mockImplementationOnce((_precedent, donnees) => {
    envois.push(Object.fromEntries(donnees));
    return Promise.resolve(issue);
  });
}

// Les globals ne sont pas activés, donc le nettoyage automatique de la bibliothèque de
// rendu ne s'accroche à rien : sans ça, le scénario suivant trouverait deux modales du
// même identifiant.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  envois.length = 0;
});

/** Ouvre ou referme par les gestes mêmes du système de design, et non à la main. */
function basculerModale(geste: "open" | "close"): void {
  act(() => {
    modaleRattacherStartup[geste]();
  });
}

describe("la fiche d'une personne et ses deux modales", () => {
  it("porte au serveur une raison trop courte, sert son refus sur le champ fautif, et ne ferme qu'au succès", async () => {
    const utilisateur = userEvent.setup();
    const fermer = vi.fn();

    // Given la modale d'appartenance d'une fiche sur laquelle aucune décision n'est posée
    render(<Appartenance username="noemie.vaillant" surcharge={null} onSucces={fermer} />);

    const raison = () => screen.getByLabelText(/Forcer son appartenance/) as HTMLInputElement;
    // Sans décision posée, il n'y a rien à retirer : le second formulaire n'existe pas.
    expect(screen.queryByRole("button", { name: "Retirer cette décision" })).toBeNull();

    // When on motive la décision en deux caractères et qu'on force l'inclusion
    await utilisateur.type(raison(), "ok");
    repond(forcer, {
      erreur:
        "Indiquez la raison de cette décision : une appartenance sans motif est une décision qu'on ne saura pas réexaminer.",
    });
    await utilisateur.click(screen.getByRole("button", { name: "Forcer dans l'incubateur" }));

    // Then l'écran n'a rien tranché de son côté : la raison courte est bien partie
    // telle quelle. La règle des trois caractères vit au serveur, et un verrou posé
    // ici la doublerait d'une seconde vérité, muette et destinée à diverger.
    //
    // Le `sens` que le bouton cliqué devrait porter n'est pas asserté, et c'est un
    // constat, pas un oubli : `Button` du système de design déclare son propre prop
    // `value` et le pose APRÈS avoir étalé `nativeButtonProps`, si bien que le
    // `value: "INCLUDE"` du composant est écrasé par un `undefined`. Le bouton part
    // sans attribut `value`, le serveur lit une chaîne vide et refuse par
    // « Sens de la décision non reconnu. ». Le correctif tient dans le passage de
    // `value` en prop de premier niveau du `Button`.
    expect(envois[0]).toMatchObject({ username: "noemie.vaillant", raison: "ok" });

    // Then le refus se lit à sa place, c'est-à-dire décrit par le champ fautif et non
    // dans un coin du formulaire : un message que le champ ne désigne pas laisse
    // chercher ce qu'il faut corriger.
    const message = await screen.findByText(/une appartenance sans motif/);
    expect(raison().getAttribute("aria-describedby")).toBe(message.id);
    expect(message.className).toContain("fr-error-text");

    // Then la modale reste ouverte : la refermer emporterait le refus avec elle
    expect(fermer).not.toHaveBeenCalled();

    // When la décision est reprise, cette fois motivée, et acceptée
    await utilisateur.clear(raison());
    await utilisateur.type(raison(), "Coach sans produit précis");
    repond(forcer, null);
    await utilisateur.click(screen.getByRole("button", { name: "Déclarer hors incubateur" }));

    await vi.waitFor(() => {
      expect(envois).toHaveLength(2);
    });
    expect(envois[1]).toMatchObject({
      username: "noemie.vaillant",
      raison: "Coach sans produit précis",
    });

    // Then, et alors seulement, la modale se ferme, une seule fois, et le refus périmé
    // a disparu avec le formulaire remis à neuf
    await vi.waitFor(() => {
      expect(fermer).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/une appartenance sans motif/)).toBeNull();
    expect(raison().value).toBe("");
  });

  it("avertit d'une échéance qui dépasse la mission, fait paraître la case de prolongation, et repart vierge à la réouverture", async () => {
    const utilisateur = userEvent.setup();

    // Given la modale de rattachement d'une personne dont la mission finit au 30 juin 2027
    render(
      <ModaleRattacherStartup
        username="noemie.vaillant"
        missionEnd="2027-06-30"
        startups={[
          { ghid: "suivi-des-friches", name: "Suivi des friches", disparue: false },
          { ghid: "balade-des-friches", name: "Balade des friches", disparue: true },
        ]}
      />,
    );
    basculerModale("open");

    const startup = () => screen.getByLabelText(/^Startup/) as HTMLInputElement;
    const jusquAu = () => screen.getByLabelText(/^Jusqu'au/) as HTMLInputElement;
    // La modale du système de design n'a pas son JS ici, donc son `dialog` reste sans
    // `open` et jsdom le tient pour caché : les rôles s'y cherchent en le disant.
    const boutonRattacher = () => screen.getByRole("button", { name: "Rattacher", hidden: true });
    const prolongation = () =>
      screen.queryByLabelText("Oui, prolonger ses accès jusqu'à cette date");

    // When on vise une cible que la base ne connaît pas, ce que la saisie libre permet
    await utilisateur.type(startup(), "suivi-de-friche");
    await utilisateur.type(jusquAu(), "2027-03-31");
    repond(rattacher, {
      erreur: "Aucune startup connue ne porte l'identifiant « suivi-de-friche ».",
    });
    await utilisateur.click(boutonRattacher());

    // Then le refus se lit tel quel, la cible nommée comprise : le champ à liste
    // n'interdit rien de son côté, c'est le serveur qui dit laquelle a manqué.
    expect(await screen.findByText(/« suivi-de-friche »/)).toBeDefined();
    expect(prolongation()).toBeNull();

    // When on corrige vers une startup connue, pour une échéance qui tient dans la mission
    await utilisateur.clear(startup());
    await utilisateur.type(startup(), "suivi-des-friches");
    await utilisateur.clear(jusquAu());
    await utilisateur.type(jusquAu(), "2027-03-31");

    // Then rien n'alerte : un avertissement qui paraîtrait toujours ne signalerait plus rien
    expect(screen.queryByText(/dépasse la fin de mission connue/)).toBeNull();
    expect(prolongation()).toBeNull();

    // When l'échéance est repoussée au-delà de la fin de mission
    await utilisateur.clear(jusquAu());
    await utilisateur.type(jusquAu(), "2027-12-31");

    // Then l'écran prévient dès la saisie, en nommant la borne qu'il vient de dépasser
    expect(screen.getByText(/dépasse la fin de mission connue \(2027-06-30\)/)).toBeDefined();
    // Then la case de prolongation n'est pas là pour autant : c'est le serveur qui la
    // réclame, l'avertissement de l'écran n'étant que du confort.
    expect(prolongation()).toBeNull();

    // When le serveur refuse tant que la prolongation n'est pas confirmée
    repond(rattacher, {
      erreur:
        "Cette date dépasse la fin de mission connue : le rattachement prolongera ses accès d'autant. Confirmez pour continuer.",
      confirmationRequise: true,
    });
    await utilisateur.click(boutonRattacher());

    // Then ce qui a été saisi est parti sous les noms que l'action lit, et la
    // confirmation ne s'y est pas invitée toute seule
    expect(envois[1]).toMatchObject({
      username: "noemie.vaillant",
      startup: "suivi-des-friches",
      jusquAu: "2027-12-31",
    });
    expect(envois[1]).not.toHaveProperty("confirme");

    // Then le refus se lit, et la case de prolongation paraît sous lui
    expect(await screen.findByText(/Confirmez pour continuer/)).toBeDefined();
    expect(prolongation()).not.toBeNull();

    // When on renonce, on referme, et on rouvre pour une autre cible
    basculerModale("close");
    basculerModale("open");

    // Then rien du geste précédent ne survit. La case de prolongation surtout :
    // héritée cochable au-dessus d'une modale vierge, elle armerait d'avance un
    // rattachement dont personne n'aurait dit qu'il repoussait une échéance.
    expect(prolongation()).toBeNull();
    expect(screen.queryByText(/Confirmez pour continuer/)).toBeNull();
    expect(screen.queryByText(/dépasse la fin de mission connue/)).toBeNull();
    expect(jusquAu().value).toBe("");
    expect(startup().value).toBe("");

    // When le même rattachement est repris, cette fois jusqu'au bout
    await utilisateur.type(startup(), "suivi-des-friches");
    await utilisateur.type(jusquAu(), "2027-12-31");
    repond(rattacher, {
      erreur:
        "Cette date dépasse la fin de mission connue : le rattachement prolongera ses accès d'autant. Confirmez pour continuer.",
      confirmationRequise: true,
    });
    await utilisateur.click(boutonRattacher());
    await screen.findByText(/Confirmez pour continuer/);

    repond(rattacher, null);
    await utilisateur.click(prolongation() as HTMLInputElement);
    await utilisateur.click(boutonRattacher());

    // Then la case part sous la valeur que l'action compare, et non sous le « on » par
    // défaut du HTML, qui ne prolongerait jamais rien
    await vi.waitFor(() => {
      expect(envois).toHaveLength(4);
    });
    expect(envois[3]).toMatchObject({ jusquAu: "2027-12-31", confirme: "oui" });

    // Then le succès referme la modale de lui-même, et ce qu'elle portait s'en va avec
    await vi.waitFor(() => {
      expect(screen.queryByText(/dépasse la fin de mission connue/)).toBeNull();
    });
    expect(jusquAu().value).toBe("");
  });

  it("dit d'un compte rapproché par ressemblance qu'il ne fera jamais couper d'accès, sans laisser affleurer le mot de base", () => {
    // Given une fiche portant un compte déclaré et un compte rapproché sur ressemblance
    render(
      <SectionComptesExternes
        comptes={[
          {
            id: "identite-github",
            provider: "github",
            handle: "noemie-vaillant",
            matchMethod: "DECLARED",
            lastSeenAt: new Date("2026-09-01T00:00:00Z"),
            vanishedAt: null,
          },
          {
            id: "identite-notion",
            provider: "notion",
            handle: "n.vaillant@exemple.invalid",
            matchMethod: "HEURISTIC",
            lastSeenAt: new Date("2026-09-01T00:00:00Z"),
            vanishedAt: null,
          },
        ]}
        systemesCollectes={["github", "notion"]}
      />,
    );

    // Then chaque rattachement sert l'entrée que la table lui donne, et se colore selon
    // la sûreté que cette même entrée déclare : le vert du déclaré, l'orange de ce qui
    // n'est qu'une ressemblance.
    const declare = screen.getByText(RATTACHEMENT_IDENTITE.DECLARED.libelle);
    const ressemblance = screen.getByText(RATTACHEMENT_IDENTITE.HEURISTIC.libelle);
    expect(declare.className).toContain("fr-badge--success");
    expect(ressemblance.className).toContain("fr-badge--warning");

    // Then aucun mot de base n'affleure : c'est le défaut que cette lecture traquait
    expect(screen.queryByText(/HEURISTIC|DECLARED/)).toBeNull();

    // Then l'écran dit en toutes lettres ce qu'un tel compte ne fera pas. Sans cette
    // phrase, on attendrait du rapprochement qu'il coupe des accès, alors qu'il ne
    // fait qu'alimenter une file de rattachement manuel.
    expect(
      screen.getByText(
        /Un compte rattaché sur une ressemblance de nom, ou sans preuve, ne fera jamais couper d'accès\./,
      ),
    ).toBeDefined();

    // Then la liste des systèmes lus est celle qu'on lui a donnée : ce qui en est
    // absent n'a jamais été observé, et ce n'est pas la même chose que rien à signaler
    expect(screen.getByText(/Systèmes couverts lus à ce jour : github, notion\./)).toBeDefined();
  });

  it("détache le compte de la ligne où l'on a cliqué, et non celui d'une voisine", async () => {
    // Given une fiche portant deux comptes externes distincts, chacun avec son propre
    // geste de détachement au bout de sa ligne
    const utilisateur = userEvent.setup();
    render(
      <SectionComptesExternes
        comptes={[
          {
            id: "identite-github",
            provider: "github",
            handle: "noemie-vaillant",
            matchMethod: "DECLARED",
            lastSeenAt: new Date("2026-09-01T00:00:00Z"),
            vanishedAt: null,
          },
          {
            id: "identite-notion",
            provider: "notion",
            handle: "n.vaillant@exemple.invalid",
            matchMethod: "DECLARED",
            lastSeenAt: new Date("2026-09-02T00:00:00Z"),
            vanishedAt: null,
          },
        ]}
        systemesCollectes={["github", "notion"]}
      />,
    );

    const ligneDe = (compte: string) => {
      const ligne = screen.getByText(compte).closest("tr");
      expect(ligne).not.toBeNull();
      return ligne as HTMLElement;
    };
    const detacherDe = (compte: string) =>
      within(ligneDe(compte)).getByRole("button", { name: "Détacher" });

    // Then chaque bouton annonce le compte qu'il vise : deux gestes identiques au même
    // endroit de deux lignes ne se distinguent que par là
    expect(detacherDe("noemie-vaillant").getAttribute("title")).toBe(
      "Détacher noemie-vaillant de cette personne",
    );
    expect(detacherDe("n.vaillant@exemple.invalid").getAttribute("title")).toBe(
      "Détacher n.vaillant@exemple.invalid de cette personne",
    );

    // When on coupe le rattachement depuis la seconde ligne
    repond(detacher, null);
    await utilisateur.click(detacherDe("n.vaillant@exemple.invalid"));

    // Then c'est l'identité de cette ligne-là qui part, sous le nom que l'action lit.
    // Ce que porte le formulaire est le seul endroit où le lien se voit : un bouton
    // câblé sur l'identité d'une voisine afficherait le bon compte, annoncerait le bon
    // compte, et couperait l'autre rattachement sans que rien à l'écran ne bouge.
    await vi.waitFor(() => {
      expect(envois).toHaveLength(1);
    });
    expect(envois[0]).toMatchObject({ id: "identite-notion" });

    // When on coupe ensuite depuis la première
    repond(detacher, null);
    await utilisateur.click(detacherDe("noemie-vaillant"));

    // Then la sienne part à son tour : les deux lignes ne visent pas la même cible
    await vi.waitFor(() => {
      expect(envois).toHaveLength(2);
    });
    expect(envois[1]).toMatchObject({ id: "identite-github" });
  });

  it("distingue les deux sens, là où le système de design effaçait la valeur des boutons", async () => {
    // Given les deux boutons d'appartenance, qui partagent un formulaire et ne se
    // séparent que par la valeur qu'ils portent. L'action refuse tout sens qui ne vaut
    // ni INCLUDE ni EXCLUDE, donc une valeur perdue rend les deux boutons inertes.
    const utilisateur = userEvent.setup();
    render(<Appartenance username="noemie.vaillant" surcharge={null} onSucces={vi.fn()} />);
    await utilisateur.type(screen.getByLabelText(/Forcer son appartenance/), "prestation terminée");

    // When on déclare la personne hors incubateur
    await utilisateur.click(screen.getByRole("button", { name: "Déclarer hors incubateur" }));

    // Then c'est bien ce sens-là qui part. Le système de design étale
    // `nativeButtonProps` puis réapplique sa propre `value`, qui vaut `undefined` : une
    // valeur posée là est effacée, le bouton part avec un sens vide, et l'action répond
    // « Sens de la décision non reconnu » quel que soit le bouton cliqué. Les deux
    // gestes étaient morts, et rien ne le disait.
    expect(forcer).toHaveBeenCalledTimes(1);
    const porte = forcer.mock.calls[0]?.[1] as FormData;
    expect(porte.get("sens")).toBe("EXCLUDE");
    expect(porte.get("username")).toBe("noemie.vaillant");
  });
});

// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RATTACHEMENT_IDENTITE } from "@/ui/severites";

import type { CompteLu, RessourceLue } from "./parc";

/**
 * L'écran tire l'action serveur du geste, qui remonte jusqu'à `next-auth` : cette chaîne
 * ne se résout pas sous jsdom, et le double la coupe à sa racine. Il rend ce que l'action
 * rend vraiment en cas de succès, un identifiant de brouillon, sans quoi la phrase qui se
 * lit après le clic ne serait jamais atteinte.
 */
vi.mock("@/app/gestes/actions", () => ({
  ouvrirGeste: vi.fn(() => Promise.resolve({ planId: "plan-du-geste" })),
}));

/**
 * La lecture en base de l'écran, doublée à sa racine : ce que la clause de vivacité
 * retient d'une vraie base se tient un étage plus bas, dans `lecture.integration.test.ts`,
 * et ce qui se lit du résultat se tient ici.
 */
const { lireLeParc } = vi.hoisted(() => ({
  lireLeParc:
    vi.fn<() => Promise<{ ressources: readonly RessourceLue[]; comptes: readonly CompteLu[] }>>(),
}));

vi.mock("./lecture", () => ({ lireLeParc }));

/**
 * Le stockage local, que ni jsdom ni Node ne donnent ici : Node le déclare en global et
 * le laisse vide sans son fichier d'appoint, si bien qu'il masque celui de jsdom.
 */
if ((globalThis as { localStorage?: unknown }).localStorage === undefined) {
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

const { ouvrirGeste } = await import("@/app/gestes/actions");
const { MENTION_SANS_ECRITURE, ecranDe, mentionDeLecture } = await import("../registre");
const EcranScalingo = (await import("./Ecran")).default;
const { assemblerLeParc } = await import("./parc");
const { ParcScalingo } = await import("./ParcScalingo");
const { libelleDuRole, MOTS_DE_SCALINGO } = await import("./redaction");

const MODALE = "changer-role-scalingo";

/**
 * Ce que le JS du système de design ferait, et que jsdom ne fera jamais : une modale du
 * DSFR s'ouvre hors de React, en émettant `dsfr.disclose` sur le `dialog`, et c'est cet
 * évènement que la clé de remontage écoute.
 */
function modale(): HTMLElement {
  const element = document.getElementById(MODALE);
  if (element === null) {
    throw new Error(`la modale ${MODALE} n'est pas montée`);
  }
  return element;
}

function ouvrir(): void {
  act(() => {
    modale().setAttribute("open", "");
    modale().dispatchEvent(new Event("dsfr.disclose"));
  });
}

const PROJET: RessourceLue = {
  id: "res-projet",
  label: "Radar des friches, osc-fr1",
  url: null,
  parentId: null,
  grants: [],
};

const API: RessourceLue = {
  id: "res-api",
  label: "radar-api, osc-fr1",
  url: "https://dashboard.scalingo.com/apps/osc-fr1/radar-api/collaborators",
  parentId: PROJET.id,
  grants: [
    {
      role: "owner",
      lastSeenAt: new Date("2026-09-10T02:00:00Z"),
      externalIdentityId: "id-compte",
    },
    {
      role: "collaborator",
      lastSeenAt: new Date("2026-09-12T02:00:00Z"),
      externalIdentityId: "id-tarik",
    },
  ],
};

const WEB: RessourceLue = {
  id: "res-web",
  label: "radar-web, osc-fr1",
  url: null,
  parentId: PROJET.id,
  grants: [
    { role: "limited", lastSeenAt: new Date("2026-09-11T02:00:00Z"), externalIdentityId: "id-noe" },
    {
      role: "collaborator",
      lastSeenAt: new Date("2026-09-11T02:00:00Z"),
      externalIdentityId: "id-deploiement",
    },
  ],
};

const HORS_PROJET: RessourceLue = {
  id: "res-veille",
  label: "veille-sol, osc-secnum1",
  url: null,
  parentId: null,
  grants: [
    {
      role: "collaborator",
      lastSeenAt: new Date("2026-09-09T02:00:00Z"),
      externalIdentityId: "id-robot",
    },
  ],
};

const PROPRIETAIRE: CompteLu = {
  id: "id-compte",
  handle: "compte.incubateur@exemple.invalid",
  matchMethod: "DECLARED",
  details: null,
  lastSeenAt: new Date("2026-09-12T02:00:00Z"),
  person: { username: "compte.incubateur", fullname: "Compte de l'incubateur" },
  serviceAccount: null,
};

const TARIK: CompteLu = {
  id: "id-tarik",
  handle: "tarik.oubeid@exemple.invalid",
  matchMethod: "EMAIL_EXACT",
  details: null,
  lastSeenAt: new Date("2026-09-12T02:00:00Z"),
  person: { username: "tarik.oubeid", fullname: "Tarik Oubeid" },
  serviceAccount: null,
};

const NOE: CompteLu = {
  id: "id-noe",
  handle: "noe.vasseur@exemple.invalid",
  matchMethod: "HEURISTIC",
  details: [{ label: "État de l'accès", value: "invitation en attente" }],
  lastSeenAt: new Date("2026-09-11T02:00:00Z"),
  person: { username: "noe.vasseur", fullname: "Noé Vasseur" },
  serviceAccount: null,
};

/**
 * Une identité déclarée machine : ni personne, ni isolement. `personId` nul et
 * `serviceAccountId` non nul est exactement ce que la déclaration pose, et c'est le
 * couple que la file des comptes isolés exclut.
 */
const DEPLOIEMENT: CompteLu = {
  id: "id-deploiement",
  handle: "deploiement@exemple.invalid",
  matchMethod: "DECLARED",
  details: null,
  lastSeenAt: new Date("2026-09-11T02:00:00Z"),
  person: null,
  serviceAccount: { key: "scalingo-deploiement", label: "Déploiement continu" },
};

const ROBOT: CompteLu = {
  id: "id-robot",
  matchMethod: "NONE",
  handle: "robot-veille@exemple.invalid",
  details: [{ label: "Type de compte", value: "automate" }],
  lastSeenAt: new Date("2026-09-09T02:00:00Z"),
  person: null,
  serviceAccount: null,
};

/** Constaté, sans aucun accès vivant à son nom. */
const SANS_ACCES: CompteLu = {
  id: "id-sans-acces",
  handle: "ancienne.astreinte@exemple.invalid",
  matchMethod: "EMAIL_EXACT",
  details: null,
  lastSeenAt: new Date("2026-09-12T02:00:00Z"),
  person: { username: "ancienne.astreinte", fullname: "Ancienne Astreinte" },
  serviceAccount: null,
};

const RESSOURCES = [PROJET, API, WEB, HORS_PROJET];
const COMPTES = [PROPRIETAIRE, DEPLOIEMENT, NOE, ROBOT, SANS_ACCES, TARIK];

const PARC = assemblerLeParc(RESSOURCES, COMPTES);

function monter(): void {
  render(<ParcScalingo groupes={PARC.groupes} />);
}

/** La ligne d'un accès se cherche par son détenteur, jamais par son rang. */
function ligneDe(handle: string): HTMLElement {
  const cellule = screen.getAllByText(handle)[0];
  const ligne = cellule?.closest("tr");
  if (!ligne) {
    throw new Error(`aucune ligne pour ${handle}`);
  }
  return ligne as HTMLElement;
}

/**
 * La même recherche, mais dans la seconde section : un même compte figure des deux
 * côtés de l'écran, et la première ligne trouvée est celle du parc.
 */
function ligneDuCompte(handle: string): HTMLElement {
  const titre = screen.getByRole("heading", { name: MOTS_DE_SCALINGO.comptes.titre });
  const section = titre.closest("section");
  if (!section) {
    throw new Error("la section des comptes n'est pas montée");
  }
  const cellule = within(section as HTMLElement).getAllByText(handle)[0];
  const ligne = cellule?.closest("tr");
  if (!ligne) {
    throw new Error(`aucune ligne de compte pour ${handle}`);
  }
  return ligne as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("l'écran Scalingo, dans les deux sens et sans jamais promettre un droit de projet", () => {
  it("regroupe sans faire appartenir, dit la date de chaque constat, et n'offre le geste qu'à un rattachement sûr", () => {
    // Given un parc où un projet contient deux applications, une troisième n'a pas de
    // contenant, et les quatre cas de détenteur se présentent : le propriétaire, un
    // rattachement sûr, une ressemblance de nom et un compte que personne ne réclame.
    // Then le recollage ne tient un contenant que pour ce qu'on désigne comme tel : le
    // projet ne figure donc dans aucune liste d'applications.
    expect(PARC.groupes.map((groupe) => groupe.projet)).toEqual([
      "Radar des friches, osc-fr1",
      null,
    ]);
    expect(PARC.groupes.flatMap((groupe) => groupe.applications.map((une) => une.libelle))).toEqual(
      ["radar-api, osc-fr1", "radar-web, osc-fr1", "veille-sol, osc-secnum1"],
    );

    // And le nom et la région se retrouvent séparément, qui sont ce qu'un périmètre de
    // geste attend, sans que la base ait une colonne pour les porter.
    const api = PARC.groupes[0]?.applications[0];
    expect(api?.nom).toBe("radar-api");
    expect(api?.region).toBe("osc-fr1");

    // And le second sens sort du même recollage, sans relecture : les accès d'un compte
    // se lisent regroupés par projet, et un compte sans accès vivant reste visible.
    const noe = PARC.detenteurs.find((un) => un.handle === NOE.handle);
    expect(noe?.parProjet.map((groupe) => groupe.projet)).toEqual(["Radar des friches, osc-fr1"]);
    expect(noe?.parProjet[0]?.acces.map((un) => un.libelle)).toEqual(["radar-web, osc-fr1"]);
    expect(PARC.dernierConstat).toEqual(new Date("2026-09-12T02:00:00Z"));

    // When l'écran se rend.
    monter();

    // Then il dit d'abord ce qu'un projet fait, et où le geste se lit.
    expect(screen.getByText(MOTS_DE_SCALINGO.parc.regroupement)).toBeDefined();

    // And le groupe du projet porte son libellé et son compte d'applications, et le
    // reste se nomme « sans projet » sans se présenter comme un projet.
    expect(screen.getByText("Radar des friches, osc-fr1 (2)")).toBeDefined();
    expect(screen.getByText(`${MOTS_DE_SCALINGO.parc.horsProjetTitre} (1)`)).toBeDefined();
    expect(screen.getByText(MOTS_DE_SCALINGO.parc.horsProjet)).toBeDefined();

    // And aucun rôle n'arrive en anglais sous les yeux de qui décide d'une coupure.
    expect(within(ligneDe(TARIK.handle)).getByText(libelleDuRole("collaborator"))).toBeDefined();
    expect(within(ligneDe(NOE.handle)).getByText(libelleDuRole("limited"))).toBeDefined();
    expect(screen.queryByText("limited")).toBeNull();
    expect(screen.queryByText("owner")).toBeNull();

    // And l'invitation qui dort ne se présente pas comme une collaboration acceptée :
    // elle vit dans les métadonnées de l'identité et non dans le rôle.
    expect(
      within(ligneDe(NOE.handle)).getByText(MOTS_DE_SCALINGO.comptes.invitation),
    ).toBeDefined();
    expect(
      within(ligneDe(TARIK.handle)).queryByText(MOTS_DE_SCALINGO.comptes.invitation),
    ).toBeNull();

    // And ce que le connecteur a écrit d'autre se rend tel quel, sans interprétation.
    expect(within(ligneDe(ROBOT.handle)).getByText("Type de compte : automate")).toBeDefined();

    // And chaque ligne porte la date de son dernier constat, et non celle du parc.
    expect(within(ligneDe(TARIK.handle)).getByText("12 septembre 2026")).toBeDefined();
    expect(within(ligneDe(NOE.handle)).getByText("11 septembre 2026")).toBeDefined();

    // Then un seul geste est offert sur tout l'écran, et c'est celui du rattachement
    // sûr. Les trois autres lignes disent pourquoi elles n'en portent pas : un bouton
    // absent sans explication est une énigme.
    const boutons = screen.getAllByRole("button", { name: MOTS_DE_SCALINGO.role.bouton });
    expect(boutons).toHaveLength(1);
    expect(ligneDe(TARIK.handle).contains(boutons[0] as HTMLElement)).toBe(true);

    expect(
      within(ligneDe(PROPRIETAIRE.handle)).getByText(MOTS_DE_SCALINGO.role.proprietaire),
    ).toBeDefined();
    expect(
      within(ligneDe(NOE.handle)).getByText(MOTS_DE_SCALINGO.role.ressemblance, { exact: false }),
    ).toBeDefined();
    expect(
      within(ligneDe(ROBOT.handle)).getByText(MOTS_DE_SCALINGO.comptes.isole, { exact: false }),
    ).toBeDefined();

    // And la ressemblance se lit aussi comme telle dans sa colonne de rattachement : le
    // refus donne la raison, le badge donne l'état.
    expect(
      within(ligneDe(NOE.handle)).getByText(RATTACHEMENT_IDENTITE.HEURISTIC.libelle),
    ).toBeDefined();

    // And l'identité déclarée machine se nomme pour ce qu'elle est, et son refus donne
    // la bonne raison : la dire non rattachée serait contredit par son propre badge, et
    // l'envoyer dans la file des comptes isolés serait l'envoyer vers une liste dont la
    // clause l'exclut, faute de détenteur nul des deux côtés.
    const machine = within(ligneDe(DEPLOIEMENT.handle));
    expect(machine.getByText(DEPLOIEMENT.serviceAccount?.label ?? "")).toBeDefined();
    expect(machine.getByText(MOTS_DE_SCALINGO.comptes.machine, { exact: false })).toBeDefined();
    expect(machine.queryByText(MOTS_DE_SCALINGO.comptes.isole, { exact: false })).toBeNull();
    expect(machine.getByRole("link", { name: "Voir les comptes de service" })).toBeDefined();
    expect(machine.queryByRole("link", { name: "Voir la file des comptes isolés" })).toBeNull();
    expect(machine.getByText(RATTACHEMENT_IDENTITE.DECLARED.libelle)).toBeDefined();

    // And le lien vers les collaborateurs ne redit pas son propre texte dans un `title`,
    // ce que le RGAA compte comme un title redondant.
    const versScalingo = screen.getByRole("link", { name: MOTS_DE_SCALINGO.parc.collaborateurs });
    expect(versScalingo.getAttribute("title")).toBeNull();
  });

  it("envoie le geste par l'action existante, avec le périmètre que le connecteur validera", async () => {
    // Given l'écran rendu, et la seule ligne qui porte un geste.
    const utilisateur = userEvent.setup();
    monter();

    // When on ouvre la modale depuis cette ligne.
    await utilisateur.click(screen.getByRole("button", { name: MOTS_DE_SCALINGO.role.bouton }));
    ouvrir();

    // Then la modale nomme l'application visée et le rôle constaté, et propose les deux
    // rôles avec ce que chacun ouvre. Rien n'est encore parti.
    const dans = within(modale());
    expect(dans.getByText("radar-api, osc-fr1")).toBeDefined();
    // Le rôle constaté se lit dans son badge, et non dans le choix qu'on va faire : les
    // deux portent le même mot, et c'est celui du haut qui dit d'où l'on part.
    expect(modale().querySelector(".fr-badge")?.textContent).toBe(libelleDuRole("collaborator"));
    expect(dans.getByText(MOTS_DE_SCALINGO.role.plein)).toBeDefined();
    expect(dans.getByText(MOTS_DE_SCALINGO.role.limite)).toBeDefined();
    expect(ouvrirGeste).not.toHaveBeenCalled();

    // And les deux rôles offerts sont exactement ceux que le périmètre saura porter,
    // chacun accompagné de ce qu'il ouvre.
    const choix = [...modale().querySelectorAll<HTMLInputElement>('input[name="role-demande"]')];
    expect(choix.map((radio) => radio.value)).toEqual(["limited", "collaborator"]);

    // And le périmètre part du rôle que l'on demande, jamais de celui qu'on a constaté :
    // le rôle constaté est plein, donc c'est l'autre qui se propose d'emblée.
    const perimetre = () =>
      JSON.parse(
        String(modale().querySelector<HTMLInputElement>('input[name="scope"]')?.value),
      ) as { role: string };
    expect(perimetre().role).toBe("limited");

    // And le champ d'échéance n'est ni exigé ni accompagné de la phrase du rôle plein :
    // le refus de l'octroi ne porte que sur ce rôle, et l'annoncer ici annoncerait une
    // contrainte que rien n'oppose.
    const terme = () =>
      dans.getByLabelText(MOTS_DE_SCALINGO.role.terme, { exact: false }) as HTMLInputElement;
    expect(terme().required).toBe(false);
    expect(dans.queryByText(MOTS_DE_SCALINGO.role.termeAide)).toBeNull();

    // When on demande le rôle plein.
    const plein = choix.find((radio) => radio.value === "collaborator");
    const limite = choix.find((radio) => radio.value === "limited");
    if (!plein || !limite) {
      throw new Error("les deux rôles devraient se proposer");
    }
    await utilisateur.click(plein);

    // Then le périmètre suit le choix, et non l'inverse : un champ figé enverrait un
    // rôle que personne n'a demandé.
    expect(perimetre().role).toBe("collaborator");

    // And l'échéance devient exigée avant le clic, avec la phrase qui l'annonce : elle
    // était connue avant, et sans elle le refus n'arrivait qu'après l'envoi.
    expect(terme().required).toBe(true);
    expect(dans.getByText(MOTS_DE_SCALINGO.role.termeAide)).toBeDefined();

    // When on revient sur le rôle limité, on pose un terme et on écrit la justification.
    await utilisateur.click(limite);
    expect(terme().required).toBe(false);
    await utilisateur.type(
      dans.getByLabelText(MOTS_DE_SCALINGO.role.terme, { exact: false }),
      "30",
    );
    await utilisateur.type(
      dans.getByLabelText(MOTS_DE_SCALINGO.role.justification, { exact: false }),
      "renfort d'astreinte",
    );

    // When on écrit le brouillon.
    await utilisateur.click(dans.getByRole("button", { name: MOTS_DE_SCALINGO.role.envoi }));

    // Then c'est l'action du geste hors dossier qui part, et elle seule : l'écran ne
    // connaît aucun autre chemin vers l'écriture.
    expect(ouvrirGeste).toHaveBeenCalledTimes(1);

    // Then elle reçoit ce qu'elle lit vraiment, sous les noms qu'elle attend. Un champ
    // renommé ferait refuser chaque geste sans que rien ici ne proteste.
    const porte = vi.mocked(ouvrirGeste).mock.calls[0]?.[1] as FormData;
    expect(porte.get("systeme")).toBe("scalingo");
    expect(porte.get("username")).toBe(TARIK.person?.username);
    expect(porte.get("justification")).toBe("renfort d'astreinte");
    expect(porte.get("expiresInDays")).toBe("30");

    // And le périmètre porte la nature, la région, l'application et le rôle demandé :
    // c'est la forme que le schéma du connecteur validera, la région ne vient que du
    // libellé que la collecte a écrit, et le rôle est celui qu'on a demandé, différent
    // de celui qui est en place.
    expect(JSON.parse(String(porte.get("scope")))).toEqual({
      nature: "collaboration",
      region: "osc-fr1",
      application: "radar-api",
      role: "limited",
    });

    // Then ce qui se lit après le clic s'arrête à ce qui a été écrit : un brouillon,
    // et rien de parti sur Scalingo.
    expect(await dans.findByText(MOTS_DE_SCALINGO.role.brouillon)).toBeDefined();
  });
});

describe("l'écran entier, tel qu'il se lit au dessus de sa lecture en base", () => {
  it("date ce qu'il montre, nomme un compte de service et dit ce qu'une liste vide vaut", async () => {
    // Given la lecture en base doublée : le parc complet, et un compte constaté dont
    // plus aucun accès ne vit.
    lireLeParc.mockResolvedValue({ ressources: RESSOURCES, comptes: COMPTES });

    // When l'écran se rend en entier.
    render(await EcranScalingo());

    // Then il dit d'abord d'où vient ce qu'il montre, et le date : c'est la garantie
    // centrale du lot, et rien d'autre sur cet écran ne dit ce que vaut ce qu'on lit.
    expect(
      screen.getByText(
        `${MOTS_DE_SCALINGO.parc.datation} Le dernier constat de ce système date du 12 septembre 2026.`,
      ),
    ).toBeDefined();
    expect(screen.queryByText(MOTS_DE_SCALINGO.parc.rienDeVivant)).toBeNull();

    // And les deux sens y sont : le parc, puis qui détient un accès et où.
    expect(screen.getByRole("heading", { name: MOTS_DE_SCALINGO.parc.titre })).toBeDefined();
    expect(screen.getByRole("heading", { name: MOTS_DE_SCALINGO.comptes.titre })).toBeDefined();

    // And la section des comptes porte une ligne par compte constaté, celui sans accès
    // vivant compris : un compte qui disparaît de l'écran parce qu'il n'ouvre plus rien
    // est un compte que personne ne pense à couper.
    const ligne = (handle: string) => within(ligneDuCompte(handle));
    expect(ligne(SANS_ACCES.handle).getByText(MOTS_DE_SCALINGO.comptes.sansAcces)).toBeDefined();
    expect(ligne(TARIK.handle).getByText("Radar des friches, osc-fr1")).toBeDefined();
    expect(
      [...ligneDuCompte(TARIK.handle).querySelectorAll("li")].map((un) => un.textContent),
    ).toEqual([`radar-api, osc-fr1 : ${libelleDuRole("collaborator")}, vu le 12 septembre 2026`]);

    // And l'invitation qui dort se voit dans la colonne du compte, sans se présenter
    // comme une collaboration acceptée.
    expect(ligne(NOE.handle).getByText(MOTS_DE_SCALINGO.comptes.invitation)).toBeDefined();

    // Then une identité déclarée machine se nomme par sa fiche et renvoie là où elle se
    // traite. La dire « rattachée à personne » la contredirait trois fois sur le même
    // écran : son badge de rattachement, la section des comptes de service au dessus, et
    // la file où elle n'apparaît pas.
    const machine = ligne(DEPLOIEMENT.handle);
    expect(machine.getByText(DEPLOIEMENT.serviceAccount?.label ?? "")).toBeDefined();
    expect(machine.getByRole("link", { name: "Voir les comptes de service" })).toBeDefined();
    expect(machine.queryByText(MOTS_DE_SCALINGO.comptes.isole, { exact: false })).toBeNull();

    // And le compte que personne ne réclame, lui, reste envoyé vers cette file.
    expect(ligne(ROBOT.handle).getByText(MOTS_DE_SCALINGO.comptes.isole)).toBeDefined();
    expect(
      ligne(ROBOT.handle).getByRole("link", { name: "Voir la file des comptes isolés" }),
    ).toBeDefined();
  });

  it("ne dit jamais qu'une lecture vient d'être faite, et ne dit « rien de daté » que quand rien de vivant ne s'affiche", async () => {
    // Given une collecte qui n'a plus vu aucun accès, alors que les comptes tiennent :
    // la datation par les seuls accès faisait alors dire à l'écran que rien n'avait
    // jamais été daté, au dessus d'une liste de comptes datés.
    lireLeParc.mockResolvedValue({ ressources: [], comptes: [SANS_ACCES] });

    // When l'écran se rend.
    render(await EcranScalingo());

    // Then il date ce qui reste, et ne prétend pas que rien n'a jamais été vu.
    expect(
      screen.getByText(
        `${MOTS_DE_SCALINGO.parc.datation} Le dernier constat de ce système date du 12 septembre 2026.`,
      ),
    ).toBeDefined();
    expect(screen.queryByText(MOTS_DE_SCALINGO.parc.rienDeVivant)).toBeNull();

    // And le parc vide dit qu'il ne dit rien du parc réel.
    expect(screen.getByText(MOTS_DE_SCALINGO.parc.vide)).toBeDefined();

    cleanup();

    // Given un système où rien de vivant ne porte de date.
    lireLeParc.mockResolvedValue({ ressources: [], comptes: [] });

    // When l'écran se rend.
    render(await EcranScalingo());

    // Then la phrase de l'absence remplace la datation, et les deux listes disent
    // chacune ce qu'elles valent.
    expect(screen.getByText(MOTS_DE_SCALINGO.parc.rienDeVivant)).toBeDefined();
    expect(screen.getByText(MOTS_DE_SCALINGO.parc.vide)).toBeDefined();
    expect(screen.getByText(MOTS_DE_SCALINGO.comptes.vide)).toBeDefined();
    expect(screen.queryByText(MOTS_DE_SCALINGO.parc.datation, { exact: false })).toBeNull();
  });

  it("laisse la page de système n'affirmer « cet écran ne modifie rien » qu'au dessus d'un écran qui ne porte aucun geste", async () => {
    // Given les deux écrans de connecteur enregistrés, dont un seul porte un geste.
    const scalingo = ecranDe("scalingo");
    const github = ecranDe("github");

    if (!scalingo || !github) {
      throw new Error("les deux écrans devraient être enregistrés");
    }

    // Then l'écran qui journalise, écrit un plan et périme les brouillons précédents ne
    // laisse rien affirmer : rassurer au dessus d'un geste est le sens le plus coûteux
    // dans lequel une phrase d'écran puisse être fausse.
    expect(mentionDeLecture(await scalingo())).toBeNull();

    // And celui qui ne fait que montrer la laisse dire, comme l'absence d'écran.
    expect(mentionDeLecture(await github())).toBe(MENTION_SANS_ECRITURE);
    expect(mentionDeLecture(undefined)).toBe(MENTION_SANS_ECRITURE);

    // And la déclaration vient de l'écran lui-même : une exception nommant un
    // connecteur dans le socle serait une dépendance du socle vers lui.
    expect((await scalingo()).porteUnGeste).toBe(true);
    expect((await github()).porteUnGeste).toBeUndefined();
  });
});

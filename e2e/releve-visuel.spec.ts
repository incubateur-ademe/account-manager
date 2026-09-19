import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { OPERATRICE } from "../playwright.config";
import { anatomieDe, rendreAnatomie } from "./anatomie";
import {
  DOSSIER_ARRIVEE,
  DOSSIER_CLOS,
  DOSSIER_DEPART,
  STARTUP_ACTIVE,
  STARTUP_SORTIE,
  STARTUP_TERMINALE,
  semerLesEcransPleins,
} from "./semis-riche";
import { ouvrirUneSession, semer } from "./session";

/**
 * Il n'assert rien, il regarde. Il ne tient donc aucune garantie et ne compte pas parmi les trois
 * choses que l'étage de bout en bout prouve. Il ne tourne que sur demande, `RELEVE_VISUEL=1`.
 *
 * Ce que `pnpm cadre` ne peut pas voir en lisant du code : un titre injecté par react-dsfr, l'ordre
 * de lecture réel, la part de page qu'un bloc occupe, la densité d'un tableau peuplé, un contenu
 * répété d'une ligne à l'autre, le débordement en étroit. Ce sont ces mesures qui tranchent les
 * arbitrages de forme, à commencer par celui du formulaire déplié contre la modale.
 */

/*
 * Sous le dossier que Playwright ignore déjà, et non dans le répertoire temporaire du système :
 * celui-ci est partagé et son chemin est devinable, donc n'importe quel processus peut y poser un
 * lien symbolique avant nous.
 *
 * Playwright vide ce dossier au démarrage, y compris pour un autre fichier de scénarios : le
 * rapport et les captures ne survivent pas au lancement suivant. Les copier ailleurs avant de
 * relancer quoi que ce soit.
 */
const SORTIE = join(process.cwd(), "test-results", "releve-visuel");

const ECRANS = [
  { nom: "01-accueil", chemin: "/" },
  { nom: "02-personnes", chemin: "/personnes" },
  { nom: "03-personne-fiche", chemin: "/personnes/noor.exemple" },
  { nom: "04-personne-edition", chemin: "/personnes/compte.a.nommer.1/edit" },
  { nom: "05-personne-echeance-passee", chemin: "/personnes/tao.exemple" },
  { nom: "06-personne-surchargee", chemin: "/personnes/sacha.exemple" },
  { nom: "07-startups", chemin: "/startups" },
  { nom: "08-startup-active", chemin: `/startups/${STARTUP_ACTIVE}` },
  { nom: "09-startup-terminale", chemin: `/startups/${STARTUP_TERMINALE}` },
  { nom: "10-startup-sortie", chemin: `/startups/${STARTUP_SORTIE}` },
  { nom: "11-dossiers", chemin: "/dossiers" },
  { nom: "12-dossier-arrivee", chemin: `/dossiers/${DOSSIER_ARRIVEE}` },
  { nom: "13-dossier-depart", chemin: `/dossiers/${DOSSIER_DEPART}` },
  { nom: "14-dossier-clos", chemin: `/dossiers/${DOSSIER_CLOS}` },
  { nom: "15-constats", chemin: "/constats" },
  { nom: "16-comptes-isoles", chemin: "/comptes-isoles" },
  { nom: "17-comptes-de-service", chemin: "/comptes-de-service" },
  { nom: "18-systemes", chemin: "/systemes" },
  { nom: "19-systeme-github", chemin: "/systemes/github" },
  { nom: "20-systeme-scalingo", chemin: "/systemes/scalingo" },
  { nom: "21-collectes", chemin: "/collectes" },
  { nom: "22-modeles", chemin: "/modeles" },
  { nom: "23-modele-incubateur", chemin: "/modeles/incubateur" },
  { nom: "24-modele-startup", chemin: `/modeles/startup/${STARTUP_ACTIVE}` },
  { nom: "25-journal", chemin: "/journal" },
  { nom: "26-configuration", chemin: "/configuration" },
  { nom: "27-non-trouve", chemin: "/personnes/personne.inconnue" },
];

const ESPACE_PERSONNEL = [
  { nom: "28-moi", chemin: "/moi" },
  { nom: "29-moi-dossier", chemin: `/moi/dossiers/${DOSSIER_DEPART}` },
];

test("relever ce qui ne se lit pas dans le code", async ({ browser }) => {
  test.skip(process.env["RELEVE_VISUEL"] !== "1", "Relevé à la demande : RELEVE_VISUEL=1");
  test.setTimeout(900_000);

  await semer(semerLesEcransPleins);
  mkdirSync(`${SORTIE}/modales`, { recursive: true });
  mkdirSync(`${SORTIE}/etroit`, { recursive: true });
  mkdirSync(`${SORTIE}/erreurs`, { recursive: true });

  const contexte = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ouvrirUneSession(contexte, {
    username: OPERATRICE,
    personId: null,
    nom: "Opératrice Exemple",
  });
  const page = await contexte.newPage();

  const participante = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ouvrirUneSession(participante, {
    username: "lou.exemple",
    personId: "per-lou",
    nom: "Lou Exemple",
  });
  const pagePerso = await participante.newPage();

  const rapport: string[] = ["# Anatomie des écrans, mesurée dans le navigateur", ""];
  const modalesVues: string[] = [];

  /*
   * Les règles de forme que seul le navigateur sait tenir : elles portent sur ce qu'un écran rend,
   * pas sur ce que son source déclare. Le contenu d'une modale vit dans des composants enfants, et
   * la hauteur d'une ligne dépend de ce qu'on y a mis.
   *
   * « modales-sans-champ » ne vise pas zéro, et c'est délibéré. Les sept relevées sont deux modales
   * répétées sur quatre écrans, toutes deux assumées : ouvrir un dossier ne se défait pas, donc le
   * geste se confirme, et le menu de profils de l'arrivée ne s'affiche que si la politique en
   * déclare. Une modale qui ne demande rien reste suspecte, mais elle est légitime quand elle
   * confirme l'irréversible. Le plafond empêche d'en ajouter sans y penser.
   */
  const manquements: Record<string, string[]> = {
    "modales-sans-champ": [],
    "modales-au-dela-de-60-mots-par-champ": [],
    "ecrans-a-plus-d-un-bouton-primaire": [],
    "lignes-de-tableau-au-dela-de-120px": [],
    "colonnes-au-contenu-identique-partout": [],
    "contenus-repetes-dans-un-ecran": [],
    "modales-qui-ne-s-ouvrent-pas": [],
    "ecrans-qui-debordent-en-375px": [],
  };

  /*
   * Chaque bouton qui commande une boîte de dialogue, ouvert puis refermé. Le contenu d'une modale
   * n'existe pas tant qu'elle est fermée, et c'est justement ce qu'on veut comparer à un
   * formulaire déplié dans la page.
   *
   * Seuls les boutons qu'un écran rend cliquables. react-dsfr monte pour chaque modale un second
   * bouton porteur du même `aria-controls`, caché sous `fr-hidden` et retiré du parcours au
   * clavier. Personne ne peut le cliquer, et le relever faisait compter dix modales qui ne
   * s'ouvraient pas là où aucune n'était en cause.
   *
   * La visibilité se lit sur le style calculé, et pas seulement sur la boîte : un accordéon replié
   * garde une boîte pleine sous un `visibility: hidden` hérité, que le navigateur refuse quand
   * même de cliquer. C'est la définition de Playwright, reprise ici pour que le bouton choisi et
   * le bouton cliqué soient le même.
   */
  async function ciblesDeModale(vue: Page): Promise<{ id: string; libelle: string }[]> {
    return vue.evaluate(() => {
      const vus = new Set<string>();
      return (
        [...document.querySelectorAll("main button[aria-controls]")]
          /* Un bouton posé DANS la boîte la referme, il ne l'ouvre pas. */
          .filter((bouton) => bouton.closest("dialog") === null)
          .filter((bouton) => {
            const boite = bouton.getBoundingClientRect();
            if (boite.height === 0 || boite.width === 0) return false;
            return getComputedStyle(bouton).visibility !== "hidden";
          })
          .map((bouton) => ({
            id: bouton.getAttribute("aria-controls") ?? "",
            libelle: (bouton.textContent ?? "").replace(/\s+/gu, " ").trim(),
          }))
          .filter((cible) => {
            if (cible.id === "" || vus.has(cible.id)) return false;
            if (document.getElementById(cible.id)?.tagName !== "DIALOG") return false;
            vus.add(cible.id);
            return true;
          })
      );
    });
  }

  /*
   * L'espace personnel passe ici comme les autres écrans, avec la session qui le rend. Il était
   * photographié et raconté sans qu'aucun compteur ne le retienne, ce qui laissait croire que le
   * relevé couvrait tout ce qu'il capturait.
   */
  async function relever(vue: Page, ecran: { nom: string; chemin: string }): Promise<void> {
    await vue.goto(ecran.chemin, { waitUntil: "networkidle" });
    await vue.screenshot({ path: `${SORTIE}/${ecran.nom}.png`, fullPage: true });
    const anatomie = await anatomieDe(vue);
    rapport.push(...rendreAnatomie(ecran.nom, ecran.chemin, anatomie));

    if (anatomie.primaires.length > 1) {
      manquements["ecrans-a-plus-d-un-bouton-primaire"]?.push(
        `${ecran.nom} : ${anatomie.primaires.join(", ")}`,
      );
    }
    for (const ligne of anatomie.lignesTropHautes) {
      manquements["lignes-de-tableau-au-dela-de-120px"]?.push(`${ecran.nom} : ${ligne}`);
    }
    for (let i = 0; i < anatomie.colonnesConstantes; i += 1) {
      manquements["colonnes-au-contenu-identique-partout"]?.push(ecran.nom);
    }
    for (const repetition of anatomie.repetitions) {
      manquements["contenus-repetes-dans-un-ecran"]?.push(`${ecran.nom} : ${repetition}`);
    }

    /*
     * Les cibles sont relevées d'abord et ouvertes ensuite, une page rechargée entre chaque : un
     * clic qui navigue détruirait le contexte et emporterait les poignées restantes.
     */
    for (const [index, cible] of (await ciblesDeModale(vue)).entries()) {
      const dialogue = vue.locator(`#${cible.id}`);
      try {
        await vue
          .locator(`main button[aria-controls="${cible.id}"]`)
          .filter({ visible: true })
          .first()
          .click({ timeout: 3000 });
        await dialogue.waitFor({ state: "visible", timeout: 3000 });
        await vue.screenshot({ path: `${SORTIE}/modales/${ecran.nom}-${index + 1}.png` });

        const mesure = await dialogue.evaluate((noeud) => {
          const texte = (noeud.textContent ?? "").replace(/\s+/gu, " ").trim();
          return {
            hauteur: Math.round(noeud.getBoundingClientRect().height),
            champs: noeud.querySelectorAll("input:not([type=hidden]), select, textarea").length,
            boutons: noeud.querySelectorAll("button").length,
            mots: texte.split(" ").length,
            titre: (noeud.querySelector("h1,h2,h3")?.textContent ?? "").trim(),
          };
        });
        if (mesure.champs === 0) {
          manquements["modales-sans-champ"]?.push(
            `${ecran.nom} : ${mesure.titre} (${mesure.mots} mots)`,
          );
        } else if (mesure.mots / mesure.champs > 60) {
          manquements["modales-au-dela-de-60-mots-par-champ"]?.push(
            `${ecran.nom} : ${mesure.titre} (${mesure.mots} mots / ${mesure.champs})`,
          );
        }
        modalesVues.push(
          `  ${ecran.nom.padEnd(26)} « ${cible.libelle.slice(0, 30).padEnd(30)} » ouvre « ${mesure.titre.slice(0, 30).padEnd(30)} » ${String(mesure.hauteur).padStart(4)}px, ${mesure.champs} champ(s), ${mesure.boutons} bouton(s), ${mesure.mots} mots`,
        );
      } catch {
        modalesVues.push(`  ${ecran.nom.padEnd(26)} « ${cible.libelle.slice(0, 30)} » NON OUVERTE`);
        manquements["modales-qui-ne-s-ouvrent-pas"]?.push(
          `${ecran.nom} : « ${cible.libelle.slice(0, 40)} »`,
        );
      }
      await vue.goto(ecran.chemin, { waitUntil: "networkidle" });
    }
  }

  for (const ecran of ECRANS) await relever(page, ecran);
  for (const ecran of ESPACE_PERSONNEL) await relever(pagePerso, ecran);

  /*
   * Ce qui suit un clic n'avait jamais été regardé : les captures montraient le repos. Un formulaire
   * soumis vide est le cas le plus courant et le moins vu, et c'est là que les messages d'erreur se
   * lisent pour de vrai. ACTIONS_ENABLED vaut false et l'espace-membre pointe sur un port mort, donc
   * rien ne sort de la machine.
   */
  const erreurs: string[] = [];
  async function soumettreAVide(vue: Page, ecran: { nom: string; chemin: string }): Promise<void> {
    await vue.goto(ecran.chemin, { waitUntil: "networkidle" });
    for (const [index, cible] of (await ciblesDeModale(vue)).entries()) {
      const dialogue = vue.locator(`#${cible.id}`);
      try {
        await vue
          .locator(`main button[aria-controls="${cible.id}"]`)
          .filter({ visible: true })
          .first()
          .click({ timeout: 3000 });
        await dialogue.waitFor({ state: "visible", timeout: 3000 });
        const soumettre = dialogue.locator('button[type="submit"]').first();
        if ((await soumettre.count()) === 0) {
          await vue.keyboard.press("Escape");
          continue;
        }
        await soumettre.click({ timeout: 3000 });
        await vue.waitForTimeout(700);
        await vue.screenshot({ path: `${SORTIE}/erreurs/${ecran.nom}-${index + 1}.png` });

        const dit = await dialogue.evaluate((noeud) => {
          const message = noeud.querySelector(".fr-error-text, [role=alert], .fr-alert--error");
          const champ = noeud.querySelector("input:invalid, select:invalid, textarea:invalid");
          return {
            message: (message?.textContent ?? "").replace(/\s+/gu, " ").trim(),
            garde: champ === null ? "aucune" : "le navigateur retient la soumission",
          };
        });
        erreurs.push(
          `  ${ecran.nom.padEnd(26)} modale ${index + 1} : ${dit.message === "" ? `aucun message, ${dit.garde}` : `« ${dit.message.slice(0, 90)} »`}`,
        );
      } catch {
        erreurs.push(`  ${ecran.nom.padEnd(26)} modale ${index + 1} : non jouable`);
      }
      await vue.goto(ecran.chemin, { waitUntil: "networkidle" });
    }
  }

  for (const ecran of ECRANS) await soumettreAVide(page, ecran);
  for (const ecran of ESPACE_PERSONNEL) await soumettreAVide(pagePerso, ecran);

  const parle = erreurs.filter((ligne) => ligne.includes("«")).length;
  rapport.push(
    "\n# Ce qu'une soumission vide répond",
    "",
    `  ${parle} modale(s) sur ${erreurs.length} rendent un message de l'application. Partout ailleurs,`,
    "  les champs required font intercepter la soumission par le navigateur, dont la bulle n'est ni",
    "  rédigée ici ni forcément dans la langue de l'écran. La validation du serveur ne se voit donc",
    "  qu'en remplissant partiellement, ce que ce relevé ne fait pas.",
    "",
    ...erreurs,
  );

  rapport.push("\n# Les modales, telles qu'elles s'ouvrent", "", ...modalesVues);

  await page.setViewportSize({ width: 375, height: 812 });
  await pagePerso.setViewportSize({ width: 375, height: 812 });
  const debordent: string[] = [];
  async function releverEnEtroit(vue: Page, ecran: { nom: string; chemin: string }): Promise<void> {
    await vue.goto(ecran.chemin, { waitUntil: "networkidle" });
    await vue.screenshot({ path: `${SORTIE}/etroit/${ecran.nom}.png`, fullPage: true });
    const { deborde, hauteur } = await anatomieDe(vue);
    if (deborde) {
      debordent.push(`  ${ecran.nom} (${hauteur}px)`);
      manquements["ecrans-qui-debordent-en-375px"]?.push(`${ecran.nom} (${hauteur}px)`);
    }
  }

  for (const ecran of ECRANS) await releverEnEtroit(page, ecran);
  for (const ecran of ESPACE_PERSONNEL) await releverEnEtroit(pagePerso, ecran);
  await participante.close();

  rapport.push(
    "\n# En 375px",
    "",
    debordent.length === 0 ? "  Aucun débordement horizontal." : "  Débordent :",
    ...debordent,
  );

  const FICHIER = "e2e/seuils-visuels.json";
  /* Lire, et prendre l'absence pour réponse : tester puis lire laisse le fichier changer entre les
     deux. */
  let plafonds: Record<string, number> = {};
  try {
    plafonds = JSON.parse(readFileSync(FICHIER, "utf8")) as Record<string, number>;
  } catch {
    plafonds = {};
  }

  const bilan: string[] = ["\n# Les règles de forme, tenues par des plafonds", ""];
  const depassements: string[] = [];
  for (const [regle, cas] of Object.entries(manquements)) {
    const plafond = plafonds[regle];
    bilan.push(`  ${regle.padEnd(40)} ${String(cas.length).padStart(4)} / ${plafond ?? "?"}`);
    for (const cas_ of cas) bilan.push(`      ${cas_}`);
    if (plafond === undefined) {
      depassements.push(`${regle} : aucun plafond posé, lance POSER_LES_PLAFONDS=1`);
    } else if (cas.length > plafond) {
      depassements.push(`${regle} : ${cas.length} au lieu de ${plafond}`);
    }
  }
  rapport.push(...bilan);

  writeFileSync(`${SORTIE}/anatomie.md`, rapport.join("\n"), "utf8");
  await contexte.close();

  if (process.env["POSER_LES_PLAFONDS"] === "1") {
    const poses = Object.fromEntries(
      Object.entries(manquements).map(([regle, cas]) => [
        regle,
        Math.min(cas.length, plafonds[regle] ?? cas.length),
      ]),
    );
    writeFileSync(FICHIER, `${JSON.stringify(poses, null, 2)}\n`, "utf8");
  }

  expect(depassements, `Relevé complet dans ${SORTIE}/anatomie.md`).toEqual([]);
});

import { mkdirSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

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

const SORTIE = "/tmp/releve-visuel";

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
  { nom: "20-systeme-notion", chemin: "/systemes/notion" },
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

  const contexte = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ouvrirUneSession(contexte, {
    username: OPERATRICE,
    personId: null,
    nom: "Opératrice Exemple",
  });
  const page = await contexte.newPage();

  const rapport: string[] = ["# Anatomie des écrans, mesurée dans le navigateur", ""];
  const modalesVues: string[] = [];

  for (const ecran of ECRANS) {
    await page.goto(ecran.chemin, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${SORTIE}/${ecran.nom}.png`, fullPage: true });
    rapport.push(...rendreAnatomie(ecran.nom, ecran.chemin, await anatomieDe(page)));

    /*
     * Chaque bouton qui commande une boîte de dialogue, ouvert puis refermé. Le contenu d'une modale
     * n'existe pas tant qu'elle est fermée, et c'est justement ce qu'on veut comparer à un
     * formulaire déplié dans la page.
     *
     * Les cibles sont relevées d'abord et ouvertes ensuite, une page rechargée entre chaque : un
     * clic qui navigue détruirait le contexte et emporterait les poignées restantes.
     */
    const cibles = await page.evaluate(() => {
      const vus = new Set<string>();
      return (
        [...document.querySelectorAll("main button[aria-controls]")]
          /* Un bouton posé DANS la boîte la referme, il ne l'ouvre pas. */
          .filter((bouton) => bouton.closest("dialog") === null)
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

    for (const [index, cible] of cibles.entries()) {
      const dialogue = page.locator(`#${cible.id}`);
      try {
        await page
          .locator(`main button[aria-controls="${cible.id}"]`)
          .first()
          .click({ timeout: 3000 });
        await dialogue.waitFor({ state: "visible", timeout: 3000 });
        await page.screenshot({ path: `${SORTIE}/modales/${ecran.nom}-${index + 1}.png` });

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
        modalesVues.push(
          `  ${ecran.nom.padEnd(26)} « ${cible.libelle.slice(0, 30).padEnd(30)} » ouvre « ${mesure.titre.slice(0, 30).padEnd(30)} » ${String(mesure.hauteur).padStart(4)}px, ${mesure.champs} champ(s), ${mesure.boutons} bouton(s), ${mesure.mots} mots`,
        );
      } catch {
        modalesVues.push(`  ${ecran.nom.padEnd(26)} « ${cible.libelle.slice(0, 30)} » NON OUVERTE`);
      }
      await page.goto(ecran.chemin, { waitUntil: "networkidle" });
    }
  }

  const participante = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ouvrirUneSession(participante, {
    username: "lou.exemple",
    personId: "per-lou",
    nom: "Lou Exemple",
  });
  const pagePerso = await participante.newPage();
  for (const ecran of ESPACE_PERSONNEL) {
    await pagePerso.goto(ecran.chemin, { waitUntil: "networkidle" });
    await pagePerso.screenshot({ path: `${SORTIE}/${ecran.nom}.png`, fullPage: true });
    rapport.push(...rendreAnatomie(ecran.nom, ecran.chemin, await anatomieDe(pagePerso)));
  }
  await participante.close();

  rapport.push("\n# Les modales, telles qu'elles s'ouvrent", "", ...modalesVues);

  await page.setViewportSize({ width: 375, height: 812 });
  const debordent: string[] = [];
  for (const ecran of ECRANS) {
    await page.goto(ecran.chemin, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${SORTIE}/etroit/${ecran.nom}.png`, fullPage: true });
    const { deborde, hauteur } = await anatomieDe(page);
    if (deborde) debordent.push(`  ${ecran.nom} (${hauteur}px)`);
  }
  rapport.push(
    "\n# En 375px",
    "",
    debordent.length === 0 ? "  Aucun débordement horizontal." : "  Débordent :",
    ...debordent,
  );

  writeFileSync(`${SORTIE}/anatomie.md`, rapport.join("\n"), "utf8");
  await contexte.close();
});

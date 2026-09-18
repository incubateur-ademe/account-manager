import { mkdirSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

import { OPERATRICE } from "../playwright.config";
import { ouvrirUneSession, semer } from "./session";

/**
 * Il n'assert rien, il regarde. Il ne tient donc aucune garantie et ne compte pas parmi les trois
 * choses que l'étage de bout en bout prouve. Il ne tourne que sur demande, `RELEVE_VISUEL=1`.
 *
 * Le relevé de `src/cli/releve-ui.ts` lit du code et ne peut donc pas voir cinq choses :
 * l'ordre de lecture d'un écran, l'espacement réellement visible, l'arbre de titres du
 * document, la densité d'un tableau et le comportement en étroit. Celui-ci les rend, par
 * une capture et par l'arbre de titres tel que le DOM le porte.
 *
 * À supprimer une fois le regard porté. Il tient ici plutôt que dans /tmp parce que le
 * cookie signé exige le harnais de `session.ts`, et que Playwright a besoin de sa config.
 */

const SORTIE = "/tmp/releve-visuel";

const STARTUP = "suivi-de-friche";
const DOSSIER = "dos-arrivee-de-noor";

async function semerDeQuoiVoir(): Promise<void> {
  await semer(async (client) => {
    /* Noor sans échéance de mission, Tao avec : la cellule vide de SectionMembres est
       celle dont le tiret nu est devenu le rendu par défaut de <Absent>. */
    await client.query(
      `INSERT INTO "Person" (id, username, fullname, source, "primaryEmail", startups, "missionEnd", attachment)
       VALUES ('per-noor', 'noor.exemple', 'Noor Exemple', 'LOCAL', 'noor@exemple.fr', ARRAY[$1], NULL, 'STARTUPS'),
              ('per-tao', 'tao.exemple', 'Tao Exemple', 'LOCAL', 'tao@exemple.fr', ARRAY[$1], now() + interval '90 days', 'STARTUPS')`,
      [STARTUP],
    );

    /* Ni phase ni date de phase : les deux <Absent mention="inconnue" /> de la fiche. */
    await client.query(
      `INSERT INTO "Startup" (id, ghid, name, "incubatorGhid", "currentPhase", "phaseStart")
       VALUES ('sta-friche', $1, 'Suivi de friche', 'ademe', NULL, NULL)`,
      [STARTUP],
    );

    await client.query(
      `INSERT INTO "AccessCase" (id, "personId", kind, state) VALUES ($1, 'per-noor', 'ONBOARDING', 'CONFIRMED')`,
      [DOSSIER],
    );
  });
}

const ECRANS = [
  { nom: "accueil", chemin: "/" },
  { nom: "collectes", chemin: "/collectes" },
  { nom: "systemes", chemin: "/systemes" },
  { nom: "personnes", chemin: "/personnes" },
  { nom: "startups", chemin: "/startups" },
  { nom: "startup-fiche", chemin: `/startups/${STARTUP}` },
  { nom: "personne-fiche", chemin: "/personnes/noor.exemple" },
  { nom: "dossier", chemin: `/dossiers/${DOSSIER}` },
  { nom: "dossiers", chemin: "/dossiers" },
  { nom: "constats", chemin: "/constats" },
  { nom: "comptes-isoles", chemin: "/comptes-isoles" },
  { nom: "modeles", chemin: "/modeles" },
  { nom: "configuration", chemin: "/configuration" },
  { nom: "journal", chemin: "/journal" },
];

test("relever ce qui ne se lit pas dans le code", async ({ browser }) => {
  test.skip(process.env["RELEVE_VISUEL"] !== "1", "Relevé à la demande : RELEVE_VISUEL=1");
  test.setTimeout(180_000);

  await semerDeQuoiVoir();
  mkdirSync(SORTIE, { recursive: true });

  const contexte = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ouvrirUneSession(contexte, {
    username: OPERATRICE,
    personId: null,
    nom: "Opératrice Exemple",
  });
  const page = await contexte.newPage();

  const rapport: string[] = [];

  for (const ecran of ECRANS) {
    await page.goto(ecran.chemin, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${SORTIE}/${ecran.nom}.png`, fullPage: true });

    const titres = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
        (titre) =>
          `${titre.tagName.toLowerCase()}  ${(titre.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 70)}`,
      ),
    );
    const hauteur = await page.evaluate(() => document.body.scrollHeight);
    const sousLaLigne = Math.max(0, hauteur - 1000);

    rapport.push(
      `\n### ${ecran.nom}  (${ecran.chemin})`,
      `hauteur ${hauteur}px, dont ${sousLaLigne}px sous la ligne de flottaison`,
      ...titres.map((t) => `  ${t}`),
      titres.length === 0 ? "  (aucun titre)" : "",
    );
  }

  await page.setViewportSize({ width: 375, height: 812 });
  for (const ecran of ECRANS.slice(0, 8)) {
    await page.goto(ecran.chemin, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${SORTIE}/etroit-${ecran.nom}.png`, fullPage: true });
    const deborde = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (deborde) rapport.push(`\nDÉBORDEMENT HORIZONTAL EN 375px : ${ecran.nom}`);
  }

  writeFileSync(`${SORTIE}/arbres-de-titres.md`, rapport.join("\n"), "utf8");
  await contexte.close();
});

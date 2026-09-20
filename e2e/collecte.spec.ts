import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { OPERATRICE } from "../playwright.config";
import { ouvrirUneSession, semer } from "./session";

/**
 * Une collecte lancee depuis l'ecran, jouee pour de vrai, et les ecrans qui en rendent compte.
 *
 * Ce qu'aucun autre etage ne tient. L'etage d'integration appelle `executerSync` en direct et
 * voit ce qu'elle ecrit ; il ne passe ni par le bouton, ni par l'action serveur, ni par le
 * verrou de lancement, ni par la revalidation des chemins, ni par le rendu. Le releve visuel,
 * lui, ouvre des ecrans deja peuples par un semis, jamais par une collecte.
 *
 * La lecture du referentiel est jouee par `e2e/faux-espace-membre.ts`, seul systeme amont que
 * ce depot sait pointer ailleurs. Les trois connecteurs restent sans credential, donc au tier
 * `none`, et la collecte les saute en le disant. Ce scenario porte donc le passage du
 * perimetre, celui des startups et celui des constats, et rien du transport des connecteurs,
 * qui appartient a leurs tests de contrat.
 */

/** Une collecte part en arriere-plan, et la page ne se rafraichit pas d'elle-meme. */
async function attendreLaFin(vue: Page, attendu: RegExp): Promise<void> {
  await expect(async () => {
    await vue.reload();
    await expect(vue.getByRole("main")).toContainText(attendu);
  }).toPass({ timeout: 60_000 });
}

test("une collecte lancee depuis l'ecran peuple le perimetre et leve ses constats", async ({
  browser,
}) => {
  // Given une base vide, et une operatrice devant l'ecran des collectes.
  await semer(async () => undefined);
  const contexte = await browser.newContext();
  await ouvrirUneSession(contexte, { username: OPERATRICE, personId: null });
  const vue = await contexte.newPage();

  await vue.goto("/personnes");
  await expect(vue.getByRole("main")).not.toContainText("Noor Exemple");

  // When elle lance une collecte, et que celle-ci se termine.
  await vue.goto("/collectes");
  await vue.getByRole("button", { name: "Lancer une collecte" }).click();
  await attendreLaFin(vue, /espace-membre/u);

  // Then le referentiel a bien ete lu, et l'ecran des collectes le dit.
  await expect(vue.getByRole("main")).toContainText("espace-membre");

  // Then les personnes que la collecte a creees sont sur leur ecran, avec leur fiche.
  await vue.goto("/personnes");
  const personnes = vue.getByRole("main");
  await expect(personnes).toContainText("Noor Exemple");
  await expect(personnes).toContainText("Tao Exemple");
  await expect(personnes).toContainText("Iris Exemple");

  await vue.goto("/personnes/noor.exemple");
  await expect(vue.getByRole("main")).toContainText("Suivi de friche");

  // Then les startups de l'incubateur ont suivi le meme passage, la phase de chacune
  // comprise. Celle qui est en phase terminale se compte, et le filtre par defaut la
  // masque, ce que le scenario traverse plutot que de l'ignorer.
  await vue.goto("/startups");
  const startups = vue.getByRole("main");
  await expect(startups).toContainText("Suivi de friche");
  await expect(startups).toContainText("1 en phase terminale");
  await vue.getByRole("link", { name: "En phase terminale" }).click();
  await expect(vue.getByRole("main")).toContainText("Cartographie des sols");

  // Then la collecte a leve ses constats sur ce qu'elle vient de lire, ce qu'aucun semis
  // n'aurait pu prouver : c'est le calcul qui les produit, pas le scenario qui les pose.
  await vue.goto("/constats");
  await expect(vue.getByRole("main")).toContainText("Iris Exemple");

  await contexte.close();
});

import { expect, test } from "@playwright/test";

import { OPERATRICE } from "../playwright.config";
import { ouvrirUneSession, semer } from "./session";

/**
 * Ce qu'aucun autre étage ne peut prouver : qu'un cookie franchisse la barrière et que
 * la garde de session sépare vraiment un opérateur d'un participant.
 *
 * La règle elle-même est tenue plus bas, et bien : `espace-du-participant.test.ts` rend
 * les deux écrans, et `actions.test.ts` exerce le droit et sa révocation. Ce qui n'est
 * tenu nulle part, c'est le câblage entre les deux : le cookie signé, le proxy qui
 * constate sans valider, `auth()` qui décode, `requireOperateur` qui renvoie ailleurs
 * plutôt que de refuser, et l'écran qui se rend et s'hydrate pour de vrai.
 *
 * C'est aussi ce que la recette manuelle déclare hors d'atteinte : un testeur seul sur
 * son poste n'a qu'une session, celle d'un opérateur, et ne peut pas être quelqu'un
 * d'autre.
 */

const PORTEUSE = { username: "solene.exemple", fullname: "Solène Exemple" };
const PARTICIPANT = { username: "camille.exemple", fullname: "Camille Exemple" };

/** Des identifiants lisibles plutôt que des `cuid()` : une assertion doit pouvoir les nommer. */
const DOSSIER = "dos-du-depart-de-solene";
const PARTICIPANTE = "per-camille";

async function semerLeDroit(): Promise<void> {
  await semer(async (client) => {
    await client.query(
      `INSERT INTO "Person" (id, username, fullname, source) VALUES ($1, $2, $3, 'LOCAL'), ($4, $5, $6, 'LOCAL')`,
      ["per-solene", PORTEUSE.username, PORTEUSE.fullname, PARTICIPANTE, PARTICIPANT.username, PARTICIPANT.fullname],
    );
    await client.query(
      `INSERT INTO "AccessCase" (id, "personId", kind, state) VALUES ($1, 'per-solene', 'OFFBOARDING', 'CONFIRMED')`,
      [DOSSIER],
    );
    // Trente jours : un droit vivant, que `participationVivante` ne filtre pas.
    await client.query(
      `INSERT INTO "CaseParticipation" (id, "accessCaseId", "personId", reason, "grantedBy", "expiresAt")
       VALUES ('par-camille', $1, $2, 'accompagne ce départ', $3, now() + interval '30 days')`,
      [DOSSIER, PARTICIPANTE, OPERATRICE],
    );
  });
}

test("un droit nominatif ouvre un seul dossier à qui n'est pas opérateur", async ({ browser }) => {
  // Given un départ ouvert sur une personne, et un droit vivant posé sur quelqu'un
  // d'autre, qui n'est pas dans l'allowlist de ce serveur.
  await semerLeDroit();

  const sansPersonne = await browser.newContext();
  const page = await sansPersonne.newPage();

  // When personne n'est connecté
  // Then la barrière renvoie à la connexion, et c'est le proxy qui le fait, avant même
  // que la page n'existe.
  await page.goto("/moi");
  await expect(page).toHaveURL(/\/login/);
  await sansPersonne.close();

  // Given la session du participant, telle qu'un lien suivi l'aurait posée.
  const cotePartipant = await browser.newContext();
  await ouvrirUneSession(cotePartipant, {
    username: PARTICIPANT.username,
    personId: PARTICIPANTE,
    nom: PARTICIPANT.fullname,
  });
  const sien = await cotePartipant.newPage();

  /**
   * Ce que le navigateur a trouvé à redire, mis de côté plutôt qu'assert tout de
   * suite : une plainte console arrive après la ligne qui l'a causée.
   *
   * Le bruit connu est écarté nommément. La mesure de performance négative vient de
   * l'instrumentation de React sur un rendu serveur interrompu par une redirection,
   * elle est documentée dans `CLAUDE.md`, absente de la production, et rien d'ici ne
   * la fera taire.
   */
  const plaintes: string[] = [];
  sien.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("negative time stamp")) {
      plaintes.push(message.text());
    }
  });

  // When il demande l'écran d'opérateur du dossier auquel il a pourtant droit
  await sien.goto(`/dossiers/${DOSSIER}`);

  // Then il est renvoyé vers son espace, et non vers la connexion : ce qui lui manque
  // n'est pas une preuve d'identité, c'est un droit sur cet écran-ci. Les deux refus ne
  // disent pas la même chose, et cette différence ne se voit qu'ici.
  await expect(sien).toHaveURL(/\/moi$/);

  // Then son espace porte le dossier, nommé par la personne concernée : le cookie a été
  // décodé, la fiche résolue par `personId`, le droit relu, et l'écran rendu.
  await expect(sien.getByRole("heading", { name: "Mon espace" })).toBeVisible();
  await expect(sien.getByRole("link", { name: PORTEUSE.fullname })).toBeVisible();

  // When il ouvre le dossier par sa porte à lui
  await sien.getByRole("link", { name: PORTEUSE.fullname }).click();

  // Then il y entre, et l'écran s'hydrate sans mourir. C'est le seul risque que les
  // deux étages du dessous ne voient pas : ils rendent des composants, ils ne les font
  // pas vivre dans un navigateur.
  await expect(sien).toHaveURL(new RegExp(`/moi/dossiers/${DOSSIER}$`));
  // Le titre de la page, nommé par son rôle : le système de design embarque sa
  // propre modale de thème, dont le titre est aussi un `h1`.
  await expect(sien.getByRole("heading", { level: 1, name: new RegExp(PORTEUSE.fullname) })).toBeVisible();

  // Then l'écran n'est pas seulement rendu, il est vivant : la modale d'affichage du
  // système de design est un composant client, et son ouverture prouve que React a
  // repris la main sur le HTML que le serveur a envoyé. C'est très exactement ce
  // qu'aucun des deux étages du dessous ne peut voir : ils montent des composants,
  // ils ne les font pas vivre dans un navigateur.
  const aide = sien.getByRole("button", { name: "Mode aide" });
  await expect(aide).toHaveAttribute("aria-pressed", "true");
  await aide.click();
  await expect(aide).toHaveAttribute("aria-pressed", "false");

  // Then et c'est bien lui qui est connecté, jusque dans l'en-tête : le nom vient du
  // jeton, pas de l'écran.
  await expect(
    sien.getByRole("button", { name: `Se déconnecter (${PARTICIPANT.username})` }),
  ).toBeVisible();

  // Then et il s'est hydraté sans rien casser en chemin.
  expect(plaintes).toEqual([]);
  await cotePartipant.close();

  // Given la session d'une opératrice, dont le nom est dans l'allowlist.
  const coteOperatrice = await browser.newContext();
  await ouvrirUneSession(coteOperatrice, { username: OPERATRICE, personId: null });
  const leSien = await coteOperatrice.newPage();

  // When elle demande le même écran de dossier
  await leSien.goto(`/dossiers/${DOSSIER}`);

  // Then elle y entre, sur le même serveur, avec la même barrière et le même cookie
  // signé. Seul le nom change, et c'est tout ce qui sépare les deux.
  await expect(leSien).toHaveURL(new RegExp(`/dossiers/${DOSSIER}$`));
  await expect(leSien.getByRole("heading", { level: 1, name: new RegExp(PORTEUSE.fullname) })).toBeVisible();

  // Then et son espace à elle ne porte aucun dossier : elle n'a pas de fiche, donc pas
  // de droit de participation. Être opératrice n'ouvre pas la porte du participant.
  await leSien.goto("/moi");
  await expect(leSien.getByText("Aucun dossier ne vous est ouvert")).toBeVisible();
  await coteOperatrice.close();
});

import { describe, expect, it } from "vitest";

/**
 * Notion ne publie pour SCIM ni schéma, ni journal des changements, ni le moindre
 * exemple de corps de réponse : sa seule documentation est une page d'aide. Tout ce
 * que le connecteur lit est donc non spécifié, et un champ qui disparaîtrait ne se
 * signalerait par aucune annonce. Ce test est le seul endroit où cela se verrait
 * avant que la collecte ne fasse passer tout le monde pour parti.
 *
 * Il lit `process.env` et jamais `env` : passer par le schéma exigerait une base de
 * données pour vérifier la forme d'une réponse distante.
 */
const JETON = process.env["NOTION_SCIM_TOKEN"];

const EXTENSION = "urn:ietf:params:scim:schemas:extension:notion:2.0:User";

/** Le plafond du serveur, et une page entière coûte la même requête que deux fiches. */
const PAR_PAGE = 100;

interface Enveloppe {
  totalResults?: unknown;
  Resources?: unknown;
}

async function premierePage(): Promise<Enveloppe> {
  const reponse = await fetch(
    `https://api.notion.com/scim/v2/Users?startIndex=1&count=${PAR_PAGE}`,
    {
      headers: { authorization: `Bearer ${JETON}`, accept: "application/scim+json" },
    },
  );

  expect(reponse.ok, `l'API SCIM a répondu ${reponse.status}`).toBe(true);
  return (await reponse.json()) as Enveloppe;
}

// S'ignore proprement sans jeton, de sorte que `pnpm test` reste exécutable sans
// secret, en local comme sur une contribution externe.
describe.skipIf(!JETON)("la forme de la réponse SCIM de Notion n'a pas changé", () => {
  it("rend une enveloppe dénombrée, dont chaque membre reste exploitable", async () => {
    const enveloppe = await premierePage();

    expect(typeof enveloppe.totalResults).toBe("number");
    expect(Array.isArray(enveloppe.Resources)).toBe(true);

    const membres = enveloppe.Resources as Record<string, unknown>[];
    expect(membres.length).toBeGreaterThan(0);

    for (const membre of membres) {
      // Sans ces deux champs, une identité ne peut pas exister : leur disparition
      // ferait écarter tout le monde, donc dater tout le monde comme disparu.
      expect(typeof membre["id"]).toBe("string");
      expect(membre["id"]).not.toBe("");
      expect(typeof membre["userName"]).toBe("string");
      expect(membre["userName"]).toContain("@");

      // `name` n'est surveillé par rien, et c'est délibéré : ce test a établi qu'aucun
      // de ses sous-champs n'est garanti, pas même `formatted`, contrairement à ce que
      // deux fiches laissaient croire. Le connecteur ne le lit donc pas du tout, et il
      // n'y a rien à protéger ici.

      // L'extension porte le rôle d'espace, sous une clé propre à Notion qu'aucune
      // spécification ne protège.
      const extension = membre[EXTENSION] as Record<string, unknown> | undefined;
      if (extension) {
        expect(["owner", "membership_admin", "member", "restricted_member"]).toContain(
          extension["role"],
        );
      }

      // Les horodatages sont des chaînes de chiffres et non des dates ISO : le
      // connecteur ne les lit pas, et ce test existe pour qu'on s'en souvienne le
      // jour où quelqu'un voudra s'en servir.
      const meta = membre["meta"] as Record<string, unknown> | undefined;
      if (meta?.["created"] !== undefined) {
        expect(typeof meta["created"]).toBe("string");
      }
    }

    // Au moins un compte actif, faute de quoi la réponse serait exacte dans sa forme
    // et vide de sens.
    expect(membres.some((membre) => membre["active"] === true)).toBe(true);

    // Et au moins un rôle rendu. Sans cette assertion, une extension que Notion
    // renommerait deviendrait indistinguable d'une extension absente : tout le monde
    // passerait pour un membre ordinaire, sur une collecte parfaitement verte.
    expect(membres.some((membre) => membre[EXTENSION] !== undefined)).toBe(true);
  });

  it("refuse un jeton qui n'est pas le bon", async () => {
    const reponse = await fetch("https://api.notion.com/scim/v2/Users?count=1", {
      headers: { authorization: "Bearer jeton-volontairement-faux" },
    });

    // Ce qui compte n'est pas le code exact, que Notion ne documente pas, mais qu'un
    // jeton mort ne rende jamais un inventaire vide sous un succès.
    expect(reponse.ok).toBe(false);
  });
});

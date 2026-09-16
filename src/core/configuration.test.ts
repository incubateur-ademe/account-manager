import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cheminsConnus, convertir, fusionner, nomDeVariable, resoudre } from "./configuration";

const SCHEMA = z.strictObject({
  mail: z
    .strictObject({
      domainsLostOnDeparture: z.array(z.string()).default([]),
    })
    .prefault({}),
  thresholds: z
    .strictObject({
      graceDays: z.number().default(7),
      maxScopeDrop: z.number().default(0.2),
    })
    .prefault({}),
  profiles: z.array(z.strictObject({ key: z.string() })).default([]),
});

describe("d'où une valeur de configuration tient ce qu'elle vaut", () => {
  it("dérive les chemins réglables du schéma, et leur nom d'environnement avec", () => {
    const connus = cheminsConnus(SCHEMA);

    // Then les feuilles, et elles seules : surcharger un objet entier écraserait des clés
    // que personne n'a nommées, et la provenance ne saurait quoi afficher
    expect(connus.map(({ chemin }) => chemin)).toEqual([
      "mail.domainsLostOnDeparture",
      "thresholds.graceDays",
      "thresholds.maxScopeDrop",
    ]);

    // Then un tableau d'objets n'en est pas : une liste de profils ne se règle pas par une
    // variable d'environnement, et prétendre le contraire donnerait une syntaxe illisible
    expect(connus.map(({ chemin }) => chemin)).not.toContain("profiles");

    // Then le nom se dérive du chemin et ne se choisit jamais : posé à la main, il finirait
    // par désigner autre chose que la clé qu'il surcharge
    expect(nomDeVariable("mail.domainsLostOnDeparture")).toBe(
      "CONFIG_MAIL_DOMAINS_LOST_ON_DEPARTURE",
    );
    expect(connus.find(({ chemin }) => chemin === "thresholds.graceDays")?.variable).toBe(
      "CONFIG_THRESHOLDS_GRACE_DAYS",
    );
    expect(connus.find(({ chemin }) => chemin === "thresholds.graceDays")?.forme).toBe("nombre");
  });

  it("fait gagner la base sur le fichier, et le fichier sur l'environnement", () => {
    const connus = cheminsConnus(SCHEMA);

    const resolue = resoudre(connus, {
      environnement: {
        CONFIG_MAIL_DOMAINS_LOST_ON_DEPARTURE: "un.exemple, deux.exemple",
        CONFIG_THRESHOLDS_GRACE_DAYS: "3",
        CONFIG_THRESHOLDS_MAX_SCOPE_DROP: "0.5",
      },
      fichier: { thresholds: { graceDays: 7 } },
      base: { "thresholds.maxScopeDrop": 0.1 },
    });

    // Then chaque niveau l'emporte sur le précédent, et ce qu'aucun ne porte reste au
    // niveau qui le portait : déclarer un seul seuil dans un fichier n'efface pas les
    // autres, faute de quoi l'environnement deviendrait inutilisable dès qu'un fichier
    // existe
    expect(resolue.valeurs).toEqual({
      mail: { domainsLostOnDeparture: ["un.exemple", "deux.exemple"] },
      thresholds: { graceDays: 7, maxScopeDrop: 0.1 },
    });

    // Then la provenance dit d'où vient chacune : trois niveaux font trois endroits où se
    // tromper, et sans elle personne ne saura pourquoi un réglage ne prend pas
    expect(resolue.provenances).toEqual([
      { chemin: "mail.domainsLostOnDeparture", niveau: "environnement" },
      { chemin: "thresholds.graceDays", niveau: "fichier" },
      { chemin: "thresholds.maxScopeDrop", niveau: "base" },
    ]);
  });

  it("dit ce qu'aucun chemin ne réclame, et laisse le schéma combler le reste", () => {
    const connus = cheminsConnus(SCHEMA);

    const resolue = resoudre(connus, {
      environnement: { CONFIG_THRESHOLDS_GRACE_DAY: "3", AUTRE_CHOSE: "sans rapport" },
      fichier: {},
      base: {},
    });

    // Then la faute de frappe est nommée. Elle ne se voit nulle part ailleurs : la valeur
    // ne prend pas, et rien ne le dirait
    expect(resolue.inconnues).toEqual(["CONFIG_THRESHOLDS_GRACE_DAY"]);

    // Then ce qu'aucune source ne porte n'est pas posé : c'est le schéma qui comblera, et
    // poser une valeur ici la ferait passer pour un choix
    expect(resolue.valeurs).toEqual({});
    expect(resolue.provenances.every(({ niveau }) => niveau === "defaut")).toBe(true);
  });

  it("convertit ce que l'environnement rend dans la forme que le schéma attend", () => {
    // Then une liste se sépare par des virgules, seule syntaxe qu'on écrive dans un
    // environnement sans la citer, et une valeur vide vaut liste vide
    expect(convertir("a, b ,c", "liste")).toEqual(["a", "b", "c"]);
    expect(convertir("", "liste")).toEqual([]);
    expect(convertir("7", "nombre")).toBe(7);

    // Then ce qui n'est pas un nombre le reste, et ne devient ni zéro ni NaN : le premier
    // poserait un seuil que personne n'a écrit, le second un refus dont le message ne
    // dirait pas que la valeur n'en était pas un
    expect(convertir("vingt", "nombre")).toBe("vingt");
    expect(convertir("", "nombre")).toBe("");
    expect(convertir("true", "booleen")).toBe(true);
    expect(convertir("false", "booleen")).toBe(false);
    expect(convertir("ademe", "texte")).toBe("ademe");
  });

  it("réunit les objets et remplace les tableaux", () => {
    // Then les objets se rejoignent : sans quoi déclarer un seuil en effacerait un autre
    expect(fusionner({ a: { x: 1, y: 2 } }, { a: { y: 3 } })).toEqual({ a: { x: 1, y: 3 } });

    // Then les tableaux se remplacent. Les fusionner interdirait d'en retirer une entrée,
    // et c'est le premier usage de ces listes
    expect(fusionner({ l: ["un", "deux"] }, { l: ["un"] })).toEqual({ l: ["un"] });
  });
});

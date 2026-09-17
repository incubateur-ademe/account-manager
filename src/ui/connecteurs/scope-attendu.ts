import { z } from "zod";

export interface ChampDeScope {
  nom: string;
  requis: boolean;
  /** La forme admise, rédigée pour être lue : « texte non vide », « l'une de : member, admin ». */
  attendu: string;
  description?: string;
  exemple?: string;
}

export interface VarianteDeScope {
  /** Ce qui désigne cette branche : « nature = collaboration », à défaut son rang. */
  libelle: string;
  champs: readonly ChampDeScope[];
  clesInconnuesRefusees: boolean;
}

export type ScopeAttendu =
  | {
      etat: "lu";
      champs: readonly ChampDeScope[];
      clesInconnuesRefusees: boolean;
      /** Vide quand le scope n'a qu'une forme. Sinon une entrée par branche. */
      variantes: readonly VarianteDeScope[];
    }
  | { etat: "illisible" };

const champLu = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  minLength: z.number().optional(),
  description: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
});

type ChampLu = z.infer<typeof champLu>;

const objetLu = z.object({
  properties: z.record(z.string(), champLu).default({}),
  required: z.array(z.string()).default([]),
  additionalProperties: z.unknown().optional(),
});

const brancheLue = objetLu.extend({ type: z.literal("object") });

const racineAPlusieursFormes = z.object({
  oneOf: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
});

const TYPES: Readonly<Record<string, string>> = {
  array: "liste",
  boolean: "oui ou non",
  integer: "entier",
  null: "vide",
  number: "nombre",
  object: "objet",
  string: "texte",
};

/**
 * `enum` et `const` disent la même chose : un ensemble clos de valeurs. Zod n'emploie
 * pourtant que le second pour un littéral, donc pour le discriminant d'une union, et
 * l'ignorer afficherait « texte » là où l'écran doit montrer la valeur à écrire.
 */
function valeursAdmises(champ: ChampLu): readonly unknown[] | undefined {
  if (champ.enum !== undefined && champ.enum.length > 0) {
    return champ.enum;
  }

  return champ.const === undefined ? undefined : [champ.const];
}

function attendu(champ: ChampLu): string {
  const valeurs = valeursAdmises(champ);

  if (valeurs !== undefined) {
    const libelles = valeurs.map((valeur) => String(valeur));

    return libelles.length === 1
      ? `exactement : ${libelles[0]}`
      : `l'une de : ${libelles.join(", ")}`;
  }

  const types = typeof champ.type === "string" ? [champ.type] : (champ.type ?? []);
  const libelles = types.map((type) => TYPES[type] ?? type);
  const forme = libelles.length > 0 ? libelles.join(" ou ") : "valeur";

  return champ.type === "string" && (champ.minLength ?? 0) > 0 ? `${forme} non vide` : forme;
}

function exemple(champ: ChampLu): string | undefined {
  const premier = champ.examples?.[0];

  if (premier === undefined) {
    return undefined;
  }

  return typeof premier === "string" ? premier : JSON.stringify(premier);
}

function decrire(nom: string, requis: boolean, champ: ChampLu): ChampDeScope {
  const illustration = exemple(champ);

  return {
    nom,
    requis,
    attendu: attendu(champ),
    ...(champ.description === undefined ? {} : { description: champ.description }),
    ...(illustration === undefined ? {} : { exemple: illustration }),
  };
}

interface ChampBrut {
  nom: string;
  requis: boolean;
  champ: ChampLu;
}

interface FormeLue {
  champs: readonly ChampBrut[];
  clesInconnuesRefusees: boolean;
}

function formeLue(lu: z.infer<typeof objetLu>): FormeLue {
  const requis = new Set(lu.required);

  return {
    champs: Object.entries(lu.properties).map(([nom, champ]) => ({
      nom,
      requis: requis.has(nom),
      champ,
    })),
    clesInconnuesRefusees: lu.additionalProperties === false,
  };
}

function typesDe(champ: ChampLu): readonly string[] {
  return typeof champ.type === "string" ? [champ.type] : (champ.type ?? []);
}

/**
 * Deux branches qui portent le même champ n'en font qu'un dans la vue à plat, et ce champ
 * n'a le droit de rien promettre qu'une des deux ne tienne : un ensemble clos ne survit
 * que si les deux en ont un, et la longueur minimale est la plus permissive des deux.
 */
function fusionnerUnChamp(a: ChampLu, b: ChampLu): ChampLu {
  const valeursA = valeursAdmises(a);
  const valeursB = valeursAdmises(b);
  const valeurs =
    valeursA === undefined || valeursB === undefined
      ? undefined
      : [...new Set([...valeursA, ...valeursB])];
  const types = [...new Set([...typesDe(a), ...typesDe(b)])];

  return {
    type: types.length === 1 ? types[0] : types,
    enum: valeurs,
    const: undefined,
    minLength:
      a.minLength === undefined || b.minLength === undefined
        ? undefined
        : Math.min(a.minLength, b.minLength),
    description: a.description ?? b.description,
    examples: a.examples ?? b.examples,
  };
}

function fusionner(formes: readonly FormeLue[]): readonly ChampDeScope[] {
  const occurrences = new Map<string, ChampBrut[]>();
  const ordre: string[] = [];

  for (const forme of formes) {
    for (const brut of forme.champs) {
      const deja = occurrences.get(brut.nom);

      if (deja === undefined) {
        occurrences.set(brut.nom, [brut]);
        ordre.push(brut.nom);
      } else {
        deja.push(brut);
      }
    }
  }

  return ordre.map((nom) => {
    const bruts = occurrences.get(nom) ?? [];

    return decrire(
      nom,
      bruts.length === formes.length && bruts.every(({ requis }) => requis),
      bruts.map(({ champ }) => champ).reduce(fusionnerUnChamp),
    );
  });
}

/**
 * Le schéma JSON ne dit pas quel champ discrimine : on le reconnaît à ce qu'il fait, être
 * partout figé sur une valeur et n'avoir jamais deux fois la même.
 */
function libelles(formes: readonly FormeLue[]): readonly string[] {
  const parRang = formes.map((_, rang) => `variante ${rang + 1}`);
  const candidats = formes[0]?.champs ?? [];

  for (const { nom } of candidats) {
    const valeurs = formes.map((forme) => {
      const admises = valeursAdmises(forme.champs.find((brut) => brut.nom === nom)?.champ ?? {});

      return admises?.length === 1 ? String(admises[0]) : undefined;
    });

    if (valeurs.some((valeur) => valeur === undefined)) {
      continue;
    }

    if (new Set(valeurs).size === formes.length) {
      return valeurs.map((valeur) => `${nom} = ${valeur}`);
    }
  }

  return parRang;
}

/**
 * Le second usage que le contrat annonce pour `scopeSchema` : ce qu'un profil de la
 * politique doit écrire pour viser ce système, lu sur le schéma qui le validera et
 * non recopié à côté de lui.
 *
 * Rien n'est levé vers l'appelant, et c'est délibéré : `z.toJSONSchema` refuse un
 * schéma non déclaratif, or cet écran montre tous les connecteurs d'un coup, si bien
 * qu'un contrat fautif y ferait disparaître l'état de tous les autres, credentials
 * compris, au moment précis où on vient le lire.
 */
export function scopeAttendu(schema: z.ZodType): ScopeAttendu {
  let json: unknown;

  try {
    json = z.toJSONSchema(schema);
  } catch {
    return { etat: "illisible" };
  }

  const plusieursFormes = racineAPlusieursFormes.safeParse(json);
  const branches = plusieursFormes.success
    ? (plusieursFormes.data.oneOf ?? plusieursFormes.data.anyOf)
    : undefined;

  if (branches !== undefined) {
    const formes: FormeLue[] = [];

    for (const branche of branches) {
      const lue = brancheLue.safeParse(branche);

      if (!lue.success) {
        return { etat: "illisible" };
      }

      formes.push(formeLue(lue.data));
    }

    const noms = libelles(formes);

    return {
      etat: "lu",
      champs: fusionner(formes),
      clesInconnuesRefusees: formes.every(({ clesInconnuesRefusees }) => clesInconnuesRefusees),
      variantes: formes.map((forme, rang) => ({
        libelle: noms[rang] ?? `variante ${rang + 1}`,
        champs: forme.champs.map(({ nom, requis, champ }) => decrire(nom, requis, champ)),
        clesInconnuesRefusees: forme.clesInconnuesRefusees,
      })),
    };
  }

  const lu = objetLu.safeParse(json);

  if (!lu.success) {
    return { etat: "illisible" };
  }

  const forme = formeLue(lu.data);

  return {
    etat: "lu",
    champs: forme.champs.map(({ nom, requis, champ }) => decrire(nom, requis, champ)),
    clesInconnuesRefusees: forme.clesInconnuesRefusees,
    variantes: [],
  };
}

import { z } from "zod";

export interface ChampDeScope {
  nom: string;
  requis: boolean;
  /** La forme admise, rédigée pour être lue : « texte non vide », « l'une de : member, admin ». */
  attendu: string;
  description?: string;
  exemple?: string;
}

export type ScopeAttendu =
  | { etat: "lu"; champs: readonly ChampDeScope[]; clesInconnuesRefusees: boolean }
  | { etat: "illisible" };

const champLu = z.object({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  enum: z.array(z.unknown()).optional(),
  minLength: z.number().optional(),
  description: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
});

const objetLu = z.object({
  properties: z.record(z.string(), champLu).default({}),
  required: z.array(z.string()).default([]),
  additionalProperties: z.unknown().optional(),
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

function attendu(champ: z.infer<typeof champLu>): string {
  if (champ.enum !== undefined && champ.enum.length > 0) {
    return `l'une de : ${champ.enum.map((valeur) => String(valeur)).join(", ")}`;
  }

  const types = typeof champ.type === "string" ? [champ.type] : (champ.type ?? []);
  const libelles = types.map((type) => TYPES[type] ?? type);
  const forme = libelles.length > 0 ? libelles.join(" ou ") : "valeur";

  return champ.type === "string" && (champ.minLength ?? 0) > 0 ? `${forme} non vide` : forme;
}

function exemple(champ: z.infer<typeof champLu>): string | undefined {
  const premier = champ.examples?.[0];

  if (premier === undefined) {
    return undefined;
  }

  return typeof premier === "string" ? premier : JSON.stringify(premier);
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

  const lu = objetLu.safeParse(json);

  if (!lu.success) {
    return { etat: "illisible" };
  }

  const requis = new Set(lu.data.required);

  return {
    etat: "lu",
    champs: Object.entries(lu.data.properties).map(([nom, champ]) => {
      const illustration = exemple(champ);

      return {
        nom,
        requis: requis.has(nom),
        attendu: attendu(champ),
        ...(champ.description === undefined ? {} : { description: champ.description }),
        ...(illustration === undefined ? {} : { exemple: illustration }),
      };
    }),
    clesInconnuesRefusees: lu.data.additionalProperties === false,
  };
}

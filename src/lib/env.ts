import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

/** Ce dont toute exécution a besoin, y compris la collecte en ligne de commande. */
/**
 * Déclarée mais vide vaut absente. Un modèle d'environnement copié tel quel porte
 * `JETON=` sans valeur, et refuser de démarrer là-dessus rendrait toute l'application
 * otage d'un credential qui se veut précisément facultatif.
 */
const jetonFacultatif = z
  .string()
  .optional()
  .transform((valeur) => (valeur === "" ? undefined : valeur));

const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1),

  ESPACE_MEMBRE_URL: z.url().default("https://espace-membre.incubateur.net"),
  ESPACE_MEMBRE_API_KEY: z.string().min(1),

  /** Faux par défaut : toute exécution est une simulation tant que rien ne l'autorise explicitement. */
  ACTIONS_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  OPERATORS: csv,
  BREAK_GLASS_USERNAMES: csv,

  /**
   * Facultatif, et c'est délibéré : un connecteur dont le credential manque se
   * résout au tier `none` et le dit, là où un démarrage refusé rendrait toute la
   * collecte otage d'un système parmi d'autres.
   */
  GITHUB_TOKEN: jetonFacultatif,

  /**
   * Facultatif pour la même raison. Nominatif malgré les apparences : Notion le
   * révoque au départ de la personne qui l'a créé comme à son changement de rôle,
   * et il porte l'écriture sur le workspace entier.
   */
  NOTION_SCIM_TOKEN: jetonFacultatif,
});

/**
 * Ce que seule l'application web exige. Le séparer évite qu'une collecte nocturne
 * échoue faute de configuration SMTP, dont elle n'a aucun usage.
 */
const webSchema = coreSchema
  .extend({
    AUTH_SECRET: z.string().min(1),

    /**
     * Facultatif en développement, où l'hôte ne ment pas. En production il devient
     * obligatoire : c'est lui qui construit les liens de connexion envoyés par
     * courriel, et son absence ne se verrait qu'au premier lien mort, c'est-à-dire
     * au moment précis où plus personne ne peut entrer pour diagnostiquer.
     */
    AUTH_URL: z.url().optional(),

    /**
     * Derrière un proxy, l'hôte vu par le serveur n'est pas celui vu par le
     * navigateur. NextAuth refuse par défaut de faire confiance à cet en-tête.
     */
    AUTH_TRUST_HOST: z
      .string()
      .default("false")
      .transform((value) => value === "true"),

    /**
     * URL de connexion nodemailer complète, identifiants compris :
     * `smtp://utilisateur:motdepasse@serveur:port`. Nommée d'après le protocole et
     * non d'après le courriel : `EMAIL_SERVER`, hérité de NextAuth v4, laissait
     * croire qu'on attendait un nom d'hôte et faisait chercher où poser le mot de
     * passe. Elle dit comment on envoie, là où `SMTP_EMAIL_FROM` dit au nom de qui.
     * Préfixe commun aux deux : dans une liste de quinze variables triée par nom,
     * ce qui relève du même sujet se retrouve côte à côte.
     */
    SMTP_URL: z.string().min(1),
    SMTP_EMAIL_FROM: z.email(),
  })
  .superRefine((valeurs, ctx) => {
    if (valeurs.NODE_ENV === "production" && !valeurs.AUTH_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_URL"],
        message:
          "obligatoire en production : les liens de connexion envoyés par courriel sont construits avec",
      });
    }
  });

export type Env = z.infer<typeof coreSchema>;
export type WebEnv = z.infer<typeof webSchema>;

function parse<T>(schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration d'environnement invalide :\n${details}`);
  }

  return parsed.data;
}

/**
 * Validation différée au premier accès : le build Next collecte les routes sans
 * environnement renseigné, un fail-fast à l'import le ferait échouer.
 */
function lazy<T extends object>(schema: z.ZodType<T>): T {
  let cached: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      cached ??= parse(schema);
      return cached[property as keyof T];
    },
  });
}

export const env = lazy(coreSchema);
export const webEnv = lazy(webSchema);

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
  GITHUB_TOKEN: z.string().min(1).optional(),
});

/**
 * Ce que seule l'application web exige. Le séparer évite qu'une collecte nocturne
 * échoue faute de configuration SMTP, dont elle n'a aucun usage.
 */
const webSchema = coreSchema.extend({
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.url().optional(),
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z.email(),
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

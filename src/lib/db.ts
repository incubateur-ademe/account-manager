import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    globalForPrisma.prisma = new PrismaClient({
      adapter,
      log: env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
    });
  }
  return globalForPrisma.prisma;
}

/**
 * Connexion différée au premier usage : le build Next importe ce module en
 * collectant les routes, sans base joignable ni DATABASE_URL renseignée.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Ferme la connexion sans jamais en ouvrir une. `prisma.$disconnect()` passe par le
 * proxy, qui instancie le client et exige donc une configuration valide : appelée
 * depuis le rattrapage d'erreur d'une commande, elle relançait l'erreur de
 * configuration qu'on était précisément en train de rapporter.
 */
export async function deconnecter(): Promise<void> {
  await globalForPrisma.prisma?.$disconnect();
}

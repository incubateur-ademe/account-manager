import { defineConfig } from "prisma/config";

if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(import.meta.dirname, true);
}

const { DATABASE_URL: databaseUrl } = process.env;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl as string,
  },
});

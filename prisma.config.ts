import { createRequire } from "module";
import { defineConfig } from "prisma/config";

const require = createRequire(import.meta.url);

try {
  require("dotenv/config");
} catch {
  // Production containers already inject env vars via Docker Compose.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});

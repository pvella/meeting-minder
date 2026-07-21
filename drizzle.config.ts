import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from src/lib/schema.ts into ./drizzle, which the app
// applies on startup (see src/lib/sqlite.ts). There is no database URL here —
// the only database lives on the device, so drizzle-kit is used purely as a
// migration generator, never to push directly.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
});

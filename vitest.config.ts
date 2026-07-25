import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run everywhere. The RLS suite talks to the real Supabase
    // project, so it skips itself unless RUN_RLS_TESTS=1 (see tests/rls.test.ts).
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

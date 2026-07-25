import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in config for the RLS integration suite: it talks to the real Supabase
// project (creating and deleting a throwaway user), so it never runs as part
// of `npm test`. Run it with `npm run test:rls`.
//
// Setting the flag here instead of inline (RUN_RLS_TESTS=1 ...) keeps the
// script working in PowerShell, which has no inline env-var syntax.
export default defineConfig({
  test: {
    include: ["tests/rls.test.ts"],
    environment: "node",
    env: { RUN_RLS_TESTS: "1" },
    testTimeout: 60_000,
    // One shared throwaway user; parallel files would race on it.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

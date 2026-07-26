// Creates the private bucket that load-note attachments live in.
// Idempotent — safe to re-run. Files are served through short-lived signed
// URLs from a server action, never public links.
//   node scripts/ensure-storage.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(path.resolve(here, "../.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "load-files";
const { data: buckets, error: listError } = await admin.storage.listBuckets();
if (listError) throw listError;

if (buckets?.some((b) => b.name === BUCKET)) {
  console.log(`bucket "${BUCKET}" already exists`);
} else {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024, // 20 MB — insurance PDFs and phone photos
  });
  if (error) throw error;
  console.log(`created private bucket "${BUCKET}"`);
}

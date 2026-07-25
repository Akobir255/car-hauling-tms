// Integration tests for the security boundary created by migration 0013.
//
// These run against the REAL Supabase project, so they are opt-in:
//   RUN_RLS_TESTS=1 npm run test:rls
// They create a throwaway auth user, probe the database as that user, and
// delete it again. Nothing else in the project is written to.
//
// What they protect: broker margin (carrier pay) staying invisible to sales,
// deactivated staff losing access, and the signup trigger refusing to grant
// admin. Those are the findings from the July 2026 security review — if any
// of these fail, that hole is open again.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_RLS_TESTS === "1";
const d = enabled ? describe : describe.skip;

function env(): Record<string, string> {
  const file = path.resolve(__dirname, "../.env.local");
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

const PERMISSION_DENIED = "42501";
const TEST_EMAIL_PREFIX = "rls-test-";

// This project signs JWTs with ES256, and the Auth Admin API intermittently
// rejects the legacy service_role key ("unrecognized JWT kid ... for algorithm
// ES256"). A one-shot delete therefore CAN fail and leave a test account in
// production auth — so deletion retries, then verifies via `profiles` (which
// cascades from auth.users) and fails the run loudly if residue remains.
async function deleteUserHard(admin: SupabaseClient, id: string): Promise<string | null> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) lastError = null;
    else lastError = error.message;
    const { data } = await admin.from("profiles").select("id").eq("id", id);
    if ((data ?? []).length === 0) return null; // gone (cascade confirms it)
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return lastError ?? "profile row still present after delete";
}

d("RLS + column grants (migration 0013)", () => {
  let admin: SupabaseClient;
  let sales: SupabaseClient;
  let userId: string;
  let url: string;
  let anonKey: string;

  beforeAll(async () => {
    const e = env();
    url = e.NEXT_PUBLIC_SUPABASE_URL;
    anonKey = e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    admin = createClient(url, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Sweep any account a previously-interrupted run left behind, so test
    // users can never accumulate in production auth.
    const { data: existing } = await admin
      .from("profiles")
      .select("id, email")
      .like("email", `${TEST_EMAIL_PREFIX}%`);
    for (const stale of existing ?? []) {
      await deleteUserHard(admin, stale.id);
    }

    const email = `${TEST_EMAIL_PREFIX}${Date.now()}@example.invalid`;
    const password = `${crypto.randomBytes(18).toString("base64url")}aA1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // The trigger must IGNORE this — asserted below.
      user_metadata: { full_name: "RLS Test", role: "admin" },
    });
    if (error) throw error;
    userId = data.user.id;

    sales = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await sales.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
  }, 60_000);

  afterAll(async () => {
    if (!userId) return;
    const failure = await deleteUserHard(admin, userId);
    if (failure) {
      throw new Error(
        `FAILED TO DELETE TEST USER ${userId} — remove it from Supabase Auth manually. Cause: ${failure}`
      );
    }
  }, 60_000);

  it("signup trigger refuses a client-requested admin role", async () => {
    const { data } = await admin.from("profiles").select("role, active").eq("id", userId).single();
    expect(data?.role).toBe("sales");
    expect(data?.active).toBe(true);
  });

  it("hides carrier money columns from sales at the database level", async () => {
    for (const col of ["carrier_pay", "carrier_received", "cod_to_carrier"]) {
      const { error } = await sales.from("loads").select(`id, ${col}`).limit(1);
      expect(error?.code, `${col} must be denied`).toBe(PERMISSION_DENIED);
    }
  });

  it("still lets sales read the columns they need (app must not be locked out)", async () => {
    const { error } = await sales
      .from("loads")
      .select("id, load_number, customer_rate, deposit_amount, carrier_id, status")
      .limit(1);
    expect(error).toBeNull();
  });

  it("refuses writes to carrier money columns", async () => {
    const { error } = await sales
      .from("loads")
      .update({ carrier_pay: 1 })
      .eq("id", crypto.randomUUID());
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("exposes loads_sales_safe for reading but not for writing", async () => {
    const read = await sales.from("loads_sales_safe").select("id, contract_token").limit(1);
    expect(read.error).toBeNull();

    // v1 of this migration left DML open on the view — that bypassed both RLS
    // and the column grants. It must stay closed.
    const write = await sales
      .from("loads_sales_safe")
      .update({ status: "delivered" })
      .eq("id", crypto.randomUUID());
    expect(write.error?.code).toBe(PERMISSION_DENIED);

    const del = await sales.from("loads_sales_safe").delete().eq("id", crypto.randomUUID());
    expect(del.error?.code).toBe(PERMISSION_DENIED);
  });

  it("returns nothing from the manager view for a sales user", async () => {
    const { data, error } = await sales.from("loads_full").select("id").limit(1);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("hides payouts (per-load carrier money) from sales", async () => {
    const { data, error } = await sales.from("payouts").select("amount").limit(1);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("shows a sales user no loads or customers they do not own", async () => {
    // The throwaway user owns nothing, so every scoped table must be empty.
    for (const table of ["loads_sales_safe", "customers", "messages"]) {
      const { data, error } = await sales.from(table).select("id").limit(1);
      expect(error, `${table} should be readable`).toBeNull();
      expect(data ?? [], `${table} should be empty for a non-owner`).toHaveLength(0);
    }
  });

  it("cuts off access the moment a profile is deactivated", async () => {
    await admin.from("profiles").update({ active: false }).eq("id", userId);
    try {
      for (const table of ["loads_sales_safe", "customers"]) {
        const { data } = await sales.from(table).select("id").limit(1);
        expect(data ?? [], `${table} after deactivation`).toHaveLength(0);
      }
      // A deactivated user must not be able to create anything either.
      const { error } = await sales
        .from("customers")
        .insert({ contact_name: "should not exist" });
      expect(error).not.toBeNull();
    } finally {
      await admin.from("profiles").update({ active: true }).eq("id", userId);
    }
  });

  it("denies the anon role outright", async () => {
    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anon.from("loads").select("id").limit(1);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("enforces one inbound SMS row per provider message id", async () => {
    const providerId = `test-${crypto.randomUUID()}`;
    const row = {
      channel: "sms",
      direction: "inbound",
      body: "dedupe test",
      provider_message_id: providerId,
      status: "delivered",
    };
    const first = await admin.from("messages").insert(row);
    expect(first.error).toBeNull();
    const second = await admin.from("messages").insert(row);
    expect(second.error?.code, "duplicate must violate the unique index").toBe("23505");
    await admin.from("messages").delete().eq("provider_message_id", providerId);
  });
});

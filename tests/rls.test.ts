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

// Local runs read .env.local; CI has no such file and provides the values as
// real environment variables instead. process.env wins when both exist.
function env(): Record<string, string> {
  let fromFile: Record<string, string> = {};
  try {
    const file = path.resolve(__dirname, "../.env.local");
    fromFile = Object.fromEntries(
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    // No .env.local (CI) — rely on process.env entirely.
  }
  const overlay: Record<string, string> = {};
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const value = (process.env[key] || "").trim();
    if (value) overlay[key] = value;
  }
  return { ...fromFile, ...overlay };
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

  // Migration 0037 deliberately turned ownership into an EDIT boundary rather
  // than a visibility one: a rep answering the phone has to be able to pull up
  // any order. These two tests are the pair that pins that down — the first
  // says the records are readable, the second says they are still not writable.
  it("lets a sales user READ orders and shippers they do not own", async () => {
    for (const table of ["loads_sales_safe", "customers"]) {
      const { data, error } = await sales.from(table).select("id").limit(1);
      expect(error, `${table} should be readable`).toBeNull();
      expect((data ?? []).length, `${table} should not be empty for a non-owner`).toBeGreaterThan(0);
    }
  });

  it("still refuses to let a sales user WRITE a record they do not own", async () => {
    const { data: someone } = await admin
      .from("loads")
      .select("id, status, sales_owner_id")
      .neq("sales_owner_id", userId)
      .limit(1)
      .single();
    if (!someone) throw new Error("no foreign load to test against");

    // PostgREST reports a policy-filtered UPDATE as a successful no-op, so the
    // assertion is on the ROW, not on the absence of an error.
    await sales.from("loads").update({ notes: "tampered" }).eq("id", someone.id);
    const { data: after } = await admin
      .from("loads")
      .select("notes")
      .eq("id", someone.id)
      .single();
    expect(after?.notes ?? "").not.toBe("tampered");
  });

  it("keeps another rep's message thread private", async () => {
    const { data, error } = await sales.from("messages").select("id").limit(1);
    expect(error, "messages should be readable").toBeNull();
    expect(data ?? [], "a shared record is not a shared inbox").toHaveLength(0);
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

  // Migration 0041. These aggregates replaced JS reductions over a .select()
  // that PostgREST silently truncated at 1,000 rows, so the whole point is that
  // the number is the TRUE number — which means the test has to compare against
  // an independently computed control, not merely assert "not null".
  describe("dashboard_stats / loads_status_counts (0041)", () => {
    // Page past the 1,000-row cap with the service role to get the truth.
    async function control(): Promise<{ rev30: number; statuses: Record<string, number> }> {
      const rows: { status: string; customer_rate: number | null; created_at: string }[] = [];
      for (let from = 0; ; from += 1000) {
        // 0054 taught the definer aggregates about hidden_at, so the control
        // has to filter it too -- otherwise this compares every load against
        // the visible ones and fails by exactly the hidden book's revenue.
        const { data, error } = await admin
          .from("loads")
          .select("status, customer_rate, created_at")
          .is("hidden_at", null)
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...(data as typeof rows));
        if (data.length < 1000) break;
      }
      const now = Date.now();
      const rev30 = rows
        .filter(
          (l) =>
            l.status !== "cancelled" &&
            new Date(l.created_at).getTime() >= now - 30 * 86_400_000 &&
            new Date(l.created_at).getTime() <= now
        )
        .reduce((s, l) => s + Number(l.customer_rate ?? 0), 0);
      const statuses: Record<string, number> = {};
      for (const l of rows) statuses[l.status] = (statuses[l.status] ?? 0) + 1;
      return { rev30, statuses };
    }

    it("returns a manager the true totals, not a 1000-row slice", async () => {
      const truth = await control();
      // Briefly a manager, so the role gate inside the definer function opens.
      await admin.from("profiles").update({ role: "dispatcher" }).eq("id", userId);
      try {
        const { data, error } = await sales.rpc("dashboard_stats", {
          p_follow_up_cutoff: new Date(Date.now() + 86_400_000).toISOString(),
        });
        expect(error).toBeNull();
        expect(data).not.toBeNull();
        // Within a cent: numeric sums come back as strings through PostgREST.
        expect(Math.abs(Number(data.rev_last_30) - truth.rev30)).toBeLessThan(0.01);
        // The defect this replaced: a truncated slice could not exceed 1000
        // rows. That is only provable when more than 1000 rows are visible --
        // while the book is hidden (0053) the visible set is tiny, and the
        // equality checks above and below are what carry the test. Assert the
        // sums match either way; assert the cap is really gone when we can.
        const total = Object.values(truth.statuses).reduce((a, b) => a + b, 0);
        if (total <= 1000) {
          console.warn(
            `dashboard_stats: only ${total} loads visible, so the >1000-row ` +
              `check is vacuous. Restore the book to make it meaningful again.`
          );
        }

        const counts = await sales.rpc("loads_status_counts", { p_rep: null });
        expect(counts.error).toBeNull();
        for (const [status, n] of Object.entries(truth.statuses)) {
          expect(Number(counts.data[status] ?? 0), `status ${status}`).toBe(n);
        }
      } finally {
        await admin.from("profiles").update({ role: "sales" }).eq("id", userId);
      }
    });

    it("pins a sales caller to their own rows whatever they pass", async () => {
      const { data, error } = await sales.rpc("dashboard_stats", {
        p_follow_up_cutoff: new Date().toISOString(),
      });
      expect(error).toBeNull();
      // The throwaway user owns nothing, so every figure must be zero even
      // though 0037 lets them READ every load in the system.
      expect(Number(data.rev_last_30)).toBe(0);
      expect(Number(data.new_last_7)).toBe(0);
      expect(Number(data.follow_ups_due)).toBe(0);

      // p_rep is a manager-only control; a rep passing somebody else's id must
      // not be handed that person's book.
      const { data: other } = await admin
        .from("profiles")
        .select("id")
        .neq("id", userId)
        .limit(1)
        .single();
      const counts = await sales.rpc("loads_status_counts", { p_rep: other?.id });
      expect(counts.error).toBeNull();
      expect(Object.keys(counts.data ?? {})).toHaveLength(0);
    });

    it("tells a deactivated profile nothing", async () => {
      await admin.from("profiles").update({ active: false }).eq("id", userId);
      try {
        const { data } = await sales.rpc("dashboard_stats", {
          p_follow_up_cutoff: new Date().toISOString(),
        });
        expect(data).toBeNull();
      } finally {
        await admin.from("profiles").update({ active: true }).eq("id", userId);
      }
    });
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

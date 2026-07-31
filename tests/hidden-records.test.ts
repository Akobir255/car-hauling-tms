import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0052_hide_customer_info.sql"), "utf8");

describe("migration 0052 — hiding is enforced by the database", () => {
  it("adds the marker to both tables without dropping anything", () => {
    expect(sql).toMatch(/alter table customers add column if not exists hidden_at timestamptz;/);
    expect(sql).toMatch(/alter table messages\s+add column if not exists hidden_at timestamptz;/);
    // The whole point is that the data survives. A migration that hides by
    // deleting or by nulling the columns would pass every other test here.
    expect(sql).not.toMatch(/\bdelete from (customers|messages)\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column)\b/i);
    expect(sql).not.toMatch(/set (phone|email|contact_name|body)\s*=\s*null/i);
  });

  it("hides every row that exists at migration time", () => {
    expect(sql).toMatch(/update customers set hidden_at = now\(\) where hidden_at is null;/);
    expect(sql).toMatch(/update messages\s+set hidden_at = now\(\) where hidden_at is null;/);
  });

  it("REPLACES the select policies rather than adding beside them", () => {
    // Permissive policies are ORed. A new policy next to the old one would
    // widen access back to everything — the exact opposite of the intent.
    for (const t of ["customers", "messages"]) {
      expect(sql).toMatch(new RegExp(`drop policy if exists "${t}_select_scoped" on ${t};`));
      expect(sql).toMatch(new RegExp(`create policy "${t}_select_scoped"\\s+on ${t} for select`));
    }
  });

  it("gates both policies on hidden_at, so an admin cannot see it either", () => {
    // "no one should see it even me" — there is no role exemption in either
    // policy, which is why this asserts the check sits OUTSIDE the role branch.
    const customers = sql.slice(sql.indexOf('create policy "customers_select_scoped"'));
    expect(customers.slice(0, 300)).toMatch(/hidden_at is null\s+and public\.is_active_staff\(\)/);

    const messages = sql.slice(sql.indexOf('create policy "messages_select_scoped"'));
    expect(messages.slice(0, 200)).toMatch(/using \(\s*hidden_at is null\s*and \(/);
    expect(messages).not.toMatch(/current_profile_role\(\) = 'admin'\s*or\s*hidden_at/);
  });

  it("keeps the 0013 message scoping underneath the new check", () => {
    // Hiding is an extra condition, not a replacement for who may read what.
    // Unhiding must not quietly hand every rep every thread.
    const messages = sql.slice(sql.indexOf('create policy "messages_select_scoped"'));
    expect(messages).toMatch(/current_profile_role\(\) in \('admin', 'dispatcher'\)/);
    expect(messages).toMatch(/c\.sales_owner_id = auth\.uid\(\)/);
  });

  it("leaves anything created from now on visible", () => {
    // hidden_at is nullable with no default, so tomorrow's customer and
    // tomorrow's inbound SMS both appear normally. This hides the past.
    expect(sql).not.toMatch(/hidden_at timestamptz[^;]*default/i);
    expect(sql).not.toMatch(/hidden_at timestamptz[^;]*not null/i);
  });

  it("does not touch carriers", () => {
    expect(sql).not.toMatch(/\bon carriers\b/i);
    expect(sql).not.toMatch(/alter table carriers/i);
  });

  it("indexes the visible rows, not the hidden ones", () => {
    for (const t of ["customers", "messages"]) {
      expect(sql).toMatch(new RegExp(`on ${t}\\s+\\(hidden_at\\) where hidden_at is null`));
    }
  });

  it("documents the restore, because a hide nobody can undo is a delete", () => {
    expect(sql).toMatch(/update customers set hidden_at = null;/);
    expect(sql).toMatch(/update messages\s+set hidden_at = null;/);
  });
});

const sql53 = readFileSync(
  join(process.cwd(), "supabase/migrations/0053_hide_loads_and_close_view_leak.sql"),
  "utf8"
);

describe("migration 0053 — the orders, and the view leak", () => {
  it("hides every load without deleting one", () => {
    expect(sql53).toMatch(/alter table loads add column if not exists hidden_at timestamptz;/);
    expect(sql53).toMatch(/update loads set hidden_at = now\(\) where hidden_at is null;/);
    expect(sql53).not.toMatch(/\bdelete from loads\b/i);
    expect(sql53).not.toMatch(/\bdrop table\b/i);
  });

  it("filters hidden rows INSIDE loads_full rather than flipping it to invoker", () => {
    // loads_full is non-invoker on purpose: it is how a manager reads
    // carrier_pay at all, since 0013 revokes that column from `authenticated`.
    // Flipping it would hit the revoke and break margin — STATUS.md rule one.
    const view = sql53.slice(sql53.indexOf("create view loads_full\n"));
    expect(view.slice(0, 400)).toMatch(/security_barrier = true/);
    expect(view.slice(0, 400)).not.toMatch(/security_invoker/);
    expect(view.slice(0, 400)).toMatch(/and hidden_at is null;/);
  });

  it("closes the leak: the customers join in both _contact views is filtered", () => {
    // Measured before this migration: an admin read 2,767 rows carrying data
    // from customers that a direct SELECT returned zero of.
    const joins = sql53.match(/left join customers c on c\.id = l\.customer_id[^;]*/g) ?? [];
    expect(joins).toHaveLength(2);
    for (const j of joins) expect(j).toMatch(/and c\.hidden_at is null/);
  });

  it("makes every load child follow its parent", () => {
    for (const t of [
      "load_vehicles", "load_notes", "load_requests", "contract_versions",
      "load_events", "shipment_locations", "geofence_events", "load_geofences",
    ]) {
      expect(sql53).toMatch(
        new RegExp(`exists \\(select 1 from loads l where l\\.id = ${t}\\.load_id\\)`)
      );
    }
  });

  it("splits the FOR ALL policies that would have handed reads back", () => {
    // A permissive FOR ALL covers SELECT and is ORed with the select policy, so
    // leaving either in place would undo the child rules entirely.
    expect(sql53).toMatch(/drop policy if exists "load_vehicles_write_scoped" on load_vehicles;/);
    expect(sql53).toMatch(/drop policy if exists "documents_write_staff" on documents;/);
    expect(sql53).not.toMatch(/create policy[^;]*for all/i);
  });

  it("keeps carrier documents readable — the stated exception", () => {
    const docs = sql53.slice(sql53.indexOf('create policy "documents_select_staff"'));
    expect(docs.slice(0, 400)).toMatch(/entity_type <> 'load'/);
  });

  it("never touches carriers", () => {
    expect(sql53).not.toMatch(/alter table carriers/i);
    expect(sql53).not.toMatch(/policy[^;]*on carriers/i);
  });
});

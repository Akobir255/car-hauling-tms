# Broker TMS — Phase 1

Internal load/carrier/customer management platform for the brokerage. This is
**Phase 1** of the plan: auth + roles, carriers, customers, loads (with
vehicles and a status history), and a dashboard. Billing, SMS/email
messaging, document uploads, and Central Dispatch/Super Dispatch integration
are later phases — see the plan doc for the full roadmap.

## Stack

Next.js 15 (App Router, TypeScript) + Supabase (Postgres, Auth, Row-Level
Security) + Tailwind CSS + shadcn/ui, deployed on Vercel.

## One-time setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and open
**Project Settings → API**. You'll need the **Project URL**, **anon public
key**, and **service_role key** (keep the service role key secret).

### 2. Apply the database schema

Easiest path (no Docker/local Supabase needed): open the Supabase dashboard's
**SQL Editor**, paste the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and
run it. This creates every table, enum, RLS policy, and the
`loads_sales_safe` view.

(If you do have Docker and prefer the CLI: `npx supabase link` then
`npx supabase db push`.)

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` from step 1.

### 4. Create the first admin account

There's no public sign-up page (accounts are staff-only, created by an
admin). To bootstrap the very first admin:

1. In the Supabase dashboard, go to **Authentication → Users → Add user** and
   create yourself an account (email + password, "Auto Confirm User" on).
2. In the **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Log in at `/login` with that email/password. From then on, use the
   **Users** page (admin-only, in the sidebar) to invite the rest of the
   team — invited users get a Supabase email with a link to set their own
   password.

### 5. Run it

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll land on `/login`.

## Notes on the data model / security

- Roles are `admin`, `dispatcher`, `sales`. Row-Level Security enforces that
  sales reps only ever see their own customers/loads at the database level
  (not just in the UI) — see `supabase/migrations/0001_init.sql`.
- Sales reps never see carrier pay / margin: the app queries the
  `loads_sales_safe` view (which omits `carrier_pay`) instead of the `loads`
  table directly whenever the signed-in user's role is `sales`.
- Load numbers use the `########-US` format for consistency with the
  marketing site's existing order-number convention.

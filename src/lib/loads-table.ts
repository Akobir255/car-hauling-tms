// Which relation admin/dispatcher read loads from.
//
// Migration 0013 revokes SELECT on the three carrier-money columns from the
// `authenticated` role (that's how margin is hidden from sales at the database
// level). Because grants are role-wide, NO user client can select those
// columns afterwards — managers must read them through `loads_full`, a
// definer view gated to admin/dispatcher.
//
// Until 0013 is applied, `loads_full` does not exist, so managers read the
// base table (which still exposes every column to `authenticated`).
//
// >>> FLIP THIS TO "loads_full" IN THE SAME DEPLOY AS MIGRATION 0013. <<<
// Pre-migration:  "loads"       — base table, all columns readable
// Post-migration: "loads_full"  — required; base select("*") will 403
export const MANAGER_LOADS_TABLE = "loads" as const;

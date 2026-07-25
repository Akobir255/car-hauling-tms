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
// Migration 0013 is APPLIED (2026-07-25), so this is "loads_full". Reverting
// it to "loads" would 403 on the revoked carrier-money columns.
export const MANAGER_LOADS_TABLE = "loads_full" as const;

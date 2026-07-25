# Read `docs/STATUS.md` first

It covers the stack, the commands, what's already built, and the five
non-obvious rules that will otherwise cost you an afternoon — most importantly
that broker margin is enforced by Postgres column grants, so manager reads must
go through the `loads_full` view and margin writes through the service role.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

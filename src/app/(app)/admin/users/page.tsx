import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Profile } from "@/types/database";
import { InviteForm } from "./invite-form";
import { UserRow } from "./user-row";

export default async function AdminUsersPage() {
  const profile = await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("full_name");
  const users = (data ?? []) as Profile[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      <InviteForm />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead colSpan={2}>Role / status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <UserRow key={u.id} profile={u} isSelf={u.id === profile.id} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

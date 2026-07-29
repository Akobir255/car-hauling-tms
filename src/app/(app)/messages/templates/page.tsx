import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MessageTemplate } from "@/types/database";

export const metadata: Metadata = { title: "Message templates" };

export default async function TemplatesPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("*").order("name");
  const templates = (data ?? []) as MessageTemplate[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px]">Message templates</h1>
        <Button render={<Link href="/messages/templates/new" />}>New template</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Body</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link href={`/messages/templates/${t.id}`} className="text-msg-link hover:underline">
                  {t.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{t.channel.toUpperCase()}</Badge>
              </TableCell>
              <TableCell className="max-w-lg truncate text-muted-foreground" title={t.body}>
                {t.body}
              </TableCell>
            </TableRow>
          ))}
          {templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No templates yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

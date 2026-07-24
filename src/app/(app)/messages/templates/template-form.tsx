"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { TEMPLATE_VARIABLES } from "@/lib/messaging/render";
import type { MessageTemplate } from "@/types/database";
import type { MessageFormState } from "../actions";

const initialState: MessageFormState = { error: null };

export function TemplateForm({
  action,
  template,
}: {
  action: (state: MessageFormState, formData: FormData) => Promise<MessageFormState>;
  template?: MessageTemplate;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Template name *</Label>
          <Input id="name" name="name" defaultValue={template?.name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel">Channel</Label>
          <NativeSelect id="channel" name="channel" defaultValue={template?.channel ?? "sms"}>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject (email only)</Label>
        <Input id="subject" name="subject" defaultValue={template?.subject ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Body *</Label>
        <Textarea id="body" name="body" rows={6} defaultValue={template?.body} required />
      </div>
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_VARIABLES.map((v) => (
          <Badge key={v} variant="outline">{`{{${v}}}`}</Badge>
        ))}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : template ? "Save changes" : "Create template"}
        </Button>
        <Button type="button" variant="outline" render={<Link href="/messages/templates" />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

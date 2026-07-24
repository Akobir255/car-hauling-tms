"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type LinkState = "checking" | "ok" | "invalid";

export function SetPasswordForm() {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Invite/recovery links land here with tokens in the URL hash.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        window.history.replaceState(null, "", window.location.pathname);
        setLinkState(sessionError ? "invalid" : "ok");
        return;
      }
      // No tokens in the URL — allow if already signed in (e.g. changing password).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setLinkState(session ? "ok" : "invalid");
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = (form.get("password") || "").toString();
    const confirm = (form.get("confirm") || "").toString();

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  if (linkState === "checking") {
    return <p className="text-center text-sm text-muted-foreground">Checking your link...</p>;
  }

  if (linkState === "invalid") {
    return (
      <p className="text-center text-sm text-muted-foreground">
        This link is invalid or has expired. Ask your admin to send a new invite.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Saving..." : "Set password & sign in"}
      </Button>
    </form>
  );
}

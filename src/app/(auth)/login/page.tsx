import { Truck } from "lucide-react";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-md">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Truck className="size-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">US Star TMS</h1>
            <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
          </div>
        </div>
        <LoginForm next={next ?? ""} />
        <p className="text-center text-xs text-muted-foreground">
          US Star Trucking LLC · internal use only
        </p>
      </div>
    </div>
  );
}

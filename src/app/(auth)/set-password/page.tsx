import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-background p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Broker TMS</h1>
          <p className="text-sm text-muted-foreground">Choose a password for your account</p>
        </div>
        <SetPasswordForm />
      </div>
    </div>
  );
}

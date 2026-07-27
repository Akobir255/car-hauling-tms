"use client";

import { useActionState, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signByToken, type SignState } from "./sign-actions";

// The signature block, msgplane-style: a draw-your-signature box on the left,
// email + name on the right, and — when this contract version requires it —
// the card form. The typed name remains the legal e-signature of record; the
// drawing is stored alongside it.
//
// PCI note: the card NUMBER and CVV inputs deliberately have NO name
// attribute, so they are never part of the submitted form data. Only the
// derived brand + last4 (hidden inputs) and expiry/billing fields reach the
// server. Real vaulting happens when the payment processor is connected.

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6/.test(digits)) return "discover";
  return "card";
}

// A plain pointer-events draw pad. The drawing is optional reinforcement of
// the typed-name signature, exported as a PNG data URL on submit.
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    };
  };

  return (
    <div className="space-y-1.5">
      <p className="text-center text-sm font-medium text-primary">Your Signature</p>
      <canvas
        ref={canvasRef}
        width={480}
        height={180}
        className="h-40 w-full max-w-sm cursor-crosshair touch-none rounded border border-neutral-400 bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const c = ctx();
          if (!c) return;
          c.lineWidth = 2.5;
          c.lineCap = "round";
          c.strokeStyle = "#1a1a2e";
          const { x, y } = pos(e);
          c.beginPath();
          c.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const c = ctx();
          if (!c) return;
          const { x, y } = pos(e);
          c.lineTo(x, y);
          c.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          setHasInk(true);
          const canvas = canvasRef.current;
          if (canvas) onChange(canvas.toDataURL("image/png"));
        }}
      />
      {hasInk && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            const canvas = canvasRef.current;
            const c = ctx();
            if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
            setHasInk(false);
            onChange("");
          }}
        >
          clear signature
        </button>
      )}
    </div>
  );
}

export function SignatureForm({
  token,
  alreadySigned,
  signedName,
  requiresCard,
}: {
  token: string;
  alreadySigned: boolean;
  signedName: string | null;
  requiresCard: boolean;
}) {
  const action = signByToken.bind(null, token);
  const [state, formAction, pending] = useActionState<SignState, FormData>(action, {
    error: null,
    signed: alreadySigned,
    signedName,
  });
  const [name, setName] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  // Card number + CVV live ONLY in state; see the PCI note above.
  const [cardNumber, setCardNumber] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);

  if (state.signed) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-4 text-center text-green-700 dark:text-green-400">
          <p className="text-lg font-bold">Signed — thank you.</p>
          {state.signedName && <p className="mt-1 font-[cursive] text-2xl">{state.signedName}</p>}
          <p className="mt-1 text-sm">
            Your agreement has been received. Keep a copy for your records.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full print:hidden"
          onClick={() => window.print()}
        >
          <Printer className="size-4" aria-hidden="true" />
          Print / save a copy
        </Button>
      </div>
    );
  }

  const cardDigits = cardNumber.replace(/\D/g, "");
  const label = (text: string) => (
    <span className="block text-center text-xs font-medium text-primary">{text}</span>
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!requiresCard) return;
        // Client-side card validation — invalid numbers never leave the page.
        if (cardDigits.length < 13 || cardDigits.length > 19 || !luhnOk(cardDigits)) {
          e.preventDefault();
          setCardError("Please check the card number — it doesn't look valid.");
          return;
        }
        if (!/^\d{3,4}$/.test(cvv)) {
          e.preventDefault();
          setCardError("Please enter the 3–4 digit CVV.");
          return;
        }
        setCardError(null);
      }}
      className="space-y-6 print:hidden"
    >
      <div className="grid gap-8 sm:grid-cols-2">
        <SignaturePad onChange={setSignatureImage} />
        <input type="hidden" name="signature_image" value={signatureImage} />

        <div className="space-y-3">
          <div className="space-y-1">
            {label("Your Email")}
            <Input name="email" type="email" required maxLength={200} autoComplete="email" className="h-10" />
          </div>
          <div className="space-y-1">
            {label("Your Name")}
            <Input
              name="full_name"
              required
              minLength={3}
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
            />
          </div>
          {name.trim() && (
            <p className="text-center font-[cursive] text-2xl leading-snug">{name}</p>
          )}
        </div>
      </div>

      {requiresCard && (
        <div className="space-y-3 border-t pt-5">
          <div className="space-y-1">
            {label("Card #")}
            {/* NO name attribute — the number never enters the form data. */}
            <Input
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="Credit Card Number"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))}
              required
              className="h-10"
            />
            <input type="hidden" name="card_last4" value={cardDigits.slice(-4)} />
            <input type="hidden" name="card_brand" value={cardDigits ? detectBrand(cardDigits) : ""} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              {label("First Name")}
              <Input name="card_first" placeholder="First Name" required maxLength={80} autoComplete="cc-given-name" className="h-10" />
            </div>
            <div className="space-y-1">
              {label("Last Name")}
              <Input name="card_last" placeholder="Last Name" required maxLength={80} autoComplete="cc-family-name" className="h-10" />
            </div>
            <div className="space-y-1">
              {label("MM/YY")}
              <Input name="card_exp" placeholder="MM/YY" required pattern="\d{2}\s*/\s*\d{2}" autoComplete="cc-exp" className="h-10" />
            </div>
            <div className="space-y-1">
              {label("CVV")}
              {/* NO name attribute — the CVV never enters the form data. */}
              <Input
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVV"
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                required
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              {label("ZIP")}
              <Input name="billing_zip" placeholder="ZIP" required maxLength={12} autoComplete="postal-code" className="h-10" />
            </div>
            <div className="space-y-1">
              {label("Address")}
              <Input name="billing_address" placeholder="Address" required maxLength={200} autoComplete="street-address" className="h-10" />
            </div>
            <div className="space-y-1">
              {label("City")}
              <Input name="billing_city" placeholder="City" required maxLength={120} className="h-10" />
            </div>
            <div className="space-y-1">
              {label("State")}
              <Input name="billing_state" placeholder="State" required maxLength={40} className="h-10" />
            </div>
          </div>
          {cardError && <p className="text-center text-sm text-destructive">{cardError}</p>}
        </div>
      )}

      <label className="flex items-start justify-center gap-2.5 text-sm">
        <input type="checkbox" name="agree" required className="mt-0.5 size-4 accent-primary" />
        <span>
          I have read and agree to the Additional Information, Cancellation Fees, and Terms &
          Conditions above, and I authorize transport of the listed vehicle(s).
        </span>
      </label>

      {state.error && <p className="text-center text-sm text-destructive">{state.error}</p>}

      <div className="flex items-center justify-center gap-2">
        <Button
          type="reset"
          variant="outline"
          onClick={() => {
            setName("");
            setCardNumber("");
            setCvv("");
            setCardError(null);
          }}
        >
          clear
        </Button>
        <Button type="submit" disabled={pending} className="bg-green-600 px-8 text-white hover:bg-green-700">
          {pending ? "Submitting…" : "sign"}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Your typed name, email, the date, and your IP address are recorded as your electronic
        signature.{requiresCard ? " Card details are used to secure your reservation deposit." : ""}
      </p>
    </form>
  );
}

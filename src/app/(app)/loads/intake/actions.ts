"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/flags";
import {
  MAX_INPUT_BYTES,
  MAX_TEXT_CHARS,
  MAX_UPLOAD_LABEL,
  extractIntake,
  inputSha256,
  type IntakeInput,
} from "@/lib/ai/extract-intake";
import { flattenFields, type IntakeExtraction } from "@/lib/ai/intake-schema";
import { createLoad } from "../actions";

// Phase 3. Two actions, and the split between them is the whole safety story:
// READ produces a draft nobody has committed to, CONFIRM is a human pressing a
// button. The AI never creates an order, never messages anyone, and never
// touches money — it fills in a form and waits.

const ALLOWED_IMAGE = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type IntakeState = {
  extractionId: string | null;
  extraction: IntakeExtraction | null;
  lowConfidence: string[];
  error: string | null;
};

export const EMPTY_INTAKE: IntakeState = {
  extractionId: null,
  extraction: null,
  lowConfidence: [],
  error: null,
};

/**
 * Read a pasted email, a PDF, or a photo of a load sheet into a draft.
 *
 * Stores the input and the output either way — a refusal and a transport
 * failure are both rows, because "how often does this fail and on what" is a
 * question the eval set has to be able to answer.
 */
export async function runIntakeExtraction(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("ai_intake"))) {
    return { ...EMPTY_INTAKE, error: "AI intake is switched off for this account." };
  }

  const text = (formData.get("text") || "").toString().trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!text && !hasFile) {
    return { ...EMPTY_INTAKE, error: "Paste the email text or attach a document." };
  }
  if (text && text.length > MAX_TEXT_CHARS) {
    return { ...EMPTY_INTAKE, error: "That text is too long — paste the order portion only." };
  }

  let input: IntakeInput;
  let fileBytes: Buffer | null = null;
  let filename: string | null = null;
  let mediaType: string | null = null;

  if (hasFile) {
    const f = file as File;
    if (f.size > MAX_INPUT_BYTES) {
      return {
        ...EMPTY_INTAKE,
        error: `That file is over ${MAX_UPLOAD_LABEL}. Send a smaller scan, or paste the text instead.`,
      };
    }
    const isPdf = f.type === "application/pdf";
    if (!isPdf && !ALLOWED_IMAGE.includes(f.type)) {
      return { ...EMPTY_INTAKE, error: "Attach a PDF or an image (PNG, JPEG, WebP, GIF)." };
    }
    fileBytes = Buffer.from(await f.arrayBuffer());
    filename = f.name;
    mediaType = f.type;
    const base64 = fileBytes.toString("base64");
    input = isPdf
      ? { kind: "pdf", base64, filename: f.name }
      : { kind: "image", base64, mediaType: f.type, filename: f.name };
  } else {
    input = { kind: "text", text };
  }

  const sha = inputSha256(input);
  const outcome = await extractIntake(input);

  // The original document is the other half of the training pair — a correction
  // without the input that produced it teaches nothing. Text lives on the row;
  // bytes go to the private bucket the rest of the app already uses.
  let storagePath: string | null = null;
  if (fileBytes) {
    storagePath = `ai-intake/${sha}-${filename}`;
    const { error: upErr } = await createAdminClient()
      .storage.from("load-files")
      .upload(storagePath, fileBytes, { contentType: mediaType ?? undefined, upsert: true });
    if (upErr) {
      // Not fatal: the extraction still stands, we just lose the original.
      console.warn(`AI intake: could not archive ${storagePath}: ${upErr.message}`);
      storagePath = null;
    }
  }

  const supabase = await createClient();
  const { data: row, error: insertError } = await supabase
    .from("ai_extractions")
    .insert({
      kind: input.kind,
      input_text: input.kind === "text" ? text : null,
      input_storage_path: storagePath,
      input_filename: filename,
      input_media_type: mediaType,
      input_bytes: fileBytes?.length ?? null,
      input_sha256: sha,
      model: outcome.meta.model,
      prompt_version: outcome.meta.promptVersion,
      output: outcome.ok ? outcome.extraction : null,
      error: outcome.ok ? null : outcome.error,
      stop_reason: outcome.ok ? null : outcome.stopReason,
      input_tokens: outcome.meta.inputTokens,
      output_tokens: outcome.meta.outputTokens,
      latency_ms: outcome.meta.latencyMs,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("AI intake: could not record extraction:", insertError.message);
  }

  if (!outcome.ok) return { ...EMPTY_INTAKE, error: outcome.error };

  return {
    extractionId: row?.id ?? null,
    extraction: outcome.extraction,
    lowConfidence: flattenFields(outcome.extraction)
      .filter((f) => f.confidence < 0.85)
      .map((f) => f.path),
    error: null,
  };
}

/**
 * The human's commit. Records what they changed, then creates the order through
 * the ORDINARY path.
 *
 * createLoad is called rather than reimplemented: it owns pricing derivation,
 * the lead/quote/order state machine, history and vehicle rows, and a second
 * creation path would drift from it within a release. It ends in redirect(), so
 * nothing after that call runs — which is why the corrections are written
 * first.
 */
export async function confirmIntake(
  extractionId: string | null,
  _prev: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const profile = await requireRole("admin", "dispatcher", "sales");
  if (!(await isFeatureEnabled("ai_intake"))) {
    return { error: "AI intake is switched off for this account." };
  }

  if (extractionId) {
    const supabase = await createClient();
    const { data: extraction } = await supabase
      .from("ai_extractions")
      .select("output")
      .eq("id", extractionId)
      .maybeSingle();

    const output = extraction?.output as IntakeExtraction | null;
    if (output) {
      // Compare what the model said against what the human is submitting. Only
      // differences are stored: a row per corrected field, with the model's own
      // confidence beside it, which is what separates "confidently wrong" (a
      // prompt problem) from "flagged and fixed" (the review screen working).
      type CorrectionRow = {
        extraction_id: string;
        field_path: string;
        model_value: string | null;
        human_value: string;
        model_confidence: number;
        corrected_by: string;
      };

      const rows = flattenFields(output)
        .map((f): CorrectionRow | null => {
          const submitted = formData.get(`f:${f.path}`);
          if (submitted == null) return null;
          const human = submitted.toString().trim();
          const model = f.value == null ? "" : String(f.value);
          if (human === model) return null;
          return {
            extraction_id: extractionId,
            field_path: f.path,
            model_value: model || null,
            // '' when they cleared it — see 0051. Never null: the dedupe index
            // below cannot see two nulls as the same row.
            human_value: human,
            model_confidence: f.confidence,
            corrected_by: profile.id,
          };
        })
        .filter((r): r is CorrectionRow => r !== null);

      if (rows.length) {
        // ON CONFLICT DO NOTHING against idx_ai_corrections_once. createLoad can
        // reject the form (no vehicle, no customer name) and the dispatcher
        // presses confirm again; without this the second press duplicates every
        // correction into a table nothing may delete from.
        const { error } = await supabase.from("ai_corrections").upsert(rows, {
          onConflict: "extraction_id,field_path,human_value",
          ignoreDuplicates: true,
        });
        // Never blocks the order. Losing a training row is a bad day; refusing
        // to book freight because a training row failed to write is a worse one.
        if (error) console.error("AI intake: corrections not saved:", error.message);
      }
    }
  }

  // Throws NEXT_REDIRECT on success — by design, so the dispatcher lands on the
  // order. The extraction's load_id therefore stays null: capturing it would
  // mean owning the redirect here and forking the creation path, which is the
  // one thing this action exists to avoid.
  return createLoad({ error: null }, formData);
}

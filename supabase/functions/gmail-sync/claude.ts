// The Claude call that classifies one e-mail and extracts the enquiry (structured JSON output), live or
// through a Message Batch (half price; used to re-classify e-mails stored as "Not classified").
import Anthropic from "npm:@anthropic-ai/sdk@1.1.0";
import { buildUserText, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "../_shared/email/ai.ts";
import type { BatchClassifier, Classifier, ClassifierInput } from "../_shared/email/sync.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  mailbox: string;
}

/** The request for one e-mail, the same live and in a batch. */
function requestParams(opts: ClaudeOptions, { email, ctx, attachments }: ClassifierInput): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const f of attachments) {
    if (f.meta.mime_type === "application/pdf") {
      content.push({ type: "document", title: f.meta.filename, source: { type: "base64", media_type: "application/pdf", data: f.base64 } });
    } else {
      content.push({ type: "image", source: { type: "base64", media_type: f.meta.mime_type as ImageType, data: f.base64 } });
    }
  }
  content.push({ type: "text", text: buildUserText(email, ctx, attachments.map((a) => a.meta), opts.mailbox) });
  return {
    model: opts.model,
    max_tokens: 8000,
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  };
}

/** Claude's JSON answer, or an error for a refusal or a cut-off answer. */
function answerOf(response: {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
}): unknown {
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to classify this e-mail (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens)");
  const text = response.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  return JSON.parse(text);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createClaudeClassifier(opts: ClaudeOptions): Classifier {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 90_000 });
  // Server-side fallback re-runs a request the model declines on Anthropic's recommended substitute.
  // Haiku has no server-side fallback, so the parameter is only sent to the other models.
  const fallback = !opts.model.startsWith("claude-haiku");

  return async (input) => {
    const params = requestParams(opts, input) as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
    const response = await client.beta.messages.create({
      ...params,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    return answerOf(response);
  };
}

/** Message Batches: no server-side fallback there, so a refused e-mail simply stays unclassified. */
export function createClaudeBatchClassifier(opts: ClaudeOptions): BatchClassifier {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });

  return {
    async submit(items) {
      const batch = await client.messages.batches.create({
        requests: items.map((i) => ({ custom_id: i.customId, params: requestParams(opts, i.input) })),
      });
      return batch.id;
    },
    async isEnded(batchId) {
      return (await client.messages.batches.retrieve(batchId)).processing_status === "ended";
    },
    async results(batchId) {
      const out = new Map<string, { answer: unknown } | { error: string }>();
      for await (const r of await client.messages.batches.results(batchId)) {
        if (r.result.type === "succeeded") {
          try {
            out.set(r.custom_id, { answer: answerOf(r.result.message) });
          } catch (e) {
            out.set(r.custom_id, { error: message(e) });
          }
        } else if (r.result.type === "errored") {
          out.set(r.custom_id, { error: `batch request failed (${r.result.error.error?.type ?? r.result.error.type})` });
        } else {
          out.set(r.custom_id, { error: `batch request ${r.result.type}` });
        }
      }
      return out;
    },
  };
}

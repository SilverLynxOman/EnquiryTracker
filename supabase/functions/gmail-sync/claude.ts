// The Claude call that classifies one e-mail and extracts the enquiry (structured JSON output).
import Anthropic from "npm:@anthropic-ai/sdk@1.1.0";
import { buildUserText, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "../_shared/email/ai.ts";
import type { Classifier } from "../_shared/email/sync.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  mailbox: string;
}

export function createClaudeClassifier(opts: ClaudeOptions): Classifier {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 90_000 });
  // Server-side fallback re-runs a request the model declines on Anthropic's recommended substitute.
  // Haiku has no server-side fallback, so the parameter is only sent to the other models.
  const fallback = !opts.model.startsWith("claude-haiku");

  return async ({ email, ctx, attachments }) => {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const f of attachments) {
      if (f.meta.mime_type === "application/pdf") {
        content.push({ type: "document", title: f.meta.filename, source: { type: "base64", media_type: "application/pdf", data: f.base64 } });
      } else {
        content.push({ type: "image", source: { type: "base64", media_type: f.meta.mime_type as ImageType, data: f.base64 } });
      }
    }
    content.push({ type: "text", text: buildUserText(email, ctx, attachments.map((a) => a.meta), opts.mailbox) });

    const response = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 8000,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: opts.effort, format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined to classify this e-mail (${response.stop_details?.category ?? "no category"})`);
    }
    if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens)");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text);
  };
}

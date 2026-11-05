// Minimal Gmail REST client. Reading needs the scope https://www.googleapis.com/auth/gmail.readonly; send() (replies
// from the app, gmail-send) also needs https://www.googleapis.com/auth/gmail.send.
// Authenticates with an OAuth refresh token of the watched mailbox. See README "E-mail intake".
import { decodeBase64Url } from "./parse.ts";
import type { GmailMessage } from "./types.ts";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gmail reports per-user quota and rate limits as 403 as well as 429. */
const RATE_LIMITED = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|Quota exceeded|RESOURCE_EXHAUSTED/;

/** True for a Gmail error worth retrying later: rate limits and server errors (not e.g. 404 or 401). */
export function isTransientGmailError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /^Gmail .* failed \((429|5\d\d)\)/.test(m) || (/^Gmail .* failed \(403\)/.test(m) && RATE_LIMITED.test(m));
}

export class GmailApi {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly creds: GmailCredentials,
    fetchFn?: typeof fetch,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      const rateLimited = res.status === 429 || (res.status === 403 && RATE_LIMITED.test(text));
      if ((rateLimited || res.status >= 500) && attempt < 4) {
        // A per-minute quota needs a real pause: honour Retry-After, else 2, 4, 8, 16 s (about 30 s in all).
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Gmail ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  /** Message ids matching a Gmail search query, newest first. */
  async listMessageIds(query: string, max: number): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("/messages", {
        q: query,
        maxResults: String(Math.min(500, max - out.length)),
        pageToken,
      });
      out.push(...(page.messages ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && out.length < max);
    return out;
  }

  getMessage(id: string): Promise<GmailMessage> {
    return this.get<GmailMessage>(`/messages/${encodeURIComponent(id)}`, { format: "full" });
  }

  /**
   * Sends a complete message (base64url `raw`) in an existing conversation; Gmail files it under Sent.
   * Not retried: a timeout after Gmail accepted the message would otherwise send it twice.
   */
  async send(raw: string, threadId: string): Promise<{ id: string; threadId: string }> {
    const res = await this.fetchFn(`${API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threadId }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gmail /messages/send failed (${res.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text) as { id: string; threadId: string };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const body = await this.get<{ data: string }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return decodeBase64Url(body.data);
  }
}

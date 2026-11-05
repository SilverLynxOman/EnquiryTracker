import { describe, expect, it } from "vitest";
import { GmailApi, isTransientGmailError } from "./gmail.ts";

const creds = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("GmailApi", () => {
  it("waits and retries when Gmail reports a per-user quota as 403", async () => {
    const calls: string[] = [];
    let first = true;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://oauth2")) return json({ access_token: "t", expires_in: 3600 });
      if (first) {
        first = false;
        return json({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost'" } }, 403, { "Retry-After": "1" });
      }
      return json({ id: "m1", threadId: "t1" });
    }) as typeof fetch;
    const msg = await new GmailApi(creds, fetchFn).getMessage("m1");
    expect(msg).toMatchObject({ id: "m1" });
    expect(calls.filter((u) => u.includes("/messages/m1"))).toHaveLength(2);
  });

  it("does not retry a permission error that is not a rate limit", async () => {
    let gets = 0;
    const fetchFn = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2")) return json({ access_token: "t" });
      gets++;
      return json({ error: { code: 403, message: "Insufficient Permission" } }, 403);
    }) as typeof fetch;
    await expect(new GmailApi(creds, fetchFn).getMessage("m1")).rejects.toThrow(/failed \(403\)/);
    expect(gets).toBe(1);
  });
});

describe("isTransientGmailError", () => {
  it("is true for rate limits and server errors only", () => {
    expect(isTransientGmailError(new Error("Gmail /messages/x failed (403): Quota exceeded for quota metric"))).toBe(true);
    expect(isTransientGmailError(new Error("Gmail /messages/x failed (429): Too many requests"))).toBe(true);
    expect(isTransientGmailError(new Error("Gmail /messages/x failed (503): backend"))).toBe(true);
    expect(isTransientGmailError(new Error("Gmail /messages/x failed (404): Not Found"))).toBe(false);
    expect(isTransientGmailError(new Error("Gmail /messages/x failed (403): Insufficient Permission"))).toBe(false);
    expect(isTransientGmailError(new Error("still not classified: overloaded"))).toBe(false);
  });
});

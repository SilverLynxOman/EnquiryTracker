import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local (or set them in Cloudflare Pages).",
  );
}

// Invite and password-reset links sign the user in through the URL hash
// (#access_token=…&type=invite|recovery). The client consumes and clears that
// hash, so note the link type first: such users must be sent to set a password.
const NEEDS_PASSWORD_KEY = "et:needs-password";
const linkType = new URLSearchParams(window.location.hash.slice(1)).get("type");
if (linkType === "invite" || linkType === "recovery") markNeedsPassword();

export function markNeedsPassword() {
  try {
    sessionStorage.setItem(NEEDS_PASSWORD_KEY, "1");
  } catch {
    // Storage unavailable (private mode etc.); the PASSWORD_RECOVERY event still covers resets.
  }
}

export function needsPassword(): boolean {
  try {
    return sessionStorage.getItem(NEEDS_PASSWORD_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearNeedsPassword() {
  try {
    sessionStorage.removeItem(NEEDS_PASSWORD_KEY);
  } catch {
    // ignore
  }
}

export const supabase = createClient(url, key);

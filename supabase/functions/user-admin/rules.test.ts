import { describe, expect, it } from "vitest";
import { accountPage, authErrorMessage, parseRequest, selfActionError } from "./rules";

const ID = "c02b81b4-2b5a-49bf-83ad-c583d6343642";
const SP = "0b9d8f0e-1111-4222-8333-944455556666";
const APP = "https://enquiries.example.com/settings";

describe("parseRequest", () => {
  it("reads an invitation, tidying the address and name", () => {
    expect(
      parseRequest({ action: "invite", email: " Ahmed@SilverLynxOman.com ", fullName: " Ahmed   Al Balushi ", role: "editor", salesPersonId: SP, delivery: "link", redirectTo: APP }),
    ).toEqual({ action: "invite", email: "ahmed@silverlynxoman.com", fullName: "Ahmed Al Balushi", role: "editor", salesPersonId: SP, delivery: "link", redirectTo: APP });
  });

  it("refuses invitations it cannot carry out", () => {
    const ok = { action: "invite", email: "a@b.co", role: "viewer", delivery: "email", redirectTo: APP };
    expect(parseRequest({ ...ok, email: "not an address" })).toEqual({ error: "Enter a valid e-mail address." });
    // Owners are made from the table by an owner, never by invitation.
    expect(parseRequest({ ...ok, role: "owner" })).toHaveProperty("error");
    expect(parseRequest({ ...ok, salesPersonId: "x" })).toHaveProperty("error");
    expect(parseRequest({ ...ok, delivery: "sms" })).toHaveProperty("error");
    expect(parseRequest({ ...ok, redirectTo: "javascript:alert(1)" })).toHaveProperty("error");
    expect(parseRequest({ ...ok, salesPersonId: "" })).toMatchObject({ salesPersonId: null, fullName: "" });
  });

  it("needs a valid user id for actions on a login", () => {
    expect(parseRequest({ action: "reset_password", userId: "1", delivery: "email", redirectTo: APP })).toHaveProperty("error");
    expect(parseRequest({ action: "reset_password", userId: ID, delivery: "email", redirectTo: APP })).toEqual({
      action: "reset_password",
      userId: ID,
      delivery: "email",
      redirectTo: APP,
    });
    expect(parseRequest({ action: "set_access", userId: ID, enabled: "no" })).toHaveProperty("error");
    expect(parseRequest({ action: "set_access", userId: ID, enabled: false })).toEqual({ action: "set_access", userId: ID, enabled: false });
  });

  it("checks temporary passwords", () => {
    expect(parseRequest({ action: "set_password", userId: ID, password: "short" })).toEqual({ error: "Use at least 8 characters." });
    expect(parseRequest({ action: "set_password", userId: ID, password: " padded-pass " })).toHaveProperty("error");
    expect(parseRequest({ action: "set_password", userId: ID, password: "Long-enough1" })).toEqual({ action: "set_password", userId: ID, password: "Long-enough1" });
  });

  it("refuses empty and unknown requests", () => {
    expect(parseRequest(null)).toHaveProperty("error");
    expect(parseRequest({ action: "delete_everyone" })).toEqual({ error: 'Unknown action "delete_everyone".' });
  });
});

describe("selfActionError", () => {
  it("keeps the owner from locking themself out", () => {
    expect(selfActionError({ action: "set_access", userId: ID, enabled: false }, ID)).toMatch(/your own access/);
    expect(selfActionError({ action: "set_password", userId: ID, password: "x".repeat(8) }, ID)).toMatch(/Account page/);
    expect(selfActionError({ action: "set_access", userId: ID, enabled: false }, SP)).toBeNull();
    expect(selfActionError({ action: "reset_password", userId: ID, delivery: "link", redirectTo: APP }, ID)).toBeNull();
  });
});

describe("links and errors", () => {
  it("sends links back to the Account page of the same app", () => {
    expect(accountPage("https://enquiries.example.com/settings?tab=users")).toBe("https://enquiries.example.com/account");
  });

  it("explains Supabase Auth errors", () => {
    expect(authErrorMessage({ code: "email_exists", message: "A user with this email address has already been registered" })).toBe(
      "There is already a login for this e-mail address.",
    );
    expect(authErrorMessage({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" })).toMatch(/Show me a link/);
    expect(authErrorMessage({ code: "email_address_not_authorized", message: "Email address not authorized" })).toMatch(/project team/);
    expect(authErrorMessage({ message: "Something else" })).toBe("Something else");
    expect(authErrorMessage(null)).toBe("Supabase Auth did not say why.");
  });
});

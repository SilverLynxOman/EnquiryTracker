import { describe, expect, it } from "vitest";
import type { UserAccount } from "./types";
import { addedOn, applyChange, changeNotice, joinNames, lastSignIn, linkedTo, sharedLinks, userName } from "./users";

const VIVEK = "sp-vivek";
const ANWAR = "sp-anwar";

function user(id: string, over: Partial<UserAccount> = {}): UserAccount {
  return {
    id,
    email: `${id}@silverlynxoman.com`,
    full_name: id.toUpperCase(),
    role: "viewer",
    sales_person_id: null,
    sales_person_name: null,
    last_sign_in_at: null,
    created_at: "2026-11-01T08:00:00Z",
    ...over,
  };
}

const ahmed = user("ahmed", { full_name: "Ahmed Ali", sales_person_id: VIVEK, sales_person_name: "VIVEK" });
const bilal = user("bilal", { full_name: "Bilal", sales_person_id: VIVEK, sales_person_name: "VIVEK" });
const chen = user("chen", { full_name: "Chen", sales_person_id: ANWAR, sales_person_name: "ANWAR ALI" });
const pricing = user("pricing", { full_name: null, role: "admin" });

describe("userName", () => {
  it("uses the profile name, else the e-mail address before the @", () => {
    expect(userName(ahmed)).toBe("Ahmed Ali");
    expect(userName({ full_name: "  ", email: "pricing@silverlynxoman.com" })).toBe("pricing");
    expect(userName({ full_name: null, email: null })).toBe("Unnamed login");
  });
});

describe("joinNames", () => {
  it("lists names in a sentence", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Ahmed"])).toBe("Ahmed");
    expect(joinNames(["Ahmed", "Bilal"])).toBe("Ahmed and Bilal");
    expect(joinNames(["Ahmed", "Bilal", "Chen"])).toBe("Ahmed, Bilal and Chen");
  });
});

describe("shared sales persons", () => {
  const users = [ahmed, bilal, chen, pricing];

  it("finds the other logins on a sales person", () => {
    expect(linkedTo(users, VIVEK, "bilal").map((u) => u.id)).toEqual(["ahmed"]);
    expect(linkedTo(users, VIVEK, "pricing").map((u) => u.id)).toEqual(["ahmed", "bilal"]);
    expect(linkedTo(users, ANWAR, "chen")).toEqual([]);
  });

  it("flags every login that shares its sales person, and only those", () => {
    const shared = sharedLinks(users);
    expect([...shared.keys()].sort()).toEqual(["ahmed", "bilal"]);
    expect(shared.get("ahmed")?.map((u) => u.id)).toEqual(["bilal"]);
    expect(shared.get("bilal")?.map((u) => u.id)).toEqual(["ahmed"]);
  });
});

describe("lastSignIn", () => {
  // Local times, so the checks hold in any time zone.
  const now = new Date(2026, 10, 5, 10, 30);
  const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

  it("names today and yesterday with the time, older days by date", () => {
    expect(lastSignIn(at(2026, 10, 5, 9, 5), now)).toBe("Today, 09:05");
    expect(lastSignIn(at(2026, 10, 4, 17, 40), now)).toBe("Yesterday, 17:40");
    expect(lastSignIn(at(2026, 10, 3, 23, 59), now)).toBe("03 Nov 2026");
    expect(lastSignIn(at(2025, 11, 31, 8, 0), now)).toBe("31 Dec 2025");
  });

  it("says when someone has never signed in", () => {
    expect(lastSignIn(null, now)).toBe("Not signed in yet");
  });

  it("handles the first of the month (yesterday is in the previous month)", () => {
    expect(lastSignIn(at(2026, 9, 31, 22, 0), new Date(2026, 10, 1, 8, 0))).toBe("Yesterday, 22:00");
  });

  it("dates when the login was added", () => {
    expect(addedOn(at(2026, 10, 4, 12, 0))).toBe("Added 04 Nov 2026");
  });
});

describe("applyChange", () => {
  const users = [ahmed, bilal, chen, pricing];

  it("changes the role of that login only", () => {
    const next = applyChange(users, { user: chen, role: "editor" }, null);
    expect(next.find((u) => u.id === "chen")?.role).toBe("editor");
    expect(next.filter((u) => u.role === "editor")).toHaveLength(1);
  });

  it("links and unlinks a sales person with its name", () => {
    const linked = applyChange(users, { user: pricing, salesPersonId: ANWAR }, "ANWAR ALI");
    expect(linked.find((u) => u.id === "pricing")).toMatchObject({ sales_person_id: ANWAR, sales_person_name: "ANWAR ALI" });
    const unlinked = applyChange(users, { user: chen, salesPersonId: null }, null);
    expect(unlinked.find((u) => u.id === "chen")).toMatchObject({ sales_person_id: null, sales_person_name: null });
  });

  it("moving the link unlinks the other logins; linking both keeps them", () => {
    const moved = applyChange(users, { user: chen, salesPersonId: VIVEK, moveLink: true }, "VIVEK");
    expect(moved.filter((u) => u.sales_person_id === VIVEK).map((u) => u.id)).toEqual(["chen"]);
    const both = applyChange(users, { user: chen, salesPersonId: VIVEK }, "VIVEK");
    expect(both.filter((u) => u.sales_person_id === VIVEK).map((u) => u.id)).toEqual(["ahmed", "bilal", "chen"]);
  });
});

describe("changeNotice", () => {
  it("says what changed, with the right article", () => {
    expect(changeNotice({ user: chen, role: "admin" }, [], null)).toBe("Chen is now an admin.");
    expect(changeNotice({ user: chen, role: "editor" }, [], null)).toBe("Chen is now an editor.");
    expect(changeNotice({ user: chen, role: "viewer" }, [], null)).toBe("Chen is now a viewer.");
  });

  it("names the sales person in display case", () => {
    expect(changeNotice({ user: pricing, salesPersonId: ANWAR }, [], "ANWAR ALI")).toBe("pricing is now linked to Anwar Ali.");
    expect(changeNotice({ user: chen, salesPersonId: null }, [], null)).toBe("Chen is no longer linked to a sales person.");
  });

  it("names the logins that lost or share the link", () => {
    expect(changeNotice({ user: chen, salesPersonId: VIVEK, moveLink: true }, [ahmed], "VIVEK")).toBe("Chen is now linked to Vivek, in place of Ahmed Ali.");
    expect(changeNotice({ user: chen, salesPersonId: VIVEK }, [ahmed], "VIVEK")).toBe("Chen and Ahmed Ali are now both linked to Vivek.");
    expect(changeNotice({ user: chen, salesPersonId: VIVEK }, [ahmed, bilal], "VIVEK")).toBe("Chen, Ahmed Ali and Bilal are now all linked to Vivek.");
  });
});

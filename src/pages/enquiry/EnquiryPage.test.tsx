import { describe, expect, it, vi } from "vitest";

// The page reads through the database module; nothing here calls it.
vi.mock("../../lib/supabase", () => ({ supabase: {}, needsPassword: () => false, markNeedsPassword: () => {}, clearNeedsPassword: () => {} }));

const { closeOutcome, hidesByItself, movedText, moveQuestion } = await import("./EnquiryPage");

describe("moving e-mails to another enquiry", () => {
  it("asks first, in one sentence, since a move cannot be undone from here", () => {
    expect(moveQuestion(2, "SL262799", "SL262700")).toBe("Move 2 e-mails to SL262799? They will stop counting for SL262700.");
    expect(moveQuestion(1, "SL262799", "SL262700")).toBe("Move 1 e-mail to SL262799? It will stop counting for SL262700.");
    expect(moveQuestion(1, null, "SL262700")).toBe("Send 1 e-mail back to Needs review? It will stop counting for SL262700.");
    expect(moveQuestion(3, null, "SL262700")).toBe("Send 3 e-mails back to Needs review? They will stop counting for SL262700.");
  });

  it("says it was done in a notice with no Undo, which goes by itself", () => {
    expect(movedText(2, "SL262799")).toBe("2 e-mails moved to SL262799.");
    expect(movedText(1, null)).toBe("1 e-mail sent back to Needs review.");
    expect(hidesByItself({ text: movedText(2, "SL262799") })).toBe(true);
  });
});

describe("closing as lost or not genuine", () => {
  it("says it was closed, with an Undo that reopens it", () => {
    const done = closeOutcome(["e1"], "SL262700", "lost");
    expect(done).toEqual({ notice: { text: "SL262700 is closed as lost.", undoIds: ["e1"] } });
    expect(closeOutcome(["e1"], "SL262700", "not_genuine")).toEqual({ notice: { text: "SL262700 is marked not genuine.", undoIds: ["e1"] } });
    if ("notice" in done) expect(hidesByItself(done.notice)).toBe(false);
  });

  it("says so as an error when the database closed nothing: a colleague confirmed or closed it meanwhile", () => {
    expect(closeOutcome([], "SL262700", "lost")).toEqual({ error: "SL262700 was not closed: it is not open any more." });
  });
});

describe("notices", () => {
  it("go by themselves unless they have something to undo", () => {
    expect(hidesByItself({ text: "Saved SL262700." })).toBe(true);
    // An empty list of enquiries to reopen is nothing to undo.
    expect(hidesByItself({ text: "SL262700 is closed as lost.", undoIds: [] })).toBe(true);
    expect(hidesByItself({ text: "SL262700 is closed as lost.", undoIds: ["e1"] })).toBe(false);
    expect(hidesByItself({ text: "Put away in this browser.", undo: () => {} })).toBe(false);
  });
});

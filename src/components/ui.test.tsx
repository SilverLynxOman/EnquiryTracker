import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alert, Button, buttonClass } from "./ui";

describe("Alert", () => {
  it("lets its text shrink and break a long e-mail address instead of widening the page", () => {
    const html = renderToStaticMarkup(<Alert kind="success">logistics.coordinator@globalfreightsolutions.com copied.</Alert>);
    expect(html).toContain('<div class="min-w-0 grow basis-48 break-words">logistics.coordinator@globalfreightsolutions.com copied.</div>');
    expect(html).toContain('role="status"');
  });

  it("keeps its action beside the text, wrapping under it when there is no room", () => {
    const html = renderToStaticMarkup(<Alert action={<Button size="sm">Undo</Button>}>It could not be saved.</Alert>);
    expect(html).toMatch(/^<div role="alert" class="flex flex-wrap items-center justify-between gap-2 [^"]*"><div class="min-w-0 grow basis-48 break-words">It could not be saved\.<\/div><button/);
  });
});

describe("Button", () => {
  it("stays on one line at its usual height", () => {
    expect(buttonClass("secondary", "sm")).toContain("whitespace-nowrap h-8 px-2.5");
    expect(renderToStaticMarkup(<Button>Save changes</Button>)).toContain("whitespace-nowrap h-9 px-3");
  });

  it("wraps a label too long for the room inside its box when asked to", () => {
    const html = renderToStaticMarkup(
      <Button variant="secondary" size="sm" wrap>
        Chase frontline.shipping.operations@gmail.com
      </Button>,
    );
    expect(html).toContain("max-w-full whitespace-normal wrap-anywhere text-center min-h-8 px-2.5 py-1");
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain(" h-8 ");
    expect(buttonClass("primary", "md", "", true)).toContain("min-h-9 px-3 py-1.5");
  });
});

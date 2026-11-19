import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { LaneBenchmark } from "../../lib/enquiryBrief";
import type { EnquiryRow, HistoryRow } from "../../lib/types";
import { LaneCard } from "./LaneCard";

// The card loads the route's history itself; here the history is already in the cache.
vi.mock("../../lib/api", () => ({ fetchLaneHistory: vi.fn() }));

const today = "2026-11-12";

const row: EnquiryRow = {
  id: "e1",
  reference: "SL262784",
  enquiry_date: "2026-11-04",
  quoted_date: null,
  confirmed_date: null,
  closure: null,
  closure_reason: null,
  status: "new",
  customer_id: "c1",
  subject: null,
  trade_type: "IMP",
  qty_text: null,
  shipment_mode: "LCL",
  units: null,
  container_type: null,
  currency: "USD",
  buy_rate: null,
  buy_total: null,
  sell_rate: null,
  sell_total: null,
  profit: null,
  pol: "NINGBO",
  pod: "SOHAR",
  agent_id: null,
  sales_person_id: null,
  remarks: null,
  contact_id: null,
  requirements: null,
  source: "email",
  import_batch_id: null,
  created_at: "2026-11-04T06:00:00Z",
  created_by: null,
  updated_at: "2026-11-04T06:00:00Z",
  updated_by: null,
  customer_name: "OMAN TEXTILES",
  agent_name: null,
  sales_person_name: "JITTU",
  contact_name: null,
  contact_email: null,
  contact_phone: null,
};

const win = (n: number, profit: number): HistoryRow => ({
  id: `w${n}`,
  reference: `SL26200${n}`,
  enquiry_date: `2026-0${n}-01`,
  quoted_date: `2026-0${n}-02`,
  confirmed_date: `2026-0${n}-05`,
  status: "confirmed",
  shipment_mode: "LCL",
  qty_text: null,
  pol: "NINGBO",
  pod: "SOHAR",
  customer_name: "ACME TRADING",
  agent_name: "FRONTLINE",
  buy_total: 800,
  sell_total: 800 + profit,
  profit,
});

const history = [win(1, 230), win(2, 247), win(3, 260)];

const benchmark: LaneBenchmark = {
  pricedWins: 3,
  usualProfitUsd: 247,
  topAgent: { name: "Frontline", wins: 3 },
  text: "Usual profit on this route: about USD 247 (from 3 priced wins) · Frontline won 3 of them",
};

function render(given?: LaneBenchmark | null) {
  const client = new QueryClient();
  client.setQueryData(["lane-history", "NINGBO", "SOHAR", "2026-01-01"], history);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LaneCard row={row} today={today} benchmark={given} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LaneCard", () => {
  it("says the route's usual profit in one plain line above the wins", () => {
    const html = render(benchmark);
    expect(html).toContain("Ningbo → Sohar before");
    expect(html).toContain("Usual profit on this route: about USD 247 (from 3 priced wins) · Frontline won 3 of them");
    expect(html).toMatch(/<p class="mt-2 break-words text-body tabular-nums text-ink-heading">Usual profit/);
    expect(html.indexOf("enquiries this year")).toBeLessThan(html.indexOf("Usual profit"));
    expect(html.indexOf("Usual profit")).toBeLessThan(html.indexOf("SL262003"));
    expect(html).toContain("+260");
  });

  it("stays as it was without the line", () => {
    for (const html of [render(), render(null)]) {
      expect(html).not.toContain("Usual profit");
      expect(html).toContain("SL262003");
      expect(html).toContain("Buy → sell in USD.");
    }
  });

  it("keeps the line back under three priced wins", () => {
    expect(render({ ...benchmark, pricedWins: 2 })).not.toContain("Usual profit");
    expect(render({ ...benchmark, text: " " })).not.toContain("Usual profit");
  });
});

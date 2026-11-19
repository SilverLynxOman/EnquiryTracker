import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchPriceCheckers } from "../lib/api";
import { todayIso } from "../lib/format";
import { lastJobText, PRICE_CHECKER_MIN_QUOTES, priceCheckerSince, priceCheckerSummary } from "../lib/priceCheckers";
import type { PriceChecker } from "../lib/types";
import { Icon } from "./icons";

/**
 * Customer id → their record, for every price checker (src/lib/priceCheckers.ts). One small list for the whole app,
 * fetched once and shared by every screen that tags customers. Empty while loading or when it fails: the tag is a
 * hint, never something a screen waits for.
 */
export function usePriceCheckers(): Map<string, PriceChecker> {
  const since = priceCheckerSince(todayIso());
  const q = useQuery({
    queryKey: ["price-checkers", since],
    queryFn: () => fetchPriceCheckers(since, PRICE_CHECKER_MIN_QUOTES),
    staleTime: 300_000,
    select: (rows) => new Map(rows.map((r) => [r.customer_id, r])),
  });
  return q.data ?? EMPTY;
}

const EMPTY = new Map<string, PriceChecker>();

/** The small orange "Price checker" tag beside a customer's name; the counts are in its tooltip. */
export function PriceCheckerTag({ info, className = "" }: { info: PriceChecker; className?: string }) {
  return (
    <span
      title={`${priceCheckerSummary(info)}. ${lastJobText(info)}`}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-price-line bg-price-bg px-1.5 text-meta font-medium text-price ${className}`}
    >
      <Icon name="tag" className="size-3" />
      Price checker
    </span>
  );
}

/** A line saying what the tag means, for the enquiry page and the Inbox; `children` adds advice or a link. */
export function PriceCheckerNote({ info, children, className = "" }: { info: PriceChecker; children?: ReactNode; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-control border border-price-line bg-price-bg px-3 py-2 text-meta text-price-strong ${className}`}>
      <Icon name="tag" className="mt-px size-4 shrink-0 text-price" />
      <span>
        <strong className="font-semibold">Price checker:</strong> {priceCheckerSummary(info)}. {children}
      </span>
    </p>
  );
}

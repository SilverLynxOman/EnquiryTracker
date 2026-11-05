import { nameKey } from "./normalize";

/**
 * The standard name of a port spelling, using the map from fetchPortNameMap (name key → standard name). The same
 * rule as the database trigger enquiries_apply_port_names, so a known spelling in an Excel file is not a change.
 */
export function standardPortName(map: ReadonlyMap<string, string>, raw: string | null): string | null {
  if (!raw) return raw;
  const key = nameKey(raw);
  return (key && map.get(key)) || raw;
}

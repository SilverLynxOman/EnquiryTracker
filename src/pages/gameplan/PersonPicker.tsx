import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { inputClass } from "../../components/ui";
import { fetchSalesPersons } from "../../lib/api";
import { displayName } from "../../lib/display";

/** Opens any sales person's game plan (for managers, and to preview the page). */
export function PersonPicker({ current, label = "Game plan of" }: { current?: string; label?: string }) {
  const navigate = useNavigate();
  const persons = useQuery({ queryKey: ["sales-persons"], queryFn: fetchSalesPersons });
  return (
    <label className="flex items-center gap-2 text-meta font-medium text-ink-heading">
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={current ?? ""}
        onChange={(e) => {
          if (e.target.value) navigate(`/plan/${e.target.value}`);
        }}
        className={`${inputClass} h-8 w-48`}
      >
        <option value="">Choose a sales person…</option>
        {persons.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {displayName(p.name)}
          </option>
        ))}
      </select>
    </label>
  );
}

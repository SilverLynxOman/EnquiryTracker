import { useParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Card, Spinner } from "../../components/ui";
import GamePlanPage from "./GamePlanPage";
import { PersonPicker } from "./PersonPicker";

/** /plan/:salesPersonId: anyone's game plan; /plan: your own, or a picker when you are not a sales person. */
export default function GamePlanRoute() {
  const { salesPersonId } = useParams();
  const { profile, profileLoading } = useAuth();
  if (profileLoading) return <Spinner />;
  const id = salesPersonId ?? profile?.sales_person_id ?? null;
  if (!id) {
    return (
      <Card title="Game plans">
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-ink-muted">
            Each sales person's home page: today's missions, their quick-quote streak and goal, and the team voyage. Choose someone to see theirs.
          </p>
          <PersonPicker label="Sales person" />
        </div>
      </Card>
    );
  }
  return <GamePlanPage key={id} salesPersonId={id} />;
}

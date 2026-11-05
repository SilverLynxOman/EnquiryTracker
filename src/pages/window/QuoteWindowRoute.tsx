import { useParams } from "react-router";
import { useAuth } from "../../auth/AuthProvider";
import { Card, Spinner } from "../../components/ui";
import { PersonPicker } from "./PersonPicker";
import QuoteWindowPage from "./QuoteWindowPage";

/** /plan/:salesPersonId: anyone's open quotes (The Window); /plan: your own, or a picker when you are not a sales person. */
export default function QuoteWindowRoute() {
  const { salesPersonId } = useParams();
  const { profile, profileLoading } = useAuth();
  if (profileLoading) return <Spinner />;
  const id = salesPersonId ?? profile?.sales_person_id ?? null;
  if (!id) {
    return (
      <Card title="Open quotes">
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-ink-muted">
            Each sales person's home page: every open quote on a timeline of days since it was sent, with the window in which their wins usually
            arrive. Choose someone to see theirs.
          </p>
          <PersonPicker label="Sales person" />
        </div>
      </Card>
    );
  }
  return <QuoteWindowPage key={id} salesPersonId={id} />;
}

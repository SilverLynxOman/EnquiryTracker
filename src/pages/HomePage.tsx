import { useAuth } from "../auth/AuthProvider";
import { Spinner } from "../components/ui";
import DashboardPage from "./DashboardPage";
import GamePlanPage from "./gameplan/GamePlanPage";

/** Sales persons land on their game plan; everyone else (managers, pricing) on the dashboard. */
export default function HomePage() {
  const { profile, profileLoading } = useAuth();
  if (profileLoading) return <Spinner />;
  return profile?.sales_person_id ? <GamePlanPage key={profile.sales_person_id} salesPersonId={profile.sales_person_id} /> : <DashboardPage />;
}

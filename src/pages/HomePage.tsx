import { useAuth } from "../auth/AuthProvider";
import { Spinner } from "../components/ui";
import DashboardPage from "./DashboardPage";
import QuoteWindowPage from "./window/QuoteWindowPage";

/** Sales persons land on their open quotes (The Window); everyone else (managers, pricing) on the dashboard. */
export default function HomePage() {
  const { profile, profileLoading } = useAuth();
  if (profileLoading) return <Spinner />;
  return profile?.sales_person_id ? <QuoteWindowPage key={profile.sales_person_id} salesPersonId={profile.sales_person_id} /> : <DashboardPage />;
}

import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { Spinner } from "../components/ui";
import { useAuth } from "./AuthProvider";

/**
 * Pages for those who see every enquiry (the pricing inbox, imports): sales staff, who see only their own, go home.
 * The database refuses them too (supabase/migrations/20261105172357_own_enquiries.sql).
 */
export function RequireSeesAll({ children }: { children: ReactNode }) {
  const { seesAll, profileLoading } = useAuth();
  if (profileLoading) return <Spinner />;
  if (!seesAll) return <Navigate to="/" replace />;
  return <>{children}</>;
}

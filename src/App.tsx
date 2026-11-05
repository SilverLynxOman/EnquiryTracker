import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import AccountPage from "./pages/AccountPage";
import EnquiryPage from "./pages/enquiry/EnquiryPage";
import EnquiryFormPage from "./pages/EnquiryFormPage";
import FollowUpsPage from "./pages/FollowUpsPage";
import QuoteWindowRoute from "./pages/window/QuoteWindowRoute";
import HomePage from "./pages/HomePage";
import InboxPage from "./pages/InboxPage";
import LoginPage from "./pages/LoginPage";
import { AGENTS, CUSTOMERS, PORTS } from "./pages/masters/kinds";
import MasterListPage from "./pages/masters/MasterListPage";
import MastersLayout from "./pages/masters/MastersLayout";
import RegisterPage from "./pages/RegisterPage";
import ReportsLayout from "./pages/reports/ReportsLayout";

// The importer pulls in the Excel library; load it only when the page is opened.
const ImportPage = lazy(() => import("./pages/ImportPage"));
const PeriodReportPage = lazy(() => import("./pages/reports/PeriodReportPage"));
const AnalyticsPage = lazy(() => import("./pages/reports/AnalyticsPage"));
const TvPage = lazy(() => import("./pages/voyage/TvPage"));
// Admins only, and rarely opened.
const UsersPage = lazy(() => import("./pages/UsersPage"));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* The team voyage for the office screen: signed in, but without the app's navigation. */}
      <Route
        path="/tv"
        element={
          <RequireAuth>
            <Suspense fallback={<Spinner />}>
              <TvPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="plan" element={<QuoteWindowRoute />} />
        <Route path="plan/:salesPersonId" element={<QuoteWindowRoute />} />
        <Route path="enquiries" element={<RegisterPage />} />
        <Route path="enquiries/new" element={<EnquiryFormPage />} />
        <Route path="enquiries/:id" element={<EnquiryPage />} />
        <Route path="enquiries/:id/edit" element={<EnquiryFormPage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route element={<MastersLayout />}>
          {/* key: a fresh page (filters, selection) per list */}
          <Route path="customers" element={<MasterListPage key="customers" kind={CUSTOMERS} />} />
          <Route path="agents" element={<MasterListPage key="agents" kind={AGENTS} />} />
          <Route path="ports" element={<MasterListPage key="ports" kind={PORTS} />} />
        </Route>
        <Route
          path="import"
          element={
            <Suspense fallback={<Spinner />}>
              <ImportPage />
            </Suspense>
          }
        />
        <Route path="reports" element={<ReportsLayout />}>
          <Route index element={<Navigate to="daily" replace />} />
          {/* key: a fresh page (and picker state) per report type */}
          <Route path="daily" element={<PeriodReportPage key="daily" kind="daily" />} />
          <Route path="weekly" element={<PeriodReportPage key="weekly" kind="weekly" />} />
          <Route path="monthly" element={<PeriodReportPage key="monthly" kind="monthly" />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
        <Route path="account" element={<AccountPage />} />
        <Route
          path="admin/users"
          element={
            <Suspense fallback={<Spinner />}>
              <UsersPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import AccountPage from "./pages/AccountPage";
import DashboardPage from "./pages/DashboardPage";
import EnquiryFormPage from "./pages/EnquiryFormPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

// The importer pulls in the Excel library; load it only when the page is opened.
const ImportPage = lazy(() => import("./pages/ImportPage"));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="enquiries" element={<RegisterPage />} />
        <Route path="enquiries/new" element={<EnquiryFormPage />} />
        <Route path="enquiries/:id" element={<EnquiryFormPage />} />
        <Route
          path="import"
          element={
            <Suspense fallback={<Spinner />}>
              <ImportPage />
            </Suspense>
          }
        />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

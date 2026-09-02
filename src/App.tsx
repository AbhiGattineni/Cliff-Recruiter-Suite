import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Home from "./pages/Home";
import ResumeParsing from "./pages/ResumeParsing";
import ResumeReports from "./pages/ResumeReports";
import ReportGeneration from "./pages/ReportGeneration";
import SavedReports from "./pages/SavedReports";
import RecruiterPerformance from "./pages/RecruiterPerformance";
import ClientTracker from "./pages/ClientTracker";
import CandidatePool from "./pages/CandidatePool";
import Preferences from "./pages/Preferences";
import Timesheets from "./pages/Timesheets";
import Consultants from "./pages/Consultants";
import ConsultantPortal from "./pages/ConsultantPortal";
import DesignPreview from "./pages/DesignPreview";

export default function App() {
  const { loading, profile, profileLoading } = useAuth();
  // A placed consultant gets the portal and nothing else. Sending them to /portal
  // rather than rendering a stripped-down suite means they never learn the rest
  // of the app exists; firestore.rules is what actually keeps them out of it.
  const isConsultant = profile?.role === "consultant";

  if (loading) {
    return (
      <div className="center-load">
        <div className="spinner dark" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/portal"
        element={
          <ProtectedRoute>
            <ConsultantPortal />
          </ProtectedRoute>
        }
      />
      {/* Design harness for the assessment layout — dev server only. */}
      {import.meta.env.DEV && <Route path="/design-preview" element={<DesignPreview />} />}
      <Route
        element={
          <ProtectedRoute>
            {/* Wait for the role before deciding — redirecting on a not-yet-loaded
                profile would bounce staff into the portal on every cold load. */}
            {profileLoading && !profile ? (
              <div className="center-load">
                <div className="spinner dark" />
              </div>
            ) : isConsultant ? (
              <Navigate to="/portal" replace />
            ) : (
              <Layout />
            )}
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/resume" element={<ResumeParsing />} />
        <Route path="/resume-reports" element={<ResumeReports />} />
        <Route path="/reports" element={<ReportGeneration />} />
        <Route path="/saved-reports" element={<SavedReports />} />
        <Route path="/recruiters" element={<RecruiterPerformance />} />
        <Route path="/client-tracker" element={<ClientTracker />} />
        <Route path="/candidate-pool" element={<CandidatePool />} />
        <Route path="/timesheets" element={<Timesheets />} />
        <Route path="/consultants" element={<Consultants />} />
        <Route path="/preferences" element={<Preferences />} />
      </Route>
      <Route path="*" element={<Navigate to={isConsultant ? "/portal" : "/"} replace />} />
    </Routes>
  );
}

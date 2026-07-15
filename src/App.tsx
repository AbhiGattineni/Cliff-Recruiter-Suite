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
import CandidatePool from "./pages/CandidatePool";
import Preferences from "./pages/Preferences";

export default function App() {
  const { loading } = useAuth();

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
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/resume" element={<ResumeParsing />} />
        <Route path="/resume-reports" element={<ResumeReports />} />
        <Route path="/reports" element={<ReportGeneration />} />
        <Route path="/saved-reports" element={<SavedReports />} />
        <Route path="/recruiters" element={<RecruiterPerformance />} />
        <Route path="/candidate-pool" element={<CandidatePool />} />
        <Route path="/preferences" element={<Preferences />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

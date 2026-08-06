import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import MyTimesheetTab from "../components/timesheets/MyTimesheetTab";
import MyLeavesTab from "../components/timesheets/MyLeavesTab";
import TeamDashboardTab from "../components/timesheets/TeamDashboardTab";

type Tab = "mine" | "leaves" | "team";

export default function Timesheets() {
  const { profile, profileLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("mine");
  const canSeeTeam = profile?.role === "admin" || profile?.role === "manager";

  return (
    <div>
      <h1>Timesheets</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Log your hours every day and request time off.
        {canSeeTeam && " Managers and admins can also track the whole team below."}
      </p>

      {profileLoading && !profile ? (
        <div className="center-load" style={{ minHeight: "30vh" }}>
          <div className="spinner dark" />
        </div>
      ) : !profile ? (
        <div className="alert error">
          Couldn&#39;t load your profile. Reload the page — if this keeps happening, the Cloud Functions may
          not be deployed yet.
        </div>
      ) : (
        <>
          <div className="segmented" style={{ marginBottom: "1rem" }}>
            <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
              My Timesheet
            </button>
            <button className={tab === "leaves" ? "active" : ""} onClick={() => setTab("leaves")}>
              My Leaves
            </button>
            {canSeeTeam && (
              <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>
                Team Dashboard
              </button>
            )}
          </div>

          {tab === "mine" && <MyTimesheetTab />}
          {tab === "leaves" && <MyLeavesTab />}
          {tab === "team" && canSeeTeam && <TeamDashboardTab role={profile.role} />}
        </>
      )}
    </div>
  );
}

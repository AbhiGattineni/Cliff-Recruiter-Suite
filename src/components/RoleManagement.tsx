import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "../lib/errors";
import { listUsers, setUserRole, setUserActive, Role, ROLES, ROLE_LABELS } from "../lib/timesheets";
import { useAuth } from "../context/AuthContext";

const PERMANENT_ADMIN_EMAIL = "abhishek.g@cliff-services.com";

export default function RoleManagement() {
  const qc = useQueryClient();
  const { profile, refreshProfile } = useAuth();
  const usersQ = useQuery({ queryKey: ["allUserProfiles"], queryFn: () => listUsers() });
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  const changeRole = async (uid: string, role: Role) => {
    setSavingUid(uid);
    setError(null);
    try {
      await setUserRole(uid, role);
      await qc.invalidateQueries({ queryKey: ["allUserProfiles"] });
      await refreshProfile(); // in case the admin just changed their own role
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingUid(null);
    }
  };

  const changeActive = async (uid: string, active: boolean, who: string) => {
    if (
      !active &&
      !window.confirm(
        `Deactivate ${who}?\n\nThey will stop being tracked for timesheets and won't be able to ` +
          `sign in. Everything they have already filed stays exactly where it is, and stays visible. ` +
          `You can reactivate them at any time.`
      )
    ) {
      return;
    }
    setSavingUid(uid);
    setError(null);
    try {
      await setUserActive(uid, active);
      await qc.invalidateQueries({ queryKey: ["allUserProfiles"] });
      await qc.invalidateQueries({ queryKey: ["teamTimesheets"] });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingUid(null);
    }
  };

  const all = usersQ.data ?? [];
  const inactiveCount = all.filter((u) => !u.active).length;
  const shown = showInactive ? all : all.filter((u) => u.active);

  return (
    <div className="card">
      <h2>Team &amp; roles</h2>
      <p className="sub">
        Assign who&#39;s an admin, manager, or employee. Employees fill timesheets and request leave;
        managers and admins can additionally approve employee leave and track the team&#39;s timesheets on the
        Timesheets tab. Only an admin can approve a manager&#39;s leave. A bench sales recruiter is an
        employee whose timesheet books bench submissions as well as requirements.
      </p>
      <p className="sub" style={{ marginTop: "-0.4rem" }}>
        Deactivate someone who has left. They stop being tracked for timesheets and can no longer
        sign in — and everything they ever filed stays visible, exactly where it is.
      </p>
      {error && <div className="alert error">{error}</div>}
      {inactiveCount > 0 && (
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.82rem", marginBottom: "0.6rem" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show {inactiveCount} deactivated {inactiveCount === 1 ? "person" : "people"}
        </label>
      )}
      {usersQ.isLoading ? (
        <div className="center-load" style={{ minHeight: "20vh" }}>
          <div className="spinner dark" />
        </div>
      ) : usersQ.error ? (
        <div className="alert error">{friendlyError(usersQ.error)}</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: 190 }}>Role</th>
                <th style={{ width: 150 }}>Tracking</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const locked = u.email.trim().toLowerCase() === PERMANENT_ADMIN_EMAIL;
                const isMe = u.uid === profile?.uid;
                return (
                  <tr key={u.uid} style={u.active ? undefined : { opacity: 0.6 }}>
                    <td style={{ fontWeight: 600 }}>{u.displayName || "—"}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={u.role}
                        disabled={locked || !u.active || savingUid === u.uid}
                        title={
                          locked
                            ? "This account is always admin."
                            : !u.active
                              ? "Reactivate them to change their role."
                              : undefined
                        }
                        onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {u.active ? (
                        <button
                          className="btn ghost"
                          style={{ padding: "0.2rem 0.55rem", fontSize: "0.8rem" }}
                          disabled={locked || isMe || savingUid === u.uid}
                          title={
                            locked
                              ? "This account can't be deactivated."
                              : isMe
                                ? "You can't deactivate your own account."
                                : "Stop tracking this person"
                          }
                          onClick={() => changeActive(u.uid, false, u.displayName || u.email)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                          <span className="pill grey">inactive</span>
                          <button
                            className="btn ghost"
                            style={{ padding: "0.2rem 0.55rem", fontSize: "0.8rem" }}
                            disabled={savingUid === u.uid}
                            onClick={() => changeActive(u.uid, true, u.displayName || u.email)}
                          >
                            Reactivate
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                    {(usersQ.data ?? []).length === 0
                      ? "No users yet — they'll appear here after signing in."
                      : "Everyone here is deactivated — tick the box above to see them."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

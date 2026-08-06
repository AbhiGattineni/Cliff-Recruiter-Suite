import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "../lib/errors";
import { listUsers, setUserRole, Role } from "../lib/timesheets";
import { useAuth } from "../context/AuthContext";

const PERMANENT_ADMIN_EMAIL = "abhishek.g@cliff-services.com";
const ROLES: Role[] = ["admin", "manager", "employee"];

export default function RoleManagement() {
  const qc = useQueryClient();
  const { refreshProfile } = useAuth();
  const usersQ = useQuery({ queryKey: ["allUserProfiles"], queryFn: () => listUsers() });
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="card">
      <h2>Team &amp; roles</h2>
      <p className="sub">
        Assign who&#39;s an admin, manager, or employee. Employees fill timesheets and request leave;
        managers and admins can additionally approve employee leave and track the team&#39;s timesheets on the
        Timesheets tab. Only an admin can approve a manager&#39;s leave.
      </p>
      {error && <div className="alert error">{error}</div>}
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
                <th style={{ width: 160 }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {(usersQ.data ?? []).map((u) => {
                const locked = u.email.trim().toLowerCase() === PERMANENT_ADMIN_EMAIL;
                return (
                  <tr key={u.uid}>
                    <td style={{ fontWeight: 600 }}>{u.displayName || "—"}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={u.role}
                        disabled={locked || savingUid === u.uid}
                        title={locked ? "This account is always admin." : undefined}
                        onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {(usersQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="muted" style={{ textAlign: "center", padding: "1rem" }}>
                    No users yet — they&#39;ll appear here after signing in.
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

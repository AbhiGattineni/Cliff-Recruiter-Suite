import { useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isPlaceholderConfig } from "../firebase";

const NAV = [
  { to: "/", end: true, icon: "🏠", label: "Dashboard" },
  { to: "/resume", icon: "📄", label: "Resume Parsing" },
  { to: "/resume-reports", icon: "🗂️", label: "Resume Reports" },
  { to: "/reports", icon: "📊", label: "Report Generation" },
  { to: "/saved-reports", icon: "📁", label: "Saved Reports" },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="brand">
          {collapsed ? (
            <span className="brand-mark">C</span>
          ) : (
            <span className="brand-full">
              Cliff Recruiter Suite
              <small>Cliff Services Inc.</small>
            </span>
          )}
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}>
              <span className="nav-ico">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        {!collapsed && (
          <div className="user-box">
            {user ? (
              <>
                <div>Signed in as</div>
                <div style={{ fontWeight: 600, color: "#fff", wordBreak: "break-all" }}>{user.email}</div>
                <button onClick={() => signOut()}>Sign out</button>
              </>
            ) : (
              <>
                <div style={{ opacity: 0.85 }}>Authentication is off</div>
                <Link to="/login" style={{ color: "#fff", fontSize: "0.8rem", textDecoration: "underline" }}>
                  Sign in (optional)
                </Link>
              </>
            )}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="collapse-btn" onClick={toggle} title={collapsed ? "Expand menu" : "Collapse menu"} aria-label="Toggle menu">
            ☰
          </button>
          <span>Recruiter Tools</span>
        </div>
        <div className="content">
          {isPlaceholderConfig && (
            <div className="alert warn">
              <strong>Placeholder configuration.</strong> The app is running on placeholder
              Firebase / API credentials. Add your real values in <span className="mono">.env</span> and
              the Cloud Functions config to enable live sign-in, Ceipal, and the LLM.
            </div>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  );
}

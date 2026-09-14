// The frame around the sign-in and create-account forms.
//
// One screen serves two audiences that have nothing in common: Cliff staff
// opening the recruiter suite, and a consultant we placed at a client opening
// their timesheet. They authenticate identically — only the role on the account
// decides where they land (see App.tsx) — so the door they both walk through is
// written for whoever shows up, and names neither tool.
//
// It is the marketing site's hero, on purpose: someone arriving from
// www.cliffservices.com should not feel they have left it.

import { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";

const POINTS = [
  "Timesheets, hours and approvals",
  "Live requirement and submission tracking",
  "Reports and assessments on demand",
];

export default function AuthShell({
  title,
  children,
}: {
  /** Sub-label under the wordmark: what this particular form does. */
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="login-wrap">
      <div className="login-grid">
        <div className="login-pitch">
          <p className="login-eyebrow">Team portal</p>
          <h1>
            Welcome back to <span className="text-gradient">Cliff Services</span>
          </h1>
          <p>
            Sign in to reach the tools your account has access to. Everything here runs on the
            same login, whether you work at Cliff or on an assignment through us.
          </p>
          <ul className="login-points">
            {POINTS.map((p) => (
              <li key={p}>
                <span className="tick" aria-hidden="true">
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="login-card">
          <div className="login-mark">
            <img src="/logo.jpg" alt="" />
            <div>
              <div className="logo">Cliff Services</div>
              <div className="tagline">{title}</div>
            </div>
            {/* Signed out is where a first-time visitor lands, so the switch
                has to be reachable before there is an account to attach it to.
                The choice is stored per browser, not per user. */}
            <ThemeToggle className="login-theme" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

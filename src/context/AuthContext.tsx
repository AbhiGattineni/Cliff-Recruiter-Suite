// Authentication context — wraps Firebase Auth and exposes the current user
// plus sign-in / sign-out helpers to the whole app.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
} from "firebase/auth";
import { auth, isPlaceholderConfig } from "../firebase";
import { isAllowedEmail, ALLOWED_DOMAIN } from "../lib/auth";
import { ensureUserProfile, UserProfile } from "../lib/timesheets";

const DOMAIN_MSG = `Only @${ALLOWED_DOMAIN} accounts are allowed.`;

// ensureUserProfile is what actually writes the userProfiles doc (server
// side) on first login — it runs on a Cloud Run service that shares this
// project's CPU quota with everything else, and that quota has been hit
// more than once. If it fails at the moment someone signs in, Firebase Auth
// still succeeds (so they can use the app), but they end up with no role and
// no visible error — silently missing from Team & roles. Rather than ask
// everyone to sign out and back in, retry it: a few quick attempts catch a
// short blip, then fall back to a slow background poll so even a longer
// outage self-heals without anyone reloading.
const QUICK_RETRY_DELAYS_MS = [2000, 5000, 15000];
const BACKGROUND_POLL_MS = 5 * 60 * 1000;

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Role profile (admin/manager/employee) used to gate Timesheets & role management. */
  profile: UserProfile | null;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  /** One attempt, no retry — errors are for the caller to handle. */
  const fetchProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (isPlaceholderConfig || !auth.currentUser) return null;
    try {
      return await ensureUserProfile();
    } catch (e) {
      console.error("ensureUserProfile failed (will retry):", e);
      return null;
    }
  }, []);

  /** Exposed for the one direct, causal re-check we already do — right after an admin changes their own role. Not part of the retry loop below. */
  const refreshProfile = useCallback(async () => {
    setProfile(await fetchProfile());
  }, [fetchProfile]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const attempt = async (delays: number[], quickBurst: boolean) => {
      const p = await fetchProfile();
      if (cancelled) return;
      if (p) {
        setProfile(p);
        setProfileLoading(false);
        return;
      }
      if (delays.length > 0) {
        const [next, ...rest] = delays;
        timer = window.setTimeout(() => void attempt(rest, true), next);
      } else {
        // Quick retries exhausted — stop blocking role-gated UI on this (it
        // reads as "no access" in the meantime, which is misleading but no
        // worse than before this fix) and keep checking quietly so a longer
        // outage still resolves on its own.
        if (quickBurst) setProfileLoading(false);
        timer = window.setTimeout(() => void attempt([], false), BACKGROUND_POLL_MS);
      }
    };

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (timer) window.clearTimeout(timer);
      if (u) {
        setProfileLoading(true);
        void attempt(QUICK_RETRY_DELAYS_MS, true);
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    if (!isAllowedEmail(email)) throw new Error(DOMAIN_MSG);
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (!isAllowedEmail(cred.user.email || "")) {
      await fbSignOut(auth);
      throw new Error(DOMAIN_MSG);
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    if (!isAllowedEmail(email)) throw new Error(DOMAIN_MSG);
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName?.trim()) await updateProfile(cred.user, { displayName: displayName.trim() });
  };

  const signOut = async () => {
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, profile, profileLoading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

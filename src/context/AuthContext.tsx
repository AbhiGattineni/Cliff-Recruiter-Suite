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

  const refreshProfile = useCallback(async () => {
    if (isPlaceholderConfig || !auth.currentUser) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      setProfile(await ensureUserProfile());
    } catch {
      // Role-gated UI (Team Dashboard, role management) just stays hidden.
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) void refreshProfile();
      else setProfile(null);
    });
    return unsub;
  }, [refreshProfile]);

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

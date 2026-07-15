// Authentication context — wraps Firebase Auth and exposes the current user
// plus sign-in / sign-out helpers to the whole app.

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
} from "firebase/auth";
import { auth } from "../firebase";
import { isAllowedEmail, ALLOWED_DOMAIN } from "../lib/auth";

const DOMAIN_MSG = `Only @${ALLOWED_DOMAIN} accounts are allowed.`;

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

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
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

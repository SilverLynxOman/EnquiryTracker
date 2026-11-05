import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearNeedsPassword, markNeedsPassword, needsPassword, supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Signed in, and the profile (role, sales person) is still being read. */
  profileLoading: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  /** Signed in from an invite or reset link and has not chosen a password yet. */
  mustSetPassword: boolean;
  passwordSet: () => void;
  /** Reads the profile again, after an admin changed their own (Users page). The current one stays meanwhile. */
  refreshProfile: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  /** The user whose profile request has finished. */
  const [profileFor, setProfileFor] = useState<string | null>(null);
  /** Bumped to read the profile again. */
  const [profileVersion, setProfileVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mustSetPassword, setMustSetPassword] = useState(needsPassword);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    // Only set state here: calling Supabase inside this callback can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") {
        markNeedsPassword();
        setMustSetPassword(true);
      }
      if (event === "SIGNED_OUT") {
        clearNeedsPassword();
        setMustSetPassword(false);
      }
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("id, full_name, role, sales_person_id")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile((data as Profile | null) ?? null);
        setProfileFor(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, profileVersion]);

  const value: AuthState = {
    session,
    profile,
    loading,
    profileLoading: userId !== null && profileFor !== userId,
    canEdit: profile?.role === "admin" || profile?.role === "editor",
    isAdmin: profile?.role === "admin",
    mustSetPassword: mustSetPassword && session !== null,
    passwordSet: () => {
      clearNeedsPassword();
      setMustSetPassword(false);
    },
    refreshProfile: () => setProfileVersion((v) => v + 1),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { Sidebar } from "@/components/sidebar";
import { isDemoMode } from "@/lib/demo-mode";

// Private, single-user app — this is a client-side UI gate only (protects the pages from
// anyone who has the URL while e.g. ngrok briefly exposes localhost publicly for an Enable
// Banking consent flow). It is NOT a hardened server-side auth layer: RLS stays disabled
// (see supabase/migrations/002_disable_rls.sql) and the Supabase anon key is still usable
// directly against the REST API by anyone who extracts it from the client bundle,
// regardless of this gate. A full fix would re-enable RLS with auth.uid()-based policies.
const ALLOWED_EMAIL = process.env.NEXT_PUBLIC_ALLOWED_EMAIL;

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (session === undefined) {
    return (
      <div className="flex-1 min-h-screen flex items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  // Public demo: no login, straight into the app on seeded dummy data.
  if (isDemoMode()) {
    return (
      <>
        <Sidebar />
        <main className="flex-1 min-w-0 p-6">{children}</main>
      </>
    );
  }

  const isAllowed = !!session && !!ALLOWED_EMAIL && session.user.email === ALLOWED_EMAIL;

  if (!isAllowed) {
    return (
      <div className="flex-1 min-h-screen flex items-center justify-center">
        <div className="max-w-sm w-full text-center px-6">
          <div className="nav-brand text-xl mb-2">FinanceHub</div>
          <p className="text-sm text-muted mb-6">
            {session
              ? `Access denied for ${session.user.email}. This app is restricted to a single account.`
              : "Private app — sign-in required."}
          </p>
          {session ? (
            <button onClick={handleSignOut} className="btn btn-secondary">
              Sign out
            </button>
          ) : (
            <button onClick={handleSignIn} className="btn btn-primary">
              Sign in with Google
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Sidebar onSignOut={handleSignOut} />
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { LoginDialog } from "@/components/LoginDialog";
import { getStoredUser, loginWithGoogle, logout, type User } from "@/lib/auth";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    void getStoredUser().then(setUser);
  }, []);

  const startGoogle = useCallback(async () => {
    setLoggingIn(true);
    try {
      await loginWithGoogle();
      const next = await getStoredUser();
      if (next) setUser(next);
    } finally {
      setLoggingIn(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col">
      <AppHeader
        user={user}
        loggingIn={loggingIn}
        onLogin={() => setLoginOpen(true)}
        onLogout={() => void logout()}
      />
      <LoginDialog isOpen={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={setUser} />

      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-4 pt-14 pb-8">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-stone-900">
            Connect Slack and your website to bots that cannot talk natively
          </h1>
          <p className="mt-4 text-stone-600 leading-relaxed text-[15px] max-w-2xl">
            Sign in with Google. We create a private workspace for you, then you attach bots
            (webhook URL + key) and channels (Slack, website widget). Nothing crosses tenants.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {user ? (
              <Link
                href="/app"
                className="inline-flex items-center rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
              >
                Open dashboard
              </Link>
            ) : (
              <button
                onClick={() => void startGoogle()}
                className="inline-flex items-center rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:from-amber-500 hover:to-amber-600 border border-amber-300"
              >
                Continue with Google
              </button>
            )}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 pb-14">
          <div className="rounded-2xl border border-stone-200 bg-white shadow-sm p-8">
            <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Step 1</div>
                <div className="mt-1 font-semibold">Login via Google</div>
                <div className="mt-1 text-sm text-stone-600">
                  No email/password account. Your tenant is created on first login.
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Step 2</div>
                <div className="mt-1 font-semibold">Connect a bot</div>
                <div className="mt-1 text-sm text-stone-600">
                  Paste the webhook URL and bearer key for a Grok Bot routine (or any compatible bot).
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Step 3</div>
                <div className="mt-1 font-semibold">Add Slack or a website widget</div>
                <div className="mt-1 text-sm text-stone-600">
                  Use Add to Slack, or drop one script tag on your site. Link any channel to any bot.
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-stone-600">
          {new Date().getFullYear()} Easy AI Bot Bridge
        </div>
      </footer>
    </div>
  );
}

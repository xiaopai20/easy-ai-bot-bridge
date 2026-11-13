"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getStoredUser();
        if (cancelled) return;
        if (user) {
          router.replace("/app");
          return;
        }
        setError("Google login did not complete. Try again from the home page.");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Login failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="rounded-2xl border border-stone-200 bg-white shadow-sm p-8 max-w-md text-center">
        <h1 className="text-lg font-semibold text-stone-900">Finishing Google login</h1>
        <p className="mt-2 text-sm text-stone-600">
          {error ?? "Creating your workspace if this is your first visit..."}
        </p>
      </div>
    </div>
  );
}

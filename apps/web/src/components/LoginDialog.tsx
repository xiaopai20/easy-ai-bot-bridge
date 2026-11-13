"use client";

import { useEffect, useState } from "react";
import { getStoredUser, loginWithGoogle, type User } from "@/lib/auth";

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export function LoginDialog({ isOpen, onClose, onSuccess }: LoginDialogProps) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoggingIn(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleStorageChange = async () => {
      const user = await getStoredUser();
      if (user) {
        setLoggingIn(false);
        setError(null);
        onSuccess(user);
      }
    };
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("auth-changed", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("auth-changed", handleStorageChange);
    };
  }, [isOpen, onSuccess]);

  async function handleLogin() {
    setError(null);
    setLoggingIn(true);
    try {
      await loginWithGoogle();
      const user = await getStoredUser();
      if (user) {
        setLoggingIn(false);
        onSuccess(user);
      }
    } catch (err) {
      setLoggingIn(false);
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold text-stone-900 mb-2">Login required</h2>
        <p className="text-sm text-stone-600 mb-6">
          Sign in with Google. A workspace is created for you on first login. There is no email or
          password sign-up.
        </p>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loggingIn}
            className="flex-1 px-4 py-2 text-sm font-medium text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleLogin}
            disabled={loggingIn}
            className="flex-1 px-4 py-2 text-sm font-medium text-stone-900 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loggingIn ? "Logging in..." : "Login via Google"}
          </button>
        </div>
      </div>
    </div>
  );
}

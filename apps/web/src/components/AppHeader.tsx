"use client";

import Link from "next/link";
import { BrandMark } from "./BrandMark";

interface AppHeaderProps {
  user?: { name: string } | null;
  isAdmin?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
  loggingIn?: boolean;
}

export function AppHeader({ user, isAdmin, onLogin, onLogout, loggingIn }: AppHeaderProps) {
  return (
    <header className="border-b border-stone-200/80 bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <Link href="/" className="min-w-0 flex items-center gap-3 group">
            <BrandMark compact={false} />
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r from-amber-400 to-amber-500 text-stone-900 border border-amber-300/50 shadow-sm">
              Beta
            </span>
          </Link>
          <div className="flex items-center gap-4 shrink-0">
            {user ? (
              <>
                <div className="hidden sm:flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-stone-700 max-w-[180px] truncate">{user.name}</span>
                </div>
                <Link href="/app" className="text-sm font-medium text-stone-700 hover:text-stone-900">
                  Dashboard
                </Link>
                {isAdmin && (
                  <Link href="/admin" className="text-sm font-medium text-stone-700 hover:text-stone-900">
                    Admin
                  </Link>
                )}
                <button
                  onClick={onLogout}
                  className="text-sm text-stone-600 hover:text-stone-900 px-4 py-2 rounded-lg hover:bg-stone-100 transition-all duration-200 font-medium border border-stone-200 hover:border-stone-300"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={onLogin}
                disabled={loggingIn}
                className="text-sm text-stone-900 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 px-4 py-2 rounded-lg transition-all duration-200 font-semibold border border-amber-300 shadow-sm hover:shadow-md disabled:opacity-70 flex items-center gap-2"
              >
                {loggingIn ? "Logging in..." : "Continue with Google"}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

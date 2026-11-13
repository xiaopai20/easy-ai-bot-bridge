"use client";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-stone-900 font-bold shadow-sm">
        EA
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-bold tracking-tight text-stone-900 truncate text-lg">Bot Bridge</span>
          {!compact && (
            <span className="hidden sm:inline text-xs text-stone-500 truncate font-medium">by Easy AI</span>
          )}
        </div>
        {!compact && (
          <div className="text-xs text-stone-500 truncate mt-0.5">Connect Slack and websites to your bots</div>
        )}
      </div>
    </div>
  );
}

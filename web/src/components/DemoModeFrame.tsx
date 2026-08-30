import type { ReactNode } from "react";

export default function DemoModeFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-2xl border-2 border-dashed border-amber-400 dark:border-amber-500/70 p-4 sm:p-6 pt-8">
      <span className="absolute -top-3.5 left-5 px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase bg-amber-400 text-[#1a1a2e] shadow-sm">
        Demo Data
      </span>
      {children}
    </div>
  );
}

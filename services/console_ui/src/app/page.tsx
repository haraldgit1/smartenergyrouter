// app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        Ella – Smart Energy Router Console
      </h1>
      <p className="text-sm text-slate-300">
        Wähle einen Bereich:
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/devices"
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm hover:border-sky-500/70 hover:bg-slate-900 transition-colors"
        >
          Devices &amp; UseCases
        </Link>
        <Link
          href="/flows"
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm hover:border-sky-500/70 hover:bg-slate-900 transition-colors"
        >
          Flows &amp; Timeline
        </Link>
      </div>
    </div>
  );
}


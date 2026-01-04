// src/app/flows/page.tsx
import { getFlows, CONSOLE_API_BASE_URL, type Flow } from "@/lib/api";
import { FlowsLiveList } from "@/components/flow/flows-live-list";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface FlowsPageProps {
  // Next.js 16: searchParams ist ein Promise
  searchParams: Promise<{ device_id?: string; hours?: string }>;
}

export default async function FlowsPage({ searchParams }: FlowsPageProps) {
  const sp = await searchParams; // Promise auflösen (Next.js 16)

  const deviceId = sp?.device_id;
  const hoursParam = sp?.hours;

  // Default-Zeitraum: 168 Stunden (7 Tage),
  // kann per URL-Parameter ?hours=... überschrieben werden.
  const defaultHours = 168;
  const parsedHours = hoursParam ? Number(hoursParam) : NaN;
  const hours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : defaultHours;

  const flows: Flow[] = await getFlows(hours);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Flows</h1>
          <p className="text-sm text-slate-400">
            Correlation-IDs über die Services hinweg, mit Live-Updates.
          </p>

          <p className="mt-1 text-xs text-slate-500">
            Zeitraum: letzte{" "}
            <span className="font-mono text-slate-200">{hours}</span> Stunde(n)
          </p>

          {deviceId && (
            <p className="mt-1 text-xs text-slate-500">
              Gefiltert auf Device:{" "}
              <span className="font-mono text-slate-200">{deviceId}</span>
            </p>
          )}
        </div>

        {/* Actions: Links zur Event-Console + Schnellwahl Zeitfenster */}
        <div className="flex flex-col items-end gap-2 text-xs">
          <Link
            href="/events"
            className="px-3 py-1 rounded bg-slate-900 border border-slate-600 text-slate-100 hover:bg-slate-800 hover:border-slate-400"
          >
            Globale Event-Console
          </Link>

          {deviceId && (
            <Link
              href={`/events?device_id=${encodeURIComponent(
                deviceId
              )}&mode=history`}
              className="px-3 py-1 rounded bg-slate-900 border border-slate-600 text-slate-100 hover:bg-slate-800 hover:border-slate-400"
            >
              Events für <span className="font-mono">{deviceId}</span>
            </Link>
          )}

          {/* Kleine Schnellwahl für typische Zeitfenster */}
          <div className="flex flex-wrap justify-end gap-1 text-[10px] text-slate-400">
            <span className="mr-1">Zeitraum:</span>
            {[24, 72, 168, 720].map((h) => {
              const params = new URLSearchParams();
              params.set("hours", String(h));
              if (deviceId) params.set("device_id", deviceId);
              const href = `/flows?${params.toString()}`;

              const isActive = h === hours;

              return (
                <Link
                  key={h}
                  href={href}
                  className={`px-2 py-0.5 rounded border ${
                    isActive
                      ? "border-slate-300 bg-slate-800 text-slate-100"
                      : "border-slate-700 hover:border-slate-500 hover:bg-slate-900"
                  }`}
                >
                  {h}h
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live-Liste der Flows */}
      <FlowsLiveList
        initialFlows={flows}
        hours={hours}
        deviceId={deviceId}
        apiBaseUrl={CONSOLE_API_BASE_URL}
      />
    </div>
  );
}


// src/app/events/page.tsx
import EventStreamConsole from "@/components/events/event-stream-console";

export const dynamic = "force-dynamic";

interface EventsPageProps {
  // Next.js 16: searchParams ist ein Promise
  searchParams: Promise<{
    device_id?: string;
    flow_id?: string;
    service?: string;
    level?: string;
    mode?: "live" | "history";
  }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const sp = await searchParams; // Promise auflösen

  const initialDeviceId = sp.device_id ?? "";
  const initialFlowId = sp.flow_id ?? "";
  const initialService = sp.service ?? "";
  const initialLevel = sp.level ?? "";
  const initialMode =
    (sp.mode as "live" | "history" | undefined) ?? "live";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Live-Event Stream</h1>
          <p className="text-sm text-slate-400">
            Globale Event-Console – alle Services, alle Flows, alle Devices.
          </p>
        </div>
      </div>

      <EventStreamConsole
        initialDeviceId={initialDeviceId}
        initialFlowId={initialFlowId}
        initialService={initialService}
        initialLevel={initialLevel}
        initialMode={initialMode}
      />
    </div>
  );
}


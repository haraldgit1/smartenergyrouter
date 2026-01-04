// components/events/event-stream-console.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LiveIndicator from "./live-indicator";
import EventFilterBar from "./event-filter-bar";
import EventLine from "./event-line";
import { EventRecord } from "./types";

type Props = {
  initialService?: string;
  initialLevel?: string;
  initialFlowId?: string;
  initialDeviceId?: string;
  initialMode?: "live" | "history";
};

export default function EventStreamConsole({
  initialService = "",
  initialLevel = "",
  initialFlowId = "",
  initialDeviceId = "",
  initialMode = "live",
}: Props) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [isLiveConnection, setIsLiveConnection] = useState(false);

  const [mode, setMode] = useState<"live" | "history">(initialMode);
  const [service, setService] = useState<string>(initialService);
  const [level, setLevel] = useState<string>(initialLevel);
  const [flowId, setFlowId] = useState<string>(initialFlowId);
  const [deviceId, setDeviceId] = useState<string>(initialDeviceId);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const evtSourceRef = useRef<EventSource | null>(null);

  // 1) History initial laden
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (initialService) params.set("service", initialService);
    if (initialLevel) params.set("level", initialLevel);
    if (initialFlowId) params.set("flow_id", initialFlowId);
    if (initialDeviceId) params.set("device_id", initialDeviceId);

    fetch(`/api/events/history?${params.toString()}`)
      .then((r) => r.json())
      .then((data: EventRecord[]) => {
        setEvents(data.reverse());
      })
      .catch(() => {
        // falls noch keine History-API existiert, einfach ignorieren
      });
  }, [initialService, initialLevel, initialFlowId, initialDeviceId]);

  // 2) Live-SSE nur im Live-Mode
  useEffect(() => {
    if (evtSourceRef.current) {
      evtSourceRef.current.close();
      evtSourceRef.current = null;
    }

    if (mode !== "live") {
      setIsLiveConnection(false);
      return;
    }

    const es = new EventSource("/api/events/live");
    evtSourceRef.current = es;
    setIsLiveConnection(true);

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setEvents((prev) => [...prev, payload]);
      } catch (err) {
        console.error("Failed to parse event", err);
      }
    };

    es.onerror = () => {
      setIsLiveConnection(false);
    };

    return () => {
      es.close();
    };
  }, [mode]);

  // 3) Auto-Scroll
  useEffect(() => {
    if (!autoScroll) return;
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, autoScroll]);

  // 4) Filter
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (service && e.service !== service) return false;
      if (level && e.level !== level) return false;
      if (flowId && e.flow_id !== flowId) return false;
      if (deviceId && e.device_id !== deviceId) return false;
      return true;
    });
  }, [events, service, level, flowId, deviceId]);

  // 5) History nachladen, wenn mode="history" oder Filter sich ändern
  useEffect(() => {
    if (mode !== "history") return;

    const params = new URLSearchParams();
    params.set("limit", "200");
    if (service) params.set("service", service);
    if (level) params.set("level", level);
    if (flowId) params.set("flow_id", flowId);
    if (deviceId) params.set("device_id", deviceId);

    fetch(`/api/events/history?${params.toString()}`)
      .then((r) => r.json())
      .then((data: EventRecord[]) => {
        setEvents(data.reverse());
      })
      .catch((err) => console.error("history load error", err));
  }, [mode, service, level, flowId, deviceId]);

  const handleClear = () => setEvents([]);

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `events-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 6) DEMO: ein paar Test-Events per Klick hinzufügen
  const addDemoEvents = () => {
    const baseTs = new Date();
    const mkTs = (offsetSec: number) =>
      new Date(baseTs.getTime() + offsetSec * 1000).toISOString();

    const demo: EventRecord[] = [
      {
        ts: mkTs(0),
        service: "predictor",
        level: "INFO",
        msg: "Forecast generated for meter1:load_kw",
        flow_id: "flow-demo-01",
        device_id: "meter1",
        payload: { horizon_h: 6, q50: 4.2 },
      },
      {
        ts: mkTs(5),
        service: "optimizer",
        level: "WARN",
        msg: "Schedule partly violates max_power_kw. Clamped.",
        flow_id: "flow-demo-01",
        device_id: "boiler1",
        payload: { requested_kw: 5.0, clamped_kw: 3.0 },
      },
      {
        ts: mkTs(10),
        service: "router_agent",
        level: "ERROR",
        msg: "Failed to dispatch schedule to device.",
        flow_id: "flow-demo-01",
        device_id: "boiler1",
        payload: { status_code: 500, reason: "Timeout" },
      },
      {
        ts: mkTs(15),
        service: "device",
        level: "INFO",
        msg: "Device state updated.",
        flow_id: "flow-demo-02",
        device_id: "battery1",
        payload: { soc: 0.73, power_kw: -1.2 },
      },
    ];

    setEvents((prev) => [...prev, ...demo]);
  };

  return (
    <div className="border border-slate-800 rounded-lg p-4 space-y-3 bg-slate-950">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <LiveIndicator live={mode === "live" && isLiveConnection} />
          <EventFilterBar
            service={service}
            setService={setService}
            level={level}
            setLevel={setLevel}
            flowId={flowId}
            setFlowId={setFlowId}
            deviceId={deviceId}
            setDeviceId={setDeviceId}
            mode={mode}
            setMode={setMode}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            onClear={handleClear}
            onExportJson={handleExportJson}
          />
        </div>

        {/* Demo-Leiste */}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">
            Tipp: Wenn noch kein Backend-Stream da ist, klicke auf{" "}
            <span className="text-slate-200 font-semibold">
              „Demo-Events hinzufügen“
            </span>{" "}
            um die UI zu testen.
          </span>
          <button
            type="button"
            className="px-3 py-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
            onClick={addDemoEvents}
          >
            Demo-Events hinzufügen
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[600px] overflow-y-auto bg-black text-green-300 font-mono text-xs p-2 rounded"
      >
        {filtered.map((e, idx) => (
          <EventLine key={e.id ?? `${e.ts}-${idx}`} e={e} />
        ))}
      </div>
    </div>
  );
}


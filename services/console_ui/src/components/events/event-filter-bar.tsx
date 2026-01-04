// components/events/event-filter-bar.tsx
"use client";

type Props = {
  service: string;
  setService: (v: string) => void;
  level: string;
  setLevel: (v: string) => void;
  flowId: string;
  setFlowId: (v: string) => void;
  deviceId: string;
  setDeviceId: (v: string) => void;
  mode: "live" | "history";
  setMode: (m: "live" | "history") => void;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  onClear: () => void;
  onExportJson: () => void;
};

export default function EventFilterBar({
  service,
  setService,
  level,
  setLevel,
  flowId,
  setFlowId,
  deviceId,
  setDeviceId,
  mode,
  setMode,
  autoScroll,
  setAutoScroll,
  onClear,
  onExportJson,
}: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center text-xs">
      {/* Mode Toggle */}
      <div className="inline-flex rounded border border-slate-700 overflow-hidden">
        <button
          type="button"
          className={`px-3 py-1 ${
            mode === "live" ? "bg-slate-800 text-green-300" : "bg-slate-900"
          }`}
          onClick={() => setMode("live")}
        >
          Live
        </button>
        <button
          type="button"
          className={`px-3 py-1 ${
            mode === "history" ? "bg-slate-800 text-slate-100" : "bg-slate-900"
          }`}
          onClick={() => setMode("history")}
        >
          History
        </button>
      </div>

      {/* Service */}
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
        value={service}
        onChange={(e) => setService(e.target.value)}
      >
        <option value="">Service: All</option>
        <option value="predictor">predictor</option>
        <option value="optimizer">optimizer</option>
        <option value="router_agent">router_agent</option>
        <option value="device">device</option>
      </select>

      {/* Level */}
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
        value={level}
        onChange={(e) => setLevel(e.target.value)}
      >
        <option value="">Level: All</option>
        <option value="DEBUG">DEBUG</option>
        <option value="INFO">INFO</option>
        <option value="WARN">WARN</option>
        <option value="ERROR">ERROR</option>
      </select>

      {/* Flow / Device */}
      <input
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
        placeholder="flow_id"
        value={flowId}
        onChange={(e) => setFlowId(e.target.value)}
      />
      <input
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
        placeholder="device_id"
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
      />

      {/* Auto-Scroll */}
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
        />
        <span>Auto-Scroll</span>
      </label>

      {/* Buttons */}
      <button
        type="button"
        className="px-2 py-1 rounded bg-slate-800 border border-slate-700"
        onClick={onClear}
      >
        Clear
      </button>

      <button
        type="button"
        className="px-2 py-1 rounded bg-slate-800 border border-slate-700"
        onClick={onExportJson}
      >
        Export JSON
      </button>
    </div>
  );
}


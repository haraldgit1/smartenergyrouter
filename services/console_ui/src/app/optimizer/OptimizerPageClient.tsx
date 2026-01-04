// src/app/optimizer/OptimizerPageClient.tsx
"use client";

import { useEffect, useState } from "react";
import { startOptimization, getOptimizationJob } from "@/lib/optimizer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Device = {
  device_id: string;
  device_name?: string;
  device_type?: string;
};

type Usecase = {
  usecase_key?: string;
  usecase_name?: string;
  usecase_id?: number | string;
  key?: string;
  usecaseKey?: string;
};

type OptimizerJob = {
  job_id: string;
  status: string;
  plan_id?: string | null;
  result?: any;
};

interface Props {
  devices: Device[];
  usecases: Usecase[];
}

export default function OptimizerPageClient({ devices, usecases }: Props) {
  // --- Helper-Funktionen ---

  function deriveUsecaseKey(u: Usecase): string | undefined {
    return (
      u.usecase_key ??
      u.usecaseKey ??
      u.key ??
      (u.usecase_id !== undefined ? String(u.usecase_id) : undefined)
    );
  }

  function deriveUsecaseLabel(u: Usecase, idx: number): string {
    return (
      u.usecase_name ??
      u.usecase_key ??
      u.usecaseKey ??
      u.key ??
      (u.usecase_id !== undefined ? `UseCase #${u.usecase_id}` : `UseCase ${idx + 1}`)
    );
  }

  // --- Hooks: immer in gleicher Reihenfolge ---

  // Mount-Guard gegen Hydration-Mismatch
  const [mounted, setMounted] = useState(false);

  const [selectedDevice, setSelectedDevice] = useState<string | undefined>(
    devices[0]?.device_id
  );
  const [selectedUsecase, setSelectedUsecase] = useState<string | undefined>(
    undefined
  );
  const [horizon, setHorizon] = useState<number>(24);

  const [job, setJob] = useState<OptimizerJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mount-Effekt (nur Client)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialen UseCase-Wert aus den gelieferten Daten ableiten
  useEffect(() => {
    if (!selectedUsecase && usecases.length > 0) {
      const firstKey = deriveUsecaseKey(usecases[0]);
      if (firstKey) {
        setSelectedUsecase(firstKey);
      }
    }
  }, [usecases, selectedUsecase]);

  // Polling für Job-Status
  useEffect(() => {
    if (!job?.job_id) return;
    if (job.status === "done" || job.status === "failed") {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    const id = setInterval(async () => {
      try {
        const updated = await getOptimizationJob(job.job_id);
        setJob(updated);
      } catch (err) {
        console.error(err);
        setError("Fehler beim Laden des Optimierungs-Status.");
        setIsPolling(false);
      }
    }, 2000);

    return () => clearInterval(id);
  }, [job?.job_id, job?.status]);

  // Wenn noch nicht gemountet: nichts rendern (verhindert Hydration-Warnung)
  if (!mounted) {
    return null;
  }

  // --- Event-Handler ---

  async function handleStart() {
    if (!selectedDevice || !selectedUsecase) {
      setError("Bitte Device und UseCase auswählen.");
      return;
    }
    setError(null);
    setIsStarting(true);
    try {
      const res = await startOptimization({
        device: selectedDevice,
        usecase: selectedUsecase,
        horizon_hours: horizon,
      });
      setJob(res);
    } catch (err) {
      console.error(err);
      setError("Fehler beim Starten der Optimierung.");
    } finally {
      setIsStarting(false);
    }
  }

  const summary = job?.result?.summary;
  const windowSlots: [string, string][] = job?.result?.window ?? [];

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Oben: Filter / Selection */}
      <Card className="bg-slate-900 border border-slate-800 shadow-none">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-300">Device</span>
              <Select
                value={selectedDevice}
                onValueChange={(v) => setSelectedDevice(v)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Device wählen" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d, idx) => (
                    <SelectItem
                      key={`device-${d.device_id}-${idx}`}
                      value={d.device_id}
                    >
                      {d.device_id}
                      {d.device_type ? ` (${d.device_type})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-300">UseCase</span>
              <Select
                value={selectedUsecase}
                onValueChange={(v) => setSelectedUsecase(v)}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="UseCase wählen" />
                </SelectTrigger>
                <SelectContent>
                  {usecases.map((u, idx) => {
                    const key = deriveUsecaseKey(u);
                    if (!key) return null;
                    const label = deriveUsecaseLabel(u, idx);
                    return (
                      <SelectItem
                        key={`usecase-${key}`}
                        value={key}
                      >
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-300">Horizont (Stunden)</span>
              <Input
                type="number"
                className="w-[120px]"
                value={horizon}
                min={1}
                max={168}
                onChange={(e) =>
                  setHorizon(parseInt(e.target.value, 10) || 1)
                }
              />
            </div>

            <div className="flex-1" />
            <Button
              onClick={handleStart}
              disabled={isStarting}
              className="
                rounded-lg border border-slate-800 
                bg-slate-900/60 px-4 py-3 text-sm font-medium
                hover:border-sky-500/70 hover:bg-slate-900 
                transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {isStarting ? "Starte..." : "Optimierung starten"}
            </Button>
          </div>

          {job && (
            <div className="text-xs text-slate-300">
              Job-ID: <span className="font-mono">{job.job_id}</span> | Status:{" "}
              <span className="font-semibold text-slate-100">
                {job.status}
              </span>
              {isPolling &&
              job.status !== "done" &&
              job.status !== "failed"
                ? " (läuft ...)"
                : ""}
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </CardContent>
      </Card>

      {/* Mitte: Fahrplan (erstmal als Liste) */}
      <Card className="bg-slate-900 border border-slate-800 shadow-none">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Optimierter Fahrplan
            </h2>
            <span className="text-xs text-slate-300">
              Zeitfenster & Leistung (Dummy-View, später Charts)
            </span>
          </div>

          {windowSlots.length === 0 ? (
            <p className="text-sm text-slate-300">
              Noch kein Fahrplan berechnet. Bitte Optimierung starten.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {windowSlots.map((slot, idx) => {
                const [start, end] = slot as [string, string];
                return (
                  <li
                    key={`slot-${idx}`}
                    className="flex justify-between border border-slate-800 rounded-lg px-3 py-2"
                  >
                    <span className="font-mono text-xs text-slate-200">
                      {start} → {end}
                    </span>
                    <span className="text-xs text-slate-200">
                      {job?.result?.power_kw} kW
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Unten: KPIs */}
      <Card className="bg-slate-900 border border-slate-800 shadow-none">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-100">KPIs</h2>
            <span className="text-xs text-slate-300">
              Kosten & CO₂ – Optimiert vs. Baseline
            </span>
          </div>

          {!summary ? (
            <p className="text-sm text-slate-300">
              Noch keine Auswertung verfügbar.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              {[
                {
                  id: "opt-cost",
                  label: "Optimierte Kosten",
                  value: `${summary.expected_cost_eur.toFixed(3)} €`,
                },
                {
                  id: "base-cost",
                  label: "Baseline-Kosten",
                  value: `${summary.baseline_cost_eur.toFixed(3)} €`,
                },
                {
                  id: "save-cost",
                  label: "Kosten-Ersparnis",
                  value: `${summary.cost_saved_eur.toFixed(3)} €`,
                  extra: `(${summary.cost_saved_percent.toFixed(1)} %)`,
                },
                {
                  id: "save-co2",
                  label: "CO₂-Ersparnis",
                  value: `${summary.co2_saved_g.toFixed(1)} g`,
                  extra: `(${summary.co2_saved_percent.toFixed(1)} %)`,
                },
              ].map((item) => (
                <div key={item.id} className="space-y-1">
                  <div className="text-slate-300">{item.label}</div>
                  <div className="text-lg font-semibold text-slate-100">
                    {item.value}{" "}
                    {item.extra ? (
                      <span className="text-xs text-emerald-400">
                        {item.extra}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


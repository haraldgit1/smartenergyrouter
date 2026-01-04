// src/components/mdm/mock/device-mdm-mock.tsx
"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

const API_BASE =
  process.env.NEXT_PUBLIC_CONSOLE_API_BASE_URL ?? "http://localhost:8000";

//
// ------------------ TYPEN (API) ------------------
//
type Device = {
  device_id: string;
  name: string;
  type: string;
  location: string | null;
  rated_power_kw: number | null;
  backend_type: string | null;
  backend_ref: string | null;
  mode: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type DevicesPage = {
  items: Device[];
  total: number;
  page: number;
  page_size: number;
};

type SearchState = {
  key: string;       // device_id
  name: string;      // name
  type: string;      // type (boiler, meter, ev_charger, ...)
  mode: string;      // simulation | live
  backend_type: string; // mock, lnd, ...
  location: string;  // Standort
  fulltext: string;  // q
};

const initialSearch: SearchState = {
  key: "",
  name: "",
  type: "",
  mode: "",
  backend_type: "",
  location: "",
  fulltext: "",
};

const PAGE_SIZE = 10;

//
// ------------------ API-Helper ------------------
//

async function fetchDevices(
  search: SearchState,
  page: number
): Promise<DevicesPage> {
  const params = new URLSearchParams();

  if (search.key) params.set("key", search.key);
  if (search.name) params.set("name", search.name);
  if (search.type) params.set("type", search.type);
  if (search.mode) params.set("mode", search.mode);
  if (search.backend_type) params.set("backend_type", search.backend_type);
  if (search.location) params.set("location", search.location);
  if (search.fulltext) params.set("q", search.fulltext);

  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const res = await fetch(`${API_BASE}/mdm/devices?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Laden der Devices (${res.status}): ${text || res.statusText}`
    );
  }

  return (await res.json()) as DevicesPage;
}

async function createDevice(payload: Partial<Device>): Promise<Device> {
  const res = await fetch(`${API_BASE}/mdm/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Anlegen (${res.status}): ${text || res.statusText}`
    );
  }
  return (await res.json()) as Device;
}

async function updateDevice(
  device_id: string,
  payload: Partial<Device>
): Promise<Device> {
  const res = await fetch(`${API_BASE}/mdm/devices/${device_id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Aktualisieren (${res.status}): ${text || res.statusText}`
    );
  }
  return (await res.json()) as Device;
}

async function deleteDevice(device_id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mdm/devices/${device_id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Löschen (${res.status}): ${text || res.statusText}`
    );
  }
}

//
// ------------------ PAGE-KOMPONENTE ------------------
//

export function DeviceMdmMockPage() {
  const [search, setSearch] = useState<SearchState>(initialSearch);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basis");
  const [selected, setSelected] = useState<Device | null>(null);
  const [detailForm, setDetailForm] = useState<Partial<Device>>({});
  const [saving, setSaving] = useState(false);

  // --- LISTE LADEN BEI SUCHE/PAGE ---
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDevices(search, page);
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [search, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;

  function updateSearch<K extends keyof SearchState>(key: K, value: SearchState[K]) {
    setSearch((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function openDetail(device: Device) {
    setSelected(device);
    setDetailForm(device);
    setActiveTab("basis");
    setDetailOpen(true);
  }

  function newDevice() {
    setSelected(null);
    setDetailForm({
      device_id: "",
      name: "",
      type: "boiler",
      location: "",
      rated_power_kw: null,
      backend_type: "mock",
      backend_ref: "",
      mode: "simulation",
      enabled: true,
    });
    setActiveTab("basis");
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  function onDetailChange<K extends keyof Device>(key: K, value: Device[K]) {
    setDetailForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!detailForm.device_id || !detailForm.name || !detailForm.type) {
      setError("Bitte mindestens Device-ID, Name und Typ ausfüllen.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selected) {
        // Update
        await updateDevice(selected.device_id, {
          name: detailForm.name,
          type: detailForm.type,
          location: detailForm.location ?? null,
          rated_power_kw: detailForm.rated_power_kw ?? null,
          backend_type: detailForm.backend_type ?? null,
          backend_ref: detailForm.backend_ref ?? null,
          mode: detailForm.mode ?? "simulation",
          enabled: detailForm.enabled ?? true,
        });
      } else {
        // Create
        await createDevice({
          device_id: detailForm.device_id,
          name: detailForm.name,
          type: detailForm.type,
          location: detailForm.location ?? null,
          rated_power_kw: detailForm.rated_power_kw ?? null,
          backend_type: detailForm.backend_type ?? null,
          backend_ref: detailForm.backend_ref ?? null,
          mode: detailForm.mode ?? "simulation",
          enabled: detailForm.enabled ?? true,
        });
      }
      // Nach Save Liste neu laden
      setDetailOpen(false);
      // kleines Refresh erzwingen
      setPage((p) => p); // trigger useEffect erneut
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDevice(selected.device_id);
      setDetailOpen(false);
      setPage((p) => p); // Refresh
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  //
  // ------------------ UI RENDER ------------------
  //
  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stammdaten – Devices / Assets</h1>
          <p className="text-sm text-slate-400">
            MDM – angebunden an FastAPI / Postgres (devices).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearch(initialSearch);
              setPage(1);
            }}
          >
            Reset Filter
          </Button>
          <Button size="sm" onClick={newDevice}>
            Neuanlage
          </Button>
        </div>
      </div>

      {/* FEHLER-/STATUSZEILE */}
      {(loading || error) && (
        <div className="text-xs text-slate-400">
          {loading && <span>Lade Devices …</span>}
          {error && (
            <span className="text-red-400 ml-2">
              Fehler: {error}
            </span>
          )}
        </div>
      )}

      {/* ------------------ SUCHE ------------------ */}
      <Card className="bg-slate-900/70 border-slate-800">
        <CardContent className="pt-4">
          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2">
            {/* Key */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Key (Device-ID)</Label>
              <Input
                className="h-8 text-xs"
                placeholder="z.B. boiler1"
                value={search.key}
                onChange={(e) => updateSearch("key", e.target.value)}
              />
            </div>

            {/* Name */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Name</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Warmwasser-Boiler"
                value={search.name}
                onChange={(e) => updateSearch("name", e.target.value)}
              />
            </div>

            {/* Type */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Typ</Label>
              <Select
                value={search.type || "__all__"}
                onValueChange={(val) =>
                  updateSearch("type", val === "__all__" ? "" : val)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="(alle)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">(alle)</SelectItem>
                  <SelectItem value="boiler">Boiler</SelectItem>
                  <SelectItem value="battery">Battery</SelectItem>
                  <SelectItem value="ev_charger">EV-Charger</SelectItem>
                  <SelectItem value="meter">Meter</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Mode */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Modus</Label>
              <Select
                value={search.mode || "__all__"}
                onValueChange={(val) =>
                  updateSearch("mode", val === "__all__" ? "" : val)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="(alle)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">(alle)</SelectItem>
                  <SelectItem value="simulation">Simulation</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Backend-Type */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Backend-Typ</Label>
              <Input
                className="h-8 text-xs"
                placeholder="z.B. mock, lnd, mqtt"
                value={search.backend_type}
                onChange={(e) =>
                  updateSearch("backend_type", e.target.value)
                }
              />
            </div>

            {/* Location */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Location</Label>
              <Input
                className="h-8 text-xs"
                placeholder="z.B. Keller, Carport"
                value={search.location}
                onChange={(e) => updateSearch("location", e.target.value)}
              />
            </div>

            {/* Volltext */}
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs text-slate-300">Volltext-Suche</Label>
              <Input
                className="h-8 text-xs"
                placeholder="beliebiger Begriff …"
                value={search.fulltext}
                onChange={(e) => updateSearch("fulltext", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ------------------ LISTE ------------------ */}
      <Card className="bg-slate-950/70 border-slate-900">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400">
              {total === 0
                ? "Keine Treffer"
                : `${startIndex + 1}–${Math.min(
                    startIndex + items.length,
                    total
                  )} von ${total} Treffern`}
            </span>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Seite {currentPage} / {totalPages}</span>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ◀
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  ▶
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="h-72 rounded-md border border-slate-900">
            <table className="w-full text-xs text-slate-200">
              <thead className="sticky top-0 bg-slate-950 border-b border-slate-800">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Device-ID
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Name
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Typ
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Location
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Backend
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Modus
                  </th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      Keine Datensätze gefunden.
                    </td>
                  </tr>
                )}

                {items.map((d) => (
                  <tr
                    key={d.device_id}
                    className="border-b border-slate-900 hover:bg-slate-900/70 cursor-pointer"
                    onClick={() => openDetail(d)}
                  >
                    <td className="px-2 py-1 font-mono text-emerald-300">
                      {d.device_id}
                    </td>
                    <td className="px-2 py-1">{d.name}</td>
                    <td className="px-2 py-1">{d.type}</td>
                    <td className="px-2 py-1">{d.location ?? "-"}</td>
                    <td className="px-2 py-1">
                      {d.backend_type ?? "-"} ({d.backend_ref ?? "-"})
                    </td>
                    <td className="px-2 py-1">
                      {d.mode}
                      {!d.enabled && (
                        <span className="ml-1 text-[10px] text-red-400">
                          (disabled)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ------------------ DETAIL-DIALOG ------------------ */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selected
                ? `Device bearbeiten (${selected.device_id})`
                : "Neues Device anlegen"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-900 border border-slate-800">
                <TabsTrigger value="basis" className="text-xs">
                  Basisdaten
                </TabsTrigger>
                <TabsTrigger value="backend" className="text-xs">
                  Backend
                </TabsTrigger>
                <TabsTrigger value="meta" className="text-xs">
                  Meta
                </TabsTrigger>
              </TabsList>

              {/* BASISDATEN */}
              <TabsContent value="basis" className="pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {/* Device-ID */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Device-ID (Key)
                    </Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={(detailForm.device_id as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("device_id", e.target.value)
                      }
                      disabled={!!selected} // PK bei bestehendem Datensatz nicht änderbar
                    />
                  </div>

                  {/* Name */}
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs text-slate-300">Name</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.name as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("name", e.target.value)
                      }
                    />
                  </div>

                  {/* Typ */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Typ</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="boiler / battery / ev_charger / meter"
                      value={(detailForm.type as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("type", e.target.value)
                      }
                    />
                  </div>

                  {/* Location */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Location</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.location as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("location", e.target.value)
                      }
                    />
                  </div>

                  {/* Power */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Nennleistung (kW)
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      step="0.001"
                      value={
                        detailForm.rated_power_kw !== undefined &&
                        detailForm.rated_power_kw !== null
                          ? String(detailForm.rated_power_kw)
                          : ""
                      }
                      onChange={(e) =>
                        onDetailChange(
                          "rated_power_kw",
                          e.target.value === ""
                            ? null
                            : Number(e.target.value)
                        )
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* BACKEND */}
              <TabsContent value="backend" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Backend-Typ
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="z.B. mock, lnd, mqtt"
                      value={(detailForm.backend_type as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("backend_type", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Backend-Ref
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="z.B. sim:boiler1"
                      value={(detailForm.backend_ref as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("backend_ref", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Modus</Label>
                    <Select
                      value={(detailForm.mode as string) ?? "simulation"}
                      onValueChange={(val) =>
                        onDetailChange("mode", val as Device["mode"])
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simulation">Simulation</SelectItem>
                        <SelectItem value="live">Live</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Enabled</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={!!detailForm.enabled}
                        onChange={(e) =>
                          onDetailChange("enabled", e.target.checked)
                        }
                      />
                      <span className="text-xs text-slate-300">
                        Device ist aktiv für Routing / Steuerung.
                      </span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* META */}
              <TabsContent value="meta" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2 text-xs">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">
                      Created At
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      value={
                        selected?.created_at
                          ? new Date(selected.created_at).toLocaleString()
                          : "-"
                      }
                      disabled
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">
                      Updated At
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      value={
                        selected?.updated_at
                          ? new Date(selected.updated_at).toLocaleString()
                          : "-"
                      }
                      disabled
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="mt-4 flex justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeDetail}
              disabled={saving}
            >
              Zurück zur Auswahl
            </Button>

            <div className="flex gap-2">
              {selected && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  Löschen
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Speichern …" : "Speichern"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// src/components/mdm/usecase-mdm.tsx
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
import { ScrollArea } from "@/components/ui/scroll-area";

const API_BASE =
  process.env.NEXT_PUBLIC_CONSOLE_API_BASE_URL ?? "http://localhost:8000";

type Usecase = {
  usecase_id: number;
  usecase_key: string;
  name: string;
  category: string | null;
  description: string | null;
  default_config: any | null;
  created_at: string;
  updated_at: string;
};

type UsecasePage = {
  items: Usecase[];
  total: number;
  page: number;
  page_size: number;
};

type SearchState = {
  key: string;
  name: string;
  category: string;
  fulltext: string;
};

const initialSearch: SearchState = {
  key: "",
  name: "",
  category: "",
  fulltext: "",
};

const PAGE_SIZE = 10;

async function fetchUsecases(
  search: SearchState,
  page: number
): Promise<UsecasePage> {
  const params = new URLSearchParams();

  if (search.key) params.set("key", search.key);
  if (search.name) params.set("name", search.name);
  if (search.category) params.set("category", search.category);
  if (search.fulltext) params.set("q", search.fulltext);

  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const res = await fetch(`${API_BASE}/mdm/usecases?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Laden der UseCases (${res.status}): ${text || res.statusText}`
    );
  }

  return (await res.json()) as UsecasePage;
}

async function createUsecase(payload: Partial<Usecase>): Promise<Usecase> {
  const res = await fetch(`${API_BASE}/mdm/usecases`, {
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
  return (await res.json()) as Usecase;
}

async function updateUsecase(
  usecase_key: string,
  payload: Partial<Usecase>
): Promise<Usecase> {
  const res = await fetch(`${API_BASE}/mdm/usecases/${usecase_key}`, {
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
  return (await res.json()) as Usecase;
}

async function deleteUsecase(usecase_key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mdm/usecases/${usecase_key}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Fehler beim Löschen (${res.status}): ${text || res.statusText}`
    );
  }
}

export function UsecaseMdmPage() {
  const [search, setSearch] = useState<SearchState>(initialSearch);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Usecase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basis");
  const [selected, setSelected] = useState<Usecase | null>(null);
  const [detailForm, setDetailForm] = useState<Partial<Usecase>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUsecases(search, page);
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

  function openDetail(uc: Usecase) {
    setSelected(uc);
    setDetailForm(uc);
    setActiveTab("basis");
    setDetailOpen(true);
  }

  function newUsecase() {
    setSelected(null);
    setDetailForm({
      usecase_key: "",
      name: "",
      category: "",
      description: "",
      default_config: null,
    });
    setActiveTab("basis");
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  function onDetailChange<K extends keyof Usecase>(key: K, value: Usecase[K]) {
    setDetailForm((prev) => ({ ...prev, [key]: value }));
  }

  function defaultConfigText(): string {
    if (detailForm.default_config == null) return "";
    try {
      return JSON.stringify(detailForm.default_config, null, 2);
    } catch {
      return "";
    }
  }

  function setDefaultConfigFromText(text: string) {
    if (!text.trim()) {
      setDetailForm((prev) => ({ ...prev, default_config: null }));
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setDetailForm((prev) => ({ ...prev, default_config: parsed }));
      setError(null);
    } catch (e: any) {
      setError("default_config ist kein gültiges JSON.");
    }
  }

  async function handleSave() {
    if (!detailForm.usecase_key || !detailForm.name) {
      setError("Bitte mindestens Key und Name ausfüllen.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selected) {
        await updateUsecase(selected.usecase_key, {
          name: detailForm.name,
          category: detailForm.category ?? null,
          description: detailForm.description ?? null,
          default_config:
            detailForm.default_config === undefined
              ? null
              : detailForm.default_config,
        });
      } else {
        await createUsecase({
          usecase_key: detailForm.usecase_key,
          name: detailForm.name,
          category: detailForm.category ?? null,
          description: detailForm.description ?? null,
          default_config:
            detailForm.default_config === undefined
              ? null
              : detailForm.default_config,
        });
      }
      setDetailOpen(false);
      setPage((p) => p); // Reload triggern
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
      await deleteUsecase(selected.usecase_key);
      setDetailOpen(false);
      setPage((p) => p);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stammdaten – UseCases</h1>
          <p className="text-sm text-slate-400">
            MDM für Optimierungs-UseCases (Key, Name, Kategorie, Beschreibung, Default-Config).
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
          <Button size="sm" onClick={newUsecase}>
            Neuanlage
          </Button>
        </div>
      </div>

      {(loading || error) && (
        <div className="text-xs text-slate-400">
          {loading && <span>Lade UseCases …</span>}
          {error && <span className="text-red-400 ml-2">Fehler: {error}</span>}
        </div>
      )}

      {/* SUCHE */}
      <Card className="bg-slate-900/70 border-slate-800">
        <CardContent className="pt-4">
          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Key</Label>
              <Input
                className="h-8 text-xs"
                placeholder="price_follow_boiler"
                value={search.key}
                onChange={(e) => updateSearch("key", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Name</Label>
              <Input
                className="h-8 text-xs"
                value={search.name}
                onChange={(e) => updateSearch("name", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Kategorie</Label>
              <Input
                className="h-8 text-xs"
                placeholder="price_following / flex_load / ..."
                value={search.category}
                onChange={(e) => updateSearch("category", e.target.value)}
              />
            </div>
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

      {/* LISTE */}
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
              <span>
                Seite {currentPage} / {totalPages}
              </span>
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
                    Key
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Name
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Kategorie
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      Keine Datensätze gefunden.
                    </td>
                  </tr>
                )}
                {items.map((uc) => (
                  <tr
                    key={uc.usecase_id}
                    className="border-b border-slate-900 hover:bg-slate-900/70 cursor-pointer"
                    onClick={() => openDetail(uc)}
                  >
                    <td className="px-2 py-1 font-mono text-emerald-300">
                      {uc.usecase_key}
                    </td>
                    <td className="px-2 py-1">{uc.name}</td>
                    <td className="px-2 py-1">{uc.category ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* DETAIL-DIALOG */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selected
                ? `UseCase bearbeiten (${selected.usecase_key})`
                : "Neuen UseCase anlegen"}
          </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-900 border border-slate-800">
                <TabsTrigger value="basis" className="text-xs">
                  Basisdaten
                </TabsTrigger>
                <TabsTrigger value="beschreibung" className="text-xs">
                  Beschreibung / Config
                </TabsTrigger>
                <TabsTrigger value="meta" className="text-xs">
                  Meta
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basis" className="pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      UseCase-Key
                    </Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={(detailForm.usecase_key as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("usecase_key", e.target.value)
                      }
                      disabled={!!selected}
                    />
                  </div>
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
                  <div className="space-y-1 md:col-span-3">
                    <Label className="text-xs text-slate-300">Kategorie</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.category as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("category", e.target.value)
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="beschreibung" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Beschreibung / Business-Logik
                    </Label>
                    <textarea
                      className="w-full rounded-md border border-slate-700 bg-slate-900 text-xs text-slate-100 px-2 py-1"
                      rows={8}
                      value={(detailForm.description as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("description", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Default Config (JSON)
                    </Label>
                    <textarea
                      className="w-full rounded-md border border-slate-700 bg-slate-900 text-xs text-slate-100 px-2 py-1 font-mono"
                      rows={8}
                      value={defaultConfigText()}
                      onChange={(e) => setDefaultConfigFromText(e.target.value)}
                    />
                    <p className="text-[10px] text-slate-500">
                      Beispiel: {'{ "max_temp_c": 60, "min_temp_c": 50 }'}
                    </p>
                  </div>
                </div>
              </TabsContent>

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


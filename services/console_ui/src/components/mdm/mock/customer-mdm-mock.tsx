// src/components/mdm/mock/customer-mdm-mock.tsx
"use client";

import { useMemo, useState } from "react";

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

//
// ------------------ TYPEN ------------------
//
type Customer = {
  id: number;
  kundenNr: string;
  typ: "KUNDE" | "INTERESSENT" | "LIEFERANT" | "PARTNER";
  anrede: "HERR" | "FRAU" | "FIRMA";
  vorname: string;
  nachname: string;
  firma?: string | null;

  strasse: string;
  plz: string;
  ort: string;
  land: string;

  telefon?: string | null;
  email?: string | null;

  bemerkung?: string | null;
};

//
// ------------------ MOCK-DATEN ------------------
//
const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 1,
    kundenNr: "K0001",
    typ: "KUNDE",
    anrede: "HERR",
    vorname: "Max",
    nachname: "Mustermann",
    firma: null,
    strasse: "Hauptstraße 1",
    plz: "8010",
    ort: "Graz",
    land: "AT",
    telefon: "+43 316 123456",
    email: "max.mustermann@example.com",
    bemerkung: "PV-Anlage, Smart Energy Router Pilotkunde",
  },
  {
    id: 2,
    kundenNr: "K0002",
    typ: "KUNDE",
    anrede: "FRAU",
    vorname: "Anna",
    nachname: "Huber",
    firma: null,
    strasse: "Nebenweg 7",
    plz: "8020",
    ort: "Graz",
    land: "AT",
    telefon: "+43 316 987654",
    email: "anna.huber@example.com",
    bemerkung: null,
  },
  {
    id: 3,
    kundenNr: "L0001",
    typ: "LIEFERANT",
    anrede: "FIRMA",
    vorname: "",
    nachname: "",
    firma: "Sailer Engineering GmbH",
    strasse: "Technikgasse 12",
    plz: "8010",
    ort: "Graz",
    land: "AT",
    telefon: "+43 316 555555",
    email: "office@sailer-engineering.at",
    bemerkung: "Lieferant für Smart Energy Router",
  },
  {
    id: 4,
    kundenNr: "I0001",
    typ: "INTERESSENT",
    anrede: "HERR",
    vorname: "Peter",
    nachname: "Schmidt",
    firma: "Schmidt Bau GmbH",
    strasse: "Baustraße 5",
    plz: "8041",
    ort: "Graz",
    land: "AT",
    telefon: null,
    email: "p.schmidt@example.com",
    bemerkung: "Interessent für Energiegemeinschaft",
  },
];

//
// ------------------ SEARCH-ZUSTAND ------------------
//
type SearchState = {
  key: string;
  name: string;
  type: string;
  lookup1: string; // Anrede
  lookup2: string; // PLZ
  lookup3: string; // Ort
  fulltext: string;
};

const initialSearch: SearchState = {
  key: "",
  name: "",
  type: "",
  lookup1: "",
  lookup2: "",
  lookup3: "",
  fulltext: "",
};

const PAGE_SIZE = 5;

//
// ------------------ PAGE-KOMPONENTE ------------------
//
export function CustomerMdmMockPage() {
  const [search, setSearch] = useState<SearchState>(initialSearch);
  const [page, setPage] = useState(1);

  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basis");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailForm, setDetailForm] = useState<Partial<Customer>>({});

  //
  // --- FILTER (nur Mock, normal wäre das ein API-Aufruf) ---
  //
  const filtered = useMemo(() => {
    return MOCK_CUSTOMERS.filter((c) => {
      if (search.key && !c.kundenNr.toLowerCase().includes(search.key.toLowerCase()))
        return false;

      if (search.name) {
        const nameHaystack = (
          `${c.vorname} ${c.nachname} ${c.firma ?? ""}`
        ).toLowerCase();
        if (!nameHaystack.includes(search.name.toLowerCase())) return false;
      }

      if (search.type && c.typ !== search.type)
        return false;

      if (search.lookup1 && c.anrede !== search.lookup1)
        return false;

      if (search.lookup2 && c.plz !== search.lookup2)
        return false;

      if (search.lookup3 && c.ort.toLowerCase() !== search.lookup3.toLowerCase())
        return false;

      if (search.fulltext) {
        const ft = search.fulltext.toLowerCase();
        const haystack = (
          `${c.kundenNr} ${c.vorname} ${c.nachname} ${c.firma ?? ""} ${c.strasse} ${c.plz} ${c.ort} ${c.land} ${c.telefon ?? ""} ${c.email ?? ""} ${c.bemerkung ?? ""}`
        ).toLowerCase();
        if (!haystack.includes(ft)) return false;
      }

      return true;
    });
  }, [search]);

  //
  // --- PAGING ---
  //
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  function updateSearch<K extends keyof SearchState>(key: K, value: SearchState[K]) {
    setSearch((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  //
  // --- DETAIL-UI ---
  //
  function openDetail(customer: Customer) {
    setSelected(customer);
    setDetailForm(customer);
    setActiveTab("basis");
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  function onDetailChange<K extends keyof Customer>(key: K, value: Customer[K]) {
    setDetailForm((prev) => ({ ...prev, [key]: value }));
  }

  //
  // ------------------ UI RENDER ------------------
  //
  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Stammdaten – Kunden / Adressen</h1>
          <p className="text-sm text-slate-400">
            MDM-UI-Shell (Mockup): Suchmaske, Liste, Detail (Tabs)
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
          <Button
            size="sm"
            onClick={() => {
              setSelected(null);
              setDetailForm({});
              setActiveTab("basis");
              setDetailOpen(true);
            }}
          >
            Neuanlage
          </Button>
        </div>
      </div>

      {/* ------------------ SUCHE ------------------ */}
      <Card className="bg-slate-900/70 border-slate-800">
        <CardContent className="pt-4">
          <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2">

            {/* Key */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Key (Kunden-Nr.)</Label>
              <Input
                className="h-8 text-xs"
                placeholder="z.B. K0001"
                value={search.key}
                onChange={(e) => updateSearch("key", e.target.value)}
              />
            </div>

            {/* Name */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Name / Firma</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Mustermann"
                value={search.name}
                onChange={(e) => updateSearch("name", e.target.value)}
              />
            </div>

            {/* Typ */}
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
                  <SelectItem value="KUNDE">Kunde</SelectItem>
                  <SelectItem value="INTERESSENT">Interessent</SelectItem>
                  <SelectItem value="LIEFERANT">Lieferant</SelectItem>
                  <SelectItem value="PARTNER">Geschäftspartner</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Anrede */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Anrede</Label>
              <Select
                value={search.lookup1 || "__all__"}
                onValueChange={(val) =>
                  updateSearch("lookup1", val === "__all__" ? "" : val)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="(alle)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">(alle)</SelectItem>
                  <SelectItem value="HERR">Herr</SelectItem>
                  <SelectItem value="FRAU">Frau</SelectItem>
                  <SelectItem value="FIRMA">Firma</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* PLZ */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">PLZ</Label>
              <Input
                className="h-8 text-xs"
                placeholder="8010"
                value={search.lookup2}
                onChange={(e) => updateSearch("lookup2", e.target.value)}
              />
            </div>

            {/* Ort */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Ort</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Graz"
                value={search.lookup3}
                onChange={(e) => updateSearch("lookup3", e.target.value)}
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
                : `${startIndex + 1}–${startIndex + pageItems.length} von ${total} Treffern`}
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
                    Kunden-Nr
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Name / Firma
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Typ
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Ort
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    Telefon
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-slate-400">
                    E-Mail
                  </th>
                </tr>
              </thead>

              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      Keine Datensätze gefunden.
                    </td>
                  </tr>
                )}

                {pageItems.map((c) => {
                  // Anzeige-Name / Firma
                  const name =
                    c.firma && c.firma.trim().length > 0
                      ? c.firma
                      : `${c.anrede === "FIRMA" ? "" : c.anrede + " "}${c.vorname ? c.vorname + " " : ""}${c.nachname}`.trim();

                  return (
                    <tr
                      key={c.id}
                      className="border-b border-slate-900 hover:bg-slate-900/70 cursor-pointer"
                      onClick={() => openDetail(c)}
                    >
                      <td className="px-2 py-1 font-mono text-emerald-300">
                        {c.kundenNr}
                      </td>
                      <td className="px-2 py-1">{name}</td>
                      <td className="px-2 py-1">{c.typ}</td>
                      <td className="px-2 py-1">{c.plz} {c.ort}</td>
                      <td className="px-2 py-1">{c.telefon ?? "-"}</td>
                      <td className="px-2 py-1">{c.email ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ------------------ DETAIL DIALOG ------------------ */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selected
                ? `Kunde bearbeiten (${selected.kundenNr})`
                : "Neuen Kunden anlegen"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-900 border border-slate-800">
                <TabsTrigger value="basis" className="text-xs">
                  Basisdaten
                </TabsTrigger>
                <TabsTrigger value="adresse" className="text-xs">
                  Adresse
                </TabsTrigger>
                <TabsTrigger value="kontakt" className="text-xs">
                  Kommunikation
                </TabsTrigger>
                <TabsTrigger value="sonstiges" className="text-xs">
                  Sonstiges
                </TabsTrigger>
              </TabsList>

              {/* ----- TAB: BASISDATEN ----- */}
              <TabsContent value="basis" className="pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {/* Key */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">
                      Kunden-Nr (Key)
                    </Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={
                        (detailForm.kundenNr as string) ??
                        (selected ? selected.kundenNr : "(wird vergeben)")
                      }
                      disabled
                    />
                  </div>

                  {/* Typ */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Typ</Label>
                    <Select
                      value={(detailForm.typ as string) || "__all__"}
                      onValueChange={(val) =>
                        onDetailChange("typ", val as Customer["typ"])
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KUNDE">Kunde</SelectItem>
                        <SelectItem value="INTERESSENT">Interessent</SelectItem>
                        <SelectItem value="LIEFERANT">Lieferant</SelectItem>
                        <SelectItem value="PARTNER">Geschäftspartner</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Anrede */}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Anrede</Label>
                    <Select
                      value={(detailForm.anrede as string) || "__all__"}
                      onValueChange={(val) =>
                        onDetailChange("anrede", val as Customer["anrede"])
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HERR">Herr</SelectItem>
                        <SelectItem value="FRAU">Frau</SelectItem>
                        <SelectItem value="FIRMA">Firma</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Vorname */}
                  <div className="space-y-1 md:col-span-1">
                    <Label className="text-xs text-slate-300">Vorname</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.vorname as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("vorname", e.target.value)
                      }
                    />
                  </div>

                  {/* Nachname */}
                  <div className="space-y-1 md:col-span-1">
                    <Label className="text-xs text-slate-300">Nachname</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.nachname as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("nachname", e.target.value)
                      }
                    />
                  </div>

                  {/* Firma */}
                  <div className="space-y-1 md:col-span-1">
                    <Label className="text-xs text-slate-300">Firma</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.firma as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("firma", e.target.value)
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* ----- TAB: ADRESSE ----- */}
              <TabsContent value="adresse" className="pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs text-slate-300">Straße</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.strasse as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("strasse", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">PLZ</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.plz as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("plz", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Ort</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.ort as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("ort", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Land</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.land as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("land", e.target.value)
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* ----- TAB: KONTAKT ----- */}
              <TabsContent value="kontakt" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">Telefon</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.telefon as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("telefon", e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-300">E-Mail</Label>
                    <Input
                      className="h-8 text-xs"
                      value={(detailForm.email as string) ?? ""}
                      onChange={(e) =>
                        onDetailChange("email", e.target.value)
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* ----- TAB: SONSTIGES ----- */}
              <TabsContent value="sonstiges" className="pt-4">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-300">
                    Bemerkung
                  </Label>

                  <textarea
                    className="w-full rounded-md border border-slate-700 bg-slate-900 text-xs text-slate-100 px-2 py-1"
                    rows={4}
                    value={(detailForm.bemerkung as string) ?? ""}
                    onChange={(e) =>
                      onDetailChange("bemerkung", e.target.value)
                    }
                  />
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
            >
              Zurück zur Auswahl
            </Button>

            <div className="flex gap-2">
              {selected && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    console.log("Delete (mock)", selected);
                    closeDetail();
                  }}
                >
                  Löschen
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                onClick={() => {
                  console.log("Save (mock)", detailForm);
                  closeDetail();
                }}
              >
                Speichern
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


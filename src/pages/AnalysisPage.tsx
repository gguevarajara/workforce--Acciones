import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import type { Row } from "../lib/types/analysis";
import { parseSheetRows, validateExcelStructure } from "../lib/parsers";
import { useAnalysisData } from "../context/AnalysisDataContext";

type UploadState = "idle" | "dragging" | "processing" | "done" | "error";

interface HistoryEntry {
  name: string;
  size: string;
  date: string;
  status: "ok" | "warn";
  timestamp: number;
  reason?: string; // motivo cuando status es "warn" (ej. columnas faltantes)
}

const columns: { key: keyof Row; label: string; align: "left" | "right"; sortable?: boolean }[] = [
  { key: "fecha",               label: "Fecha",                              align: "left",  sortable: true  },
  { key: "dia",                 label: "Día",                                align: "left",  sortable: true  },
  { key: "servicio",            label: "Servicio",                           align: "left",  sortable: true  },
  { key: "subarea",             label: "Subárea",                            align: "left",  sortable: true  },
  { key: "hora",                label: "Hora",                               align: "left",  sortable: true  },
  { key: "pronRecibidas",       label: "Pron. Recibidas",                    align: "right" },
  { key: "llamadasObj",         label: "Llamadas Obj a Atender",             align: "right" },
  { key: "pronTMO",             label: "Pron TMO",                           align: "right" },
  { key: "dispRequerido",       label: "Disponible (Requerido)",             align: "right", sortable: true  },
  { key: "dispOficiales",       label: "Disponible (Oficiales)",             align: "right", sortable: true  },
  { key: "dispOficialesHhee",   label: "Disponible (Oficiales + Hhee)",      align: "right", sortable: true  },
  { key: "dispOficialesHheeOjt",label: "Disponible (Oficiales + Hhee + Ojt)",align: "right", sortable: true  },
  { key: "difOficiales",        label: "Diferencia (Oficiales)",             align: "right", sortable: true  },
  { key: "difOficialesHhee",    label: "Diferencia (Oficiales + Hhee)",      align: "right", sortable: true  },
  { key: "difOficialesHheeOjt", label: "Diferencia (Oficiales + Hhee + Ojt)",align: "right", sortable: true  },
];

// --- Filtro por columna (estilo Excel) ---
type NumericOp = "none" | "gt" | "gte" | "lt" | "lte" | "eq";

const NUMERIC_OP_OPTIONS: { value: NumericOp; label: string }[] = [
  { value: "none", label: "Sin filtro numérico" },
  { value: "gt",   label: "Mayor que (>)"        },
  { value: "gte",  label: "Mayor o igual (≥)"    },
  { value: "lt",   label: "Menor que (<)"        },
  { value: "lte",  label: "Menor o igual (≤)"    },
  { value: "eq",   label: "Igual a (=)"          },
];

interface ColumnFilterState {
  // "all": sin restricción — se muestran y se marcan TODOS los valores (estado por defecto,
  // y también el estado al que se vuelve cuando "Seleccionar todo" termina cubriendo el 100%
  // de los valores disponibles de la columna).
  // "custom": solo se consideran los valores presentes en `selected`. Puede estar vacío
  // (ej. justo después de "Limpiar filtro"), en cuyo caso NINGÚN valor queda marcado y
  // ninguna fila de esa columna pasa el filtro hasta que el usuario marque algo.
  mode: "all" | "custom";
  selected: Set<string>; // solo relevante cuando mode === "custom"
  numOp: NumericOp;
  numValue: string;
}

const emptyColumnFilter = (): ColumnFilterState => ({ mode: "all", selected: new Set(), numOp: "none", numValue: "" });

const isColumnFilterActive = (f: ColumnFilterState | undefined): boolean =>
  !!f && (f.mode === "custom" || (f.numOp !== "none" && f.numValue.trim() !== ""));

function diffColor(val: number) {
  if (val > 0)  return "#10b981";
  if (val < 0)  return "#ef4444";
  return "#64748b";
}

function fmt(val: number, isDiff?: boolean) {
  const rounded = parseFloat(val.toFixed(2));
  const str = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
  return isDiff && rounded > 0 ? `+${str}` : str;
}

const HISTORY_STORAGE_KEY = "workforce_upload_history";

// Funciones para gestionar el historial en localStorage
const getHistory = (): HistoryEntry[] => {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveToHistory = (entry: HistoryEntry) => {
  const history = getHistory();
  // Evitar duplicados por nombre
  const filtered = history.filter(h => h.name !== entry.name);
  // Agregar nuevo al inicio y limitar a 10 entradas
  const updated = [entry, ...filtered].slice(0, 10);
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
};

export default function AnalysisPage() {
  const { rows, uploadedName, setData, clear, isHydrated, persistError } = useAnalysisData();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [tab, setTab] = useState<"upload" | "history">("upload");
  const [sortCol, setSortCol] = useState<keyof Row>("fecha");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterServicio, setFilterServicio] = useState("Todos");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<keyof Row, ColumnFilterState>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<keyof Row | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [historyFiles, setHistoryFiles] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cargar historial al montar el componente
  useEffect(() => {
    setHistoryFiles(getHistory());
  }, []);

  const handleFile = (file: File) => {
    // Validar tamaño de archivo (50MB = 50 * 1024 * 1024 bytes)
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert("El archivo excede el tamaño máximo de 50MB. Por favor, utiliza un archivo más pequeño.");
      return;
    }

    setUploadState("processing");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

        // Validar estructura de columnas
        const headers = raw[0] || [];
        const validation = validateExcelStructure(headers);

        if (!validation.valid) {
          console.error("Columnas faltantes:", validation.missingColumns);
          alert(`El archivo no tiene las columnas necesarias para el análisis. Faltan: ${validation.missingColumns.join(", ")}`);
          setUploadState("error");
          saveToHistory({
            name: file.name,
            size: formatFileSize(file.size),
            date: formatDate(Date.now()),
            status: "warn",
            timestamp: Date.now(),
            reason: `Faltan columnas: ${validation.missingColumns.join(", ")}`,
          });
          setHistoryFiles(getHistory());
          return;
        }

        const parsed = parseSheetRows(raw as unknown[][]);

        if (parsed.length === 0) {
          alert("No se pudieron procesar los datos del archivo. Verifica el formato.");
          setUploadState("error");
          saveToHistory({
            name: file.name,
            size: formatFileSize(file.size),
            date: formatDate(Date.now()),
            status: "warn",
            timestamp: Date.now(),
            reason: "No se pudo procesar ninguna fila del archivo",
          });
          setHistoryFiles(getHistory());
          return;
        }

        setData(parsed, file.name);
        setFilterServicio("Todos");
        setColumnFilters({});
        setSortCol("fecha");
        setSortDir("asc");
        setUploadState("done");

        // Guardar en historial
        const historyEntry: HistoryEntry = {
          name: file.name,
          size: formatFileSize(file.size),
          date: formatDate(Date.now()),
          status: "ok",
          timestamp: Date.now(),
        };
        saveToHistory(historyEntry);
        setHistoryFiles(getHistory());
      } catch (error) {
        console.error("Error al procesar el archivo:", error);
        setUploadState("error");
        saveToHistory({
          name: file.name,
          size: formatFileSize(file.size),
          date: formatDate(Date.now()),
          status: "warn",
          timestamp: Date.now(),
          reason: "Error al leer el archivo (formato no reconocido o dañado)",
        });
        setHistoryFiles(getHistory());
      }
    };
    reader.readAsArrayBuffer(file);
  };


  // Sincronizar uploadState con el estado de datos persistente
  useEffect(() => {
    if (isHydrated && rows.length > 0 && uploadState !== "done") {
      setUploadState("done");
    }
  }, [isHydrated, rows.length, uploadState]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setUploadState("idle");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const toggleSort = (key: keyof Row) => {
    if (sortCol === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
  };

  const servicios = ["Todos", ...Array.from(new Set(rows.map(r => r.servicio)))];

  const isDiff = (key: keyof Row) => key.startsWith("dif");
  const isNumeric = (key: keyof Row) => !["fecha","dia","servicio","subarea","hora"].includes(key);

  // Valor formateado tal cual se ve en la tabla (para que el listado de
  // selección de valores y el filtro coincidan con lo que el usuario ve).
  const displayValue = (row: Row, key: keyof Row): string => {
    const val = row[key];
    return isNumeric(key) ? fmt(val as number, isDiff(key)) : String(val);
  };

  // Evalúa si una fila cumple el filtro de UNA columna. `excludeKey` permite
  // calcular las opciones disponibles de una columna sin aplicar su propio
  // filtro (igual que hace Excel: la lista de valores de una columna se
  // arma con las demás columnas ya filtradas).
  const rowMatchesColumnFilters = (row: Row, excludeKey?: keyof Row): boolean => {
    for (const col of columns) {
      if (col.key === excludeKey) continue;
      const filter = columnFilters[col.key];
      if (!filter) continue;

      if (isNumeric(col.key) && filter.numOp !== "none" && filter.numValue.trim() !== "") {
        const num = Number(row[col.key]);
        const target = Number(filter.numValue);
        if (!Number.isNaN(target)) {
          if (filter.numOp === "gt"  && !(num > target))  return false;
          if (filter.numOp === "gte" && !(num >= target)) return false;
          if (filter.numOp === "lt"  && !(num < target))  return false;
          if (filter.numOp === "lte" && !(num <= target)) return false;
          if (filter.numOp === "eq"  && !(num === target)) return false;
        }
      }

      if (filter.mode === "custom" && !filter.selected.has(displayValue(row, col.key))) {
        return false;
      }
    }
    return true;
  };

  // Valores únicos disponibles para el desplegable de una columna, ya
  // acotados por el filtro "Servicio" y por el resto de columnas filtradas.
  const optionsForColumn = (key: keyof Row): string[] => {
    const base = rows.filter(r => filterServicio === "Todos" || r.servicio === filterServicio);
    const values = base
      .filter(r => rowMatchesColumnFilters(r, key))
      .map(r => displayValue(r, key));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  };

  const activeFilterCount = Object.values(columnFilters).filter(isColumnFilterActive).length;

  const clearAllColumnFilters = () => { setColumnFilters({}); setOpenFilterCol(null); };

  const updateColumnFilter = (key: keyof Row, patch: Partial<ColumnFilterState>) => {
    setColumnFilters(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyColumnFilter()), ...patch },
    }));
  };

  // "Limpiar filtro": deja la columna en modo "custom" con selección VACÍA,
  // es decir, ningún valor queda marcado (y, en consecuencia, ninguna fila
  // pasa el filtro de esa columna hasta que el usuario vuelva a marcar algo).
  // También se reinicia el filtro numérico, si la columna tenía uno.
  const clearColumnFilter = (key: keyof Row) => {
    setColumnFilters(prev => ({
      ...prev,
      [key]: { mode: "custom", selected: new Set<string>(), numOp: "none", numValue: "" },
    }));
  };

  const toggleFilterValue = (key: keyof Row, value: string, allOptions: string[]) => {
    const current = columnFilters[key] ?? emptyColumnFilter();
    let nextSelected: Set<string>;
    if (current.mode === "all") {
      // Al desmarcar el primer valor estando en modo "todos seleccionados",
      // se vuelve explícito: todos los valores disponibles de la columna,
      // menos el que se acaba de desmarcar.
      nextSelected = new Set(allOptions);
      nextSelected.delete(value);
    } else {
      nextSelected = new Set(current.selected);
      if (nextSelected.has(value)) nextSelected.delete(value);
      else nextSelected.add(value);
    }
    // Si terminó incluyendo absolutamente todos los valores disponibles,
    // se vuelve al modo "all" (equivalente, pero deja el estado más simple
    // y coherente con el badge de "filtro activo").
    if (allOptions.length > 0 && allOptions.every(v => nextSelected.has(v))) {
      updateColumnFilter(key, { mode: "all", selected: new Set() });
      return;
    }
    updateColumnFilter(key, { mode: "custom", selected: nextSelected });
  };

  const openFilterPopover = (key: keyof Row, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const POPOVER_WIDTH = 260;
    setPopoverPos({
      top: rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12),
    });
    setFilterSearch("");
    setOpenFilterCol(prev => (prev === key ? null : key));
  };

  const exportFilteredToExcel = () => {
    try {
      if (displayed.length === 0) {
        alert("No hay filas visibles para exportar con los filtros actuales.");
        return;
      }

      const exportRows = displayed.map(row => {
        const out: Record<string, string | number> = {};
        for (const col of columns) {
          const value = row[col.key];
          out[col.label] = isNumeric(col.key)
            ? Number(value)
            : String(value ?? "");
        }
        return out;
      });

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet['!cols'] = columns.map(col => ({
        wch: Math.min(Math.max(col.label.length + 2, 12), 32),
      }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Análisis filtrado");

      const safeName = (uploadedName || "analisis")
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 60) || "analisis";
      const fileName = `${safeName}_filtrado.xlsx`;

      // writeFile usa el mecanismo de descarga del navegador.
      XLSX.writeFile(workbook, fileName, { bookType: "xlsx" });
    } catch (error) {
      console.error("Error al exportar análisis filtrado:", error);
      alert("No se pudo generar el Excel. Verifica que el navegador permita descargas desde esta aplicación.");
    }
  };

  const displayed = [...rows]
    .filter(r => filterServicio === "Todos" || r.servicio === filterServicio)
    .filter(r => rowMatchesColumnFilters(r))
    .sort((a, b) => {
      // La columna "Fecha" se muestra como texto dd/mm/yyyy, pero ese
      // formato no ordena cronológicamente al comparar como texto (ej.
      // "01/09/2026" queda antes que "31/08/2026" porque "0" < "3").
      // Para esta columna se compara por fechaSort (ISO yyyy-mm-dd), que
      // sí ordena correctamente sin importar el locale.
      if (sortCol === "fecha") {
        const cmp = a.fechaSort.localeCompare(b.fechaSort);
        return sortDir === "asc" ? cmp : -cmp;
      }

      const av = a[sortCol];
      const bv = b[sortCol];
      const cmp = typeof av === "number" ? (av as number) - (bv as number) : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

  return (
    <div className="p-8 min-h-full">
      <div className="mb-8">
        <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "#2563eb" }}>Módulo</p>
        <h1 className="text-2xl font-semibold" style={{ color: "#f0f4ff" }}>Análisis</h1>
        <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>Carga y procesa archivos de datos planificados</p>
      </div>

      {/* Tabs */}
      <div className="flex mb-6 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        {[
          { id: "upload" as const, label: "Cargar archivo" },
          { id: "history" as const, label: "Historial de cargas" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px"
            style={{
              color: tab === t.id ? "#3b82f6" : "#475569",
              borderColor: tab === t.id ? "#2563eb" : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "upload" && (
        <div>
          {/* Drop zone - Solo mostrar si no hay datos o si no está hidratado aún */}
          {(!isHydrated || rows.length === 0) && uploadState !== "done" && (
            <div className="max-w-2xl mb-6">
              <div
                className="rounded-lg border-2 border-dashed p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200"
                style={{
                  borderColor: uploadState === "dragging" ? "#2563eb" : "rgba(255,255,255,0.1)",
                  background: uploadState === "dragging" ? "rgba(37,99,235,0.06)" : "#0d1526",
                }}
                onDragOver={e => { e.preventDefault(); setUploadState("dragging"); }}
                onDragLeave={() => setUploadState("idle")}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleInput} />

                {(uploadState === "idle" || uploadState === "dragging") && (
                  <>
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(37,99,235,0.12)" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium mb-1" style={{ color: "#cbd5e1" }}>
                      Arrastra tu archivo aquí o <span style={{ color: "#3b82f6" }}>selecciona uno</span>
                    </p>
                    <p className="text-xs" style={{ color: "#334155" }}>Formatos: .xlsx, .xls, .csv · Máx. 50 MB</p>
                  </>
                )}

                {uploadState === "processing" && (
                  <>
                    <div className="w-14 h-14 rounded-full border-2 border-t-transparent animate-spin mb-4"
                      style={{ borderColor: "#2563eb", borderTopColor: "transparent" }} />
                    <p className="text-sm font-medium" style={{ color: "#cbd5e1" }}>Procesando {uploadedName}…</p>
                    <p className="text-xs mt-1" style={{ color: "#334155" }}>Leyendo y mapeando columnas</p>
                  </>
                )}

                {uploadState === "error" && (
                  <>
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(239,68,68,0.1)" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium" style={{ color: "#ef4444" }}>Error al procesar el archivo</p>
                    <p className="text-xs mt-1" style={{ color: "#334155" }}>Verifica el formato e intenta nuevamente</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Success banner */}
          {uploadState === "done" && (
            <div className="flex items-center justify-between mb-4 rounded-lg px-5 py-3 border"
              style={{ background: "rgba(16,185,129,0.06)", borderColor: "rgba(16,185,129,0.2)" }}>
              <div className="flex items-center gap-3">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-xs font-semibold" style={{ color: "#10b981" }}>Cargado: </span>
                <span className="text-xs" style={{ color: "#64748b" }}>{uploadedName}</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#475569" }}>
                  {rows.length} filas · {columns.length} columnas
                </span>
              </div>
              <button
                onClick={() => { setUploadState("idle"); clear(); setColumnFilters({}); setOpenFilterCol(null); }}
                className="text-xs transition-colors"
                style={{ color: "#334155" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                onMouseLeave={e => (e.currentTarget.style.color = "#334155")}
              >
                Cargar otro archivo
              </button>
            </div>
          )}

          {/* Aviso: los datos están en memoria pero no se pudieron persistir en localStorage */}
          {persistError && (
            <div className="flex items-center gap-3 mb-4 rounded-lg px-5 py-3 border"
              style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.25)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-xs" style={{ color: "#f59e0b" }}>{persistError}</span>
            </div>
          )}

          {/* Data table */}
          {uploadState === "done" && rows.length > 0 && (
            <div>
              {/* Filters */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="text-xs" style={{ color: "#475569" }}>Servicio:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {servicios.map(s => (
                    <button
                      key={s}
                      onClick={() => setFilterServicio(s)}
                      className="px-2.5 py-1 rounded text-xs font-medium transition-all duration-150"
                      style={{
                        background: filterServicio === s ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.04)",
                        color: filterServicio === s ? "#3b82f6" : "#475569",
                        border: `1px solid ${filterServicio === s ? "rgba(37,99,235,0.3)" : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllColumnFilters}
                    className="px-2.5 py-1 rounded text-xs font-medium transition-all duration-150 flex items-center gap-1.5"
                    style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}
                  >
                    {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"} de columna activo{activeFilterCount === 1 ? "" : "s"} · Quitar todos ✕
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportFilteredToExcel}
                  disabled={displayed.length === 0}
                  className="px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 flex items-center gap-2"
                  style={{
                    background: displayed.length > 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
                    color: displayed.length > 0 ? "#10b981" : "#475569",
                    border: `1px solid ${displayed.length > 0 ? "rgba(16,185,129,0.28)" : "rgba(255,255,255,0.06)"}`,
                    cursor: displayed.length > 0 ? "pointer" : "not-allowed",
                  }}
                  title="Descargar únicamente las filas que se muestran con los filtros actuales"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Descargar Excel filtrado
                </button>
                <span className="text-xs" style={{ color: "#334155" }}>
                  {displayed.length} de {rows.length} filas
                </span>
              </div>

              <div
                className="rounded-lg border overflow-auto"
                style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)", maxHeight: "calc(100vh - 320px)" }}
              >
                <table style={{ minWidth: "max-content", width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#111d35" }}>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      {columns.map(col => {
                        const filterActive = isColumnFilterActive(columnFilters[col.key]);
                        return (
                        <th
                          key={col.key}
                          className="px-4 py-3 font-medium whitespace-nowrap"
                          style={{
                            color: sortCol === col.key ? "#3b82f6" : "#475569",
                            textAlign: col.align,
                            userSelect: "none",
                          }}
                        >
                          <span className="inline-flex items-center gap-1.5"
                            style={{ justifyContent: col.align === "right" ? "flex-end" : "flex-start" }}>
                            <span
                              style={{ cursor: col.sortable ? "pointer" : "default" }}
                              onClick={() => col.sortable && toggleSort(col.key)}
                              className="inline-flex items-center gap-1"
                            >
                              {col.label}
                              {col.sortable && (
                                <span style={{ color: sortCol === col.key ? "#3b82f6" : "#2d3a52", fontSize: 9 }}>
                                  {sortCol === col.key ? (sortDir === "asc" ? "▲" : "▼") : "▼"}
                                </span>
                              )}
                            </span>
                            <button
                              onClick={e => openFilterPopover(col.key, e)}
                              title="Filtrar columna"
                              className="inline-flex items-center justify-center rounded transition-colors"
                              style={{
                                width: 16, height: 16, flexShrink: 0,
                                background: filterActive ? "rgba(37,99,235,0.25)" : "transparent",
                                color: filterActive || openFilterCol === col.key ? "#3b82f6" : "#334155",
                              }}
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
                              </svg>
                            </button>
                          </span>
                        </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((row, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: i < displayed.length - 1 ? "1px solid rgba(255,255,255,0.035)" : "none",
                          background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.013)",
                        }}
                      >
                        {columns.map(col => {
                          const val = row[col.key];
                          const diff = isDiff(col.key);
                          const numeric = isNumeric(col.key);
                          return (
                            <td
                              key={col.key}
                              className="px-4 py-2 whitespace-nowrap"
                              style={{
                                textAlign: col.align,
                                color: diff
                                  ? diffColor(val as number)
                                  : numeric
                                  ? "#94a3b8"
                                  : col.key === "servicio"
                                  ? "#cbd5e1"
                                  : "#64748b",
                                fontFamily: numeric ? "DM Mono, monospace" : "Inter, sans-serif",
                                fontWeight: diff ? 600 : col.key === "dispRequerido" ? 600 : 400,
                              }}
                            >
                              {numeric ? fmt(val as number, diff) : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Popover de filtro por columna (estilo Excel) */}
              {openFilterCol && (() => {
                const col = columns.find(c => c.key === openFilterCol)!;
                const filter = columnFilters[openFilterCol] ?? emptyColumnFilter();
                const allOptionsForCol = optionsForColumn(openFilterCol); // sin acotar por búsqueda
                const options = allOptionsForCol.filter(v =>
                  v.toLowerCase().includes(filterSearch.toLowerCase())
                );
                const allVisibleSelected = options.length > 0 &&
                  (filter.mode === "all" || options.every(v => filter.selected.has(v)));

                return (
                  <>
                    <div
                      onClick={() => setOpenFilterCol(null)}
                      style={{ position: "fixed", inset: 0, zIndex: 40 }}
                    />
                    <div
                      onClick={e => e.stopPropagation()}
                      className="rounded-lg border flex flex-col"
                      style={{
                        position: "fixed",
                        top: popoverPos.top,
                        left: popoverPos.left,
                        width: 260,
                        maxHeight: 380,
                        background: "#111d35",
                        borderColor: "rgba(255,255,255,0.12)",
                        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                        zIndex: 50,
                      }}
                    >
                      <div className="px-3 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <span className="text-xs font-semibold" style={{ color: "#f0f4ff" }}>{col.label}</span>
                      </div>

                      {col.sortable && (
                        <div className="px-3 pt-2.5 flex gap-1.5">
                          <button
                            onClick={() => { setSortCol(col.key); setSortDir("asc"); }}
                            className="flex-1 text-[11px] py-1.5 rounded"
                            style={{
                              background: sortCol === col.key && sortDir === "asc" ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.04)",
                              color: sortCol === col.key && sortDir === "asc" ? "#3b82f6" : "#94a3b8",
                            }}
                          >
                            ▲ {isNumeric(col.key) ? "Menor a mayor" : "A-Z"}
                          </button>
                          <button
                            onClick={() => { setSortCol(col.key); setSortDir("desc"); }}
                            className="flex-1 text-[11px] py-1.5 rounded"
                            style={{
                              background: sortCol === col.key && sortDir === "desc" ? "rgba(37,99,235,0.18)" : "rgba(255,255,255,0.04)",
                              color: sortCol === col.key && sortDir === "desc" ? "#3b82f6" : "#94a3b8",
                            }}
                          >
                            ▼ {isNumeric(col.key) ? "Mayor a menor" : "Z-A"}
                          </button>
                        </div>
                      )}

                      {isNumeric(col.key) && (
                        <div className="px-3 pt-2.5 flex flex-col gap-1.5">
                          <span className="text-[10px] uppercase tracking-wide" style={{ color: "#475569" }}>Filtro numérico</span>
                          <div className="flex gap-1.5">
                            <select
                              value={filter.numOp}
                              onChange={e => updateColumnFilter(col.key, { numOp: e.target.value as NumericOp })}
                              className="text-[11px] rounded flex-1"
                              style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", color: "#cbd5e1", padding: "5px 6px" }}
                            >
                              {NUMERIC_OP_OPTIONS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>
                            <input
                              type="number"
                              value={filter.numValue}
                              onChange={e => updateColumnFilter(col.key, { numValue: e.target.value })}
                              placeholder="Valor"
                              className="text-[11px] rounded"
                              style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", color: "#cbd5e1", padding: "5px 6px", width: 70 }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="px-3 pt-2.5">
                        <input
                          type="text"
                          value={filterSearch}
                          onChange={e => setFilterSearch(e.target.value)}
                          placeholder="Buscar valor..."
                          className="text-[11px] rounded w-full"
                          style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", color: "#cbd5e1", padding: "5px 8px" }}
                        />
                      </div>

                      <div className="px-3 pt-1.5 pb-1">
                        <button
                          onClick={() => {
                            const base = filter.mode === "all" ? new Set(allOptionsForCol) : new Set(filter.selected);
                            if (allVisibleSelected) {
                              // Deseleccionar todo (los visibles según la búsqueda actual).
                              options.forEach(v => base.delete(v));
                              updateColumnFilter(col.key, { mode: "custom", selected: base });
                            } else {
                              // Seleccionar todo (los visibles según la búsqueda actual).
                              options.forEach(v => base.add(v));
                              // Si con esto quedaron TODOS los valores de la columna marcados,
                              // se vuelve al modo "all" (sin restricción); si no (por ejemplo,
                              // hay una búsqueda activa que oculta otros valores sin marcar),
                              // se guarda como selección explícita.
                              if (allOptionsForCol.length > 0 && allOptionsForCol.every(v => base.has(v))) {
                                updateColumnFilter(col.key, { mode: "all", selected: new Set() });
                              } else {
                                updateColumnFilter(col.key, { mode: "custom", selected: base });
                              }
                            }
                          }}
                          className="text-[11px]"
                          style={{ color: "#3b82f6" }}
                        >
                          {allVisibleSelected ? "Deseleccionar todo" : "Seleccionar todo"}
                        </button>
                      </div>

                      <div className="px-3 pb-2 overflow-auto flex-1" style={{ minHeight: 60 }}>
                        {options.length === 0 ? (
                          <p className="text-[11px] py-2" style={{ color: "#334155" }}>Sin valores para mostrar</p>
                        ) : (
                          options.map(value => (
                            <label key={value} className="flex items-center gap-2 py-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={filter.mode === "all" || filter.selected.has(value)}
                                onChange={() => toggleFilterValue(col.key, value, allOptionsForCol)}
                                style={{ accentColor: "#2563eb" }}
                              />
                              <span className="text-[11px]" style={{ color: "#cbd5e1" }}>{value || "(vacío)"}</span>
                            </label>
                          ))
                        )}
                      </div>

                      <div className="px-3 py-2.5 border-t flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <button
                          onClick={() => clearColumnFilter(col.key)}
                          className="text-[11px]"
                          style={{ color: "#64748b" }}
                        >
                          Limpiar filtro
                        </button>
                        <button
                          onClick={() => setOpenFilterCol(null)}
                          className="text-[11px] px-3 py-1 rounded font-medium"
                          style={{ background: "rgba(37,99,235,0.18)", color: "#3b82f6" }}
                        >
                          Aceptar
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="rounded-lg border" style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Archivo", "Tamaño", "Fecha de carga", "Estado"].map(h => (
                  <th key={h} className="text-left px-5 py-3 font-medium" style={{ color: "#475569" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyFiles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center" style={{ color: "#475569" }}>
                    No hay archivos en el historial
                  </td>
                </tr>
              ) : (
                historyFiles.map((f, i) => (
                  <tr key={i} style={{ borderBottom: i < historyFiles.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span style={{ color: "#cbd5e1" }}>{f.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3" style={{ color: "#64748b", fontFamily: "DM Mono, monospace" }}>{f.size}</td>
                    <td className="px-5 py-3" style={{ color: "#64748b" }}>{f.date}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className="px-2 py-0.5 rounded text-[11px] font-medium w-fit"
                          style={{
                            background: f.status === "ok" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                            color: f.status === "ok" ? "#10b981" : "#f59e0b",
                          }}
                        >
                          {f.status === "ok" ? "Procesado" : "Advertencia"}
                        </span>
                        {f.status === "warn" && f.reason && (
                          <span className="text-[10px]" style={{ color: "#64748b" }}>{f.reason}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

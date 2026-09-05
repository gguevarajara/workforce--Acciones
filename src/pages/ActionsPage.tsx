import { useMemo, useState, useEffect } from "react";
import { useAnalysisData } from "../context/AnalysisDataContext";
import {
  generateActions,
  DEFAULT_ENGINE_CONFIG,
  ACTIONS_CONFIG_STORAGE_KEY,
  type ActionsEngineConfig,
  type ActionSuggestion,
  type ActionType,
  type CoverageBase,
} from "../lib/actions";
import * as XLSX from "xlsx";

const DAY_ORDER: Record<string, number> = {
  "Lunes": 1,
  "Martes": 2,
  "Miércoles": 3,
  "Jueves": 4,
  "Viernes": 5,
  "Sábado": 6,
  "Domingo": 7,
};

const DAY_NAMES = Object.keys(DAY_ORDER);

/**
 * El campo `dia` de una sugerencia AGRUPADA no siempre es un solo día: puede
 * ser una lista separada por comas (ej. "Lunes, Martes", armada en
 * cambioHorario.ts) o incluir rangos con guion (ej. "Lunes - Miércoles",
 * armados por formatDayRange en jornadasExtendidas.ts, que a su vez pueden
 * combinarse con más días: "Lunes - Miércoles, Viernes").
 *
 * Antes el filtro de Día comparaba con === exacto contra el día del filtro
 * (que siempre es un solo día, tomado de las filas crudas del Excel), así
 * que una sugerencia agrupada nunca podía calzar con ningún día individual
 * y quedaba oculta salvo con el filtro en "Todos". Esta función descompone
 * el campo `dia` en sus días individuales (incluyendo los que caen dentro
 * de un rango) para que el filtro sí la encuentre.
 */
function actionAppliesOnDay(itemDia: string, day: string): boolean {
  const parts = itemDia.split(",").map(p => p.trim());
  for (const part of parts) {
    if (part === day) return true;

    const rangeParts = part.split(" - ").map(p => p.trim());
    if (rangeParts.length === 2) {
      const [start, end] = rangeParts;
      const startIdx = DAY_NAMES.indexOf(start);
      const endIdx = DAY_NAMES.indexOf(end);
      const dayIdx = DAY_NAMES.indexOf(day);
      if (startIdx !== -1 && endIdx !== -1 && dayIdx !== -1 && dayIdx >= startIdx && dayIdx <= endIdx) {
        return true;
      }
    }
  }
  return false;
}

const TAB_CONFIG: { id: ActionType; label: string; color: string }[] = [
  { id: "cambio", label: "Cambio de Horario", color: "#10b981" },
  { id: "extendida", label: "Jornadas Extendidas", color: "#f59e0b" },
  { id: "hhee", label: "HHEE", color: "#ef4444" },
];

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
      style={{ background: `${color}1a`, color, letterSpacing: "0.03em" }}
    >
      {text}
    </span>
  );
}

function TimeBadge({ value }: { value: string }) {
  return (
    <span
      key={`time-${value}`}
      className="px-1.5 py-0.5 rounded font-medium"
      style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontFamily: "DM Mono, monospace", fontSize: 11 }}
    >
      {value}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border p-12 flex flex-col items-center justify-center text-center" style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)" }}>
      <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(37,99,235,0.12)" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      </div>
      <p className="text-sm font-medium mb-1" style={{ color: "#cbd5e1" }}>Aún no hay datos para generar acciones</p>
      <p className="text-xs" style={{ color: "#475569", maxWidth: 340 }}>
        Carga un archivo planificado en el módulo <strong style={{ color: "#3b82f6" }}>Análisis</strong> y las acciones se calcularán automáticamente a partir del déficit real detectado.
      </p>
    </div>
  );
}

// --- Filtro por columna (estilo Excel), igual convención que en AnalysisPage.tsx ---
type ActionNumericOp = "none" | "gt" | "gte" | "lt" | "lte" | "eq";

const ACTION_NUMERIC_OP_OPTIONS: { value: ActionNumericOp; label: string }[] = [
  { value: "none", label: "Sin filtro numérico" },
  { value: "gt",   label: "Mayor que (>)"        },
  { value: "gte",  label: "Mayor o igual (≥)"    },
  { value: "lt",   label: "Menor que (<)"        },
  { value: "lte",  label: "Menor o igual (≤)"    },
  { value: "eq",   label: "Igual a (=)"          },
];

type ActionColKey = "servicio" | "accion" | "dia" | "agentes" | "horarioActual" | "nuevoHorario" | "observaciones";

interface ActionColumnFilterState {
  // "all": sin restricción — todos los valores se muestran/marcan (estado por defecto).
  // "custom": solo se consideran los valores en `selected`. Puede estar vacío (ej. justo
  // después de "Limpiar filtro"), en cuyo caso ninguna fila pasa el filtro de esa columna
  // hasta que se vuelva a marcar algo.
  mode: "all" | "custom";
  selected: Set<string>;
  numOp: ActionNumericOp;
  numValue: string;
}

const emptyActionColumnFilter = (): ActionColumnFilterState => ({ mode: "all", selected: new Set(), numOp: "none", numValue: "" });

const isActionColumnFilterActive = (f: ActionColumnFilterState | undefined): boolean =>
  !!f && (f.mode === "custom" || (f.numOp !== "none" && f.numValue.trim() !== ""));

function ActionsTable({ items, columnLabel }: { items: ActionSuggestion[]; columnLabel: string }) {
  const actionTypeLabel = (type: string) => {
    if (type === "cambio") return "CAMBIO DE HORARIO";
    if (type === "extendida") return "JORNADAS EXTENDIDAS";
    return "HHEE";
  };

  const getHeaderLabel = (type: string) => {
    if (type === "hhee") return "HHEE";
    return "NUEVO HORARIO"; // Para cambio y extendida
  };

  const nuevoHorarioLabel = getHeaderLabel(items[0]?.type || "cambio");

  // Definición de las 7 columnas filtrables del encabezado. "horarioActual" y
  // "nuevoHorario" cada una agrupa 2 celdas de datos (hora inicio / hora fin)
  // bajo un solo filtro, con el mismo valor combinado que se ve en pantalla.
  const ACTION_COLUMNS: {
    key: ActionColKey;
    label: string;
    align: "left" | "center";
    numeric?: boolean;
    getValue: (it: ActionSuggestion) => string;
  }[] = [
    { key: "servicio", label: "SERVICIO", align: "left", getValue: it => it.servicio },
    { key: "accion", label: "ACCIÓN", align: "left", getValue: it => actionTypeLabel(it.type) },
    { key: "dia", label: "DÍA", align: "left", getValue: it => it.dia },
    { key: "agentes", label: "AGENTES", align: "center", numeric: true, getValue: it => String(it.agents) },
    { key: "horarioActual", label: "HORARIO ACTUAL", align: "left", getValue: it => it.currentStartHora ? `${it.currentStartHora} - ${it.currentEndHora}` : "-" },
    { key: "nuevoHorario", label: nuevoHorarioLabel, align: "left", getValue: it => `${it.newStartHora} - ${it.newEndHora}` },
    { key: "observaciones", label: "OBSERVACIONES", align: "left", getValue: it => it.observations?.trim() ? it.observations : "(vacío)" },
  ];

  const [columnFilters, setColumnFilters] = useState<Partial<Record<ActionColKey, ActionColumnFilterState>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<ActionColKey | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const updateColumnFilter = (key: ActionColKey, patch: Partial<ActionColumnFilterState>) => {
    setColumnFilters(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyActionColumnFilter()), ...patch },
    }));
  };

  // "Limpiar filtro": deja la columna en modo "custom" con selección VACÍA —
  // ningún valor queda marcado y ninguna fila pasa el filtro de esa columna
  // hasta que el usuario vuelva a marcar algo (igual que en Análisis).
  const clearColumnFilter = (key: ActionColKey) => {
    setColumnFilters(prev => ({
      ...prev,
      [key]: { mode: "custom", selected: new Set<string>(), numOp: "none", numValue: "" },
    }));
  };

  const toggleFilterValue = (key: ActionColKey, value: string, allOptions: string[]) => {
    const current = columnFilters[key] ?? emptyActionColumnFilter();
    let nextSelected: Set<string>;
    if (current.mode === "all") {
      nextSelected = new Set(allOptions);
      nextSelected.delete(value);
    } else {
      nextSelected = new Set(current.selected);
      if (nextSelected.has(value)) nextSelected.delete(value);
      else nextSelected.add(value);
    }
    if (allOptions.length > 0 && allOptions.every(v => nextSelected.has(v))) {
      updateColumnFilter(key, { mode: "all", selected: new Set() });
      return;
    }
    updateColumnFilter(key, { mode: "custom", selected: nextSelected });
  };

  // Igual que en AnalysisPage.tsx: al calcular las opciones disponibles de una
  // columna, se acota por las DEMÁS columnas ya filtradas (estilo Excel).
  const itemMatchesColumnFilters = (it: ActionSuggestion, excludeKey?: ActionColKey): boolean => {
    for (const col of ACTION_COLUMNS) {
      if (col.key === excludeKey) continue;
      const filter = columnFilters[col.key];
      if (!filter) continue;
      const value = col.getValue(it);

      if (col.numeric && filter.numOp !== "none" && filter.numValue.trim() !== "") {
        const num = Number(value);
        const target = Number(filter.numValue);
        if (!Number.isNaN(num) && !Number.isNaN(target)) {
          if (filter.numOp === "gt"  && !(num > target))  return false;
          if (filter.numOp === "gte" && !(num >= target)) return false;
          if (filter.numOp === "lt"  && !(num < target))  return false;
          if (filter.numOp === "lte" && !(num <= target)) return false;
          if (filter.numOp === "eq"  && !(num === target)) return false;
        }
      }

      if (filter.mode === "custom" && !filter.selected.has(value)) return false;
    }
    return true;
  };

  const optionsForColumn = (key: ActionColKey): string[] => {
    const col = ACTION_COLUMNS.find(c => c.key === key)!;
    const values = items.filter(it => itemMatchesColumnFilters(it, key)).map(col.getValue);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  };

  const displayedItems = items.filter(it => itemMatchesColumnFilters(it));

  const openFilterPopover = (key: ActionColKey, e: React.MouseEvent) => {
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

  return (
    <div className="overflow-x-auto">
      {items.length === 0 ? (
        <div key="empty-state" className="py-16 text-center text-xs" style={{ color: "#475569" }}>
          No se detectaron sugerencias de {columnLabel.toLowerCase()} con la configuración actual.
        </div>
      ) : (
        <table key="data-table" className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {ACTION_COLUMNS.map(col => {
              const filterActive = isActionColumnFilterActive(columnFilters[col.key]);
              const colSpan = col.key === "horarioActual" || col.key === "nuevoHorario" ? 2 : 1;
              return (
                <th
                  key={col.key}
                  colSpan={colSpan}
                  className={`px-3 py-2.5 font-medium whitespace-nowrap ${col.align === "center" ? "text-center" : "text-left"}`}
                  style={{ color: "#475569", fontSize: 10, userSelect: "none" }}
                >
                  <span className="inline-flex items-center gap-1.5" style={{ justifyContent: col.align === "center" ? "center" : "flex-start" }}>
                    {col.label}
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
          {displayedItems.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-10 text-center text-xs" style={{ color: "#475569" }}>
                Ninguna fila coincide con los filtros de columna aplicados.
              </td>
            </tr>
          ) : (
            displayedItems.map((it, i) => (
            <tr key={`action-${i}-${it.type}-${it.servicio}-${it.dia}-${it.newStartHora}-${it.newEndHora}`} style={{ borderBottom: i < displayedItems.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: "#cbd5e1" }}>{it.servicio}</td>
              <td className="px-3 py-2.5 whitespace-nowrap font-semibold" style={{ color: "#3b82f6", fontSize: 10 }}>{actionTypeLabel(it.type)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#94a3b8" }}>
                {it.dia}
              </td>
              <td className="px-3 py-2.5 text-center font-semibold" style={{ color: "#3b82f6", fontSize: 13 }}>{it.agents}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {it.currentStartHora ? <TimeBadge value={it.currentStartHora} /> : <span key={`start-empty-${i}`} style={{ color: "#475569" }}>-</span>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#334155" }}>
                {it.currentEndHora ? <TimeBadge value={it.currentEndHora} /> : <span key={`end-empty-${i}`} style={{ color: "#475569" }}>-</span>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <TimeBadge value={it.newStartHora} />
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <TimeBadge value={it.newEndHora} />
              </td>
              <td className="px-3 py-2.5" style={{ color: "#64748b", maxWidth: 300, whiteSpace: "normal", lineHeight: 1.3, fontSize: 10 }}>{it.observations}</td>
            </tr>
            ))
          )}
        </tbody>
      </table>
      )}

      {openFilterCol && (() => {
        const col = ACTION_COLUMNS.find(c => c.key === openFilterCol)!;
        const filter = columnFilters[openFilterCol] ?? emptyActionColumnFilter();
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

              {col.numeric && (
                <div className="px-3 pt-2.5 flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: "#475569" }}>Filtro numérico</span>
                  <div className="flex gap-1.5">
                    <select
                      value={filter.numOp}
                      onChange={e => updateColumnFilter(col.key, { numOp: e.target.value as ActionNumericOp })}
                      className="text-[11px] rounded flex-1"
                      style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.1)", color: "#cbd5e1", padding: "5px 6px" }}
                    >
                      {ACTION_NUMERIC_OP_OPTIONS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
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
                      options.forEach(v => base.delete(v));
                      updateColumnFilter(col.key, { mode: "custom", selected: base });
                    } else {
                      options.forEach(v => base.add(v));
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
  );
}

/** Exporta las sugerencias de acciones a un archivo Excel */
function exportActionsToExcel(actions: ActionSuggestion[], fileName: string) {
  if (actions.length === 0) {
    alert("No hay acciones para exportar.");
    return;
  }
  const actionTypeLabel = (type: string) => {
    if (type === "cambio") return "CAMBIO DE HORARIO";
    if (type === "extendida") return "JORNADAS EXTENDIDAS";
    return "HHEE";
  };

  // Ordenar por día de la semana antes de exportar
  const sortedActions = [...actions].sort((a, b) => {
    const dayOrderA = DAY_ORDER[a.dia] ?? 99;
    const dayOrderB = DAY_ORDER[b.dia] ?? 99;
    return dayOrderA - dayOrderB;
  });

  const exportData = sortedActions.map(action => ({
    "SERVICIO": action.servicio,
    "ACCIÓN": actionTypeLabel(action.type),
    "DÍA": action.dia,
    "AGENTES": action.agents,
    "HORARIO ACTUAL - HORA INICIO": action.currentStartHora,
    "HORARIO ACTUAL - HORA FIN": action.currentEndHora,
    "NUEVO HORARIO / HHEE - HORA INICIO": action.newStartHora,
    "NUEVO HORARIO / HHEE - HORA FIN": action.newEndHora,
    "OBSERVACIONES": action.observations,
  }));

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Acciones");

  // Ajustar ancho de columnas
  const colWidths = [
    { wch: 15 }, // SERVICIO
    { wch: 20 }, // ACCIÓN
    { wch: 15 }, // DÍA
    { wch: 10 }, // AGENTES
    { wch: 15 }, // HORARIO ACTUAL - HORA INICIO
    { wch: 15 }, // HORARIO ACTUAL - HORA FIN
    { wch: 20 }, // NUEVO HORARIO / HHEE - HORA INICIO
    { wch: 20 }, // NUEVO HORARIO / HHEE - HORA FIN
    { wch: 60 }, // OBSERVACIONES
  ];
  ws['!cols'] = colWidths;

  const timestamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `acciones_${fileName}_${timestamp}.xlsx`);
}

export default function ActionsPage() {
  const { rows, uploadedName } = useAnalysisData();

  const [tab, setTab] = useState<ActionType>("cambio");
  const [serviceFilter, setServiceFilter] = useState<string>("Todos");
  const [subareaFilter, setSubareaFilter] = useState<string>("Todos");
  const [dayFilter, setDayFilter] = useState<string>("Todos");
  const [config, setConfig] = useState<ActionsEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [configSaveError, setConfigSaveError] = useState(false);

  // Cargar configuración desde localStorage al montar y cuando cambia
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACTIONS_CONFIG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConfig({ ...DEFAULT_ENGINE_CONFIG, ...parsed });
      }
    } catch (error) {
      console.error("Error loading config:", error);
    }
  }, []);

  // Escuchar cambios en localStorage de otras pestañas/ventanas
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACTIONS_CONFIG_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setConfig({ ...DEFAULT_ENGINE_CONFIG, ...parsed });
        } catch (error) {
          console.error("Error loading config from storage event:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // NOTA DE DISEÑO: los toggles del panel "Configuración rápida" (activar/
  // desactivar Cambio/Extendida/HHEE, Base de Cobertura) se persisten al
  // instante, A PROPÓSITO — son interruptores binarios pensados para
  // probarse al vuelo. Esto es distinto, intencionalmente, de ConfigPage.tsx
  // (los parámetros numéricos finos quedan en borrador hasta pulsar
  // "Guardar cambios"). Ambas pantallas comparten ACTIONS_CONFIG_STORAGE_KEY,
  // así que un cambio aquí sí sobrescribe la configuración guardada en
  // Configuración. Si se decide unificar el comportamiento, hay que
  // actualizar los dos archivos a la vez.
  //
  // Actualiza un parámetro del motor y lo persiste de inmediato (afecta también a Configuración)
  const updateConfig = (partial: Partial<ActionsEngineConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(ACTIONS_CONFIG_STORAGE_KEY, JSON.stringify(next));
        }
        setConfigSaveError(false);
      } catch (error) {
        console.error("Error saving config:", error);
        // El cambio queda aplicado en memoria para esta sesión (se sigue
        // usando en generateActions), pero no se persistió: se perderá al
        // recargar. Avisamos en la UI en vez de fallar en silencio.
        setConfigSaveError(true);
      }
      return next;
    });
  };

  const actions = useMemo(() => {
    const result = generateActions(rows, config);

    // Validación defensiva: si generateActions retorna undefined, usar estructura vacía
    if (!result || typeof result !== 'object') {
      console.error("Error: generateActions retornó valor inválido:", result);
      return { cambio: [], extendida: [], hhee: [] };
    }

    return result;
  }, [rows, config, uploadedName]);

  // Obtener valores únicos para filtros
  const servicios = useMemo(() => ["Todos", ...Array.from(new Set(rows.filter(r => r && typeof r === "object").map(r => r.servicio)))], [rows]);
  const subareas = useMemo(() => ["Todos", ...Array.from(new Set(rows.filter(r => r && typeof r === "object").map(r => r.subarea)))], [rows]);
  const dias = useMemo(() => ["Todos", ...Array.from(new Set(rows.filter(r => r && typeof r === "object").map(r => r.dia)))], [rows]);

  // Función de filtrado combinada
  const filterFn = (it: ActionSuggestion) => {
    const serviceMatch = serviceFilter === "Todos" || it.servicio === serviceFilter;
    const subareaMatch = subareaFilter === "Todos" || it.subarea === subareaFilter;
    const dayMatch = dayFilter === "Todos" || actionAppliesOnDay(it.dia, dayFilter);
    return serviceMatch && subareaMatch && dayMatch;
  };

  // Función de ordenamiento por día de la semana
  const sortByDay = (a: ActionSuggestion, b: ActionSuggestion) => {
    const dayOrderA = DAY_ORDER[a.dia] ?? 99;
    const dayOrderB = DAY_ORDER[b.dia] ?? 99;
    return dayOrderA - dayOrderB;
  };

  const cambio = actions.cambio.filter(filterFn).sort(sortByDay);
  const extendida = actions.extendida.filter(filterFn).sort(sortByDay);
  const hhee = actions.hhee.filter(filterFn).sort(sortByDay);

  const totalAgents = [...cambio, ...extendida, ...hhee].reduce((s, a) => s + a.agents, 0);
  const activeTab = TAB_CONFIG.find(t => t.id === tab)!;
  const activeItems = tab === "cambio" ? cambio : tab === "extendida" ? extendida : hhee;

  return (
    <div className="p-8 min-h-full">

      <div className="flex items-start justify-between mb-8 flex-wrap gap-3">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "#2563eb" }}>Módulo</p>
          <h1 className="text-2xl font-semibold" style={{ color: "#f0f4ff" }}>Acciones</h1>
          {rows.length === 0 && (
            <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
              Se generan automáticamente desde el déficit detectado en Análisis
            </p>
          )}
          {rows.length > 0 && config && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
                ✓ Jornada estándar: {config.workHours}h trabajo + {config.breakHours}h break ({config.workHours + config.breakHours}h total)
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={() => exportActionsToExcel([...actions.cambio, ...actions.extendida, ...actions.hhee], uploadedName)}
              className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Exportar Excel
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Configuración rápida del motor: tipos de acción activos + base de cobertura.
              Siempre visible (sin toggle de colapsar), en una sola fila compacta para
              minimizar el espacio vertical que ocupa. */}
          <div
            className="rounded-lg mb-4 px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-2"
            style={{
              background: "linear-gradient(180deg, rgba(37,99,235,0.09), rgba(13,21,38,0.4))",
              border: "1px solid rgba(59,130,246,0.35)",
            }}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "#e2e8f0" }}>
              <span>⚙️</span> Motor:
            </span>

            {/* Tipos de acción activos */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { key: "enableCambio" as const, label: "Cambio de Horario", color: "#10b981" },
                { key: "enableExtendida" as const, label: "Jornadas Extendidas", color: "#f59e0b" },
                { key: "enableHhee" as const, label: "HHEE", color: "#ef4444" },
              ].map(item => {
                const active = config[item.key];
                return (
                  <button
                    key={item.key}
                    onClick={() => updateConfig({ [item.key]: !active } as Partial<ActionsEngineConfig>)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold"
                    style={{
                      background: active ? `${item.color}1f` : "rgba(255,255,255,0.04)",
                      color: active ? item.color : "#64748b",
                      border: `1px solid ${active ? `${item.color}55` : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? item.color : "#475569" }} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{ width: 1, height: 18, background: "rgba(59,130,246,0.2)" }} />

            {/* Base de cobertura */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "#7c93b8" }}>
                Base:
              </span>
              <div className="flex gap-1 p-0.5 rounded-md" style={{ background: "#0b1224", border: "1px solid rgba(255,255,255,0.08)" }}>
                {[
                  { value: "officials" as CoverageBase, label: "Oficiales" },
                  { value: "officials_hhee" as CoverageBase, label: "+ HHEE" },
                  { value: "officials_hhee_ojt" as CoverageBase, label: "+ HHEE + OJT" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateConfig({ coverageBase: opt.value })}
                    className="px-2.5 py-1 rounded text-[11px] font-semibold"
                    style={{
                      background: config.coverageBase === opt.value ? "rgba(59,130,246,0.22)" : "transparent",
                      color: config.coverageBase === opt.value ? "#60a5fa" : "#64748b",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {configSaveError && (
              <span className="text-[10.5px]" style={{ color: "#ef4444" }}>
                No se pudo guardar el último cambio (sigue activo en esta sesión, pero se perderá al recargar).
              </span>
            )}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Cambios de Horario", value: cambio.length, color: "#10b981" },
              { label: "Jornadas Extendidas", value: extendida.length, color: "#f59e0b" },
              { label: "Horas Extra (HHEE)", value: hhee.length, color: "#ef4444" },
              { label: "Agentes recomendados (total)", value: totalAgents, color: "#3b82f6" },
            ].map(k => (
              <div
                key={k.label}
                className="rounded-lg border px-4 py-2 flex items-center justify-between gap-2"
                style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)" }}
              >
                <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "#64748b" }}>{k.label}</div>
                <div className="text-lg font-semibold shrink-0" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Filters + tabs */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {/* Filtro por Servicio */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: "#64748b" }}>Servicio:</span>
              <div className="flex gap-1 p-1 rounded flex-wrap" style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.07)" }}>
                {servicios.map(s => (
                  <button
                    key={s}
                    onClick={() => setServiceFilter(s)}
                    className="px-2 py-1 rounded text-[10px] font-medium"
                    style={{
                      background: serviceFilter === s ? "rgba(37,99,235,0.18)" : "transparent",
                      color: serviceFilter === s ? "#3b82f6" : "#475569",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtro por Subárea */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "#64748b" }}>Subárea:</span>
              <div className="flex gap-1 p-1 rounded" style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.07)" }}>
                {subareas.map(s => (
                  <button
                    key={s}
                    onClick={() => setSubareaFilter(s)}
                    className="px-3 py-1 rounded text-xs font-medium"
                    style={{
                      background: subareaFilter === s ? "rgba(37,99,235,0.18)" : "transparent",
                      color: subareaFilter === s ? "#3b82f6" : "#475569",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtro por Día */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "#64748b" }}>Día:</span>
              <div className="flex gap-1 p-1 rounded" style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.07)" }}>
                {dias.map(d => (
                  <button
                    key={d}
                    onClick={() => setDayFilter(d)}
                    className="px-3 py-1 rounded text-xs font-medium"
                    style={{
                      background: dayFilter === d ? "rgba(37,99,235,0.18)" : "transparent",
                      color: dayFilter === d ? "#3b82f6" : "#475569",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1" />

            <div className="flex gap-1 p-1 rounded" style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.07)" }}>
              {TAB_CONFIG.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="px-3 py-1.5 rounded text-xs font-semibold"
                  style={{
                    background: tab === t.id ? `${t.color}1a` : "transparent",
                    color: tab === t.id ? t.color : "#475569",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-lg border overflow-hidden" style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)", borderTop: `2px solid ${activeTab.color}` }}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}>
              <Badge text={activeTab.label.toUpperCase()} color={activeTab.color} />
              <span className="text-xs" style={{ color: "#475569" }}>{activeItems.length} sugerencias</span>
            </div>
            <ActionsTable key={tab} items={activeItems} columnLabel={activeTab.label} />
          </div>

          {/* Priority note */}
          <div className="flex items-center gap-2 flex-wrap mt-4 px-4 py-2.5 rounded text-[11px]" style={{ background: "#0d1526", border: "1px solid rgba(255,255,255,0.07)", color: "#475569" }}>
            <span style={{ color: "#334155", fontWeight: 600 }}>Cadena de dependencia (acumulativa):</span>
            <span style={{ color: "#10b981" }}>① Cambio de Horario</span>
            <span style={{ color: "#334155" }}>→</span>
            <span style={{ color: "#f59e0b" }}>② Jornada Extendida</span>
            <span style={{ color: "#334155" }}>→</span>
            <span style={{ color: "#ef4444" }}>③ HHEE</span>
            <span style={{ marginLeft: 6 }}>· cada acción activa parte del déficit remanente de las anteriores</span>
          </div>
        </>
      )}
    </div>
  );
}

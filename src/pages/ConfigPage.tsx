import { useState, useEffect } from "react";
import {
  DEFAULT_ENGINE_CONFIG,
  EXTENDED_HOURS_PER_DAY,
  EXTENDED_DAYS_PER_WEEK,
  EXTENDED_RETURN_BLOCK_HOURS,
  EXTENDED_PRIORITY_RETURN_DAY,
  EXTENDED_RETURN_UTILIZATION,
  LAYER_TOLERANCE_AGENTS,
  HHEE_MIN_DEFICIT_AGENTS,
  ACTIONS_CONFIG_STORAGE_KEY,
  type ActionsEngineConfig,
} from "../lib/actions";

const ALL_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

type TabKey = "general" | "cambio" | "extendida" | "hhee";

const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
  { key: "general", label: "General", icon: "⚙️", color: "#3b82f6" },
  { key: "cambio", label: "Cambio de Horario", icon: "🔀", color: "#10b981" },
  { key: "extendida", label: "Jornadas Extendidas", icon: "⏱️", color: "#f59e0b" },
  { key: "hhee", label: "HHEE", icon: "🕐", color: "#ef4444" },
];

const saveActionsConfig = (config: ActionsEngineConfig): boolean => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(ACTIONS_CONFIG_STORAGE_KEY, JSON.stringify(config));
    }
    return true;
  } catch (error) {
    console.error("Error saving actions config:", error);
    return false;
  }
};

export default function ConfigPage() {
  const [actionsConfig, setActionsConfig] = useState<ActionsEngineConfig>(DEFAULT_ENGINE_CONFIG);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  // Cargar configuración guardada al montar
  useEffect(() => {
    const savedActions = localStorage.getItem(ACTIONS_CONFIG_STORAGE_KEY);
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setActionsConfig({ ...DEFAULT_ENGINE_CONFIG, ...parsed });
      } catch (e) {
        console.error("Error loading actions config:", e);
      }
    }
  }, []);

  // NOTA DE DISEÑO: aquí los cambios quedan en borrador (`isDirty`) hasta que
  // el usuario presiona "Guardar cambios" (handleSaveAll). Esto es distinto,
  // A PROPÓSITO, del panel "Configuración rápida" en ActionsPage.tsx, donde
  // los toggles (activar/desactivar Cambio/Extendida/HHEE, Base de Cobertura)
  // se persisten al instante sin confirmación. La distinción es intencional:
  // esta pantalla ajusta parámetros numéricos finos que conviene poder
  // revisar antes de aplicar; los toggles rápidos son interruptores binarios
  // pensados para probarse al vuelo. Ambas pantallas comparten la misma
  // clave de localStorage (ACTIONS_CONFIG_STORAGE_KEY), así que si se cambia
  // este flujo a guardado inmediato (o viceversa), debe hacerse en los dos
  // archivos a la vez para no reintroducir la inconsistencia.
  const updateConfig = (patch: Partial<ActionsEngineConfig>) => {
    setActionsConfig(prev => ({ ...prev, ...patch }));
    setIsDirty(true);
  };

  const handleSaveAll = () => {
    const ok = saveActionsConfig(actionsConfig);
    if (ok) {
      setIsDirty(false);
      setSaveError(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setSaveError(true);
    }
  };

  const handleRestoreDefault = () => {
    setActionsConfig(DEFAULT_ENGINE_CONFIG);
    setIsDirty(true);
  };

  const Section = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
    <div className="rounded-lg border mb-6" style={{ background: "#0d1526", borderColor: "rgba(255,255,255,0.07)" }}>
      <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <span className="text-lg">{icon}</span>
        <h2 className="text-sm font-semibold" style={{ color: "#f0f4ff" }}>{title}</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-5">{children}</div>
    </div>
  );

  const RangeField = ({ label, hint, value, min, max, step, onChange, formatValue }: {
    label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; formatValue?: (v: number) => string;
  }) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{label}</label>
        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(37,99,235,0.15)", color: "#3b82f6" }}>
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <p className="text-[11px] mb-2" style={{ color: "#64748b" }}>{hint}</p>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ accentColor: "#2563eb" }}
      />
    </div>
  );

  const ToggleField = ({ label, hint, value, onChange }: {
    label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <label className="text-xs font-medium" style={{ color: "#cbd5e1" }}>{label}</label>
        <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>{hint}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="shrink-0 rounded-full transition-all duration-150"
        style={{
          width: 36, height: 20, padding: 2,
          background: value ? "#2563eb" : "rgba(255,255,255,0.12)",
        }}
      >
        <div
          className="rounded-full transition-all duration-150"
          style={{
            width: 16, height: 16, background: "#fff",
            transform: value ? "translateX(16px)" : "translateX(0px)",
          }}
        />
      </button>
    </div>
  );

  const SelectField = ({ label, hint, value, options, onChange }: {
    label: string; hint: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
  }) => (
    <div className="mb-4">
      <label className="text-xs font-medium block mb-2" style={{ color: "#cbd5e1" }}>{label}</label>
      <p className="text-[11px] mb-2" style={{ color: "#64748b" }}>{hint}</p>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span className="text-xs" style={{ color: "#94a3b8" }}>{label}</span>
      <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "#cbd5e1" }}>{value}</span>
    </div>
  );

  const inputStyle: React.CSSProperties = {
    background: "#111d35",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#f0f4ff",
    fontFamily: "Inter, sans-serif",
    width: "100%",
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 12,
    outline: "none",
  };

  // Recibe HORAS decimales (ej. 8, 8.5, 21) — que es lo que entregan los
  // RangeField de esta página (siempre value={config.xxxMinutes / 60}) — y
  // las formatea como "HH:MM". 24h se muestra como "00:00" (medianoche).
  const toHHMM = (hoursDecimal: number) => {
    const totalMinutes = Math.round(hoursDecimal * 60);
    const h = ((Math.floor(totalMinutes / 60) % 24) + 24) % 24;
    const m = ((totalMinutes % 60) + 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const toggleSpecificDay = (day: string) => {
    const current = actionsConfig.cambioSpecificDays ?? [];
    const next = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    updateConfig({ cambioSpecificDays: next });
  };

  // Vista previa de validación del patrón personalizado: como resolveApplicableDays
  // (cambioHorario.ts) compara por igualdad exacta de texto contra los nombres de
  // día reales (con tilde incluida), un typo deja ese día fuera en silencio. Si
  // TODOS los días quedan sin reconocer, el resultado es un arreglo vacío y no se
  // genera ninguna sugerencia de Cambio de Horario para ese servicio/subárea, sin
  // ningún aviso en la UI. Esta vista previa hace visible ese caso antes de guardar.
  const customPatternDays = (actionsConfig.cambioCustomPattern ?? "")
    .split(",")
    .map(d => d.trim())
    .filter(Boolean);
  const customPatternRecognized = customPatternDays.filter(d => ALL_DAYS.includes(d));
  const customPatternUnrecognized = customPatternDays.filter(d => !ALL_DAYS.includes(d));

  // Duración total de la Jornada Laboral Estándar (Horas de trabajo + Horas de
  // break), en minutos. `getPrincipalSchedule` (scheduleCalculator.ts) usa esta
  // misma cuenta para IGNORAR "Fin turno mañana/tarde" cuando no coincide con el
  // horario configurado, y recalcular el fin como inicio + esta duración.
  const totalWorkDurationMinutes = (actionsConfig.workHours + actionsConfig.breakHours) * 60;

  const scheduleMismatchWarning = (startMinutes: number, endMinutes: number): string | null => {
    const configuredDuration = endMinutes - startMinutes;
    if (Math.abs(configuredDuration - totalWorkDurationMinutes) <= 1) return null;
    const effectiveEnd = startMinutes + totalWorkDurationMinutes;
    return `Esta combinación no coincide con la Jornada Laboral Estándar (${actionsConfig.workHours + actionsConfig.breakHours}h). Jornadas Extendidas usará como fin real ${toHHMM(effectiveEnd / 60)} en vez de ${toHHMM(endMinutes / 60)}. Cambio de Horario no se ve afectado: nunca lee este campo.`;
  };

  return (
    <div className="p-8 min-h-full">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "#2563eb" }}>Configuración</p>
        <h1 className="text-2xl font-semibold" style={{ color: "#f0f4ff" }}>Configuración del Motor de Acciones</h1>
        <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>Umbrales, jornada laboral y parámetros de precisión horaria, organizados por tipo de acción.</p>
        <p className="text-xs mt-1" style={{ color: "#3b82f6" }}>Los tipos de acción activos (Cambio / Extendida / HHEE) y la base de cobertura se activan y desactivan directamente en el módulo Acciones. Aquí se ajustan sus parámetros de cálculo.</p>
      </div>

      {/* Navegación por pestañas */}
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold transition-all duration-150"
              style={{
                color: active ? tab.color : "#64748b",
                borderBottom: active ? `2px solid ${tab.color}` : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ============ TAB GENERAL ============ */}
      {activeTab === "general" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-6">
            <Section title="Umbrales de Detección de Déficit" icon="⚙️">
              <RangeField
                label="Déficit mínimo considerado"
                hint="Mínimo número de agentes faltantes para considerar un intervalo como déficit. Valores más bajos detectan más déficit pero pueden incluir ruido. Ej: 1 significa que faltar al menos 1 agente ya se considera déficit. Aplica a Cambio de Horario y Jornadas Extendidas. HHEE NO usa este control: tiene su propio umbral fijo de 0.5 agentes (ver pestaña HHEE)."
                value={actionsConfig.minDeficit} min={0} max={5} step={0.5}
                onChange={v => updateConfig({ minDeficit: v })}
              />
              <RangeField
                label="Umbral de redondeo de agentes"
                hint="Umbral decimal para redondear el número de agentes hacia arriba. Ej: 0.2 significa que si el déficit es 1.3 agentes, se redondea a 2 (porque 0.3 > 0.2). Valores más bajos redondean más agresivamente. Aplica a Jornadas Extendidas y HHEE. Cambio de Horario NO usa este control: determina la cantidad de agentes probando exhaustivamente 1, 2, 3... N y quedándose con la que da mejor resultado, no redondeando un déficit fraccionario."
                value={actionsConfig.roundingThreshold} min={0.1} max={0.5} step={0.05}
                onChange={v => updateConfig({ roundingThreshold: v })}
              />
            </Section>

            <Section title="Jornada Laboral Estándar" icon="⏱️">
              <p className="text-[11px] -mt-2 mb-1" style={{ color: "#3b82f6" }}>Cambio de Horario SIEMPRE usa esta duración para calcular el fin del horario que propone (el campo "Fin turno mañana/tarde" de la sección de al lado no le aplica). Jornadas Extendidas no arma una jornada nueva, pero SÍ depende de esta duración: si "Fin turno mañana/tarde" no coincide exactamente con ella, se recalcula automáticamente a partir de aquí (ver aviso en "Horarios de Turno Estándar" cuando aplique).</p>
              <RangeField
                label="Horas de trabajo"
                hint="Duración de la jornada laboral efectiva sin contar breaks. Ej: 8h significa que un agente trabaja 8 horas diarias."
                value={actionsConfig.workHours} min={4} max={12} step={0.5}
                onChange={v => updateConfig({ workHours: v })}
              />
              <RangeField
                label="Horas de break"
                hint="Tiempo de descanso/almuerzo dentro de la jornada. Ej: 1h significa 1 hora de descanso. La jornada total = trabajo + break."
                value={actionsConfig.breakHours} min={0} max={2} step={0.25}
                onChange={v => updateConfig({ breakHours: v })}
              />
              <div className="mt-4 p-3 rounded" style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)" }}>
                <p className="text-xs" style={{ color: "#94a3b8" }}>
                  <span style={{ color: "#3b82f6", fontWeight: 600 }}>Jornada total:</span> {actionsConfig.workHours + actionsConfig.breakHours} horas
                  <span className="ml-2" style={{ color: "#64748b" }}>({actionsConfig.workHours}h trabajo + {actionsConfig.breakHours}h break)</span>
                </p>
              </div>
            </Section>
          </div>

          <div className="flex flex-col gap-6">
            <Section title="Horarios de Turno Estándar" icon="🕐">
              <p className="text-[11px] -mt-2 mb-1" style={{ color: "#3b82f6" }}>"Inicio" aplica a Cambio de Horario y Jornadas Extendidas. "Fin" aplica SOLO a Jornadas Extendidas: Cambio de Horario calcula su propio fin como Inicio + Jornada Laboral Estándar (sección de al lado) y nunca lee este valor.</p>
              <div className="mb-4">
                <p className="text-xs font-medium mb-3" style={{ color: "#cbd5e1" }}>Turno Mañana</p>
                <RangeField
                  label="Inicio turno mañana"
                  hint="Horario principal de inicio del turno matutino. Usado por Cambio de Horario (que calcula su propio fin desde Jornada Laboral Estándar) y por Jornadas Extendidas: 08:00-17:00 + extensión = 08:00-19:00 (mantiene inicio). Ej: 08:00"
                  value={actionsConfig.shiftStartMorning / 60} min={5} max={12} step={0.5}
                  onChange={v => updateConfig({ shiftStartMorning: v * 60 })}
                  formatValue={toHHMM}
                />
                <RangeField
                  label="Fin turno mañana"
                  hint="Solo lo usa Jornadas Extendidas (Cambio de Horario no lee este campo): 08:00-17:00 + extensión = 08:00-19:00 (extiende fin). Ej: 17:00. Debe coincidir con Inicio + Jornada Laboral Estándar o será recalculado automáticamente (ver aviso abajo)."
                  value={actionsConfig.shiftEndMorning / 60} min={12} max={20} step={0.5}
                  onChange={v => updateConfig({ shiftEndMorning: v * 60 })}
                  formatValue={toHHMM}
                />
                {scheduleMismatchWarning(actionsConfig.shiftStartMorning, actionsConfig.shiftEndMorning) && (
                  <p className="text-[11px] mt-1" style={{ color: "#f59e0b" }}>
                    ⚠️ {scheduleMismatchWarning(actionsConfig.shiftStartMorning, actionsConfig.shiftEndMorning)}
                  </p>
                )}
              </div>
              <div className="mb-2">
                <p className="text-xs font-medium mb-3" style={{ color: "#cbd5e1" }}>Turno Tarde</p>
                <RangeField
                  label="Inicio turno tarde"
                  hint="Horario principal de inicio del turno vespertino. Usado por Cambio de Horario (que calcula su propio fin desde Jornada Laboral Estándar) y por Jornadas Extendidas: 11:00-20:00 + extensión = 09:00-20:00 (extiende inicio). Ej: 11:00"
                  value={actionsConfig.shiftStartAfternoon / 60} min={9} max={15} step={0.5}
                  onChange={v => updateConfig({ shiftStartAfternoon: v * 60 })}
                  formatValue={toHHMM}
                />
                <RangeField
                  label="Fin turno tarde"
                  hint="Solo lo usa Jornadas Extendidas (Cambio de Horario no lee este campo): 11:00-20:00 + extensión = 09:00-20:00 (mantiene fin). Ej: 20:00. Debe coincidir con Inicio + Jornada Laboral Estándar o será recalculado automáticamente (ver aviso abajo)."
                  value={actionsConfig.shiftEndAfternoon / 60} min={15} max={24} step={0.5}
                  onChange={v => updateConfig({ shiftEndAfternoon: v * 60 })}
                  formatValue={toHHMM}
                />
                {scheduleMismatchWarning(actionsConfig.shiftStartAfternoon, actionsConfig.shiftEndAfternoon) && (
                  <p className="text-[11px] mt-1" style={{ color: "#f59e0b" }}>
                    ⚠️ {scheduleMismatchWarning(actionsConfig.shiftStartAfternoon, actionsConfig.shiftEndAfternoon)}
                  </p>
                )}
              </div>
            </Section>

            <Section title="Granularidad de Horario" icon="📐">
              <p className="text-[11px] -mt-2 mb-1" style={{ color: "#3b82f6" }}>Aplica a Cambio de Horario y Jornadas Extendidas. HHEE no la usa: por regla de negocio siempre trabaja en horas completas.</p>
              <RangeField
                label="Paso mínimo entre horarios candidatos"
                hint="Paso mínimo entre los horarios que el motor puede proponer. En Cambio de Horario define el paso entre horarios candidatos (ej: 1h evalúa 08:00, 09:00, 10:00...). En Jornadas Extendidas define el paso del reparto de horas de extensión/devolución. No permite medias horas: el horario nuevo siempre queda en horas completas."
                value={actionsConfig.scheduleGranularityMinutes} min={60} max={120} step={60}
                onChange={v => updateConfig({ scheduleGranularityMinutes: v })}
                formatValue={v => `${v / 60}h`}
              />
            </Section>
          </div>
        </div>
      )}

      {/* ============ TAB CAMBIO DE HORARIO ============ */}
      {activeTab === "cambio" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-6">
            <Section title="Rango Operativo" icon="🔀">
              <RangeField
                label="Hora mínima de ingreso"
                hint="Ningún horario candidato puede empezar antes de esta hora. Ej: 06:00 por defecto."
                value={actionsConfig.minEntryMinutes / 60} min={0} max={12} step={0.5}
                onChange={v => updateConfig({ minEntryMinutes: v * 60 })}
                formatValue={toHHMM}
              />
              <RangeField
                label="Hora máxima de salida"
                hint="Ningún horario candidato (que no cruce medianoche) puede terminar después de esta hora. Ej: 00:00 (medianoche) por defecto."
                value={actionsConfig.maxExitMinutes / 60} min={12} max={24} step={0.5}
                onChange={v => updateConfig({ maxExitMinutes: v * 60 })}
                formatValue={toHHMM}
              />
              <ToggleField
                label="Permitir turnos de madrugada"
                hint="Habilita horarios que cruzan medianoche, ej: 21:00–06:00 o 22:00–07:00, interpretados como un turno continuo."
                value={actionsConfig.allowMadrugada}
                onChange={v => updateConfig({ allowMadrugada: v })}
              />
              {actionsConfig.allowMadrugada && (
                <div className="mt-3">
                  <label className="text-xs font-medium block mb-2" style={{ color: "#cbd5e1" }}>Turno madrugada estándar</label>
                  <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    style={{ background: "#0f172a", borderColor: "#334155", color: "#e2e8f0" }}
                    value={actionsConfig.madrugadaShiftPreset}
                    onChange={e => {
                      const preset = e.target.value as "21-06" | "22-07";
                      updateConfig({
                        madrugadaShiftPreset: preset,
                        madrugadaStartMinutes: preset === "21-06" ? 21 * 60 : 22 * 60,
                      });
                    }}
                  >
                    <option value="21-06">21:00 - 06:00</option>
                    <option value="22-07">22:00 - 07:00</option>
                  </select>
                  <p className="text-[10px] mt-1" style={{ color: "#64748b" }}>Este preset solo fija la hora de referencia desde la cual se permite cruzar medianoche (21:00 o 22:00). El motor puede proponer otros horarios de inicio dentro del rango de búsqueda configurado ("Búsqueda de Candidatos"), siempre que empiecen en o después de esa hora.</p>
                </div>
              )}
            </Section>

            <Section title="Búsqueda de Candidatos" icon="🔎">
              <RangeField
                label="Máximo desplazamiento permitido"
                hint="Cuántas horas antes o después del horario actual se evalúan como candidatos de cambio. Ej: 4h evalúa desde 4h antes hasta 4h después del horario actual."
                value={actionsConfig.maxShiftDisplacementMinutes / 60} min={0.5} max={8} step={0.5}
                onChange={v => updateConfig({ maxShiftDisplacementMinutes: v * 60 })}
                formatValue={v => `${v}h`}
              />
              <RangeField
                label="Tolerancia de deterioro por día"
                hint="Cuántos agentes-intervalo de déficit adicional se toleran en UN SOLO día antes de descartar un candidato, aunque el balance semanal total sea positivo. Ej: 0 significa que ningún día individual puede empeorar."
                value={actionsConfig.dailyDeteriorationTolerance} min={0} max={5} step={0.5}
                onChange={v => updateConfig({ dailyDeteriorationTolerance: v })}
              />
              <p className="text-[11px]" style={{ color: "#64748b" }}>El paso entre horarios candidatos (granularidad) se ajusta en la pestaña General, porque también lo usa Jornadas Extendidas.</p>
            </Section>

            <Section title="Homogeneización por Franja Horaria" icon="⚖️">
              <p className="text-[11px] -mt-2 mb-1" style={{ color: "#3b82f6" }}>
                Además de reducir el GAP total de la semana, el motor puede premiar que el GAP remanente quede repartido de forma pareja entre 3 franjas del día, en vez de mejorar mucho una y dejar otra igual de mal.
              </p>
              <ToggleField
                label="Homogenizar GAP entre franjas"
                hint="Si está activo, el motor prefiere candidatos que dejen el GAP de Mañana, Cierre y Madrugada más parejo entre sí, no solo el candidato con mayor mejora total."
                value={actionsConfig.enableZoneBalancing}
                onChange={v => updateConfig({ enableZoneBalancing: v })}
              />
              {actionsConfig.enableZoneBalancing && (
                <>
                  <div className="mb-4">
                    <p className="text-xs font-medium mb-3" style={{ color: "#cbd5e1" }}>Franja Mañana</p>
                    <RangeField
                      label="Inicio" hint="Ej: 06:00"
                      value={actionsConfig.zoneMorningStartMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneMorningStartMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                    <RangeField
                      label="Fin" hint="Ej: 14:00"
                      value={actionsConfig.zoneMorningEndMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneMorningEndMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                  </div>
                  <div className="mb-4">
                    <p className="text-xs font-medium mb-3" style={{ color: "#cbd5e1" }}>Franja Cierre</p>
                    <RangeField
                      label="Inicio" hint="Ej: 14:00"
                      value={actionsConfig.zoneClosingStartMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneClosingStartMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                    <RangeField
                      label="Fin" hint="Ej: 22:00"
                      value={actionsConfig.zoneClosingEndMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneClosingEndMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                  </div>
                  <div className="mb-2">
                    <p className="text-xs font-medium mb-3" style={{ color: "#cbd5e1" }}>Franja Madrugada</p>
                    <p className="text-[11px] mb-2" style={{ color: "#64748b" }}>Si Inicio es mayor que Fin, se interpreta como un rango que cruza medianoche (ej. 22:00 → 06:00).</p>
                    <RangeField
                      label="Inicio" hint="Ej: 22:00"
                      value={actionsConfig.zoneMadrugadaStartMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneMadrugadaStartMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                    <RangeField
                      label="Fin" hint="Ej: 06:00"
                      value={actionsConfig.zoneMadrugadaEndMinutes / 60} min={0} max={24} step={0.5}
                      onChange={v => updateConfig({ zoneMadrugadaEndMinutes: v * 60 })}
                      formatValue={toHHMM}
                    />
                  </div>
                  <RangeField
                    label="Peso de la homogeneización"
                    hint="Qué tanto pesa el balance entre franjas frente a la mejora total del GAP. 0 = no influye (igual que apagar el interruptor de arriba). Valores altos priorizan parejo-entre-franjas incluso a costa de un poco de mejora total."
                    value={actionsConfig.zoneBalancingWeight} min={0} max={100} step={5}
                    onChange={v => updateConfig({ zoneBalancingWeight: v })}
                  />
                  <p className="text-[11px] mt-1" style={{ color: "#64748b" }}>
                    Si dejas huecos entre las 3 franjas (ej. 12:00-13:00 sin asignar a ninguna), esos intervalos siguen contando para el GAP total, pero no participan del cálculo de balance entre franjas.
                  </p>
                </>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-6">
            <Section title="Alcance de Aplicación" icon="📅">
              <SelectField
                label="Días en los que se aplica el cambio"
                hint="La evaluación de GAPS siempre es semanal. Este control decide en qué días de esa semana se aplica el cambio ya seleccionado."
                value={actionsConfig.cambioApplicationScope}
                onChange={v => updateConfig({ cambioApplicationScope: v as ActionsEngineConfig["cambioApplicationScope"] })}
                options={[
                  { value: "full_week", label: "Toda la semana" },
                  { value: "weekdays", label: "Días laborales (Lunes a Viernes)" },
                  { value: "specific_days", label: "Días específicos" },
                  { value: "consecutive_days", label: "Primeros N días consecutivos" },
                  { value: "custom_pattern", label: "Patrón personalizado" },
                ]}
              />

              {actionsConfig.cambioApplicationScope === "specific_days" && (
                <div className="mb-2">
                  <p className="text-xs font-medium mb-2" style={{ color: "#cbd5e1" }}>Días seleccionados</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map(day => {
                      const active = (actionsConfig.cambioSpecificDays ?? []).includes(day);
                      return (
                        <button
                          key={day}
                          onClick={() => toggleSpecificDay(day)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium transition-all duration-150"
                          style={{
                            background: active ? "rgba(37,99,235,0.2)" : "rgba(255,255,255,0.05)",
                            color: active ? "#3b82f6" : "#94a3b8",
                            border: `1px solid ${active ? "rgba(37,99,235,0.4)" : "rgba(255,255,255,0.1)"}`,
                          }}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {actionsConfig.cambioApplicationScope === "consecutive_days" && (
                <RangeField
                  label="Cantidad de días consecutivos"
                  hint="Se aplica el cambio a los primeros N días consecutivos del período analizado."
                  value={actionsConfig.cambioConsecutiveDaysCount} min={1} max={7} step={1}
                  formatValue={v => `${v} día${v === 1 ? "" : "s"}`}
                  onChange={v => updateConfig({ cambioConsecutiveDaysCount: v })}
                />
              )}

              {actionsConfig.cambioApplicationScope === "custom_pattern" && (
                <div className="mb-2">
                  <label className="text-xs font-medium block mb-2" style={{ color: "#cbd5e1" }}>Patrón personalizado (días separados por coma)</label>
                  <input
                    type="text"
                    value={actionsConfig.cambioCustomPattern}
                    onChange={e => updateConfig({ cambioCustomPattern: e.target.value })}
                    placeholder="Ej: Lunes,Miércoles,Viernes"
                    style={inputStyle}
                  />
                  {customPatternDays.length === 0 ? (
                    <p className="text-[11px] mt-2" style={{ color: "#64748b" }}>Vacío = se aplica a todos los días operativos.</p>
                  ) : (
                    <p className="text-[11px] mt-2" style={{ color: customPatternUnrecognized.length ? "#ef4444" : "#10b981" }}>
                      {customPatternRecognized.length}/{customPatternDays.length} día{customPatternDays.length === 1 ? "" : "s"} reconocido{customPatternDays.length === 1 ? "" : "s"}
                      {customPatternRecognized.length > 0 ? `: ${customPatternRecognized.join(", ")}` : ""}
                      {customPatternUnrecognized.length > 0 && ` · No reconocido${customPatternUnrecognized.length === 1 ? "" : "s"} (revisa mayúsculas/tildes): ${customPatternUnrecognized.join(", ")}`}
                      {customPatternRecognized.length === 0 && " — con 0 días reconocidos, Cambio de Horario no generará ninguna sugerencia para este servicio/subárea."}
                    </p>
                  )}
                </div>
              )}

            </Section>
          </div>
        </div>
      )}

      {/* ============ TAB JORNADAS EXTENDIDAS ============ */}
      {activeTab === "extendida" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-6">
            <Section title="Regla de negocio (lógica corregida v2)" icon="⏱️">
              <p className="text-xs" style={{ color: "#94a3b8" }}>
                La estructura de la Jornada Extendida es fija y ya no se ajusta desde esta pantalla: siempre son <span style={{ color: "#cbd5e1", fontWeight: 600 }}>2 días</span> por semana, siempre <span style={{ color: "#cbd5e1", fontWeight: 600 }}>2 horas</span> de extensión por día. Solo el día de <span style={{ color: "#cbd5e1", fontWeight: 600 }}>mayor déficit</span> necesita tener déficit real — el segundo día completa el paquete obligatorio de 2 días aunque no tenga déficit ahí.
              </p>
              <p className="text-xs mt-2" style={{ color: "#94a3b8" }}>
                Las 4 horas acumuladas se devuelven siempre en <span style={{ color: "#cbd5e1", fontWeight: 600 }}>un único bloque continuo de 4 horas</span>, posicionado en una de las <span style={{ color: "#cbd5e1", fontWeight: 600 }}>dos mitades fijas</span> del horario principal del turno (antes del break o después del break) — nunca en un corte que caiga a caballo del break, y nunca fragmentado. Se prioriza el Sábado. Si ninguna de las 2 mitades está completamente libre en ningún día, no se genera ninguna Jornada Extendida para ese servicio/subárea/turno.
              </p>
              <p className="text-xs mt-2" style={{ color: "#94a3b8" }}>
                El número de agentes ya no sale solo del déficit del día que se extiende: también queda limitado por cuánto excedente REAL hay, en promedio, en la ventana exacta de devolución — se compromete como máximo el <span style={{ color: "#cbd5e1", fontWeight: 600 }}>80%</span> de ese promedio, dejando colchón. Si ese tope da 0 agentes, no se genera la Jornada Extendida.
              </p>
              <p className="text-xs mt-2" style={{ color: "#94a3b8" }}>
                Además, Jornadas Extendidas usa directamente estos parámetros compartidos definidos en la pestaña <span style={{ color: "#3b82f6", fontWeight: 600 }}>General</span>:
              </p>
              <ul className="text-xs mt-2 flex flex-col gap-1.5" style={{ color: "#94a3b8" }}>
                <li>• <span style={{ color: "#cbd5e1" }}>Déficit mínimo considerado</span> — decide si hay necesidad genuina para generar la extensión.</li>
                <li>• <span style={{ color: "#cbd5e1" }}>Horarios de Turno Estándar</span> — el turno mañana/tarde que se extiende siempre parte de aquí, y también define dónde caen las 2 mitades de devolución.</li>
              </ul>
              <p className="text-[11px] mt-3" style={{ color: "#f59e0b" }}>No arma una jornada nueva, solo extiende el horario estándar existente — pero SÍ depende de Jornada Laboral Estándar (pestaña General): si "Fin turno mañana/tarde" no coincide con Horas de trabajo + Horas de break, se recalcula automáticamente a partir de esa duración (ver aviso en General → Horarios de Turno Estándar).</p>
            </Section>
          </div>
          <div className="flex flex-col gap-6">
            <Section title="Parámetros internos fijos" icon="🔒">
              <p className="text-[11px] -mt-2 mb-2" style={{ color: "#f59e0b" }}>
                No editables desde esta pantalla: quedaron fijos en el código como reglas de negocio no negociables. Se muestran aquí solo como referencia.
              </p>
              <InfoRow label="Horas de extensión por día" value={`${EXTENDED_HOURS_PER_DAY}h`} />
              <InfoRow label="Días por semana con Jornada Extendida" value={`${EXTENDED_DAYS_PER_WEEK}`} />
              <InfoRow label="Bloque continuo de devolución" value={`${EXTENDED_RETURN_BLOCK_HOURS}h`} />
              <InfoRow label="Posición de la devolución" value="Antes o después del break (nunca a caballo)" />
              <InfoRow label="Día priorizado para la devolución" value={EXTENDED_PRIORITY_RETURN_DAY} />
              <InfoRow label="Utilización máxima del excedente en la devolución" value={`${EXTENDED_RETURN_UTILIZATION * 100}%`} />
            </Section>
          </div>
        </div>
      )}

      {/* ============ TAB HHEE ============ */}
      {activeTab === "hhee" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col gap-6">
            <Section title="Parámetros que sí puedes ajustar" icon="🕐">
              <p className="text-xs" style={{ color: "#94a3b8" }}>
                HHEE usa únicamente el <span style={{ color: "#3b82f6", fontWeight: 600 }}>Umbral de redondeo de agentes</span> definido en la pestaña <span style={{ color: "#3b82f6", fontWeight: 600 }}>General</span> para decidir cuántos agentes asignar por hora.
              </p>
              <p className="text-[11px] mt-3" style={{ color: "#f59e0b" }}>No usa "Déficit mínimo considerado": HHEE tiene su propio umbral fijo (ver abajo), porque es el último eslabón de la cadena y filtra sobre el déficit remanente, no sobre el déficit original.</p>
            </Section>
          </div>
          <div className="flex flex-col gap-6">
            <Section title="Parámetros internos fijos" icon="🔒">
              <p className="text-[11px] -mt-2 mb-2" style={{ color: "#f59e0b" }}>
                No editables desde esta pantalla — son reglas de negocio fijas en el código. Se muestran aquí solo como referencia.
              </p>
              <InfoRow label="Déficit mínimo para generar HHEE" value={`${HHEE_MIN_DEFICIT_AGENTS} agentes`} />
              <InfoRow label="Tolerancia de capa (sobre-cobertura)" value={`${LAYER_TOLERANCE_AGENTS} agentes`} />
              <p className="text-xs mt-4" style={{ color: "#94a3b8" }}>
                Además, por regla de negocio HHEE siempre trabaja en <span style={{ color: "#3b82f6", fontWeight: 600 }}>bloques de hora completa</span> y solo agrupa intervalos de déficit que son estrictamente consecutivos (separados por 30 minutos exactos, sin huecos). No hay un "gap de tolerancia" configurable: si hay un hueco entre dos bloques de déficit, se generan como acciones de HHEE separadas.
              </p>
            </Section>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mt-6 pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <button
          onClick={handleSaveAll}
          className="px-5 py-2 rounded text-xs font-semibold transition-all duration-150"
          style={{ background: "#2563eb", color: "#fff" }}
        >
          Guardar cambios
        </button>
        <button
          onClick={handleRestoreDefault}
          className="px-5 py-2 rounded text-xs font-semibold transition-all duration-150"
          style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Restaurar valores por defecto
        </button>
        {isDirty && !saved && (
          <span className="text-xs" style={{ color: "#f59e0b" }}>Tienes cambios sin guardar</span>
        )}
        {saved && (
          <span className="text-xs flex items-center gap-1.5" style={{ color: "#10b981" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Cambios guardados
          </span>
        )}
        {saveError && (
          <span className="text-xs flex items-center gap-1.5" style={{ color: "#ef4444" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            No se pudo guardar (almacenamiento local no disponible o sin espacio)
          </span>
        )}
      </div>
    </div>
  );
}

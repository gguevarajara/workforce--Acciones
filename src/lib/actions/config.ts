/**
 * Configuración del motor de acciones
 */

import type { ActionsEngineConfig } from "./types";

// Clave única de localStorage para la configuración del motor de Acciones.
// Definida en un solo lugar y re-exportada para que ConfigPage.tsx y
// ActionsPage.tsx (que leen/escriben el mismo config) no puedan
// desincronizarse por tener cada uno su propio literal.
export const ACTIONS_CONFIG_STORAGE_KEY = "workforce_actions_config";

// --- Jornadas Extendidas: reglas fijas de negocio (NO configurables) ---
// La lógica corregida exige una estructura rígida: siempre 2 días, siempre
// 2h por día, siempre un único bloque continuo de 4h de devolución,
// posicionado en una de las 2 mitades fijas del horario principal (antes o
// después del break). Ya no son parámetros que el usuario pueda ajustar.
export const EXTENDED_HOURS_PER_DAY = 2;
export const EXTENDED_DAYS_PER_WEEK = 2;
export const EXTENDED_RETURN_BLOCK_HOURS = EXTENDED_HOURS_PER_DAY * EXTENDED_DAYS_PER_WEEK; // 4h
// Día que se prioriza al buscar el GAP positivo continuo de devolución,
// siempre que exista disponibilidad ese día.
export const EXTENDED_PRIORITY_RETURN_DAY = "Sábado";
// Cuánto del excedente promedio disponible durante la ventana de devolución
// se puede usar realmente para pagar horas sin generar un déficit nuevo ahí
// mismo. Ej: si en esa ventana hay en promedio 11 agentes de excedente, solo
// se puede "gastar" el 80% (≈8 agentes) — el resto queda de colchón. El
// número final de agentes de la Jornada Extendida queda limitado por esto,
// no solo por el déficit del día que se extiende (ver jornadasExtendidas.ts).
export const EXTENDED_RETURN_UTILIZATION = 0.8;

export const DEFAULT_ENGINE_CONFIG: ActionsEngineConfig = {
  minDeficit: 1,
  roundingThreshold: 0.2,
  enableCambio: true,
  enableExtendida: true,
  enableHhee: true,
  coverageBase: "officials",
  workHours: 8,
  breakHours: 1,
  // Horarios de turno estándar (en minutos desde 00:00)
  shiftStartMorning: 8 * 60,    // 08:00
  shiftEndMorning: 17 * 60,      // 17:00
  shiftStartAfternoon: 11 * 60,  // 11:00
  shiftEndAfternoon: 20 * 60,    // 20:00
  // --- Configuración de Cambio de Horario ---
  minEntryMinutes: 6 * 60,       // 06:00
  maxExitMinutes: 24 * 60,       // 00:00 (medianoche)
  allowMadrugada: true,
  madrugadaStartMinutes: 21 * 60, // 21:00 (compatibilidad)
  madrugadaShiftPreset: "21-06", // Turno madrugada estándar permitido: 21:00-06:00 o 22:00-07:00
  maxShiftDisplacementMinutes: 4 * 60, // hasta 4 horas antes/después del horario actual
  scheduleGranularityMinutes: 60, // horarios en horas completas (no medias horas)
  cambioApplicationScope: "full_week",
  cambioSpecificDays: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"],
  cambioConsecutiveDaysCount: 5,
  cambioCustomPattern: "",
  dailyDeteriorationTolerance: 0,
  // Homogeneización por franja horaria: activada por defecto con 3 franjas
  // razonables de 8h cada una. El usuario puede redefinir los límites y el
  // peso desde Configuración → pestaña "Cambio de Horario".
  enableZoneBalancing: true,
  zoneMorningStartMinutes: 6 * 60,    // 06:00
  zoneMorningEndMinutes: 14 * 60,     // 14:00
  zoneClosingStartMinutes: 14 * 60,   // 14:00
  zoneClosingEndMinutes: 22 * 60,     // 22:00
  zoneMadrugadaStartMinutes: 22 * 60, // 22:00
  zoneMadrugadaEndMinutes: 6 * 60,    // 06:00 (cruza medianoche: 22:00 → 06:00)
  zoneBalancingWeight: 20,
};

/**
 * Calcula la duración total de la jornada laboral (trabajo + break)
 */
export function getTotalWorkDuration(config: ActionsEngineConfig): number {
  return config.workHours + config.breakHours;
}

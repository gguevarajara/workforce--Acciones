/**
 * Funciones auxiliares comunes
 */

import type { Row } from "../types/analysis";
import type { ActionsEngineConfig, CoverageBase, TimeZoneName } from "./types";

/**
 * Obtiene el valor de déficit de una fila según la base de cobertura configurada
 */
export function getDeficitFromRow(row: Row, coverageBase: CoverageBase): number {
  switch (coverageBase) {
    case "officials":
      return row.difOficiales;
    case "officials_hhee":
      return row.difOficialesHhee;
    case "officials_hhee_ojt":
      return row.difOficialesHheeOjt;
    default:
      return row.difOficiales;
  }
}

/**
 * Obtiene la columna de "disponibilidad" de una fila según la base de cobertura
 * configurada. Es el complemento de `getDeficitFromRow`: ambas deben usar
 * SIEMPRE la misma base, para que déficit (negativo) y excedente/GAP positivo
 * (disponibilidad - requerido) sean consistentes entre sí. Se usa en
 * `compensation.ts` para calcular el excedente que financia las devoluciones
 * de Jornada Extendida con la misma base que el déficit que originó la
 * extensión.
 */
export function getAvailableFromRow(row: Row, coverageBase: CoverageBase): number {
  switch (coverageBase) {
    case "officials":
      return row.dispOficiales;
    case "officials_hhee":
      return row.dispOficialesHhee;
    case "officials_hhee_ojt":
      return row.dispOficialesHheeOjt;
    default:
      return row.dispOficiales;
  }
}

/**
 * Redondea el número de agentes según el umbral configurado
 */
export function roundAgents(raw: number, threshold: number): number {
  const frac = raw - Math.floor(raw);
  const tolerance = 0.0001;
  const rounded = frac > threshold + tolerance ? Math.ceil(raw) : Math.floor(raw);
  return Math.max(1, rounded);
}

/**
 * Convierte hora en formato HH:MM a minutos desde medianoche
 */
export function toMinutes(hhmm: string): number {
  if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) {
    return 0;
  }
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) {
    return 0;
  }
  return h * 60 + (m || 0);
}

/**
 * Convierte minutos desde medianoche a formato HH:MM.
 *
 * Los minutos de entrada pueden venir con decimales (ej. 102.857142857142)
 * porque cálculos como el reparto equitativo de horas de Jornada Extendida
 * dividen horas entre varios días (12h / 7 = 1.7142857...h). Se redondea al
 * minuto entero más cercano ANTES de formatear — los cálculos internos en
 * decimales no se tocan, solo la representación final "HH:MM".
 */
export function toHHMM(mins: number): string {
  const rounded = Math.round(mins);
  // Caso especial: 1440 minutos = 24:00 (medianoche), no 00:00
  if (rounded === 1440) {
    return "24:00";
  }
  const wrapped = ((rounded % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Indica si `minute` (0-1439) cae dentro del rango [start, end).
 * Soporta rangos que cruzan medianoche (start > end), ej. 22:00→06:00:
 * el minuto pertenece al rango si es >= start (22:00-23:59) O < end (00:00-05:59).
 */
function minuteInRange(minute: number, start: number, end: number): boolean {
  if (start === end) return false; // rango de duración cero: nunca aplica
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/**
 * Clasifica un minuto del día (0-1439) en una de las 3 franjas horarias
 * configurables (mañana / cierre / madrugada) usadas por Cambio de Horario
 * para homogeneizar el GAP entre franjas, en vez de solo minimizar el total.
 *
 * Orden de evaluación: madrugada primero (es la que más probablemente cruza
 * medianoche), luego mañana, luego cierre. Si las franjas configuradas se
 * solapan, la primera que matchee gana. Si un minuto no cae en ninguna,
 * devuelve "none" — sigue sumando al déficit/excedente total, pero no
 * participa del cálculo de balance entre franjas.
 */
export function classifyTimeZone(minute: number, config: ActionsEngineConfig): TimeZoneName {
  const m = ((minute % 1440) + 1440) % 1440;
  if (minuteInRange(m, config.zoneMadrugadaStartMinutes, config.zoneMadrugadaEndMinutes)) return "madrugada";
  if (minuteInRange(m, config.zoneMorningStartMinutes, config.zoneMorningEndMinutes)) return "morning";
  if (minuteInRange(m, config.zoneClosingStartMinutes, config.zoneClosingEndMinutes)) return "closing";
  return "none";
}

/**
 * Agrupa elementos por una clave
 */
export function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

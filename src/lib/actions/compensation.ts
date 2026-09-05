/**
 * Compensación semanal para Jornadas Extendidas.
 *
 * Regla: una extensión solo se puede proponer si existe, en la misma semana,
 * un volumen equivalente de GAP positivo que pueda devolverse dentro del
 * horario principal del agente.
 *
 * IMPORTANTE — dos correcciones respecto a la versión anterior:
 *
 * 1) Bolsa ÚNICA y COMPARTIDA por servicio/subárea (no una bolsa separada por
 *    turno). Las ventanas de turno mañana (08:00-17:00) y tarde (11:00-20:00)
 *    se solapan (11:00-17:00): las mismas horas de excedente NO pueden
 *    ofrecerse como devolución a un agente de mañana y, por separado, a uno
 *    de tarde — es el mismo personal excedente. `consumeCompensation`
 *    descuenta la bolsa compartida en cuanto se usa, sin importar qué turno
 *    la consumió primero (ver jornadasExtendidas.ts, que procesa mañana y
 *    tarde en orden fijo sobre la MISMA instancia de `blocks`).
 *
 * 2) El excedente se calcula descontando lo que Cambio de Horario ya haya
 *    consumido de ese mismo intervalo al mover cobertura hacia un déficit
 *    (`surplusLedger`, poblado por cambioHorario.ts). Sin este descuento, el
 *    excedente se leía siempre de los datos originales y podía ofrecerse
 *    como devolución dos veces: una implícita (ya usada por Cambio de
 *    Horario) y otra explícita (ofrecida aquí).
 *
 * 3) El excedente se calcula con la MISMA Base de Cobertura (`coverageBase`)
 *    que el déficit (ver `getAvailableFromRow` en utils.ts), en vez de la
 *    columna "Oficiales" fija. Antes de esta corrección, el déficit que
 *    dispara una Jornada Extendida respetaba `coverageBase`, pero el
 *    excedente que la financia siempre se leía de "Oficiales" — dos partes
 *    del mismo cálculo usando bases distintas.
 */

import type { Row } from "../types/analysis";
import type { ActionsEngineConfig, SurplusLedger } from "./types";
import { getPrincipalSchedule, type ShiftType } from "./scheduleCalculator";
import { FULL_DAY_OFF_HOURS } from "./config";
import { getAvailableFromRow, toHHMM, toMinutes } from "./utils";

export interface CompensationRange {
  start: number;
  end: number;
}

/** Bloque de excedente semanal: bolsa única compartida entre turnos. */
export interface CompensationBlock {
  day: string;
  /** Fecha real (ISO, yyyy-mm-dd) del bloque. Se usa para identificar el
   * bloque de forma inequívoca: `day` es solo la etiqueta ("Lunes") y no
   * alcanza si el archivo cargado cubre más de una semana (dos "Lunes"
   * distintos no deben mezclarse en el mismo bloque de excedente). */
  fechaSort: string;
  totalHours: number;
  /** Sub-rangos aún no comprometidos como devolución. Se fragmenta al consumirse. */
  remaining: CompensationRange[];
}

export interface WeeklyCompensationPlan {
  totalAvailableHours: number;
  blocks: CompensationBlock[];
}

export interface ConsumedCompensation {
  day: string;
  start: string;
  end: string;
  hours: number;
  isFullDayOff: boolean;
}

/**
 * Bloques de horas permitidos para una devolución. Nunca se debe devolver
 * una cantidad de horas seguidas que no sea una de estas (ej. 6h NO es
 * válido: debe salir como 4h, y el resto queda sin devolver ese día).
 * Orden descendente: siempre se prioriza el bloque más grande que quepa.
 */
export const ALLOWED_COMPENSATION_BLOCK_HOURS = [8, 4, 2] as const;

/** Minutos del mayor bloque permitido que cabe en `minutes` (0 si no cabe ni el menor). */
function pickAllowedMinutes(minutes: number): number {
  for (const h of ALLOWED_COMPENSATION_BLOCK_HOURS) {
    if (minutes >= h * 60 - 0.001) return h * 60;
  }
  return 0;
}

/**
 * Unifica devoluciones de un mismo día que son contiguas en el tiempo (ej.
 * 11:00-13:00 + 13:00-15:00 → una sola de 11:00-15:00) en vez de mostrarlas
 * como tramos separados, y recorta el resultado al mayor bloque permitido
 * (`ALLOWED_COMPENSATION_BLOCK_HOURS`) si la unión da una cantidad de horas
 * no permitida (ej. 3×2h contiguas = 6h → se muestran solo 4h; el resto no
 * se le devuelve a todos los agentes ese día, de ahí el flag `capped`).
 *
 * Los días completos (`isFullDayOff`) no se fusionan por horario: se listan
 * aparte, una vez por día (8h ya es un bloque permitido).
 */
export function mergeAndCapCompensation(
  entries: ConsumedCompensation[]
): { text: string; capped: boolean; realHours: number; shownHours: number } {
  if (!entries.length) return { text: "Sin devolución disponible", capped: false, realHours: 0, shownHours: 0 };

  const fullDayEntries = entries.filter(e => e.isFullDayOff);
  const timedEntries = entries.filter(e => !e.isFullDayOff);

  const parts: string[] = [];
  let capped = false;
  let realMinutes = 0;
  let shownMinutes = 0;

  const seenFullDays = new Set<string>();
  for (const e of fullDayEntries) {
    realMinutes += e.hours * 60;
    if (seenFullDays.has(e.day)) continue;
    seenFullDays.add(e.day);
    parts.push(`${e.day} (Día libre)`);
    shownMinutes += e.hours * 60;
  }

  const byDay = new Map<string, ConsumedCompensation[]>();
  for (const e of timedEntries) {
    const arr = byDay.get(e.day) ?? [];
    arr.push(e);
    byDay.set(e.day, arr);
  }

  for (const [day, dayEntries] of byDay) {
    const sorted = [...dayEntries].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    // Fusiona tramos contiguos/solapados del mismo día en rangos únicos.
    const merged: { start: number; end: number }[] = [];
    for (const e of sorted) {
      const start = toMinutes(e.start);
      const end = toMinutes(e.end);
      const last = merged[merged.length - 1];
      if (last && start <= last.end + 0.001) {
        last.end = Math.max(last.end, end);
      } else {
        merged.push({ start, end });
      }
    }

    for (const range of merged) {
      const durationMin = range.end - range.start;
      realMinutes += durationMin;
      const allowedMin = pickAllowedMinutes(durationMin);
      if (allowedMin <= 0) {
        // No alcanza ni el bloque mínimo permitido (2h): se muestra tal
        // cual para no ocultar la devolución (no debería pasar si
        // consumeCompensation ya restringe cada toma a bloques permitidos).
        parts.push(`${day} (${toHHMM(range.start)}-${toHHMM(range.end)})`);
        shownMinutes += durationMin;
        continue;
      }
      if (allowedMin < durationMin - 0.001) capped = true;
      parts.push(`${day} (${toHHMM(range.start)}-${toHHMM(range.start + allowedMin)})`);
      shownMinutes += allowedMin;
    }
  }

  return {
    text: parts.length ? parts.join(", ") : "Sin devolución disponible",
    capped,
    realHours: realMinutes / 60,
    shownHours: shownMinutes / 60,
  };
}

interface RawPositiveBlock {
  day: string;
  fechaSort: string;
  start: number;
  end: number;
}

/**
 * Excedente neto de una fila, descontando lo que Cambio de Horario ya haya
 * consumido de ese mismo intervalo (servicio/subárea/día/hora).
 *
 * Usa `coverageBase` para leer la misma columna de disponibilidad que se usó
 * para calcular el déficit (ver `getAvailableFromRow`), en vez de asumir
 * siempre "Oficiales".
 */
function getNetSurplusForRow(
  row: Row,
  coverageBase: ActionsEngineConfig["coverageBase"],
  surplusLedger: SurplusLedger | undefined
): number {
  const rawSurplus = getAvailableFromRow(row, coverageBase) - row.dispRequerido;
  if (rawSurplus <= 0 || !surplusLedger) return rawSurplus;

  const key = `${row.servicio}|${row.subarea}|${row.fechaSort}`;
  const entries = surplusLedger.get(key);
  if (!entries || !entries.length) return rawSurplus;

  const rowStart = toMinutes(row.hora);
  let consumed = 0;
  for (const entry of entries) {
    if (entry.startMin === rowStart) consumed += entry.consumedAgents;
  }

  return Math.max(0, rawSurplus - consumed);
}

function getPositiveBlocks(
  rows: Row[],
  coverageBase: ActionsEngineConfig["coverageBase"],
  surplusLedger: SurplusLedger | undefined
): RawPositiveBlock[] {
  const blocks: RawPositiveBlock[] = [];

  // Se itera por fecha real (fechaSort), no por nombre de día: si el archivo
  // cargado cubriera más de una semana, dos "Lunes" distintos son fechas
  // distintas y no deben compartir la misma bolsa de excedente.
  const dateKeys = Array.from(new Set(rows.map(r => r.fechaSort))).sort();

  for (const fechaSort of dateKeys) {
    const dayRows = rows
      .filter(r => r.fechaSort === fechaSort && getNetSurplusForRow(r, coverageBase, surplusLedger) > 0)
      .sort((a, b) => toMinutes(a.hora) - toMinutes(b.hora));

    if (!dayRows.length) continue;

    const day = dayRows[0].dia;

    let blockStart = toMinutes(dayRows[0].hora);
    let previous = blockStart;

    for (let i = 1; i < dayRows.length; i++) {
      const current = toMinutes(dayRows[i].hora);
      if (current - previous !== 30) {
        blocks.push({ day, fechaSort, start: blockStart, end: previous + 30 });
        blockStart = current;
      }
      previous = current;
    }

    blocks.push({ day, fechaSort, start: blockStart, end: previous + 30 });
  }

  return blocks;
}

function intersectRange(a: CompensationRange, b: CompensationRange): CompensationRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

function remainingMinutesOf(block: CompensationBlock): number {
  return block.remaining.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/**
 * Identifica primero TODOS los gaps positivos de la semana (ya descontado lo
 * consumido por Cambio de Horario) y arma la bolsa ÚNICA compartida.
 */
export function calculateWeeklyCompensationPlan(
  servicio: string,
  subarea: string,
  serviceRows: Row[],
  config: ActionsEngineConfig,
  surplusLedger?: SurplusLedger
): WeeklyCompensationPlan | null {
  const rows = serviceRows.filter(r => r.servicio === servicio && r.subarea === subarea);
  const positiveBlocks = getPositiveBlocks(rows, config.coverageBase, surplusLedger);
  if (!positiveBlocks.length) return null;

  const blocks: CompensationBlock[] = positiveBlocks.map(b => ({
    day: b.day,
    fechaSort: b.fechaSort,
    totalHours: (b.end - b.start) / 60,
    remaining: [{ start: b.start, end: b.end }],
  }));

  const totalAvailableHours = blocks.reduce((sum, b) => sum + b.totalHours, 0);
  if (totalAvailableHours <= 0) return null;

  return { totalAvailableHours, blocks };
}

/**
 * Horas de la bolsa compartida que HOY siguen siendo utilizables por el
 * turno indicado (intersección con su horario principal). Se recalcula
 * sobre el estado ACTUAL de `blocks`: si el turno mañana ya consumió parte
 * del solape 11:00-17:00, el turno tarde ve automáticamente menos horas
 * disponibles (y viceversa) — así se evita el doble conteo entre turnos.
 */
export function availableHoursForShift(
  blocks: CompensationBlock[],
  shiftType: ShiftType,
  config: ActionsEngineConfig
): number {
  const schedule = getPrincipalSchedule(shiftType, config);
  let total = 0;
  for (const block of blocks) {
    for (const range of block.remaining) {
      const overlap = intersectRange(range, schedule);
      if (overlap) total += (overlap.end - overlap.start) / 60;
    }
  }
  return total;
}

/**
 * Consume horas de la bolsa COMPARTIDA para devolver `neededHours` a un
 * agente del turno `shiftType`, respetando su horario principal y evitando
 * devolver la misma fecha que se extiende (`excludeFechaSort`). Modifica `blocks`
 * IN-PLACE: lo consumido aquí deja de estar disponible para cualquier otra
 * devolución, sea del mismo turno o del turno contrario.
 *
 * Prioriza los bloques con más excedente remanente primero, para preferir
 * consolidar la devolución en la menor cantidad de días posible (regla del
 * documento: preferir 4 u 8 horas seguidas en vez de fragmentar en muchos
 * días pequeños).
 */
export function consumeCompensation(
  blocks: CompensationBlock[],
  shiftType: ShiftType,
  config: ActionsEngineConfig,
  neededHours: number,
  excludeFechaSort: string
): ConsumedCompensation[] {
  const schedule = getPrincipalSchedule(shiftType, config);
  const consumed: ConsumedCompensation[] = [];
  let remainingNeeded = neededHours * 60;

  const sortedBlocks = [...blocks].sort((a, b) => remainingMinutesOf(b) - remainingMinutesOf(a));

  for (const block of sortedBlocks) {
    if (remainingNeeded <= 0.001) break;
    if (block.fechaSort === excludeFechaSort) continue;

    const beforeMinutes = remainingMinutesOf(block);
    const blockConsumedRanges: CompensationRange[] = [];

    for (let i = 0; i < block.remaining.length && remainingNeeded > 0.001; i++) {
      const range = block.remaining[i];
      const overlap = intersectRange(range, schedule);
      if (!overlap) continue;

      const take = pickAllowedMinutes(Math.min(remainingNeeded, overlap.end - overlap.start));
      if (take <= 0.001) continue;

      const consumeStart = overlap.start;
      const consumeEnd = overlap.start + take;

      // Fragmentar el rango: lo que queda antes y después de lo consumido.
      const leftovers: CompensationRange[] = [];
      if (range.start < consumeStart) leftovers.push({ start: range.start, end: consumeStart });
      if (consumeEnd < range.end) leftovers.push({ start: consumeEnd, end: range.end });
      block.remaining.splice(i, 1, ...leftovers);
      i += leftovers.length - 1; // reacomodar el índice tras la fragmentación

      blockConsumedRanges.push({ start: consumeStart, end: consumeEnd });
      remainingNeeded -= take;
    }

    if (!blockConsumedRanges.length) continue;

    const blockTakenMinutes = blockConsumedRanges.reduce((s, r) => s + (r.end - r.start), 0);
    const isFullDayOff =
      block.totalHours >= FULL_DAY_OFF_HOURS &&
      remainingMinutesOf(block) <= 0.001 &&
      blockTakenMinutes >= beforeMinutes - 0.001;

    if (isFullDayOff) {
      consumed.push({
        day: block.day,
        start: toHHMM(blockConsumedRanges[0].start),
        end: toHHMM(blockConsumedRanges[blockConsumedRanges.length - 1].end),
        hours: blockTakenMinutes / 60,
        isFullDayOff: true,
      });
    } else {
      for (const r of blockConsumedRanges) {
        consumed.push({
          day: block.day,
          start: toHHMM(r.start),
          end: toHHMM(r.end),
          hours: (r.end - r.start) / 60,
          isFullDayOff: false,
        });
      }
    }
  }

  return consumed;
}

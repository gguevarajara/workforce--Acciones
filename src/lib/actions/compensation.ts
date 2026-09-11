/**
 * Bolsa semanal de excedente (GAP POSITIVO) para financiar Jornadas Extendidas.
 *
 * LÓGICA CORREGIDA (ver documento de lógica de Jornadas Extendidas):
 *
 * 1) Bolsa ÚNICA y COMPARTIDA por servicio/subárea (no una bolsa separada por
 *    turno). Las ventanas de turno mañana (08:00-17:00) y tarde (11:00-20:00)
 *    se solapan (11:00-17:00): las mismas horas de excedente NO pueden
 *    ofrecerse como devolución a un agente de mañana y, por separado, a uno
 *    de tarde — es el mismo personal excedente. `consumeReturnBlock`
 *    descuenta la bolsa compartida en cuanto se usa, sin importar qué turno
 *    la consumió primero (ver jornadasExtendidas.ts, que procesa mañana y
 *    tarde en orden fijo sobre la MISMA instancia de `blocks`).
 *
 * 2) El excedente se calcula descontando lo que Cambio de Horario ya haya
 *    consumido de ese mismo intervalo al mover cobertura hacia un déficit
 *    (`surplusLedger`, poblado por cambioHorario.ts). Sin este descuento, el
 *    excedente se leía siempre de los datos originales y podía ofrecerse
 *    como devolución dos veces.
 *
 * 3) El excedente se calcula con la MISMA Base de Cobertura (`coverageBase`)
 *    que el déficit (ver `getAvailableFromRow` en utils.ts).
 *
 * 4) LA DEVOLUCIÓN YA NO SE FRAGMENTA. La regla corregida exige que las 4
 *    horas acumuladas (2 días × 2h) se devuelvan en UN ÚNICO bloque continuo
 *    de exactamente `EXTENDED_RETURN_BLOCK_HOURS` horas, dentro del horario
 *    principal del turno, priorizando el Sábado. Si ese bloque continuo no
 *    existe, no hay devolución posible y, por regla de negocio, tampoco debe
 *    generarse la Jornada Extendida (ver jornadasExtendidas.ts).
 */

import type { Row } from "../types/analysis";
import type { ActionsEngineConfig, SurplusLedger } from "./types";
import { getPrincipalSchedule, type ShiftType } from "./scheduleCalculator";
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

/** Devolución continua consumida de la bolsa compartida (siempre UN único
 *  tramo, nunca fragmentado — ver regla del bloque continuo de 4h). */
export interface ConsumedCompensation {
  day: string;
  fechaSort: string;
  start: string;
  end: string;
  hours: number;
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

/**
 * Arma los bloques CONTINUOS de excedente positivo de cada día (se corta el
 * bloque en cuanto aparece un intervalo de 30' sin excedente neto). Esta es
 * la base sobre la que luego se busca el GAP positivo continuo de 4h (ver
 * `findContinuousReturnBlock`): un bloque nunca puede ser más largo de lo
 * que realmente es continuo en los datos.
 */
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

// (fin de utilidades geométricas de rango — la búsqueda de devolución ya no
// necesita intersección arbitraria: solo comprueba si una ventana fija cabe
// completa dentro de un remanente, ver findContinuousReturnBlock más abajo)

/**
 * Identifica primero TODOS los gaps positivos continuos de la semana (ya
 * descontado lo consumido por Cambio de Horario) y arma la bolsa ÚNICA
 * compartida. No aplica ninguna regla de tamaño de bloque acá: eso lo decide
 * `findContinuousReturnBlock` en el momento de buscar devolución.
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

export interface ContinuousReturnWindow {
  fechaSort: string;
  day: string;
  start: number;
  end: number;
}

/**
 * Las dos únicas posiciones válidas para la devolución dentro del horario
 * principal de un turno: la primera mitad (antes del break) o la segunda
 * mitad (después del break). No se admite ningún otro corte.
 *
 * Ej: horario 08:00-17:00 (break de por medio) → [08:00-12:00, 13:00-17:00].
 * Ej: horario 09:00-18:00 → [09:00-13:00, 14:00-18:00].
 * Ej: horario 11:00-20:00 → [11:00-15:00, 16:00-20:00].
 *
 * El hueco entre ambas mitades queda siempre disponible para que el agente
 * gestione — es donde cae su break — y nunca se ofrece como devolución.
 */
export function getReturnHalfWindows(
  shiftType: ShiftType,
  config: ActionsEngineConfig,
  requiredHours: number
): [CompensationRange, CompensationRange] {
  const schedule = getPrincipalSchedule(shiftType, config);
  const blockMin = requiredHours * 60;
  return [
    { start: schedule.start, end: schedule.start + blockMin },
    { start: schedule.end - blockMin, end: schedule.end },
  ];
}

/**
 * Busca, dentro de la bolsa compartida de excedente semanal, cuál de las DOS
 * ventanas fijas de devolución (`getReturnHalfWindows`: primera mitad o
 * segunda mitad del horario principal, separadas por el break) está
 * COMPLETAMENTE disponible — ni un minuto de esa ventana puede tener
 * déficit. No se acepta ningún otro corte de 4h: la devolución nunca cae,
 * por ejemplo, a caballo del break.
 *
 * Prioriza el día `priorityDay` (Sábado): si Sábado tiene alguna de las dos
 * ventanas completamente libre, se usa esa sin mirar el resto de la semana
 * (se prefiere la primera mitad si ambas están libres). Si el Sábado no
 * alcanza, se evalúan los demás días en orden de fecha y se toma la primera
 * ventana que califique.
 *
 * `excludeFechaSorts` excluye los días que están siendo extendidos: un día
 * no puede ser, a la vez, uno de los 2 días con Jornada Extendida y el día
 * de devolución de esa misma extensión.
 *
 * Devuelve la ventana EXACTA a consumir (siempre una de las dos fijas), o
 * `null` si ningún día tiene ninguna de las dos completamente libre — en
 * cuyo caso, por regla de negocio, no debe generarse la Jornada Extendida.
 */
export function findContinuousReturnBlock(
  blocks: CompensationBlock[],
  shiftType: ShiftType,
  config: ActionsEngineConfig,
  requiredHours: number,
  priorityDay: string,
  excludeFechaSorts: Set<string>
): ContinuousReturnWindow | null {
  const halves = getReturnHalfWindows(shiftType, config, requiredHours);

  interface Candidate extends ContinuousReturnWindow {
    halfIndex: number;
  }
  const candidates: Candidate[] = [];

  for (const block of blocks) {
    if (excludeFechaSorts.has(block.fechaSort)) continue;

    for (let halfIndex = 0; halfIndex < halves.length; halfIndex++) {
      const half = halves[halfIndex];
      // La ventana fija debe caer ENTERA dentro de un único sub-rango
      // remanente: no se admite que una parte de la ventana tenga déficit.
      const fits = block.remaining.some(r => r.start <= half.start + 0.001 && r.end >= half.end - 0.001);
      if (!fits) continue;

      candidates.push({ fechaSort: block.fechaSort, day: block.day, start: half.start, end: half.end, halfIndex });
    }
  }

  if (!candidates.length) return null;

  const onPriorityDay = candidates.filter(c => c.day === priorityDay);
  const pool = onPriorityDay.length ? onPriorityDay : candidates;

  // Determinista: se prefiere la primera mitad sobre la segunda; a igualdad,
  // la fecha más temprana.
  pool.sort((a, b) => a.halfIndex - b.halfIndex || a.fechaSort.localeCompare(b.fechaSort));

  const { fechaSort, day, start, end } = pool[0];
  return { fechaSort, day, start, end };
}

/**
 * Consume EXACTAMENTE el rango [start,end) del día `fechaSort` de la bolsa
 * compartida (in-place). Se usa siempre sobre una ventana ya validada por
 * `findContinuousReturnBlock`, así que el rango buscado siempre debe caer
 * dentro de un único sub-rango de `block.remaining` sin fragmentarse en
 * varios — si por algún motivo no calza (estado inconsistente), no se
 * consume nada y se devuelve `null` en vez de fragmentar la devolución.
 */
export function consumeReturnBlock(
  blocks: CompensationBlock[],
  fechaSort: string,
  start: number,
  end: number
): ConsumedCompensation | null {
  // OJO: un mismo día puede tener VARIOS bloques de excedente disjuntos (ej.
  // un excedente breve a primera hora y otro grande más tarde, separados por
  // un tramo con déficit en el medio). No alcanza con matchear por
  // `fechaSort`: hay que ubicar el bloque específico cuyo remanente contiene
  // efectivamente el rango [start,end) — si se toma "el primero de esa
  // fecha" a secas, se puede agarrar un bloque que ni siquiera cubre la
  // ventana, y la devolución termina descartándose por error.
  const block = blocks.find(
    b => b.fechaSort === fechaSort && b.remaining.some(r => r.start <= start + 0.001 && r.end >= end - 0.001)
  );
  if (!block) return null;

  const idx = block.remaining.findIndex(r => r.start <= start + 0.001 && r.end >= end - 0.001);
  if (idx === -1) return null;

  const range = block.remaining[idx];
  const leftovers: CompensationRange[] = [];
  if (range.start < start) leftovers.push({ start: range.start, end: start });
  if (end < range.end) leftovers.push({ start: end, end: range.end });
  block.remaining.splice(idx, 1, ...leftovers);

  return {
    day: block.day,
    fechaSort,
    start: toHHMM(start),
    end: toHHMM(end),
    hours: (end - start) / 60,
  };
}

/** Texto legible de una devolución continua ya consumida, ej. "Sábado (12:00-16:00)". */
export function formatReturnBlock(consumed: ConsumedCompensation): string {
  return `${consumed.day} (${consumed.start}-${consumed.end})`;
}

/**
 * Cuántos agentes, en promedio, sobran REALMENTE durante una ventana exacta
 * (ej. la ventana de devolución ya encontrada) — neto de lo que Cambio de
 * Horario ya haya consumido de esos mismos intervalos.
 *
 * `findContinuousReturnBlock` solo garantiza que la ventana está libre de
 * déficit (una condición binaria: ningún intervalo en negativo). Pero eso no
 * dice CUÁNTOS agentes puede realmente absorber esa ventana sin quedar en
 * déficit — si el excedente ahí es de apenas 2 agentes en promedio, no se
 * puede prometer una Jornada Extendida de 17 agentes solo porque la ventana
 * "está libre". Este promedio es la base para ese tope real (ver
 * `EXTENDED_RETURN_UTILIZATION` en config.ts y su uso en jornadasExtendidas.ts).
 */
export function getAverageAvailableAgents(
  servicio: string,
  subarea: string,
  serviceRows: Row[],
  fechaSort: string,
  startMin: number,
  endMin: number,
  coverageBase: ActionsEngineConfig["coverageBase"],
  surplusLedger?: SurplusLedger
): number {
  const rows = serviceRows.filter(
    r => r.servicio === servicio &&
         r.subarea === subarea &&
         r.fechaSort === fechaSort &&
         toMinutes(r.hora) >= startMin &&
         toMinutes(r.hora) < endMin
  );
  if (!rows.length) return 0;

  const total = rows.reduce((sum, r) => sum + Math.max(0, getNetSurplusForRow(r, coverageBase, surplusLedger)), 0);
  return total / rows.length;
}

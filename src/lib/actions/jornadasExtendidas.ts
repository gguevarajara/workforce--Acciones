/**
 * Generación de Jornadas Extendidas — LÓGICA CORREGIDA (v2).
 *
 * Regla principal (no negociable): las Jornadas Extendidas se realizan
 * SIEMPRE en exactamente 2 días de la semana, con exactamente 2 horas de
 * extensión por día (4h acumuladas), y esas 4h se devuelven SIEMPRE en un
 * único bloque continuo de 4h, posicionado en UNA DE LAS DOS mitades fijas
 * del horario principal del turno (antes o después del break — nunca a
 * caballo del break, nunca en un corte arbitrario), priorizando el Sábado.
 * Si esa devolución no existe, no se genera ninguna Jornada Extendida.
 *
 * CAMBIO CLAVE v2 — los 2 días NO tienen que tener déficit los dos:
 * Alcanza con que UNO de los dos días tenga déficit real cerca del borde
 * que se va a extender. El segundo día se completa igual (aunque no tenga
 * déficit ahí) porque la regla de negocio exige el paquete de 2 días — el
 * segundo día se elige simplemente por ser el siguiente en la misma
 * prioridad (mismo criterio de "mayor déficit", que en su caso puede ser 0).
 * La devolución, en cualquier caso, solo se paga donde de verdad hay GAP
 * disponible (nunca se inventa disponibilidad).
 *
 * CAMBIO CLAVE v3 — el número de agentes lo limita la CAPACIDAD REAL de
 * devolución, no solo el déficit del día que se extiende:
 * Antes, `agents` salía únicamente del déficit del día de mayor necesidad
 * (cuántos agentes hacen falta ahí). Pero que la ventana de devolución esté
 * "libre de déficit" no dice cuánto excedente REAL tiene — puede estar
 * apenas en positivo. Si esa ventana solo sostiene, en promedio, un puñado
 * de agentes de excedente, prometer una Jornada Extendida para muchos más
 * agentes generaría un déficit nuevo justo en la devolución. Por eso ahora
 * se calcula también el promedio de excedente neto en la ventana exacta de
 * devolución y se usa como TOPE, aplicando el margen de seguridad
 * `EXTENDED_RETURN_UTILIZATION` (80%: de ese promedio, solo se compromete
 * el 80%, el resto queda de colchón). `agents` final = mínimo entre lo que
 * hace falta y lo que la devolución puede realmente sostener. Si ese tope
 * da 0, no se genera la Jornada Extendida (no hay con qué pagarla).
 *
 * ORDEN OBLIGATORIO:
 *  1) Horario principal de cada turno (mañana/tarde).
 *  2) Para cada turno, calcular el déficit de CADA día de la semana
 *     específicamente en la ventana de 2h que esa extensión cubriría
 *     (justo antes del inicio del turno tarde, o justo después del fin
 *     del turno mañana) — no el déficit del día completo.
 *  3) Ordenar TODOS los días (con y sin déficit) según ese nivel de déficit.
 *  4) Exigir que el día de mayor déficit tenga déficit real (> minDeficit);
 *     si no, no hay necesidad genuina y no se genera nada para este turno.
 *  5) Buscar si alguna de las 2 mitades fijas de devolución está
 *     COMPLETAMENTE libre en algún día (priorizando Sábado), excluyendo los
 *     2 días que se van a extender.
 *  6) Si no existe esa devolución → NO se genera Jornada Extendida.
 *  7) Si existe, se seleccionan los 2 días con mayor déficit (el de mayor
 *     déficit real + el siguiente en la lista, tenga o no déficit).
 *  8) Se calcula el promedio de excedente neto real en esa ventana y se
 *     aplica el tope de capacidad (80% de ese promedio). Si el tope es 0,
 *     no se genera nada.
 *  9) Se genera una extensión de 2h en cada uno de esos 2 días, para
 *     min(agentes que hacen falta, tope de capacidad) agentes.
 * 10) Se acumulan exactamente 4h, devueltas en la ventana fija encontrada.
 *
 * Se procesa turno mañana antes que turno tarde para que, si hay solape de
 * horario principal entre ambos (11:00-17:00), la bolsa compartida se
 * consuma de forma determinista y sin doble conteo.
 */

import type { Row } from "../types/analysis";
import type { ActionSuggestion, ActionsEngineConfig, DeficitSlot, SurplusLedger } from "./types";
import { EXTENDED_DAYS_PER_WEEK, EXTENDED_HOURS_PER_DAY, EXTENDED_PRIORITY_RETURN_DAY, EXTENDED_RETURN_BLOCK_HOURS, EXTENDED_RETURN_UTILIZATION } from "./config";
import {
  calculateWeeklyCompensationPlan,
  findContinuousReturnBlock,
  consumeReturnBlock,
  getReturnHalfWindows,
  getAverageAvailableAgents,
  type WeeklyCompensationPlan,
} from "./compensation";
import { applyCoverage } from "./deficitMatrix";
import { getPrincipalSchedule, calculateExtendedSchedule, type ShiftType } from "./scheduleCalculator";
import { groupBy, roundAgents, toHHMM } from "./utils";

/** Un día de la semana evaluado para un turno: puede tener déficit real
 *  (`edgeDeficit > 0`) o no (candidato "de relleno" para completar el
 *  paquete obligatorio de 2 días). */
interface DayCandidate {
  fechaSort: string;
  fecha: string;
  dia: string;
  shiftType: ShiftType;
  edgeDeficit: number;
  edgeIntervalCount: number;
}

/** Orden fijo de procesamiento: mañana primero, para que si hay solape con el
 *  horario de tarde (11:00-17:00), la primera en consumir la bolsa compartida
 *  sea siempre la misma (procesamiento determinista, sin doble conteo). */
const SHIFT_PROCESSING_ORDER: ShiftType[] = ["morning", "afternoon"];

const DAY_ORDER = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Déficit de un día ESPECÍFICAMENTE en la ventana de 2h que la extensión de
 * este turno cubriría:
 *  - turno tarde (se extiende el INICIO): ventana [afternoon.start - 2h, afternoon.start].
 *  - turno mañana (se extiende el FIN): ventana [morning.end, morning.end + 2h].
 *
 * Antes se usaba el déficit máximo de TODO el día como proxy de "borde",
 * detectado con una ventana dinámica ligada al horario operativo del día.
 * Eso producía dos problemas reales:
 *  1) Si el déficit ocupaba el día completo (frecuente en servicios con
 *     mucho volumen), ambos "bordes" quedaban con el mismo déficit inflado,
 *     y turno mañana y turno tarde terminaban eligiendo exactamente los
 *     mismos 2 días — dejando fuera de cualquier análisis servicios cuyo
 *     verdadero problema estaba en otro borde.
 *  2) Un día sin déficit quedaba totalmente excluido de la lista de
 *     candidatos, así que si solo había 1 día con déficit real, la regla
 *     de "siempre 2 días" no se podía cumplir nunca.
 *
 * Con la ventana fija y exacta (igual a EXTENDED_HOURS_PER_DAY) ambos
 * problemas se resuelven: el déficit que cuenta es siempre el de las 2
 * horas que realmente se van a trabajar de más, y un día sin déficit ahí
 * simplemente devuelve 0 (sigue siendo un día "elegible", solo que de
 * relleno).
 */
function getEdgeDeficit(
  shiftType: ShiftType,
  slots: DeficitSlot[],
  config: ActionsEngineConfig
): { deficit: number; intervalCount: number } {
  const morning = getPrincipalSchedule("morning", config);
  const afternoon = getPrincipalSchedule("afternoon", config);
  const zoneMin = EXTENDED_HOURS_PER_DAY * 60;

  const zone = shiftType === "afternoon"
    ? { start: afternoon.start - zoneMin, end: afternoon.start }
    : { start: morning.end, end: morning.end + zoneMin };

  const relevant = slots.filter(s => s.startMin >= zone.start && s.endMin <= zone.end && s.remainingDeficit > 0);
  if (!relevant.length) return { deficit: 0, intervalCount: 0 };

  return {
    deficit: Math.max(...relevant.map(s => s.remainingDeficit)),
    intervalCount: relevant.length,
  };
}

/**
 * Convierte una lista de días en un texto que lista CADA día explícitamente,
 * respetando el orden de la semana (nunca un rango con guion, ambiguo).
 * Ej: ["Lunes","Martes"] -> "Lunes, Martes".
 */
function formatDayRange(days: string[]): string {
  const unique = Array.from(new Set(days)).filter(d => DAY_ORDER.includes(d));
  if (!unique.length) return days.join(", ");

  const sorted = unique.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return sorted.join(", ");
}

/**
 * Procesa un turno (mañana o tarde) de un servicio/subárea sobre TODOS los
 * días en que ese servicio/subárea tiene datos (con o sin déficit en el
 * borde de este turno), usando y consumiendo la bolsa compartida
 * `weeklyPlan.blocks` in-place.
 */
function processShift(
  servicio: string,
  subarea: string,
  shiftType: ShiftType,
  allDays: DayCandidate[],
  serviceRows: Row[],
  weeklyPlan: WeeklyCompensationPlan,
  config: ActionsEngineConfig,
  deficitMatrix: Map<string, DeficitSlot[]>,
  surplusLedger: SurplusLedger | undefined
): ActionSuggestion | null {
  // Paso 3: ordenar TODOS los días (con y sin déficit en el borde) por
  // déficit descendente; a igual déficit (incluido 0), por fecha ascendente
  // — así, entre varios días "de relleno" sin déficit, se elige siempre el
  // más próximo/temprano de forma determinista.
  const ranked = [...allDays].sort(
    (a, b) => b.edgeDeficit - a.edgeDeficit || a.fechaSort.localeCompare(b.fechaSort)
  );

  if (ranked.length < EXTENDED_DAYS_PER_WEEK) return null;

  // Paso 4: sin déficit real en el día de mayor prioridad, no hay necesidad
  // genuina — no se inventa una Jornada Extendida de la nada.
  if (ranked[0].edgeDeficit <= config.minDeficit) return null;

  // Paso 7: los 2 días con mayor déficit — el segundo puede no tener déficit
  // real (día "de relleno" para completar el paquete obligatorio de 2 días).
  const selected = ranked.slice(0, EXTENDED_DAYS_PER_WEEK);
  const excludeFechaSorts = new Set(selected.map(c => c.fechaSort));

  // Paso 5/6: buscar cuál de las 2 mitades fijas de devolución (antes o
  // después del break del horario principal de este turno) está
  // completamente libre, priorizando el Sábado, excluyendo los días que se
  // van a extender.
  const returnWindow = findContinuousReturnBlock(
    weeklyPlan.blocks,
    shiftType,
    config,
    EXTENDED_RETURN_BLOCK_HOURS,
    EXTENDED_PRIORITY_RETURN_DAY,
    excludeFechaSorts
  );

  if (!returnWindow) return null;

  // Paso 8: el tope real de agentes. Que la ventana esté "libre de déficit"
  // (binario) no dice cuánto excedente hay — se mide el promedio real neto
  // en esa ventana exacta y solo se compromete el EXTENDED_RETURN_UTILIZATION
  // (80%) de ese promedio, dejando el resto de colchón. Si ni siquiera
  // alcanza para 1 agente, no hay con qué pagar la Jornada Extendida.
  const avgAvailable = getAverageAvailableAgents(
    servicio, subarea, serviceRows,
    returnWindow.fechaSort, returnWindow.start, returnWindow.end,
    config.coverageBase, surplusLedger
  );
  const paybackCapacity = Math.floor(avgAvailable * EXTENDED_RETURN_UTILIZATION);
  if (paybackCapacity < 1) return null;

  const consumed = consumeReturnBlock(weeklyPlan.blocks, returnWindow.fechaSort, returnWindow.start, returnWindow.end);
  if (!consumed) return null; // estado inconsistente: no debería ocurrir, pero nunca se inventa una devolución

  // Pasos 9/10: construir la extensión de +2h en cada uno de los 2 días
  // seleccionados y aplicar la cobertura resultante a la matriz de déficit.
  const principal = getPrincipalSchedule(shiftType, config);
  const schedules = calculateExtendedSchedule(
    EXTENDED_HOURS_PER_DAY,
    principal.start - EXTENDED_HOURS_PER_DAY * 60,
    principal.end + EXTENDED_HOURS_PER_DAY * 60,
    config,
    shiftType
  );

  // El grupo de agentes que recibe la Jornada Extendida es el mismo en los 2
  // días (son las mismas personas trabajando 2 días de 11h). Su tamaño es el
  // MENOR entre lo que hace falta (déficit del día de mayor necesidad) y lo
  // que la devolución puede realmente sostener sin quedar en déficit — nunca
  // se promete más de lo que la ventana de pago puede absorber.
  const neededAgents = roundAgents(ranked[0].edgeDeficit, config.roundingThreshold);
  const agents = Math.min(neededAgents, paybackCapacity);

  for (const day of selected) {
    applyCoverage(deficitMatrix, {
      type: "extendida",
      servicio,
      subarea,
      fecha: day.fecha,
      fechaSort: day.fechaSort,
      dia: day.dia,
      startMin: schedules.new.start,
      endMin: schedules.new.end,
      agents,
      coverageAmount: agents,
    });
  }

  const dayLabel = formatDayRange(selected.map(d => d.dia));
  const avgDeficit = parseFloat(((selected[0].edgeDeficit + selected[1].edgeDeficit) / 2).toFixed(2));
  const maxDeficit = parseFloat(Math.max(selected[0].edgeDeficit, selected[1].edgeDeficit).toFixed(2));
  const intervalCount = selected.reduce((sum, d) => sum + d.edgeIntervalCount, 0);

  // El texto muestra la CONEXIÓN real (lo que el agente sí gestiona ese día),
  // no la devolución. Son las mitades complementarias del mismo horario
  // principal: si la devolución (lo que se paga sin trabajar) cae en la
  // segunda mitad (ej. 13:00-17:00), la conexión es la primera mitad (ej.
  // 08:00-12:00) — nunca las mismas horas que la devolución.
  const halves = getReturnHalfWindows(shiftType, config, EXTENDED_RETURN_BLOCK_HOURS);
  const connectionHalf = halves.find(h => h.start !== returnWindow.start || h.end !== returnWindow.end) ?? halves[0];

  // Observación corta: mismo formato que antes — solo qué días se
  // extendieron y en qué horario conecta realmente el día de la devolución.
  // El tope de capacidad (paso 8) sigue aplicándose sobre `agents`, solo que
  // ya no se explica dentro del texto — se ve reflejado en la columna de
  // agentes de la tabla, no en observations.
  const observations =
    `Jornada Extendida (${dayLabel}).Conexión ${EXTENDED_RETURN_BLOCK_HOURS} horas ${consumed.day} de (${toHHMM(connectionHalf.start)} - ${toHHMM(connectionHalf.end)})`;

  return {
    type: "extendida",
    servicio,
    subarea,
    fecha: "Varios días",
    dia: dayLabel,
    currentStartHora: toHHMM(schedules.current.start),
    currentEndHora: toHHMM(schedules.current.end),
    newStartHora: toHHMM(schedules.new.start),
    newEndHora: toHHMM(schedules.new.end),
    agents,
    avgDeficit,
    maxDeficit,
    intervalCount,
    occurrences: selected.length,
    observations,
    compensationDetail: [consumed],
  };
}

export function generateJornadasExtendidasAggregated(
  validRows: Row[],
  config: ActionsEngineConfig,
  deficitMatrix: Map<string, DeficitSlot[]>,
  surplusLedger?: SurplusLedger
): ActionSuggestion[] {
  const extendida: ActionSuggestion[] = [];
  const byServiceSubarea = groupBy(validRows, r => `${r.servicio}|${r.subarea}`);

  for (const [serviceKey, serviceRows] of byServiceSubarea) {
    const [servicio, subarea] = serviceKey.split("|");

    const weeklyPlan = calculateWeeklyCompensationPlan(servicio, subarea, serviceRows, config, surplusLedger);
    if (!weeklyPlan) continue;

    // Paso 2: TODOS los días en que el servicio/subárea tiene datos (con o
    // sin déficit), no solo los que ya tienen una entrada en deficitMatrix
    // — un día sin ningún déficit no aparece ahí, pero igual es un
    // candidato válido "de relleno" para completar el paquete de 2 días.
    const daysMap = new Map<string, { fecha: string; dia: string }>();
    for (const row of serviceRows) {
      if (!daysMap.has(row.fechaSort)) {
        daysMap.set(row.fechaSort, { fecha: row.fecha, dia: row.dia });
      }
    }

    const candidatesByShift = new Map<ShiftType, DayCandidate[]>();
    for (const shiftType of SHIFT_PROCESSING_ORDER) candidatesByShift.set(shiftType, []);

    for (const [fechaSort, { fecha, dia }] of daysMap) {
      const slots = deficitMatrix.get(`${servicio}|${subarea}|${fechaSort}`) ?? [];

      for (const shiftType of SHIFT_PROCESSING_ORDER) {
        const { deficit, intervalCount } = getEdgeDeficit(shiftType, slots, config);
        candidatesByShift.get(shiftType)!.push({
          fechaSort, fecha, dia, shiftType,
          edgeDeficit: deficit,
          edgeIntervalCount: intervalCount,
        });
      }
    }

    // Pasos 3-9: se procesa un turno completo a la vez, en orden fijo
    // (mañana, luego tarde), sobre la MISMA instancia de `weeklyPlan.blocks`.
    for (const shiftType of SHIFT_PROCESSING_ORDER) {
      const allDays = candidatesByShift.get(shiftType)!;
      if (allDays.length < EXTENDED_DAYS_PER_WEEK) continue;

      const suggestion = processShift(servicio, subarea, shiftType, allDays, serviceRows, weeklyPlan, config, deficitMatrix, surplusLedger);
      if (suggestion) extendida.push(suggestion);
    }
  }

  return extendida;
}

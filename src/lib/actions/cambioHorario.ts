/**
 * Motor de CAMBIO DE HORARIO.
 *
 * Reglas:
 * - Mantiene la duración configurada (horas de trabajo + break).
 * - Evalúa la necesidad sobre TODA la semana.
 * - La aplicación respeta cambioApplicationScope.
 * - La cantidad de agentes se determina por simulación, no por el déficit máximo.
 * - Un día sin necesidad NO bloquea un cambio que sí mejora los días aplicables.
 * - Antes de aplicar una sugerencia se actualiza la cobertura acumulada.
 */

import type { Row } from "../types/analysis";
import type {
  ActionSuggestion,
  ActionsEngineConfig,
  DeficitSlot,
  SurplusLedger,
} from "./types";
import { getDeficitFromRow, toHHMM, toMinutes, groupBy, classifyTimeZone } from "./utils";
import { getTotalWorkDuration } from "./config";

const SLOT_MINUTES = 30;
const MIN_AGENTS = 1;
const MAX_SEARCH_AGENTS = 200;

/**
 * Dentro de un mismo horario candidato, priorizamos la menor cantidad de
 * agentes que conserva prácticamente toda la mejora de la mejor cantidad
 * encontrada. Esto evita bloques artificiales de 5 agentes.
 */
const QUANTITY_SCORE_RETENTION = 0.98;

const WEEKDAY_LABELS = new Set([
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
]);

interface Candidate {
  start: number;
  end: number;
}

interface DaySlotMap {
  net: Map<number, number>;
  dia: string;
}

interface DaySimulation {
  fechaSort: string;
  deficitBefore: number;
  deficitAfter: number;
  positiveBefore: number;
  positiveAfter: number;
  mismatchBefore: number;
  mismatchAfter: number;
  improved: number;
  worsened: number;
}

/** Mismatch (déficit + excedente) acumulado en una franja horaria, antes y después del candidato. */
interface ZoneMismatch {
  before: number;
  after: number;
}

/** Acumulado de mismatch por franja horaria (mañana/cierre/madrugada). "none" no se usa para el balance. */
type ZoneMismatchMap = Record<"morning" | "closing" | "madrugada", ZoneMismatch>;

function createEmptyZoneMap(): ZoneMismatchMap {
  return {
    morning: { before: 0, after: 0 },
    closing: { before: 0, after: 0 },
    madrugada: { before: 0, after: 0 },
  };
}

interface SimulationResult {
  deficitBefore: number;
  deficitAfter: number;
  positiveBefore: number;
  positiveAfter: number;
  mismatchBefore: number;
  mismatchAfter: number;
  improved: number;
  worsened: number;
  gainedIntervals: number;
  perDay: DaySimulation[];
  zones: ZoneMismatchMap;
}

interface EvaluatedCandidate {
  candidate: Candidate;
  agents: number;
  simulation: SimulationResult;
  score: number;
}

/** Fecha ISO + días, sin depender de la zona horaria local. */
function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeEndMinutes(value: number): number {
  return value === 0 ? 1440 : value;
}

function getNet(
  grid: Map<string, DaySlotMap>,
  fechaSort: string,
  startMin: number
): number {
  return grid.get(fechaSort)?.net.get(startMin) ?? 0;
}

/**
 * Construye la grilla semanal.
 *
 * Importante:
 * La grilla conserva los GAP positivos. La matriz solo sobrescribe los
 * intervalos que tienen déficit remanente. Esto permite usar el excedente
 * como capacidad real para retirar cobertura del horario origen.
 */
function buildWeeklyGrid(
  groupRows: Row[],
  config: ActionsEngineConfig,
  matrix: Map<string, DeficitSlot[]>,
  servicio: string,
  subarea: string
): Map<string, DaySlotMap> {
  const grid = new Map<string, DaySlotMap>();

  for (const row of groupRows) {
    if (!grid.has(row.fechaSort)) {
      grid.set(row.fechaSort, {
        net: new Map(),
        dia: row.dia,
      });
    }

    grid.get(row.fechaSort)!.net.set(
      toMinutes(row.hora),
      getDeficitFromRow(row, config.coverageBase)
    );
  }

  const prefix = `${servicio}|${subarea}|`;

  for (const [key, slots] of matrix) {
    if (!key.startsWith(prefix)) continue;

    const fechaSort = key.slice(prefix.length);
    const day = grid.get(fechaSort);
    if (!day) continue;

    for (const slot of slots) {
      day.net.set(slot.startMin, -Math.max(0, slot.remainingDeficit));
    }
  }

  return grid;
}

/**
 * Identifica el horario origen a partir de dónde se concentra el déficit.
 *
 * Déficit predominantemente matutino:
 *   horario tardío -> por defecto 11:00-20:00
 *
 * Déficit predominantemente vespertino:
 *   horario temprano -> por defecto 08:00-17:00
 */
function inferCurrentSchedule(
  groupRows: Row[],
  config: ActionsEngineConfig,
  matrix: Map<string, DeficitSlot[]>,
  servicio: string,
  subarea: string
): Candidate | null {
  const grid = buildWeeklyGrid(
    groupRows,
    config,
    matrix,
    servicio,
    subarea
  );

  let morningDeficit = 0;
  let afternoonDeficit = 0;

  for (const day of grid.values()) {
    for (const [minute, net] of day.net) {
      const deficit = Math.max(0, -net);
      if (deficit < config.minDeficit) continue;

      if (minute < 12 * 60) {
        morningDeficit += deficit;
      } else {
        afternoonDeficit += deficit;
      }
    }
  }

  if (morningDeficit <= 0 && afternoonDeficit <= 0) return null;

  const start =
    morningDeficit >= afternoonDeficit
      ? config.shiftStartAfternoon
      : config.shiftStartMorning;

  const duration = getTotalWorkDuration(config) * 60;
  if (duration <= 0) return null;

  return {
    start,
    end: start + duration,
  };
}

/**
 * Genera todos los horarios posibles alrededor del horario actual.
 * Se mantiene exactamente la duración configurada.
 */
function generateCandidates(
  currentStart: number,
  duration: number,
  config: ActionsEngineConfig
): Candidate[] {
  // Piso de 60 min: coincide con el mínimo que permite ConfigPage.tsx (60-120)
  // y con el piso usado en jornadasExtendidas.ts para el mismo campo
  // compartido, para que ambos motores nunca diverjan en horarios de media hora.
  const step = Math.max(60, config.scheduleGranularityMinutes || 60);
  const maxDisplacement = Math.max(
    0,
    config.maxShiftDisplacementMinutes
  );
  const maxExit = normalizeEndMinutes(config.maxExitMinutes);

  const candidates: Candidate[] = [];

  for (
    let displacement = -maxDisplacement;
    displacement <= maxDisplacement;
    displacement += step
  ) {
    const start = currentStart + displacement;
    if (start < config.minEntryMinutes) continue;

    const end = start + duration;
    const crossesMidnight = end > 1440;

    if (!crossesMidnight) {
      if (end > maxExit) continue;
    } else {
      if (!config.allowMadrugada) continue;
      if (start < config.madrugadaStartMinutes) continue;
    }

    candidates.push({ start, end });
  }

  return Array.from(
    new Map(
      candidates.map(candidate => [
        `${candidate.start}|${candidate.end}`,
        candidate,
      ])
    ).values()
  ).sort(
    (a, b) =>
      Math.abs(a.start - currentStart) -
      Math.abs(b.start - currentStart)
  );
}

function getAffectedSlots(
  currentStart: number,
  currentEnd: number,
  candidate: Candidate
): number[] {
  const from =
    Math.floor(
      Math.min(currentStart, candidate.start) / SLOT_MINUTES
    ) * SLOT_MINUTES;

  const to = Math.max(currentEnd, candidate.end);
  const slots: number[] = [];

  for (let t = from; t < to; t += SLOT_MINUTES) {
    slots.push(t);
  }

  return slots;
}

/**
 * Simula el cambio solamente en los días donde se aplicaría.
 *
 * La métrica global se calcula sobre toda la semana, pero los días no
 * seleccionados permanecen sin cambios.
 */
function simulateCandidate(
  grid: Map<string, DaySlotMap>,
  evaluationDays: string[],
  applyDays: Set<string>,
  currentStart: number,
  currentEnd: number,
  candidate: Candidate,
  agents: number,
  config: ActionsEngineConfig
): SimulationResult {
  const result: SimulationResult = {
    deficitBefore: 0,
    deficitAfter: 0,
    positiveBefore: 0,
    positiveAfter: 0,
    mismatchBefore: 0,
    mismatchAfter: 0,
    improved: 0,
    worsened: 0,
    gainedIntervals: 0,
    perDay: [],
    zones: createEmptyZoneMap(),
  };

  const affected = getAffectedSlots(
    currentStart,
    currentEnd,
    candidate
  );

  for (const fechaSort of evaluationDays) {
    const day = grid.get(fechaSort);
    if (!day) continue;

    const dayResult: DaySimulation = {
      fechaSort,
      deficitBefore: 0,
      deficitAfter: 0,
      positiveBefore: 0,
      positiveAfter: 0,
      mismatchBefore: 0,
      mismatchAfter: 0,
      improved: 0,
      worsened: 0,
    };

    const isApplied = applyDays.has(fechaSort);

    for (const t of affected) {
      let targetFecha = fechaSort;
      let slotMin = t;

      if (slotMin >= 1440) {
        targetFecha = addDaysISO(fechaSort, 1);
        slotMin -= 1440;
      }

      if (!grid.has(targetFecha)) continue;

      const inOld =
        t >= currentStart && t < currentEnd;
      const inNew =
        t >= candidate.start && t < candidate.end;

      if (!inOld && !inNew) continue;

      const netBefore = getNet(
        grid,
        targetFecha,
        slotMin
      );

      const delta = isApplied
        ? (inNew ? agents : 0) -
          (inOld ? agents : 0)
        : 0;

      const netAfter = netBefore + delta;

      const deficitBefore = Math.max(0, -netBefore);
      const deficitAfter = Math.max(0, -netAfter);
      const positiveBefore = Math.max(0, netBefore);
      const positiveAfter = Math.max(0, netAfter);

      result.deficitBefore += deficitBefore;
      result.deficitAfter += deficitAfter;
      result.positiveBefore += positiveBefore;
      result.positiveAfter += positiveAfter;

      // Acumular por franja horaria (mañana/cierre/madrugada) para el
      // término de homogeneización del score. `slotMin` ya viene normalizado
      // a 0-1439 (ver arriba: se restó 1440 si el intervalo cruzaba
      // medianoche), así que representa la hora real del reloj.
      const zone = classifyTimeZone(slotMin, config);
      if (zone !== "none") {
        result.zones[zone].before += deficitBefore + positiveBefore;
        result.zones[zone].after += deficitAfter + positiveAfter;
      }

      dayResult.deficitBefore += deficitBefore;
      dayResult.deficitAfter += deficitAfter;
      dayResult.positiveBefore += positiveBefore;
      dayResult.positiveAfter += positiveAfter;

      if (deficitAfter < deficitBefore - 0.0001) {
        result.improved++;
        dayResult.improved++;
      } else if (
        deficitAfter >
        deficitBefore + 0.0001
      ) {
        result.worsened++;
        dayResult.worsened++;
      }

      if (
        isApplied &&
        inNew &&
        !inOld &&
        deficitBefore > 0
      ) {
        result.gainedIntervals++;
      }
    }

    dayResult.mismatchBefore =
      dayResult.deficitBefore +
      dayResult.positiveBefore;

    dayResult.mismatchAfter =
      dayResult.deficitAfter +
      dayResult.positiveAfter;

    result.mismatchBefore +=
      dayResult.mismatchBefore;
    result.mismatchAfter +=
      dayResult.mismatchAfter;

    result.perDay.push(dayResult);
  }

  return result;
}

/**
 * Calcula cuántos agentes pueden salir del horario origen.
 *
 * NO se toma el mínimo de excedentes de toda la semana.
 *
 * En su lugar:
 * - Solo se evalúan los días donde realmente se aplicará el cambio.
 * - Se permite que otros días de la semana no participen.
 * - El límite se obtiene de la capacidad del horario origen en los días
 *   aplicables.
 *
 * Esto evita que un día que no necesita el cambio bloquee el cambio del lunes.
 */
function getSafeAgentLimit(
  grid: Map<string, DaySlotMap>,
  applyDays: string[],
  currentStart: number,
  currentEnd: number,
  candidate: Candidate,
  config: ActionsEngineConfig
): number {
  const affected = getAffectedSlots(
    currentStart,
    currentEnd,
    candidate
  );

  let safeLimit = Number.POSITIVE_INFINITY;
  let hasLoss = false;

  for (const fechaSort of applyDays) {
    for (const t of affected) {
      const inOld =
        t >= currentStart && t < currentEnd;
      const inNew =
        t >= candidate.start && t < candidate.end;

      if (!inOld || inNew) continue;

      let targetFecha = fechaSort;
      let slotMin = t;

      if (slotMin >= 1440) {
        targetFecha = addDaysISO(fechaSort, 1);
        slotMin -= 1440;
      }

      const day = grid.get(targetFecha);
      if (!day) continue;

      hasLoss = true;

      const net = day.net.get(slotMin) ?? 0;

      /*
       * Solo el excedente puede financiar la pérdida.
       * La tolerancia diaria se agrega como margen permitido.
       */
      const allowed =
        Math.max(0, net) +
        Math.max(
          0,
          config.dailyDeteriorationTolerance
        );

      safeLimit = Math.min(
        safeLimit,
        Math.floor(allowed + 1e-9)
      );
    }
  }

  if (!hasLoss) return 0;

  if (!Number.isFinite(safeLimit)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(safeLimit, MAX_SEARCH_AGENTS)
  );
}

/**
 * Diferencia entre la franja con más GAP remanente y la que tiene menos,
 * de las 3 franjas configuradas (mañana/cierre/madrugada). Cuanto más chico,
 * más "parejo" está el GAP entre franjas. Se usa tanto para "antes" como
 * para "después" del candidato, para poder medir si el candidato mejora o
 * empeora el balance entre franjas (no solo el total).
 */
function zoneImbalance(zones: ZoneMismatchMap, key: "before" | "after"): number {
  const values = [zones.morning[key], zones.closing[key], zones.madrugada[key]];
  return Math.max(...values) - Math.min(...values);
}

/**
 * Evalúa 1..N agentes y selecciona la cantidad que maximiza la mejora.
 */
function pickBestQuantityForCandidate(
  candidate: Candidate,
  grid: Map<string, DaySlotMap>,
  evaluationDays: string[],
  applyDays: string[],
  currentStart: number,
  currentEnd: number,
  config: ActionsEngineConfig
): EvaluatedCandidate | null {
  const safeLimit = getSafeAgentLimit(
    grid,
    applyDays,
    currentStart,
    currentEnd,
    candidate,
    config
  );

  if (safeLimit < MIN_AGENTS) return null;

  const applySet = new Set(applyDays);

  let best: EvaluatedCandidate | null = null;

  // Buscar TODAS las cantidades enteras disponibles: 1, 2, 3, 4... N.
  // Nunca se agrupa por bloques de 5.
  for (
    let agents = MIN_AGENTS;
    agents <= safeLimit;
    agents += 1
  ) {
    const simulation = simulateCandidate(
      grid,
      evaluationDays,
      applySet,
      currentStart,
      currentEnd,
      candidate,
      agents,
      config
    );

    let invalid = false;
    let worstDeterioration = 0;

    /*
     * El deterioro se valida únicamente contra el estado del mismo día.
     * Los días sin aplicación quedan idénticos y no penalizan el cambio.
     */
    for (const day of simulation.perDay) {
      const deterioration =
        day.deficitAfter -
        day.deficitBefore;

      worstDeterioration = Math.max(
        worstDeterioration,
        deterioration
      );

      if (
        deterioration >
        config.dailyDeteriorationTolerance +
          1e-9
      ) {
        invalid = true;
        break;
      }
    }

    if (invalid) continue;

    const mismatchImprovement =
      simulation.mismatchBefore -
      simulation.mismatchAfter;

    const deficitImprovement =
      simulation.deficitBefore -
      simulation.deficitAfter;

    const positiveReduction =
      simulation.positiveBefore -
      simulation.positiveAfter;

    if (mismatchImprovement <= 0.0001) {
      continue;
    }

    const displacement = Math.abs(
      candidate.start - currentStart
    );

    // Homogeneización por franja horaria (mañana/cierre/madrugada): además
    // de reducir el mismatch TOTAL, premiamos que el GAP remanente quede
    // repartido de forma pareja entre las 3 franjas configuradas, en vez de
    // concentrado en una sola (ej. mejorar mucho la mañana a costa de dejar
    // la madrugada mucho peor que las demás). `imbalanceImprovement`
    // positivo = el candidato deja las franjas más parejas entre sí que
    // antes; negativo = las deja más dispares (se penaliza).
    const imbalanceBefore = zoneImbalance(simulation.zones, "before");
    const imbalanceAfter = zoneImbalance(simulation.zones, "after");
    const imbalanceImprovement = imbalanceBefore - imbalanceAfter;
    const zoneBalancingTerm = config.enableZoneBalancing
      ? imbalanceImprovement * config.zoneBalancingWeight
      : 0;

    /*
     * Prioridad:
     * 1. reducir desbalance global;
     * 2. reducir déficit;
     * 3. aprovechar excedente;
     * 4. cubrir más intervalos deficitarios;
     * 5. evitar deterioro;
     * 6. homogeneizar entre franjas horarias (mañana/cierre/madrugada);
     * 7. menor desplazamiento.
     */
    const score =
      mismatchImprovement * 100 +
      deficitImprovement * 30 +
      Math.max(0, positiveReduction) * 10 +
      simulation.gainedIntervals * 2 -
      simulation.worsened * 10 -
      worstDeterioration * 50 +
      zoneBalancingTerm -
      displacement / 1000;

    if (
      !best ||
      score > best.score + 1e-9
    ) {
      best = {
        candidate,
        agents,
        simulation,
        score,
      };
    } else if (best) {
      /*
       * Si dos cantidades producen resultados prácticamente equivalentes,
       * conservar la menor cantidad de agentes.
       *
       * Importante: la búsqueda sigue siendo 1, 2, 3, 4, 5, 6...; no hay
       * redondeos ni saltos de cinco. El criterio solo evita consumir más
       * agentes de los necesarios.
       */
      const retainedScore =
        best.score * QUANTITY_SCORE_RETENTION;

      if (
        score >= retainedScore &&
        agents < best.agents
      ) {
        best = {
          candidate,
          agents,
          simulation,
          score,
        };
      }
    }
  }

  return best;
}

/**
 * Resuelve qué días pueden recibir el cambio.
 */
function resolveApplicableDays(
  operativeDaysSorted: string[],
  dayLabelByFecha: Map<string, string>,
  config: ActionsEngineConfig
): string[] {
  switch (config.cambioApplicationScope) {
    case "weekdays": {
      const filtered =
        operativeDaysSorted.filter(fecha =>
          WEEKDAY_LABELS.has(
            dayLabelByFecha.get(fecha) ?? ""
          )
        );

      return filtered.length
        ? filtered
        : operativeDaysSorted;
    }

    case "specific_days": {
      const selected = new Set(
        config.cambioSpecificDays ?? []
      );

      return operativeDaysSorted.filter(
        fecha =>
          selected.has(
            dayLabelByFecha.get(fecha) ?? ""
          )
      );
    }

    case "consecutive_days": {
      const count = Math.max(
        1,
        Math.floor(
          config.cambioConsecutiveDaysCount ||
            operativeDaysSorted.length
        )
      );

      return operativeDaysSorted.slice(
        0,
        count
      );
    }

    case "custom_pattern": {
      const pattern = (
        config.cambioCustomPattern ?? ""
      )
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);

      if (!pattern.length) {
        return operativeDaysSorted;
      }

      const selected = new Set(pattern);

      return operativeDaysSorted.filter(
        fecha =>
          selected.has(
            dayLabelByFecha.get(fecha) ?? ""
          )
      );
    }

    case "full_week":
    default:
      return operativeDaysSorted;
  }
}

/**
 * Determina los días en los que existe realmente una necesidad
 * compatible con el desplazamiento.
 *
 * Esto es clave para no obligar a aplicar un cambio a toda la semana
 * solo porque la evaluación sea semanal.
 */
function detectNeedDays(
  grid: Map<string, DaySlotMap>,
  candidate: Candidate,
  current: Candidate,
  configuredDays: string[],
  config: ActionsEngineConfig
): string[] {
  const result: string[] = [];
  const affected = getAffectedSlots(
    current.start,
    current.end,
    candidate
  );

  for (const fechaSort of configuredDays) {
    const day = grid.get(fechaSort);
    if (!day) continue;

    let gainedDeficit = 0;
    let lostSurplus = 0;

    for (const t of affected) {
      const inOld =
        t >= current.start &&
        t < current.end;

      const inNew =
        t >= candidate.start &&
        t < candidate.end;

      if (!inOld && !inNew) continue;

      let targetFecha = fechaSort;
      let slotMin = t;

      if (slotMin >= 1440) {
        targetFecha = addDaysISO(fechaSort, 1);
        slotMin -= 1440;
      }

      const targetDay = grid.get(targetFecha);
      if (!targetDay) continue;

      const net =
        targetDay.net.get(slotMin) ?? 0;

      if (inNew && !inOld) {
        gainedDeficit += Math.max(0, -net);
      }

      if (inOld && !inNew) {
        lostSurplus += Math.max(0, net);
      }
    }

    /*
     * El día participa si:
     * - recibe cobertura en intervalos deficitarios; y
     * - puede financiar la pérdida del horario origen.
     */
    const hasNeed =
      gainedDeficit >=
      Math.max(0.5, config.minDeficit);

    const hasSourceCapacity =
      lostSurplus >= 1 ||
      config.dailyDeteriorationTolerance > 0;

    if (hasNeed && hasSourceCapacity) {
      result.push(fechaSort);
    }
  }

  return result;
}

/**
 * Aplica el cambio al grid y a la matriz acumulada.
 */
function applyCambioToMatrix(
  matrix: Map<string, DeficitSlot[]>,
  servicio: string,
  subarea: string,
  applyDays: string[],
  grid: Map<string, DaySlotMap>,
  currentStart: number,
  currentEnd: number,
  candidate: Candidate,
  agents: number,
  surplusLedger?: SurplusLedger
): void {
  const affected = getAffectedSlots(
    currentStart,
    currentEnd,
    candidate
  );

  for (const fechaSort of applyDays) {
    for (const t of affected) {
      let targetFecha = fechaSort;
      let slotMin = t;

      if (slotMin >= 1440) {
        targetFecha = addDaysISO(fechaSort, 1);
        slotMin -= 1440;
      }

      const dayMap = grid.get(targetFecha);
      if (!dayMap) continue;

      const inOld =
        t >= currentStart && t < currentEnd;

      const inNew =
        t >= candidate.start && t < candidate.end;

      if (!inOld && !inNew) continue;

      const delta =
        (inNew ? agents : 0) -
        (inOld ? agents : 0);

      if (delta === 0) continue;

      const netBefore =
        dayMap.net.get(slotMin) ?? 0;

      const targetKey =
        `${servicio}|${subarea}|${targetFecha}`;

      let targetSlots =
        matrix.get(targetKey);

      const existingSlot =
        targetSlots?.find(
          slot => slot.startMin === slotMin
        );

      if (delta < 0) {
        const removed = -delta;

        const consumedFromSurplus =
          Math.min(
            removed,
            Math.max(0, netBefore)
          );

        if (
          consumedFromSurplus > 0 &&
          surplusLedger
        ) {
          if (
            !surplusLedger.has(targetKey)
          ) {
            surplusLedger.set(
              targetKey,
              []
            );
          }

          surplusLedger
            .get(targetKey)!
            .push({
              startMin: slotMin,
              endMin:
                slotMin + SLOT_MINUTES,
              consumedAgents:
                consumedFromSurplus,
            });
        }

        const newNet =
          netBefore + delta;

        if (existingSlot) {
          existingSlot.remainingDeficit =
            Math.max(
              0,
              -newNet
            );

          if (
            existingSlot.remainingDeficit <=
            0 &&
            targetSlots
          ) {
            const idx =
              targetSlots.indexOf(
                existingSlot
              );

            if (idx >= 0) {
              targetSlots.splice(idx, 1);
            }
          }
        } else if (newNet < 0) {
          if (!targetSlots) {
            targetSlots = [];
            matrix.set(
              targetKey,
              targetSlots
            );
          }

          targetSlots.push({
            servicio,
            subarea,
            fecha: targetFecha,
            fechaSort: targetFecha,
            dia: dayMap.dia,
            hora: toHHMM(slotMin),
            startMin: slotMin,
            endMin:
              slotMin + SLOT_MINUTES,
            originalDeficit:
              Math.abs(newNet),
            remainingDeficit:
              Math.abs(newNet),
            coveredBy: [],
          });
        }
      } else {
        if (existingSlot) {
          existingSlot.remainingDeficit =
            Math.max(
              0,
              existingSlot.remainingDeficit -
                delta
            );

          existingSlot.coveredBy.push(
            "cambio"
          );

          if (
            existingSlot.remainingDeficit <=
            0 &&
            targetSlots
          ) {
            const idx =
              targetSlots.indexOf(
                existingSlot
              );

            if (idx >= 0) {
              targetSlots.splice(idx, 1);
            }
          }
        }
      }

      dayMap.net.set(
        slotMin,
        netBefore + delta
      );
    }
  }
}

export function generateCambioAggregated(
  validRows: Row[],
  config: ActionsEngineConfig,
  deficitMatrix: Map<string, DeficitSlot[]>,
  surplusLedger?: SurplusLedger
): ActionSuggestion[] {
  const cambio: ActionSuggestion[] = [];

  const byServiceSubarea = groupBy(
    validRows,
    row =>
      `${row.servicio}|${row.subarea}`
  );

  for (const [, groupRows] of byServiceSubarea) {
    if (!groupRows.length) continue;

    const servicio =
      groupRows[0].servicio;

    const subarea =
      groupRows[0].subarea;

    const daysByGroup = groupBy(
      groupRows,
      row => row.fechaSort
    );

    const operativeDaysSorted =
      Array.from(
        daysByGroup.keys()
      ).sort();

    if (!operativeDaysSorted.length) {
      continue;
    }

    const dayLabelByFecha =
      new Map<string, string>();

    // Mapa fechaSort (ISO, usado internamente para agrupar/ordenar) -> fecha
    // de despliegue (dd/mm/yyyy, la misma que ya usan Jornadas Extendidas y
    // HHEE en su propio campo `fecha`). Sin este mapa, una sugerencia de
    // Cambio de Horario aplicada a un solo día quedaba con `fecha` en
    // formato ISO (bestApplyDays[0] es fechaSort), inconsistente con el
    // formato dd/mm/yyyy que usan los otros dos tipos de acción.
    const dateDisplayByFecha =
      new Map<string, string>();

    for (const row of groupRows) {
      dayLabelByFecha.set(
        row.fechaSort,
        row.dia
      );
      dateDisplayByFecha.set(
        row.fechaSort,
        row.fecha
      );
    }

    /*
     * EVALUACIÓN: siempre semanal.
     */
    const evaluationDays =
      operativeDaysSorted;

    /*
     * APLICACIÓN: según configuración.
     */
    const configuredDays =
      resolveApplicableDays(
        operativeDaysSorted,
        dayLabelByFecha,
        config
      );

    if (!configuredDays.length) {
      continue;
    }

    const current =
      inferCurrentSchedule(
        groupRows,
        config,
        deficitMatrix,
        servicio,
        subarea
      );

    if (!current) continue;

    const duration =
      getTotalWorkDuration(config) * 60;

    if (duration <= 0) continue;

    /*
     * Garantizar duración exacta del horario actual.
     */
    const currentCandidate: Candidate = {
      start: current.start,
      end: current.start + duration,
    };

    const grid =
      buildWeeklyGrid(
        groupRows,
        config,
        deficitMatrix,
        servicio,
        subarea
      );

    const candidates =
      generateCandidates(
        currentCandidate.start,
        duration,
        config
      );

    let bestGlobal: EvaluatedCandidate | null =
      null;

    let bestApplyDays: string[] = [];

    /*
     * Cada candidato se evalúa para el patrón real de días.
     *
     * IMPORTANTE:
     * "Toda la semana" define el ALCANCE DE BÚSQUEDA/EVALUACIÓN, pero no
     * debe obligar a financiar el movimiento en días donde el horario origen
     * no tiene excedente. Si, por ejemplo, lunes-viernes no pueden ceder
     * cobertura pero sábado sí, sábado debe seguir pudiendo generar la acción.
     *
     * La evaluación sigue siendo semanal; lo que cambia es el subconjunto de
     * días en el que el movimiento es físicamente aplicable.
     */
    for (const candidate of candidates) {
      if (
        candidate.start ===
          currentCandidate.start &&
        candidate.end ===
          currentCandidate.end
      ) {
        continue;
      }

      // Siempre detectamos los días realmente viables dentro del alcance
      // configurado. Esto evita que un día sin excedente en el horario origen
      // bloquee a otro día que sí puede financiar el cambio.
      const needDays =
        detectNeedDays(
          grid,
          candidate,
          currentCandidate,
          configuredDays,
          config
        );

      if (!needDays.length) continue;

      const applyDays = needDays;

      /*
       * La métrica global continúa evaluando TODA la semana.
       * Solo la aplicación se restringe a los días viables y configurados.
       */
      const evaluated =
        pickBestQuantityForCandidate(
          candidate,
          grid,
          evaluationDays,
          applyDays,
          currentCandidate.start,
          currentCandidate.end,
          config
        );

      if (!evaluated) continue;

      if (
        !bestGlobal ||
        evaluated.score >
          bestGlobal.score + 1e-9
      ) {
        bestGlobal = evaluated;
        bestApplyDays = applyDays;
      }
    }

    if (!bestGlobal) continue;

    const {
      candidate,
      agents,
      simulation,
    } = bestGlobal;

    if (agents < MIN_AGENTS) continue;
    if (!bestApplyDays.length) continue;

    const dayLabel = Array.from(
      new Set(
        bestApplyDays
          .map(
            fecha =>
              dayLabelByFecha.get(
                fecha
              ) ?? ""
          )
          .filter(Boolean)
      )
    ).join(", ");

    const deficitImprovement =
      simulation.deficitBefore -
      simulation.deficitAfter;

    const mismatchImprovement =
      simulation.mismatchBefore -
      simulation.mismatchAfter;

    const positiveReduction =
      simulation.positiveBefore -
      simulation.positiveAfter;

    /*
     * Solo se muestra la acción si realmente mejora el GAP.
     */
    if (
      mismatchImprovement <=
      0.0001
    ) {
      continue;
    }

    const suggestion: ActionSuggestion = {
      type: "cambio",
      servicio,
      subarea,
      fecha:
        bestApplyDays.length === 1
          ? (dateDisplayByFecha.get(bestApplyDays[0]) ?? bestApplyDays[0])
          : "Varios días",
      dia: dayLabel,
      currentStartHora:
        toHHMM(
          currentCandidate.start
        ),
      currentEndHora:
        toHHMM(
          currentCandidate.end
        ),
      newStartHora:
        toHHMM(candidate.start),
      newEndHora:
        toHHMM(candidate.end),
      agents,
      avgDeficit: Number(
        (
          simulation.deficitBefore /
          Math.max(
            1,
            simulation.perDay.length
          )
        ).toFixed(2)
      ),
      maxDeficit: Number(
        Math.max(
          ...simulation.perDay.map(
            day =>
              day.deficitBefore
          ),
          0
        ).toFixed(2)
      ),
      intervalCount:
        simulation.gainedIntervals,
      occurrences:
        bestApplyDays.length,
      observations:
        `Redistribución de ${agents} agente${
          agents === 1 ? "" : "s"
        }: ` +
        `${toHHMM(
          currentCandidate.start
        )}-${toHHMM(
          currentCandidate.end
        )} → ` +
        `${toHHMM(
          candidate.start
        )}-${toHHMM(
          candidate.end
        )}. ` +
        `Evaluación semanal; aplicación en ${dayLabel}. ` +
        `Mejora semanal de GAPS: ` +
        `${mismatchImprovement.toFixed(
          1
        )} agente-intervalo. ` +
        `Déficit reducido: ` +
        `${deficitImprovement.toFixed(
          1
        )}. ` +
        `GAP positivo reducido: ` +
        `${Math.max(
          0,
          positiveReduction
        ).toFixed(1)}.` +
        (config.enableZoneBalancing
          ? ` GAP por franja tras el cambio — Mañana: ${simulation.zones.morning.after.toFixed(1)}, ` +
            `Cierre: ${simulation.zones.closing.after.toFixed(1)}, ` +
            `Madrugada: ${simulation.zones.madrugada.after.toFixed(1)}.`
          : ""),
    };

    cambio.push(suggestion);

    /*
     * Actualización acumulativa.
     */
    applyCambioToMatrix(
      deficitMatrix,
      servicio,
      subarea,
      bestApplyDays,
      grid,
      currentCandidate.start,
      currentCandidate.end,
      candidate,
      agents,
      surplusLedger
    );
  }

  return cambio;
}

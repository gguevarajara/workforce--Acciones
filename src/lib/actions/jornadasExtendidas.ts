/**
 * Generación de Jornadas Extendidas.
 *
 * ORDEN OBLIGATORIO:
 * 1) horario principal
 * 2) déficits de toda la semana
 * 3) gaps positivos de toda la semana (bolsa única compartida, ya descontado
 *    lo consumido por Cambio de Horario)
 * 4) horas disponibles para devolver (recalculadas turno por turno sobre el
 *    estado ACTUAL de la bolsa compartida, para no contar dos veces el
 *    solape 11:00-17:00 entre turno mañana y tarde)
 * 5) horas de extensión permitidas
 * 6) distribución por días con déficit
 * 7) construcción de la extensión según turno
 * 8) construcción de la devolución dentro del horario principal, consumiendo
 *    la bolsa compartida (turno mañana se procesa antes que turno tarde)
 */

import type { Row } from "../types/analysis";
import type { ActionSuggestion, ActionsEngineConfig, DeficitSlot, SurplusLedger } from "./types";
import { EDGE_WINDOW_HOURS } from "./config";
import {
  calculateWeeklyCompensationPlan,
  availableHoursForShift,
  consumeCompensation,
  mergeAndCapCompensation,
  type ConsumedCompensation,
} from "./compensation";
import { applyCoverage } from "./deficitMatrix";
import { getPrincipalSchedule, calculateExtendedSchedule, type ShiftType } from "./scheduleCalculator";
import { groupBy, roundAgents, toHHMM, toMinutes } from "./utils";

interface ExtensionNeed {
  dayKey: string;
  daySlots: DeficitSlot[];
  edgeType: "start" | "end";
  shiftType: ShiftType;
  requiredHours: number;
}

/** Orden fijo de procesamiento: mañana primero, para que si hay solape con el
 *  horario de tarde (11:00-17:00), la primera en consumir la bolsa compartida
 *  sea siempre la misma (procesamiento determinista, sin doble conteo). */
const SHIFT_PROCESSING_ORDER: ShiftType[] = ["morning", "afternoon"];

function getDayRows(serviceRows: Row[], slot: DeficitSlot): Row[] {
  return serviceRows.filter(
    r => r.servicio === slot.servicio &&
         r.subarea === slot.subarea &&
         r.fechaSort === slot.fechaSort
  );
}

function getExtensionNeed(
  serviceRows: Row[],
  slots: DeficitSlot[],
  config: ActionsEngineConfig
): ExtensionNeed | null {
  if (!slots.length) return null;

  const first = slots[0];
  const rows = getDayRows(serviceRows, first);
  if (!rows.length) return null;

  const windowStart = Math.min(...rows.map(r => toMinutes(r.hora)));
  const windowEnd = Math.max(...rows.map(r => toMinutes(r.hora))) + 30;

  const deficitStart = Math.min(...slots.map(s => s.startMin));
  const deficitEnd = Math.max(...slots.map(s => s.endMin));

  const morning = getPrincipalSchedule("morning", config);
  const afternoon = getPrincipalSchedule("afternoon", config);

  const nearStart = deficitStart - windowStart <= EDGE_WINDOW_HOURS * 60;
  const nearEnd = windowEnd - deficitEnd <= EDGE_WINDOW_HOURS * 60;

  // Si el déficit está antes del turno, corresponde al turno tarde:
  // 11:00-20:00 -> 09:00-20:00 para +2h.
  const startNeed: ExtensionNeed | null =
    nearStart && deficitStart < afternoon.start
      ? (() => {
          const requiredHours = Math.min(
            config.extendedMaxHoursPerDay,
            (afternoon.start - deficitStart) / 60
          );
          return requiredHours > 0
            ? { dayKey: `${first.servicio}|${first.subarea}|${first.fechaSort}|start`, daySlots: slots, edgeType: "start" as const, shiftType: "afternoon" as const, requiredHours }
            : null;
        })()
      : null;

  // Si el déficit está después del turno, corresponde al turno mañana:
  // 08:00-17:00 -> 08:00-19:00 para +2h.
  const endNeed: ExtensionNeed | null =
    nearEnd && deficitEnd > morning.end
      ? (() => {
          const requiredHours = Math.min(
            config.extendedMaxHoursPerDay,
            (deficitEnd - morning.end) / 60
          );
          return requiredHours > 0
            ? { dayKey: `${first.servicio}|${first.subarea}|${first.fechaSort}|end`, daySlots: slots, edgeType: "end" as const, shiftType: "morning" as const, requiredHours }
            : null;
        })()
      : null;

  // Caso normal: solo un borde aplica (el grupo de slots ya viene
  // pre-clasificado como "start" o "end" desde generateJornadasExtendidasAggregated).
  // Si por el ancho de ventana llegaran a aplicar los dos a la vez, no se
  // descarta el segundo en silencio: se prioriza el de mayor necesidad de
  // horas (el borde más crítico del día).
  if (startNeed && endNeed) {
    return startNeed.requiredHours >= endNeed.requiredHours ? startNeed : endNeed;
  }
  return startNeed ?? endNeed ?? null;
}

/**
 * Reparte de forma equitativa (water-filling, en pasos discretos) las horas
 * de extensión disponibles entre los días con déficit de un mismo turno.
 *
 * Ej: 4h disponibles y Lunes + Martes necesitan extensión → 2h y 2h,
 * en vez de darle las 4h completas solo al primero que se procese.
 *
 * El reparto se hace en incrementos enteros de `config.scheduleGranularityMinutes`
 * (por defecto 60 min = 1 hora; configurable en Configuración → pestaña
 * "General" → "Granularidad de Horario", el mismo campo que usa Cambio
 * de Horario para el paso entre horarios candidatos) para que el horario
 * resultante siempre caiga en una hora "redonda" (ej. 18:00, 19:00), nunca en
 * minutos sueltos ni en medias horas. Si la bolsa disponible no es múltiplo
 * exacto del paso configurado, el remanente simplemente no se reparte — es
 * un margen de seguridad, no una pérdida operativa real.
 */
function distributeFairly(
  needs: ExtensionNeed[],
  totalAvailable: number,
  config: ActionsEngineConfig
): Map<string, number> {
  const result = new Map<string, number>();
  if (!needs.length || totalAvailable <= 0.001) return result;

  // Piso de 60 min: coincide con el mínimo que permite ConfigPage.tsx (60-120)
  // y con el piso usado en cambioHorario.ts para el mismo campo compartido.
  const stepHours = Math.max(60, config.scheduleGranularityMinutes) / 60;

  let availableSteps = Math.floor(totalAvailable / stepHours + 1e-9);
  if (availableSteps <= 0) return result;

  const items = needs
    .map(n => ({
      key: n.dayKey,
      capSteps: Math.floor(Math.min(n.requiredHours, config.extendedMaxHoursPerDay) / stepHours + 1e-9),
      givenSteps: 0,
    }))
    .filter(i => i.capSteps > 0)
    .sort((a, b) => a.capSteps - b.capSteps);

  if (!items.length) return result;

  let progressed = true;
  while (availableSteps > 0 && progressed) {
    progressed = false;
    for (const item of items) {
      if (availableSteps <= 0) break;
      if (item.givenSteps < item.capSteps) {
        item.givenSteps += 1;
        availableSteps -= 1;
        progressed = true;
      }
    }
  }

  for (const item of items) {
    if (item.givenSteps > 0) result.set(item.key, item.givenSteps * stepHours);
  }

  return result;
}

/**
 * Construye el texto y la etiqueta de "Devolución" a partir del detalle
 * consumido de la bolsa compartida, fusionando tramos contiguos del mismo
 * día y recortando a un bloque permitido (2h, 4h u 8h) cuando la unión no
 * cae en uno de esos valores (ej. 6h → se muestra solo 4h). Cuando hubo que
 * recortar, se antepone la cantidad de agentes a la etiqueta para dejar
 * explícito que no todos reciben esa devolución completa ese día.
 */
function buildDevolutionLabel(consumed: ConsumedCompensation[], agents: number): { label: string; text: string } {
  const { text, capped, realHours, shownHours } = mergeAndCapCompensation(consumed);
  if (!capped) return { label: "Devolución", text };

  // Cuando el recorte a bloques permitidos (2h/4h/8h) deja horas realmente
  // consumidas de la bolsa compartida fuera del texto (ej. 6h fusionadas se
  // muestran como 4h), se lo aclaramos en el propio rótulo: de lo contrario
  // el total de "Devolución" que lee el usuario no cierra contra el "(+Xh)"
  // de la fila, aunque las horas sí estén correctamente descontadas.
  const hiddenHours = realHours - shownHours;
  const label =
    hiddenHours > 0.001
      ? `Devolución ${agents} Agentes (${shownHours.toFixed(1)}h mostradas de ${realHours.toFixed(1)}h reales)`
      : `Devolución ${agents} Agentes`;
  return { label, text };
}

const DAY_ORDER = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Convierte una lista de días en un texto que lista CADA día explícitamente,
 * respetando el orden de la semana. No se comprime en rangos con guion
 * (ej. "Miércoles - Sábado") porque esa notación es ambigua: no queda claro
 * si incluye los días intermedios (Jueves, Viernes) o solo los dos extremos.
 * Ej: ["Lunes","Martes"] -> "Lunes, Martes".
 * ["Miércoles","Jueves","Viernes","Sábado"] -> "Miércoles, Jueves, Viernes, Sábado".
 */
function formatDayRange(days: string[]): string {
  const unique = Array.from(new Set(days)).filter(d => DAY_ORDER.includes(d));
  if (!unique.length) return days.join(", ");

  const sorted = unique.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return sorted.join(", ");
}

/**
 * Agrupa las sugerencias de Jornada Extendida que comparten el mismo
 * servicio/subárea, el mismo horario actual/nuevo y la misma cantidad de
 * agentes, en una sola fila con el rango de días correspondiente.
 *
 * Ej:
 *  Lunes  -> 18 agentes, 11:00-20:00 -> 09:00-20:00
 *  Martes -> 18 agentes, 11:00-20:00 -> 09:00-20:00
 * se combinan en:
 *  "Lunes - Martes" -> 18 agentes, 11:00-20:00 -> 09:00-20:00
 */
function groupExtendedSuggestions(suggestions: ActionSuggestion[]): ActionSuggestion[] {
  const groups = new Map<string, ActionSuggestion[]>();

  for (const s of suggestions) {
    const key = `${s.servicio}|${s.subarea}|${s.currentStartHora}|${s.currentEndHora}|${s.newStartHora}|${s.newEndHora}|${s.agents}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const result: ActionSuggestion[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const dayLabel = formatDayRange(group.map(g => g.dia));

    // Delta real de horas de extensión POR DÍA (misma lógica que el caso
    // individual: diferencia entre la duración del turno nuevo y la del
    // turno actual, NO la duración total del turno nuevo), multiplicado por
    // la cantidad de días que integran este grupo. Es imprescindible
    // multiplicar por `group.length`: el texto de "Devolución" que se arma
    // más abajo (`allConsumed`) suma la devolución consumida de TODOS los
    // días del grupo, así que el "(+Xh)" tiene que representar ese mismo
    // total agregado — de lo contrario queda comparando el excedente de un
    // solo día contra una devolución que corresponde a varios días,
    // mostrando un total de devolución más alto de lo que el "+Xh" sugiere.
    const perDayExtensionHours =
      ((toMinutes(group[0].newEndHora) - toMinutes(group[0].newStartHora)) -
        (toMinutes(group[0].currentEndHora) - toMinutes(group[0].currentStartHora))) / 60;
    const extensionHours = perDayExtensionHours * group.length;

    // Se fusiona el detalle REAL (estructurado) de devolución de todos los
    // miembros del grupo, no el texto ya formateado de cada uno — así, si
    // dos días del grupo devuelven horas contiguas del mismo día (ej. 2h +
    // 2h + 2h en Domingo), se unifican en un solo tramo y se recortan al
    // bloque permitido (2h/4h/8h) en vez de mostrarse fragmentadas.
    const allConsumed = group.flatMap(g => g.compensationDetail ?? []);
    const { label: devolutionLabel, text: devolutionText } = buildDevolutionLabel(allConsumed, group[0].agents);

    result.push({
      ...group[0],
      fecha: "Varios días",
      dia: dayLabel,
      avgDeficit: parseFloat((group.reduce((sum, g) => sum + g.avgDeficit, 0) / group.length).toFixed(2)),
      maxDeficit: parseFloat(Math.max(...group.map(g => g.maxDeficit)).toFixed(2)),
      intervalCount: group.reduce((sum, g) => sum + g.intervalCount, 0),
      occurrences: group.length,
      observations: `Jornada Extendida (${dayLabel}) de ${group[0].agents} agentes: ${group[0].currentStartHora}-${group[0].currentEndHora} → ${group[0].newStartHora}-${group[0].newEndHora} (+${extensionHours.toFixed(1)}h). ${devolutionLabel}: ${devolutionText}.`,
      compensationDetail: allConsumed,
    });
  }

  return result;
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

    // 1-4. Primero se evalúa TODA la semana: déficits + gaps positivos (bolsa
    // única compartida, ya descontado lo consumido por Cambio de Horario).
    const weeklyPlan = calculateWeeklyCompensationPlan(servicio, subarea, serviceRows, config, surplusLedger);
    if (!weeklyPlan) continue;

    const candidates: ExtensionNeed[] = [];

    for (const slots of deficitMatrix.values()) {
      if (!slots.length || slots[0].servicio !== servicio || slots[0].subarea !== subarea) continue;

      const byEdge = groupBy(slots.filter(s => s.remainingDeficit > config.minDeficit), s => {
        const rows = getDayRows(serviceRows, s);
        if (!rows.length) return "none";
        const start = Math.min(...rows.map(r => toMinutes(r.hora)));
        const end = Math.max(...rows.map(r => toMinutes(r.hora))) + 30;
        const nearStart = s.startMin - start <= EDGE_WINDOW_HOURS * 60;
        const nearEnd = end - s.endMin <= EDGE_WINDOW_HOURS * 60;
        return nearStart ? "start" : nearEnd ? "end" : "none";
      });

      for (const [edge, edgeSlots] of byEdge) {
        if (edge === "none") continue;
        const need = getExtensionNeed(serviceRows, edgeSlots, config);
        if (need) candidates.push(need);
      }
    }

    if (!candidates.length) continue;

    // No se puede consumir dos veces el mismo día/borde.
    let uniqueCandidates = Array.from(new Map(candidates.map(c => [c.dayKey, c])).values());

    // Límite de días por semana (config.extendedMaxDaysPerWeek): si hay más
    // días distintos con necesidad de extensión que los permitidos para este
    // servicio+subárea, se priorizan los días con mayor déficit (los más
    // críticos) y se descartan los restantes. 7 = sin restricción.
    if (config.extendedMaxDaysPerWeek < 7) {
      const byDay = groupBy(uniqueCandidates, c => c.daySlots[0].fechaSort);
      const dayPriority = Array.from(byDay.entries())
        .map(([fechaSort, cands]) => ({
          fechaSort,
          maxDeficit: Math.max(...cands.flatMap(c => c.daySlots.map(s => s.remainingDeficit))),
        }))
        .sort((a, b) => b.maxDeficit - a.maxDeficit);

      const allowedDays = new Set(
        dayPriority.slice(0, Math.max(0, config.extendedMaxDaysPerWeek)).map(d => d.fechaSort)
      );
      uniqueCandidates = uniqueCandidates.filter(c => allowedDays.has(c.daySlots[0].fechaSort));
    }

    const needsByShift = groupBy(uniqueCandidates, n => n.shiftType);

    // 5-8. Se procesa un turno completo a la vez, en orden fijo (mañana,
    // luego tarde). La disponibilidad de la bolsa compartida (`weeklyPlan.blocks`)
    // se recalcula justo antes de cada turno, y se consume inmediatamente al
    // construir su devolución — así el turno tarde ve automáticamente menos
    // horas disponibles si el turno mañana ya usó parte del solape 11:00-17:00.
    for (const shiftType of SHIFT_PROCESSING_ORDER) {
      const needsList = (needsByShift.get(shiftType) ?? []) as ExtensionNeed[];
      if (!needsList.length) continue;

      const totalAvailable = availableHoursForShift(weeklyPlan.blocks, shiftType, config);
      const allocation = distributeFairly(needsList, totalAvailable, config);

      for (const need of needsList) {
        const allocatedHours = allocation.get(need.dayKey) ?? 0;
        if (allocatedHours <= 0.001) continue;

        const firstSlot = need.daySlots[0];
        const principal = getPrincipalSchedule(need.shiftType, config);
        // La ventana debe permitir al menos las horas máximas configurables
        // (config.extendedMaxHoursPerDay); usar EDGE_WINDOW_HOURS aquí (que es
        // solo el radio de detección de déficit cercano al borde, no un tope
        // de extensión) recortaría silenciosamente allocatedHours cuando el
        // usuario configure más horas de las que EDGE_WINDOW_HOURS permite.
        const scheduleWindowHours = Math.max(EDGE_WINDOW_HOURS, config.extendedMaxHoursPerDay);
        const schedules = calculateExtendedSchedule(
          allocatedHours,
          principal.start - scheduleWindowHours * 60,
          principal.end + scheduleWindowHours * 60,
          config,
          need.shiftType
        );

        const agents = roundAgents(
          Math.max(...need.daySlots.map(s => s.remainingDeficit)),
          config.roundingThreshold
        );

        const consumed = consumeCompensation(
          weeklyPlan.blocks,
          need.shiftType,
          config,
          allocatedHours,
          firstSlot.fechaSort
        );
        const { label: devolutionLabel, text: compensationText } = buildDevolutionLabel(consumed, agents);

        extendida.push({
          type: "extendida",
          servicio: firstSlot.servicio,
          subarea: firstSlot.subarea,
          fecha: firstSlot.fecha,
          dia: firstSlot.dia,
          currentStartHora: toHHMM(principal.start),
          currentEndHora: toHHMM(principal.end),
          newStartHora: toHHMM(schedules.new.start),
          newEndHora: toHHMM(schedules.new.end),
          agents,
          avgDeficit: parseFloat((need.daySlots.reduce((sum, s) => sum + s.remainingDeficit, 0) / need.daySlots.length).toFixed(2)),
          maxDeficit: parseFloat(Math.max(...need.daySlots.map(s => s.remainingDeficit)).toFixed(2)),
          intervalCount: need.daySlots.length,
          occurrences: 1,
          observations: `Jornada Extendida (${firstSlot.dia}) de ${agents} agentes: ${toHHMM(principal.start)}-${toHHMM(principal.end)} → ${toHHMM(schedules.new.start)}-${toHHMM(schedules.new.end)} (+${allocatedHours.toFixed(1)}h). ${devolutionLabel}: ${compensationText}.`,
          compensationDetail: consumed,
        });

        applyCoverage(deficitMatrix, {
          type: "extendida",
          servicio: firstSlot.servicio,
          subarea: firstSlot.subarea,
          fecha: firstSlot.fecha,
          fechaSort: firstSlot.fechaSort,
          dia: firstSlot.dia,
          startMin: schedules.new.start,
          endMin: schedules.new.end,
          agents,
          coverageAmount: agents,
        });
      }
    }
  }

  return groupExtendedSuggestions(extendida);
}

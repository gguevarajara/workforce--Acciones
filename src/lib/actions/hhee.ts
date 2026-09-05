/**
 * Lógica de HHEE (Horas Extra Económicas)
 *
 * REGLAS DE GENERACIÓN:
 * 1. Agrupar los intervalos consecutivos con déficit en el rango más largo posible.
 * 2. El rango de una HHEE se expresa en horas completas, incluyendo
 *    siempre la hora completa que contiene al último intervalo con
 *    déficit (aunque ese intervalo empiece justo en punto de hora):
 *      08:30 - 10:30 -> 08:00 - 11:00
 *      08:30 - 11:00 -> 08:00 - 12:00  (11:00 pertenece a la hora 11:00-12:00)
 * 3. Dentro de cada hora se toma el MAYOR déficit de sus intervalos.
 * 4. Las HHEE se construyen por capas (una pila de incrementos de agentes):
 *      - SUBIR: si el déficit de una hora supera el nivel ya cubierto, SIEMPRE
 *        se abre una capa nueva por la diferencia completa, sin importar cuán
 *        chica sea. Un intervalo con déficit nunca puede quedar sin cubrir.
 *      - BAJAR: si el déficit de una hora cae por debajo del nivel cubierto,
 *        la capa (o capas) más reciente(s) se cierran SOLO si la caída supera
 *        LAYER_TOLERANCE_AGENTS. Caídas más chicas se sostienen (se acepta
 *        algo de sobre-cobertura, acotada por esa tolerancia) para no
 *        fragmentar la acción en demasiados tramos pequeños.
 *    Esto evita generar acciones innecesarias y mantiene el mayor rango
 *    posible, sin sostener indefinidamente un pico que ya bajó de forma
 *    significativa (ej. no arrastrar el máximo de la mañana hasta el cierre
 *    de la noche si el déficit real ya bajó mucho en el camino).
 * 5. Los intervalos sin déficit no generan acciones por sí mismos. Solo pueden
 *    quedar dentro del rango porque son necesarios para redondear una HHEE
 *    a horas completas.
 * 6. Las acciones resultantes de un mismo rango continuo se ordenan del rango
 *    más amplio (en duración) al más chico.
 */

import type {
  ActionSuggestion,
  ActionsEngineConfig,
  DeficitSlot,
} from "./types";
import { toHHMM, groupBy, roundAgents } from "./utils";
import { applyCoverage } from "./deficitMatrix";

const SLOT_MINUTES = 30;
const HOUR_MINUTES = 60;

/**
 * Devuelve el inicio de la hora que contiene el intervalo.
 * Ejemplo: 08:30 -> 08:00.
 */
function floorToHour(minutes: number): number {
  return Math.floor(minutes / HOUR_MINUTES) * HOUR_MINUTES;
}

/**
 * Devuelve el final de la hora que CONTIENE al intervalo (no el fin del
 * propio intervalo). Un intervalo de 30 min que empieza justo en punto de
 * hora (ej. 11:00) pertenece a la hora 11:00-12:00, por lo que su "fin de
 * hora" debe ser 12:00, no 11:00.
 *
 * Antes se usaba Math.ceil(minutes/60)*60, que para un valor ya múltiplo de
 * 60 (ej. 660 = 11:00) devolvía el mismo valor (660) en vez de avanzar a la
 * siguiente hora (720 = 12:00). Esto hacía que la hora que contenía al
 * último intervalo del rango nunca se recorriera en buildHourlyLayers,
 * dejando ese déficit completamente sin cubrir cuando el rango terminaba
 * justo en punto de hora.
 *
 * Ejemplos:
 *   10:30 (630) -> 11:00 (660)
 *   11:00 (660) -> 12:00 (720)
 */
function ceilToHour(minutes: number): number {
  return floorToHour(minutes) + HOUR_MINUTES;
}

/**
 * Agrupa los slots consecutivos con déficit.
 *
 * Un nuevo bloque empieza cuando entre dos intervalos existe un hueco.
 * Los intervalos deben estar separados exactamente por 30 minutos.
 */
function splitIntoContinuousRanges(slots: DeficitSlot[]): DeficitSlot[][] {
  if (slots.length === 0) return [];

  const ordered = [...slots].sort((a, b) => a.startMin - b.startMin);
  const ranges: DeficitSlot[][] = [];
  let current: DeficitSlot[] = [ordered[0]];

  for (let i = 1; i < ordered.length; i++) {
    const previous = current[current.length - 1];
    const currentSlot = ordered[i];

    if (currentSlot.startMin - previous.startMin === SLOT_MINUTES) {
      current.push(currentSlot);
    } else {
      ranges.push(current);
      current = [currentSlot];
    }
  }

  ranges.push(current);
  return ranges;
}

/**
 * Tolerancia (en agentes) para evitar fragmentar las HHEE en demasiadas
 * acciones pequeñas cuando el déficit sube y baja varias veces dentro del
 * mismo rango continuo (ej. un día completo con varios picos y valles).
 *
 * Se aplica SOLO al bajar: una capa se cierra únicamente si la caída
 * respecto al nivel ya cubierto supera esta cantidad de agentes. Caídas
 * más chicas se sostienen (quedan absorbidas por la capa vigente), lo que
 * acota la sobre-cobertura posible en esas horas a como máximo este valor.
 *
 * Nunca se aplica al subir: una subida de déficit, por chica que sea,
 * siempre abre una capa nueva por el 100% de la diferencia, porque ningún
 * intervalo con déficit puede quedar sin cubrir.
 *
 * Valor acordado con negocio: 5 agentes. Ajustar aquí si se necesita más o
 * menos tolerancia (más alto = menos acciones pero más sobre-cobertura
 * posible; más bajo = cobertura más ajustada pero más acciones).
 */
export const LAYER_TOLERANCE_AGENTS = 5;

/**
 * Déficit mínimo (en agentes) para que un intervalo cuente como candidato de
 * HHEE. Es un umbral FIJO propio de HHEE, distinto de `config.minDeficit`
 * (que sí es configurable y se usa en Cambio de Horario y Jornadas
 * Extendidas). No se expone como configurable porque HHEE es el último
 * eslabón de la cadena y este valor evita generar acciones por ruido
 * decimal casi nulo.
 */
export const HHEE_MIN_DEFICIT_AGENTS = 0.5;

/**
 * Calcula las capas de HHEE para un rango continuo.
 *
 * Ejemplo simple (déficit que solo sube y se corta, sin bajar antes del
 * final del rango):
 *   08:00 = 9
 *   08:30 = 11
 *   09:00 = 12
 *   09:30 = 15
 *   10:00 = 18
 *   10:30 = 18
 *
 * Resultado:
 *   11 agentes -> 08:00 - 11:00
 *    4 agentes -> 09:00 - 11:00
 *    3 agentes -> 10:00 - 11:00
 *
 * Cuando el déficit sube y BAJA varias veces dentro del mismo rango (ej. un
 * día completo), las capas también se cierran cuando la baja es mayor a
 * LAYER_TOLERANCE_AGENTS, en vez de sostener el pico indefinidamente hasta
 * el final del rango.
 *
 * El cálculo se hace por hora y no por cada media hora.
 */
function buildHourlyLayers(
  range: DeficitSlot[],
  config: ActionsEngineConfig
): Array<{
  startMin: number;
  endMin: number;
  agents: number;
}> {
  if (range.length === 0) return [];

  const ordered = [...range].sort((a, b) => a.startMin - b.startMin);

  // El horario mostrado termina en la hora que contiene el último intervalo.
  // Así, por ejemplo, 08:30 - 10:30 se convierte en 08:00 - 11:00.
  const rangeStart = floorToHour(ordered[0].startMin);
  const rangeEnd = ceilToHour(ordered[ordered.length - 1].startMin);

  // Máximo déficit existente dentro de cada hora, ya redondeado a una
  // cantidad entera de agentes (así la tolerancia se compara en unidades
  // reales de personas, no en fracciones de déficit).
  const hourlyMaxAgents = new Map<number, number>();

  for (const slot of ordered) {
    const hourStart = floorToHour(slot.startMin);
    const deficit = Math.max(0, slot.remainingDeficit);

    if (deficit <= HHEE_MIN_DEFICIT_AGENTS) continue;

    const agentsNeeded = roundAgents(deficit, config.roundingThreshold);
    const currentMax = hourlyMaxAgents.get(hourStart) ?? 0;
    hourlyMaxAgents.set(hourStart, Math.max(currentMax, agentsNeeded));
  }

  // Capas activas (pila): cada una representa un incremento de agentes que
  // arrancó en cierta hora y sigue vigente. Se cierran en orden LIFO (la
  // más reciente / más alta primero) cuando el déficit baja lo suficiente.
  const active: Array<{ startMin: number; agents: number }> = [];
  const layers: Array<{ startMin: number; endMin: number; agents: number }> =
    [];

  let coveredLevel = 0;

  for (
    let hourStart = rangeStart;
    hourStart < rangeEnd;
    hourStart += HOUR_MINUTES
  ) {
    const need = hourlyMaxAgents.get(hourStart) ?? 0;

    if (need > coveredLevel) {
      // Cualquier subida se cubre al 100%, sin tolerancia: ningún
      // intervalo con déficit puede quedar sin cubrir.
      active.push({ startMin: hourStart, agents: need - coveredLevel });
      coveredLevel = need;
    } else if (need < coveredLevel - LAYER_TOLERANCE_AGENTS) {
      // La baja supera la tolerancia: cerrar capas empezando por la más
      // reciente (la más alta) hasta llegar al nivel realmente necesario.
      let toRemove = coveredLevel - need;

      while (toRemove > 0 && active.length > 0) {
        const top = active[active.length - 1];

        if (top.agents <= toRemove) {
          layers.push({
            startMin: top.startMin,
            endMin: hourStart,
            agents: top.agents,
          });
          toRemove -= top.agents;
          active.pop();
        } else {
          layers.push({
            startMin: top.startMin,
            endMin: hourStart,
            agents: toRemove,
          });
          top.agents -= toRemove;
          toRemove = 0;
        }
      }

      coveredLevel = need;
    }
    // Si la baja está dentro de la tolerancia (o no hubo baja), no se toca
    // nada: se sostiene el nivel ya cubierto.
  }

  // Cerrar todo lo que siga activo al llegar al final del rango.
  for (const layer of active) {
    layers.push({
      startMin: layer.startMin,
      endMin: rangeEnd,
      agents: layer.agents,
    });
  }

  // Del rango más amplio (en duración) al más chico; a igual duración, el
  // de mayor cantidad de agentes primero.
  layers.sort((a, b) => {
    const durationDiff = b.endMin - b.startMin - (a.endMin - a.startMin);
    if (durationDiff !== 0) return durationDiff;
    return b.agents - a.agents;
  });

  return layers;
}

/**
 * Genera acciones HHEE en modo agregado.
 */
export function generateHheeAggregated(
  deficitMatrix: Map<string, DeficitSlot[]>,
  config: ActionsEngineConfig
): ActionSuggestion[] {
  const hhee: ActionSuggestion[] = [];

  const hheeCandidates: DeficitSlot[] = [];

  // Solo se consideran intervalos que realmente tienen déficit.
  for (const [, slots] of deficitMatrix) {
    for (const slot of slots) {
      if (slot.remainingDeficit > HHEE_MIN_DEFICIT_AGENTS) {
        hheeCandidates.push(slot);
      }
    }
  }

  const hheeByDay = groupBy(
    hheeCandidates,
    s => `${s.servicio}|${s.subarea}|${s.fechaSort}`
  );

  for (const [, daySlots] of hheeByDay) {
    if (daySlots.length === 0) continue;

    const continuousRanges = splitIntoContinuousRanges(daySlots);

    for (const range of continuousRanges) {
      if (range.length === 0) continue;

      const layers = buildHourlyLayers(range, config);

      for (const layer of layers) {
        // layer.agents ya es una cantidad entera de agentes: cada capa se
        // calculó a partir del déficit por hora ya redondeado dentro de
        // buildHourlyLayers, así que no hace falta redondear de nuevo.
        const agents = layer.agents;

        if (agents < 1) continue;

        const deficit = agents;

        const suggestion: ActionSuggestion = {
          type: "hhee",
          servicio: range[0].servicio,
          subarea: range[0].subarea,
          fecha: range[0].fecha,
          dia: range[0].dia,
          currentStartHora: "",
          currentEndHora: "",
          newStartHora: toHHMM(layer.startMin),
          newEndHora: toHHMM(layer.endMin),
          agents,
          avgDeficit: deficit,
          maxDeficit: deficit,
          intervalCount: range.length,
          occurrences: 1,
          observations: "",
        };

        hhee.push(suggestion);

        // Registrar la cobertura en la matriz usando la cantidad real
        // redondeada de agentes de la acción.
        applyCoverage(deficitMatrix, {
          type: "hhee",
          servicio: range[0].servicio,
          subarea: range[0].subarea,
          fecha: range[0].fecha,
          fechaSort: range[0].fechaSort,
          dia: range[0].dia,
          startMin: layer.startMin,
          endMin: layer.endMin,
          agents,
          coverageAmount: agents,
        });
      }
    }
  }

  return hhee;
}

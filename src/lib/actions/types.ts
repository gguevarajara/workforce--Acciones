/**
 * Tipos e interfaces para el motor de acciones
 */

import type { ConsumedCompensation } from "./compensation";

export type ActionType = "cambio" | "extendida" | "hhee";
export type CoverageBase = "officials" | "officials_hhee" | "officials_hhee_ojt";

/**
 * Franja horaria del día para la homogeneización de GAP en Cambio de
 * Horario. "none" es el intervalo que no cae en ninguna de las 3 franjas
 * configuradas (por ejemplo, si el usuario deja huecos entre ellas): sigue
 * contando para el déficit/excedente total, pero no participa del cálculo
 * de balance entre franjas.
 */
export type TimeZoneName = "morning" | "closing" | "madrugada" | "none";

export interface DeficitSlot {
  servicio: string;
  subarea: string;
  fecha: string;
  fechaSort: string;
  dia: string;
  hora: string;
  startMin: number;
  endMin: number;
  originalDeficit: number;
  remainingDeficit: number;
  coveredBy: ActionType[];
}

export interface CoverageResult {
  type: ActionType;
  servicio: string;
  subarea: string;
  fecha: string;
  fechaSort: string;
  dia: string;
  startMin: number;
  endMin: number;
  agents: number;
  coverageAmount: number;
}

export interface ActionSuggestion {
  type: ActionType;
  servicio: string;
  subarea: string;
  fecha: string;
  dia: string;
  currentStartHora: string;
  currentEndHora: string;
  newStartHora: string;
  newEndHora: string;
  agents: number;
  avgDeficit: number;
  maxDeficit: number;
  intervalCount: number;
  occurrences: number;
  observations: string;
  /** Detalle estructurado de la devolución consumida de la bolsa compartida
   *  (solo Jornadas Extendidas). Permite fusionar/recortar correctamente al
   *  agrupar varias filas, en vez de re-parsear el texto ya formateado. */
  compensationDetail?: ConsumedCompensation[];
}

export interface GeneratedActions {
  cambio: ActionSuggestion[];
  extendida: ActionSuggestion[];
  hhee: ActionSuggestion[];
}

export interface ActionsEngineConfig {
  minDeficit: number;
  roundingThreshold: number;
  enableCambio: boolean;
  enableExtendida: boolean;
  enableHhee: boolean;
  coverageBase: CoverageBase;
  workHours: number;
  breakHours: number;
  // Horarios de turno estándar (en minutos desde 00:00)
  shiftStartMorning: number;
  shiftEndMorning: number;
  shiftStartAfternoon: number;
  shiftEndAfternoon: number;
  // --- Configuración de Cambio de Horario (redistribución semanal de cobertura) ---
  // Rango horario operativo (en minutos desde 00:00 del día)
  minEntryMinutes: number; // Hora mínima de ingreso permitida (default 06:00)
  maxExitMinutes: number; // Hora máxima de salida permitida (default 00:00 = 1440)
  // Turnos de madrugada (cruzan medianoche, p.ej. 21:00-06:00)
  allowMadrugada: boolean; // Permite generar/evaluar turnos que cruzan medianoche
  madrugadaStartMinutes: number; // Compatibilidad: inicio de referencia de madrugada (default 21:00)
  madrugadaShiftPreset: "21-06" | "22-07"; // Turno estándar de madrugada permitido
  // Búsqueda de horarios candidatos (desplazamiento del turno actual)
  maxShiftDisplacementMinutes: number; // Máximo desplazamiento evaluado respecto al horario actual
  // Granularidad de horario del motor (en minutos). Paso mínimo entre los
  // horarios que el motor puede proponer. Se usa en DOS lugares:
  //  - Cambio de Horario: paso entre horarios candidatos evaluados.
  //  - Jornadas Extendidas: paso del reparto de horas de extensión/devolución.
  // HHEE no usa este campo: por regla de negocio siempre trabaja en horas
  // completas (ver comentario de cabecera en hhee.ts), sin importar este valor.
  scheduleGranularityMinutes: number;
  // Evaluación y aplicación del cambio
  // La evaluación de GAPS siempre es semanal (regla fija del motor, según el
  // documento de lógica: "el motor debe analizar siempre los GAPS de toda la
  // semana"). Lo único configurable es el ALCANCE DE APLICACIÓN.
  cambioApplicationScope:
    | "full_week"        // Toda la semana
    | "weekdays"          // Lunes a viernes / días laborales
    | "specific_days"     // Días específicos elegidos por el usuario
    | "consecutive_days"  // Los primeros N días consecutivos del período analizado
    | "custom_pattern";   // Patrón personalizado de días (texto libre)
  cambioSpecificDays: string[]; // Días usados cuando el alcance es "specific_days" (ej. ["Lunes","Miércoles","Viernes"])
  cambioConsecutiveDaysCount: number; // Cantidad de días consecutivos usados cuando el alcance es "consecutive_days"
  cambioCustomPattern: string; // Patrón personalizado usado cuando el alcance es "custom_pattern" (días separados por coma)
  // Tolerancia de deterioro de cobertura permitida (en agentes) por CADA DÍA
  // individual antes de descartar un candidato. Evita "solucionar un día
  // generando déficits importantes en otros" (regla explícita del documento).
  dailyDeteriorationTolerance: number;
  // --- Homogeneización de GAP por franja horaria (Cambio de Horario) ---
  // Además de minimizar el desbalance TOTAL de la semana (déficit + excedente
  // de todos los intervalos juntos), el motor puede premiar además que ese
  // desbalance quede repartido de forma pareja entre 3 franjas horarias
  // configurables (mañana, cierre, madrugada), en vez de solo mirar la suma
  // global. Ver `classifyTimeZone` en utils.ts.
  enableZoneBalancing: boolean;
  // Límites de cada franja, en minutos desde las 00:00. Cada franja admite
  // start > end para representar un rango que cruza medianoche (ej.
  // madrugada 22:00→06:00 se guarda como start=1320, end=360).
  zoneMorningStartMinutes: number;
  zoneMorningEndMinutes: number;
  zoneClosingStartMinutes: number;
  zoneClosingEndMinutes: number;
  zoneMadrugadaStartMinutes: number;
  zoneMadrugadaEndMinutes: number;
  // Peso del término de homogeneización dentro del score de Cambio de
  // Horario (ver `pickBestQuantityForCandidate`). 0 = el balance por franja
  // no influye en absoluto en la elección (equivalente a apagar
  // `enableZoneBalancing`); valores altos priorizan parejo-entre-franjas
  // incluso a costa de un poco de mejora total.
  zoneBalancingWeight: number;
  // --- Configuración de Jornadas Extendidas ---
  // Máximo de horas adicionales que se le puede sumar al horario estándar
  // de un turno (mañana/tarde) en un mismo día.
  extendedMaxHoursPerDay: number;
  // Máximo de días distintos por semana, dentro de un mismo servicio+subárea,
  // en los que se puede aplicar Jornada Extendida. Cuando hay más días con
  // necesidad de extensión que este límite, se priorizan los días con mayor
  // déficit. Valor 7 = sin restricción (se puede extender cualquier día).
  extendedMaxDaysPerWeek: number;
}

/**
 * Registro de cuánto excedente (GAP POSITIVO) ya fue consumido por Cambio de
 * Horario al mover cobertura desde un intervalo con excedente hacia uno con
 * déficit. Jornadas Extendidas debe descontar esto antes de ofrecer ese mismo
 * excedente como devolución (evita contar dos veces las mismas horas).
 * Clave: `${servicio}|${subarea}|${fechaSort}`.
 */
export interface SurplusConsumption {
  startMin: number;
  endMin: number;
  consumedAgents: number;
}
export type SurplusLedger = Map<string, SurplusConsumption[]>;


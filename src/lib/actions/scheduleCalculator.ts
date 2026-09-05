/**
 * Cálculo de horarios para acciones
 *
 * REGLA FUNDAMENTAL: Respetar siempre el horario principal del agente
 * 
 * Para Jornadas Extendidas:
 * - Turno mañana 08:00-17:00 → extensión: 08:00-19:00 (mantiene inicio, extiende fin)
 * - Turno tarde 11:00-20:00 → extensión: 09:00-20:00 (mantiene fin, extiende inicio)
 * 
 * Para Devoluciones:
 * - 08:00-17:00 → devolución: 08:00-12:00 o 13:00-17:00 (dentro del horario principal)
 * - 11:00-20:00 → devolución: 11:00-15:00 o 16:00-20:00 (dentro del horario principal)
 */

import type { ActionsEngineConfig } from "./types";

export interface ScheduleResult {
  current: { start: number; end: number };
  new: { start: number; end: number };
}

export type ShiftType = "morning" | "afternoon";

/**
 * Determina el tipo de turno basado en el horario principal del agente
 *
 * CORRECCIÓN: Usar siempre el horario principal configurado, no inferir del déficit
 * Por defecto usamos turno mañana (08:00-17:00) como horario principal estándar.
 *
 * NOTA: esta función es un valor de respaldo (fallback). Hoy el único
 * llamador real (`calculateExtendedSchedule`) siempre recibe `forcedShiftType`
 * explícito desde `jornadasExtendidas.ts`, así que esta rama nunca se
 * ejecuta en producción. Se deja documentado explícitamente para que, si en
 * el futuro se llama sin `forcedShiftType`, quede claro que el turno por
 * defecto es "mañana" por diseño y no un descuido — no toma `config` como
 * entrada porque, por ahora, no existe una regla para inferir el turno a
 * partir de la configuración (solo desde el déficit real, que este helper
 * deliberadamente no usa).
 */
export function determineShiftType(_config: ActionsEngineConfig): ShiftType {
  return "morning";
}

/**
 * Calcula horario principal del agente según tipo de turno
 * 
 * VALIDACIÓN: Los horarios principales deben respetar la duración de jornada
 * laboral configurada (workHours + breakHours). Si los horarios configurados
 * (shiftStartMorning, shiftEndMorning, etc.) no corresponden a esta duración,
 * se ajustan automáticamente para garantizar consistencia.
 */
export function getPrincipalSchedule(shiftType: ShiftType, config: ActionsEngineConfig): { start: number; end: number } {
  const totalDuration = (config.workHours + config.breakHours) * 60; // en minutos
  
  if (shiftType === "morning") {
    const configuredStart = config.shiftStartMorning;
    const configuredEnd = config.shiftEndMorning;
    const configuredDuration = configuredEnd - configuredStart;
    
    // Si la duración configurada no coincide con la jornada laboral, ajustar el fin
    if (Math.abs(configuredDuration - totalDuration) > 1) {
      return {
        start: configuredStart,
        end: configuredStart + totalDuration
      };
    }
    
    return {
      start: configuredStart,
      end: configuredEnd
    };
  } else {
    const configuredStart = config.shiftStartAfternoon;
    const configuredEnd = config.shiftEndAfternoon;
    const configuredDuration = configuredEnd - configuredStart;
    
    // Si la duración configurada no coincide con la jornada laboral, ajustar el fin
    if (Math.abs(configuredDuration - totalDuration) > 1) {
      return {
        start: configuredStart,
        end: configuredStart + totalDuration
      };
    }
    
    return {
      start: configuredStart,
      end: configuredEnd
    };
  }
}

/**
 * Calcula horario extendido respetando el horario principal del agente
 * 
 * @param additionalHours - Horas adicionales a extender
 * @param windowStartMin - Inicio de ventana operativa
 * @param windowEndMin - Fin de ventana operativa
 * @param config - Configuración del motor
 * @returns Horario extendido manteniendo el horario principal
 */
export function calculateExtendedSchedule(
  additionalHours: number,
  windowStartMin: number,
  windowEndMin: number,
  config: ActionsEngineConfig,
  forcedShiftType?: ShiftType
): ScheduleResult {
  // VALIDACIÓN DE SEGURIDAD: asegurar que nunca se exceda el límite configurado
  // de horas máximas de extensión por día, independientemente de cómo se calcule
  // additionalHours en las funciones llamantes
  const safeAdditionalHours = Math.min(additionalHours, config.extendedMaxHoursPerDay);
  
  // Determinar tipo de turno y horario principal (usar configuración, no inferir del déficit)
  const shiftType = forcedShiftType ?? determineShiftType(config);
  const principalSchedule = getPrincipalSchedule(shiftType, config);
  
  let newStart = principalSchedule.start;
  let newEnd = principalSchedule.end;
  
  // Calcular extensión manteniendo el horario principal
  if (shiftType === "morning") {
    // Turno mañana (08:00-17:00): extiende el final
    // Ejemplo: 08:00-17:00 + 2h = 08:00-19:00
    newEnd = Math.min(windowEndMin, principalSchedule.end + (safeAdditionalHours * 60));
  } else {
    // Turno tarde (11:00-20:00): extiende el inicio
    // Ejemplo: 11:00-20:00 + 2h = 09:00-20:00
    newStart = Math.max(windowStartMin, principalSchedule.start - (safeAdditionalHours * 60));
  }
  
  return {
    current: { start: principalSchedule.start, end: principalSchedule.end },
    new: { start: newStart, end: newEnd }
  };
}


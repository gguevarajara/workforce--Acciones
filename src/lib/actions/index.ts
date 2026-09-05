/**
 * Motor de Generación de Acciones - Punto de entrada principal
 *
 * Este módulo coordina la generación de acciones de cobertura para déficit
 * de personal, siguiendo una cadena de dependencia ACUMULATIVA:
 * Horario base → Cambio de Horario → Jornada Extendida → HHEE
 *
 * Cada acción activa toma como base el déficit remanente que dejaron las
 * acciones previas de la cadena (si están activas). Si una acción no está
 * seleccionada, no interviene en el cálculo, pero la cadena continúa con
 * el resultado de la(s) acción(es) anterior(es) que sí estén activas.
 */

import type { Row } from "../types/analysis";
import type {
  ActionSuggestion,
  ActionsEngineConfig,
  GeneratedActions,
  SurplusLedger,
} from "./types";
import { DEFAULT_ENGINE_CONFIG } from "./config";
import { getDeficitFromRow } from "./utils";
import { createDeficitMatrix } from "./deficitMatrix";
import { generateCambioAggregated } from "./cambioHorario";
import { generateJornadasExtendidasAggregated } from "./jornadasExtendidas";
import { generateHheeAggregated } from "./hhee";

/**
 * Genera acciones con cálculo secuencial de déficit restante
 *
 * @param rows - Filas de datos de análisis con déficit
 * @param config - Configuración del motor de acciones
 * @returns Objeto con arrays de acciones por tipo
 */
export function generateActions(
  rows: Row[],
  config: ActionsEngineConfig = DEFAULT_ENGINE_CONFIG
): GeneratedActions {
  try {
    if (!rows || rows.length === 0) {
      return { cambio: [], extendida: [], hhee: [] };
    }

    // Validar que los rows tengan los campos necesarios
    const validRows = rows.filter(row => {
      return row &&
             typeof row === "object" &&
             typeof row.hora === "string" &&
             typeof row.servicio === "string" &&
             typeof row.subarea === "string" &&
             typeof row.fecha === "string" &&
             typeof row.fechaSort === "string" &&
             typeof row.dia === "string" &&
             typeof row.difOficiales === "number" &&
             typeof row.difOficialesHhee === "number" &&
             typeof row.difOficialesHheeOjt === "number" &&
             typeof row.dispRequerido === "number" &&
             typeof row.dispOficiales === "number";
    });

    if (validRows.length === 0) {
      return { cambio: [], extendida: [], hhee: [] };
    }

    // Verificar si hay déficit según la Base de Cobertura seleccionada
    // (antes se usaba siempre difOficiales, ignorando coverageBase)
    const rowsWithDeficit = validRows.filter(r => getDeficitFromRow(r, config.coverageBase) < 0);

    if (rowsWithDeficit.length === 0) {
      return { cambio: [], extendida: [], hhee: [] };
    }

    // Si todas las acciones están desactivadas, no generar nada
    if (!config.enableCambio && !config.enableExtendida && !config.enableHhee) {
      return { cambio: [], extendida: [], hhee: [] };
    }

    // PASO 1: Crear matriz de déficit original (horario base)
    const deficitMatrix = createDeficitMatrix(validRows, config);

    // Ledger de excedente (GAP POSITIVO) consumido por Cambio de Horario al
    // mover cobertura hacia un déficit. Jornadas Extendidas lo usa para no
    // volver a ofrecer esas mismas horas como devolución (ver compensation.ts).
    const surplusLedger: SurplusLedger = new Map();

    const cambio: ActionSuggestion[] = [];
    const extendida: ActionSuggestion[] = [];
    const hhee: ActionSuggestion[] = [];

    // PASO 2: Cálculo ACUMULATIVO según la cadena de dependencia
    // Horario base → Cambio de Horario → Jornada Extendida → HHEE
    //
    // Las tres acciones comparten UNA sola matriz de déficit (deficitMatrix),
    // no copias independientes. Cada generador reduce/actualiza el
    // `remainingDeficit` de esa misma matriz a medida que cubre intervalos
    // (ver applyCambioToMatrix en cambioHorario.ts y applyCoverage en
    // deficitMatrix.ts, usado por jornadasExtendidas.ts y hhee.ts).
    // Así, la siguiente acción de la cadena siempre parte del déficit que
    // dejaron pendiente las acciones anteriores que estén activas.
    // Si una acción no está seleccionada, simplemente no se ejecuta y no
    // aporta cambios a la matriz, pero la cadena continúa normalmente con
    // el resultado de la(s) acción(es) previa(s) que sí se hayan aplicado.

    // PASO 3: Cambio de Horario (primer eslabón de la cadena)
    if (config.enableCambio) {
      const cambioAggregated = generateCambioAggregated(validRows, config, deficitMatrix, surplusLedger);
      cambio.push(...cambioAggregated);
    }

    // PASO 4: Jornadas Extendidas (toma en cuenta el déficit remanente tras
    // el Cambio de Horario, si estuvo activo)
    if (config.enableExtendida) {
      const extendidaAggregated = generateJornadasExtendidasAggregated(validRows, config, deficitMatrix, surplusLedger);
      extendida.push(...extendidaAggregated);
    }

    // PASO 5: HHEE (toma en cuenta el déficit remanente tras Cambio de
    // Horario y Jornadas Extendidas, si estuvieron activos)
    if (config.enableHhee) {
      const hheeAggregated = generateHheeAggregated(deficitMatrix, config);
      hhee.push(...hheeAggregated);
    }

    // Ordenar resultados
    cambio.sort((a, b) => a.servicio.localeCompare(b.servicio));
    extendida.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.servicio.localeCompare(b.servicio));
    hhee.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.servicio.localeCompare(b.servicio));

    return { cambio, extendida, hhee };
  } catch (error) {
    console.error("[GENERATE-ACTIONS-ERROR] Error generating actions:", error);
    return { cambio: [], extendida: [], hhee: [] };
  }
}

// Re-exportar tipos y configuración para uso externo
export type { ActionSuggestion, ActionsEngineConfig, GeneratedActions, CoverageBase, ActionType } from "./types";
export { DEFAULT_ENGINE_CONFIG, getTotalWorkDuration, EDGE_WINDOW_HOURS, FULL_DAY_OFF_HOURS, ACTIONS_CONFIG_STORAGE_KEY } from "./config";
export { LAYER_TOLERANCE_AGENTS, HHEE_MIN_DEFICIT_AGENTS } from "./hhee";
export { calculateExtendedSchedule, determineShiftType, getPrincipalSchedule } from "./scheduleCalculator";

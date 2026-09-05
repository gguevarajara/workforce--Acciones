/**
 * Creación y manipulación de la matriz de déficit
 */

import type { Row } from "../types/analysis";
import type { DeficitSlot, CoverageResult, ActionsEngineConfig } from "./types";
import { getDeficitFromRow, toMinutes } from "./utils";

/**
 * Crea matriz de déficit por día y franja horaria para cálculo secuencial
 */
export function createDeficitMatrix(rows: Row[], config: ActionsEngineConfig): Map<string, DeficitSlot[]> {
  const matrix = new Map<string, DeficitSlot[]>();

  for (const row of rows) {
    const deficit = getDeficitFromRow(row, config.coverageBase);
    if (deficit >= 0) continue; // Solo procesar déficit

    const key = `${row.servicio}|${row.subarea}|${row.fechaSort}`;
    if (!matrix.has(key)) {
      matrix.set(key, []);
    }

    const startMin = toMinutes(row.hora);
    const endMin = startMin + 30; // Asumiendo intervalos de 30 min

    matrix.get(key)!.push({
      servicio: row.servicio,
      subarea: row.subarea,
      fecha: row.fecha,
      fechaSort: row.fechaSort,
      dia: row.dia,
      hora: row.hora,
      startMin,
      endMin,
      originalDeficit: -deficit,
      remainingDeficit: -deficit,
      coveredBy: [],
    });
  }

  return matrix;
}

/**
 * Aplica cobertura a un slot en la matriz de déficit
 */
export function applyCoverage(
  matrix: Map<string, DeficitSlot[]>,
  coverage: CoverageResult
): void {
  const key = `${coverage.servicio}|${coverage.subarea}|${coverage.fechaSort}`;
  const slots = matrix.get(key);

  if (!slots) return;

  for (const slot of slots) {
    // Verificar si el slot está dentro del rango de cobertura
    if (slot.startMin >= coverage.startMin && slot.endMin <= coverage.endMin) {
      // Reducir déficit restante
      slot.remainingDeficit = Math.max(0, slot.remainingDeficit - coverage.coverageAmount);
      slot.coveredBy.push(coverage.type);
    }
  }
}


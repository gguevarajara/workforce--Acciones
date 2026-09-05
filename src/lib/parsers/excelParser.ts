import type { Row } from "../types/analysis";

export const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Descarta años imposibles (ej. un número de serie de Excel mal interpretado). */
function isValidDateParts(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
  );
}

function parseDateStr(raw: string): Date | null {
  // formats: "10/08/2026" (DD/MM/YYYY) o "2026-08-10" (YYYY-MM-DD)
  if (!raw) return null;
  const str = String(raw).trim();

  // "10/08/2026"
  const slashParts = str.split("/");
  if (slashParts.length === 3) {
    const [d, m, y] = slashParts.map(Number);
    if (!isValidDateParts(y, m, d)) return null;
    return new Date(y, m - 1, d);
  }

  // "2026-08-10" — se arma manualmente en hora LOCAL, igual que la rama de
  // arriba. `new Date("2026-08-10")` la interpretaría como medianoche UTC,
  // y como el resto del archivo lee la fecha con getters locales
  // (getDate/getMonth/getDay en formatDate/isoDate/DAYS[...]), eso corría
  // la fecha un día hacia atrás en cualquier huso detrás de UTC (incluido
  // Perú, UTC-5): un lunes 2026-08-10 se leía como domingo 9 de agosto.
  const dashParts = str.split("-");
  if (dashParts.length === 3) {
    const [y, m, d] = dashParts.map(Number);
    if (!isValidDateParts(y, m, d)) return null;
    return new Date(y, m - 1, d);
  }

  // Último recurso (formato no anticipado): dejar que Date lo intente, pero
  // validando que el resultado sea una fecha real y no un absurdo — por
  // ejemplo, un número de serie de Excel sin formatear ("46247") que Date
  // interpretaría como el año literal 46247 sin lanzar ningún error.
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  if (!isValidDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate())) return null;
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Column indices (0-based) expected in the "Planificado" export:
 *  0  Cuenta
 *  1  Sub área
 *  2  Servicio
 *  3  Fecha
 *  4  Intervalo (hora)
 *  5  Tipo intervalo
 *  6  Pron. Recibidas
 *  7  Llamadas Obj a Atender
 *  8  Llamadas Obj a Atender% + desvío
 *  9  Pron TMO
 *  10 Carga laboral
 *  11 Pron. Ausentismo
 *  12 Pron. %TNP
 *  13 Plan.Disponibles  → Disponible (Requerido)
 *  14 RAC_s Plan. Logueados
 *  15 Prog.Disponibles  → Disponible (Oficiales)
 *  16 Prog.Logueados
 *  17 Racs Prog sin ausentismo
 *  18 Ocupación planificada
 *  19 Ocupación programada
 *  20 Avail de diseño
 *  21 RAC_s Prog. Disponibles SIN OJT
 *  22 RAC_s Prog. Logueados SIN OJT
 *  23 RAC_s Prog. Logueados SIN AUSENTISMO SIN OJT
 *  24 Break
 *  25 Ausente
 *  26 RAC_s Prog. Disponibles (Oficiales + HHEE)   → Disponible (Oficiales + Hhee)
 *  27 RAC_s Prog. Logueados (Oficiales + HHEE)
 *  28 RAC_s Prog. Disponible  (OJT)
 *  29 RAC_s Prog. Logueado  (OJT)
 *  30 RAC_s Prog. Disponibles (Oficiales + HHEE + OJT) → Disponible (Oficiales + Hhee + Ojt)
 *  31 RAC_s Prog. Logueados (Oficiales + HHEE + OJT)
 */
export function parseRow(raw: unknown[]): Row | null {
  if (!raw || raw.length < 31) return null;

  // Validar columnas críticas para el análisis
  const requiredIndices = [1, 2, 3, 4, 13, 15, 26, 30]; // Sub área, Servicio, Fecha, Hora, y columnas de disponibilidad
  for (const idx of requiredIndices) {
    if (raw[idx] === undefined || raw[idx] === null) {
      console.warn(`Columna crítica ${idx} está vacía o undefined en la fila`);
      return null;
    }
  }

  const fecha = String(raw[3] ?? "").trim();
  if (!fecha) return null;

  const dateObj = parseDateStr(fecha);
  const dia = dateObj ? DAYS[dateObj.getDay()] : "";

  // Hora: raw[4] can be a decimal (Excel time) or "08:00:00" string
  let hora = String(raw[4] ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(hora)) {
    const totalMin = Math.round(parseFloat(hora) * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else {
    hora = hora.substring(0, 5);
  }

  const n = (idx: number) => parseFloat(String(raw[idx] ?? 0)) || 0;

  const dispRequerido = n(13);
  const dispOficiales = n(15);
  const dispOficialesHhee = n(26);
  const dispOficialesHheeOjt = n(30);

  return {
    fecha: dateObj ? formatDate(dateObj) : fecha,
    fechaSort: dateObj ? isoDate(dateObj) : fecha,
    dia,
    servicio: String(raw[2] ?? "").trim(),
    subarea: String(raw[1] ?? "").trim(),
    hora,
    pronRecibidas: n(6),
    llamadasObj: n(7),
    pronTMO: n(9),
    dispRequerido,
    dispOficiales,
    dispOficialesHhee,
    dispOficialesHheeOjt,
    difOficiales: parseFloat((dispOficiales - dispRequerido).toFixed(2)),
    difOficialesHhee: parseFloat((dispOficialesHhee - dispRequerido).toFixed(2)),
    difOficialesHheeOjt: parseFloat((dispOficialesHheeOjt - dispRequerido).toFixed(2)),
  };
}

/** Valida que el archivo tenga las columnas críticas necesarias para el análisis */
export function validateExcelStructure(headers: unknown[]): { valid: boolean; missingColumns: string[] } {
  const requiredColumns = [
    { index: 1, name: "Sub área" },
    { index: 2, name: "Servicio" },
    { index: 3, name: "Fecha" },
    { index: 4, name: "Intervalo (hora)" },
    { index: 13, name: "Plan.Disponibles (Requerido)" },
    { index: 15, name: "Prog.Disponibles (Oficiales)" },
    { index: 26, name: "RAC_s Prog. Disponibles (Oficiales + HHEE)" },
    { index: 30, name: "RAC_s Prog. Disponibles (Oficiales + HHEE + OJT)" },
  ];

  const missingColumns: string[] = [];

  for (const { index, name } of requiredColumns) {
    if (headers[index] === undefined || headers[index] === null || String(headers[index]).trim() === "") {
      missingColumns.push(name);
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns,
  };
}

/** Parses a full sheet (array-of-arrays with header in row 0) into typed Rows. */
export function parseSheetRows(raw: unknown[][]): Row[] {
  return raw.slice(1).map(r => parseRow(r as unknown[])).filter((r): r is Row => r !== null);
}

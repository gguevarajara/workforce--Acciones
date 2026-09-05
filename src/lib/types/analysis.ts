/**
 * Tipos relacionados con análisis de datos
 */

export interface Row {
  fecha: string; // formatted dd/mm/yyyy
  fechaSort: string; // ISO yyyy-mm-dd, used for sorting/grouping regardless of locale
  dia: string;
  servicio: string;
  subarea: string;
  hora: string; // "HH:MM"
  pronRecibidas: number;
  llamadasObj: number;
  pronTMO: number;
  dispRequerido: number;
  dispOficiales: number;
  dispOficialesHhee: number;
  dispOficialesHheeOjt: number;
  difOficiales: number;
  difOficialesHhee: number;
  difOficialesHheeOjt: number;
}

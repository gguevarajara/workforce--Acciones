import { createContext, useContext, useMemo, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Row } from "../lib/types/analysis";

const ANALYSIS_STORAGE_KEY = "workforce_analysis_data";

interface AnalysisDataValue {
  rows: Row[];
  uploadedName: string;
  isHydrated: boolean;
  persistError: string | null;
  setData: (rows: Row[], fileName: string) => void;
  clear: () => void;
}

const AnalysisDataContext = createContext<AnalysisDataValue | null>(null);

export function AnalysisDataProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [uploadedName, setUploadedName] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Cargar datos desde localStorage al iniciar
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ANALYSIS_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Validar que los datos tengan la estructura esperada
        if (data && Array.isArray(data.rows) && typeof data.uploadedName === "string") {
          setRows(data.rows);
          setUploadedName(data.uploadedName);
        } else {
          console.warn("[AnalysisData] Invalid data in localStorage, clearing");
          localStorage.removeItem(ANALYSIS_STORAGE_KEY);
        }
      }
    } catch (error) {
      console.error("[AnalysisData] Error loading from localStorage:", error);
      localStorage.removeItem(ANALYSIS_STORAGE_KEY);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  const setData = useCallback((newRows: Row[], fileName: string) => {
    setRows(newRows);
    setUploadedName(fileName);
    // Guardar en localStorage
    try {
      const dataToStore = { rows: newRows, uploadedName: fileName };
      localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(dataToStore));
      setPersistError(null);
    } catch (error) {
      console.error("[AnalysisData] Error saving to localStorage:", error);
      // Los datos quedan disponibles en memoria para esta sesión, pero no
      // se persistieron: se perderán al recargar. Avisamos en la UI en vez
      // de fallar en silencio.
      setPersistError(
        "No se pudo guardar el archivo en el almacenamiento local (posiblemente por su tamaño). " +
        "Los datos siguen disponibles en esta sesión, pero se perderán si recargas la página."
      );
    }
  }, []);

  const clear = useCallback(() => {
    setRows([]);
    setUploadedName("");
    // Limpiar localStorage
    try {
      localStorage.removeItem(ANALYSIS_STORAGE_KEY);
      setPersistError(null);
    } catch (error) {
      console.error("[AnalysisData] Error clearing localStorage:", error);
    }
  }, []);

  const value = useMemo<AnalysisDataValue>(() => ({
    rows,
    uploadedName,
    isHydrated,
    persistError,
    setData,
    clear,
  }), [rows, uploadedName, isHydrated, persistError, setData, clear]);

  return <AnalysisDataContext.Provider value={value}>{children}</AnalysisDataContext.Provider>;
}

export function useAnalysisData(): AnalysisDataValue {
  const ctx = useContext(AnalysisDataContext);
  if (!ctx) throw new Error("useAnalysisData must be used within AnalysisDataProvider");
  return ctx;
}

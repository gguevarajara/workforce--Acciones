# Parámetros de Configuración - Uso Funcional

## Parámetros del Motor de Acciones

### 1. minDeficit (Umbrales)
- **Valor default**: 1
- **Rango**: 0 - 5
- **Uso**: Filtro mínimo para considerar déficit significativo
- **Archivos**: 
  - `cambioHorario.ts` línea 49: Filtra déficit para cambio de horario
  - `jornadasExtendidas.ts` línea 45: Filtra slots para jornadas extendidas
- **Estado**: ✅ FUNCIONAL
- **Nota (corregido)**: esta entrada citaba antes también a `hhee.ts` línea 32 como usuario de
  `minDeficit`. No es así: HHEE filtra con su propio umbral fijo `HHEE_MIN_DEFICIT_AGENTS = 0.5`
  (ver parámetro 27 y el comentario de cabecera de `hhee.ts`), no con este campo configurable.
  `ConfigPage.tsx` (pestaña HHEE) ya lo aclaraba correctamente en la UI; se corrige aquí la
  discrepancia con el código real.

### 2. EDGE_WINDOW_HOURS (Umbrales — corregido)
- **Valor**: 2 (fijo)
- **Uso**: Ventana de tiempo desde el borde operativo para considerar jornada extendida
- **Archivos**:
  - `jornadasExtendidas.ts` (import `EDGE_WINDOW_HOURS` desde `config.ts`): detecta si un slot está en el borde
- **Estado**: ✅ FUNCIONAL, pero **NO es un campo de `ActionsEngineConfig` ni es editable desde ConfigPage.tsx** — es una constante fija (`EDGE_WINDOW_HOURS` en `config.ts`). ConfigPage.tsx solo la muestra como texto informativo de solo lectura ("Ventana de detección de déficit cercano al borde"). Esta entrada listaba antes un rango editable (0.5–4) que no corresponde al comportamiento actual — corregido.

### 3. (eliminado) hheeMaxHours
- Esta entrada listaba un parámetro `hheeMaxHours` (default 1.5, rango 0.5–4) como "✅ FUNCIONAL (agregado recientemente)". **No existe en el código actual**: no está en `ActionsEngineConfig` (`types.ts`), no está en `DEFAULT_ENGINE_CONFIG` (`config.ts`) y no se usa en `hhee.ts`. Entrada eliminada por no corresponder al código real.

### 4. extendedMaxHoursPerDay (Umbrales)
- **Valor default**: 2
- **Rango**: 1 - 6
- **Uso**: Horas máximas adicionales que se le pueden sumar al horario estándar de un agente en un mismo día
- **Archivos**:
  - `jornadasExtendidas.ts` líneas 82, 97, 149, 367: Calcula límite de extensión
  - `ConfigPage.tsx` (pestaña Jornadas Extendidas): control editable
- **Estado**: ✅ FUNCIONAL
- **Nota**: esta entrada se llamaba antes `extendedMaxHours` (default 4, rango 1–8), un nombre y
  valores que no correspondían al código real — corregido. Ver también parámetro 4b.

### 4b. extendedMaxDaysPerWeek (Umbrales)
- **Valor default**: 7 (sin restricción)
- **Rango**: 1 - 7
- **Uso**: Máximo de días distintos por semana, dentro de un mismo servicio+subárea, en los que se
  puede aplicar Jornada Extendida. Si hay más días con necesidad que este límite, se priorizan los
  días con mayor déficit.
- **Archivos**:
  - `jornadasExtendidas.ts` líneas 323, 327, 337: Filtra días priorizados
  - `ConfigPage.tsx` (pestaña Jornadas Extendidas): control editable
- **Estado**: ✅ FUNCIONAL
- **Nota**: parámetro que no estaba documentado en la revisión anterior de este documento.

### 5. (eliminado) recurrenceRatio
- Esta entrada listaba `RECURRENCE_RATIO` (valor fijo 0.5) como "✅ FUNCIONAL", supuestamente
  usado en `cambioHorario.ts` línea 49 para "detectar patrones recurrentes". **No corresponde al
  código actual**: no existe ninguna lógica de detección de patrones recurrentes en el motor;
  la constante solo se mostraba en `ConfigPage.tsx` como dato informativo de solo lectura, sin
  ser leída en ningún cálculo (código muerto). Se eliminó la constante (`config.ts`), su
  re-exportación (`index.ts`) y su fila en `ConfigPage.tsx`, y esta entrada del documento.

### 6. roundingThreshold (Umbrales — corregido)
- **Valor default**: 0.2
- **Rango**: 0.1 - 0.5
- **Uso**: Umbral de decimal para redondear agentes hacia arriba
- **Archivos**:
  - `jornadasExtendidas.ts` (usa `roundAgents` de `utils.ts`): Redondea agentes en jornadas extendidas
  - `hhee.ts` (usa `roundAgents` de `utils.ts`): Redondea agentes en HHEE
- **Estado**: ✅ FUNCIONAL — pero **NO aplica a Cambio de Horario**
- **Nota (corregida)**: esta entrada citaba antes también `cambioHorario.ts` como usuario de este
  campo ("línea 124: Redondea agentes en cambio de horario"). No es así: `cambioHorario.ts` no
  importa `roundAgents` ni lee `config.roundingThreshold` en ningún lugar (confirmado por grep en
  todo el archivo). Cambio de Horario determina la cantidad de agentes probando exhaustivamente
  cada cantidad entera (1, 2, 3... N) y quedándose con la que da mejor puntaje
  (`pickBestQuantityForCandidate`), no redondeando un déficit fraccionario. `ConfigPage.tsx`
  (pestaña General) tenía el mismo error en el texto de ayuda del control — corregido también ahí.

## Tipos de Acción

### 7. enableCambio (Tipos de Acción)
- **Valor default**: true
- **Uso**: Habilita/deshabilita generación de Cambio de Horario
- **Archivos**:
  - `index.ts` línea 59: Condición para ejecutar cambio de horario
- **Estado**: ✅ FUNCIONAL

### 8. enableExtendida (Tipos de Acción)
- **Valor default**: true
- **Uso**: Habilita/deshabilita generación de Jornadas Extendidas
- **Archivos**:
  - `index.ts` línea 97: Condición para ejecutar jornadas extendidas
- **Estado**: ✅ FUNCIONAL

### 9. enableHhee (Tipos de Acción)
- **Valor default**: true
- **Uso**: Habilita/deshabilita generación de HHEE
- **Archivos**:
  - `index.ts` línea 111: Condición para ejecutar HHEE
- **Estado**: ✅ FUNCIONAL

## Base de Cobertura

### 10. coverageBase (Base de Cobertura)
- **Valor default**: "officials"
- **Opciones**: "officials", "officials_hhee", "officials_hhee_ojt"
- **Uso**: Columna del análisis usada como base para calcular tanto el déficit (negativo) como el
  excedente/GAP positivo (la misma columna se usa para ambos signos, para que sean consistentes
  entre sí)
- **Archivos**:
  - `utils.ts` función `getDeficitFromRow`: Calcula déficit según base seleccionada
  - `utils.ts` función `getAvailableFromRow`: Calcula la disponibilidad (columna) según base
    seleccionada; usada para el excedente
  - Usado en: `cambioHorario.ts`, `jornadasExtendidas.ts`, `compensation.ts`
- **Estado**: ✅ FUNCIONAL
- **Nota (corregida)**: hasta esta revisión, `compensation.ts` calculaba el excedente siempre
  con la columna "Oficiales" fija (`dispOficiales - dispRequerido`), sin importar esta
  configuración — inconsistente con el déficit, que sí la respetaba. Se corrigió para que ambos
  usen la misma base.

## Jornada Laboral Estándar

### 11. workHours (Jornada Laboral)
- **Valor default**: 8
- **Rango**: 4 - 12
- **Uso**: Horas de trabajo estándar
- **Archivos**:
  - `config.ts` función `getTotalWorkDuration`: Suma trabajo + break
  - `scheduleCalculator.ts` línea 26: Usa duración total para cálculos
  - `cambioHorario.ts` línea 85: Usa duración total para nuevo horario
- **Estado**: ✅ FUNCIONAL

### 12. breakHours (Jornada Laboral)
- **Valor default**: 1
- **Rango**: 0 - 2
- **Uso**: Horas de break dentro de la jornada
- **Archivos**:
  - `config.ts` función `getTotalWorkDuration`: Suma trabajo + break
  - Indirectamente usado en cálculos de horarios
- **Estado**: ✅ FUNCIONAL

## Horarios de Turno Estándar (NUEVOS - Impacto ALTO)

### 13. shiftStartMorning (Horarios de Turno)
- **Valor default**: 480 (08:00)
- **Rango**: 300 (05:00) - 720 (12:00)
- **Uso**: Inicio del turno matutino para inferencia de horarios
- **Archivos**:
  - `scheduleCalculator.ts` línea 36: Usado cuando déficit está en tarde
  - `cambioHorario.ts` línea 78: Usado cuando déficit está en tarde
- **Estado**: ✅ FUNCIONAL

### 14. shiftEndMorning (Horarios de Turno)
- **Valor default**: 1020 (17:00)
- **Rango**: 720 (12:00) - 1200 (20:00)
- **Uso**: Fin del turno matutino para inferencia de horarios
- **Archivos**:
  - `scheduleCalculator.ts` línea 37: Usado cuando déficit está en tarde
  - `cambioHorario.ts` línea 79: Usado cuando déficit está en tarde
- **Estado**: ✅ FUNCIONAL

### 15. shiftStartAfternoon (Horarios de Turno)
- **Valor default**: 660 (11:00)
- **Rango**: 540 (09:00) - 900 (15:00)
- **Uso**: Inicio del turno vespertino para inferencia de horarios
- **Archivos**:
  - `scheduleCalculator.ts` línea 34: Usado cuando déficit está en mañana
  - `cambioHorario.ts` línea 76: Usado cuando déficit está en mañana
- **Estado**: ✅ FUNCIONAL

### 16. shiftEndAfternoon (Horarios de Turno)
- **Valor default**: 1200 (20:00)
- **Rango**: 900 (15:00) - 1440 (24:00)
- **Uso**: Fin del turno vespertino para inferencia de horarios
- **Archivos**:
  - `scheduleCalculator.ts` línea 35: Usado cuando déficit está en mañana
  - `cambioHorario.ts` línea 77: Usado cuando déficit está en mañana
- **Estado**: ✅ FUNCIONAL

## Parámetros de Precisión (NUEVOS - Impacto MEDIO)

### 17-18. (eliminados) scheduleBufferBefore / scheduleBufferAfter
- Estas dos entradas listaban `scheduleBufferBefore` (default 60, rango 15–120) y
  `scheduleBufferAfter` (default 30, rango 15–60) como "✅ FUNCIONAL", supuestamente usados en
  `scheduleCalculator.ts` (líneas 43/47) y `cambioHorario.ts` (líneas 86/90) para calcular el
  inicio/fin del nuevo horario. **No corresponde al código actual**: ambos campos existían en
  `ActionsEngineConfig`/`DEFAULT_ENGINE_CONFIG` con valores por defecto, pero nunca fueron leídos
  por ningún archivo del motor (código muerto) y no tenían control en `ConfigPage.tsx`. Se
  eliminaron los dos campos del código (`types.ts`, `config.ts`) y estas entradas del documento.

### 19. (eliminado) hheeGapMinutes
- Esta entrada listaba `hheeGapMinutes` (default 30, rango 15–60) como "✅ FUNCIONAL", supuestamente usado en `hhee.ts` líneas 54 y 163. **No corresponde al código actual**: el campo llegó a existir en `ActionsEngineConfig`/`DEFAULT_ENGINE_CONFIG`, pero nunca fue leído por `hhee.ts` (código muerto) y no tenía control en ConfigPage.tsx — que además documenta explícitamente lo contrario en la pestaña HHEE ("No hay un 'gap de tolerancia' configurable"). Se eliminó el campo del código (`types.ts`, `config.ts`) y esta entrada del documento. Ver parámetro 27 para el comportamiento real y fijo de agrupación de HHEE.

## Cambio de Horario (redistribución semanal de cobertura)

### 20. minEntryMinutes / maxExitMinutes (Rango operativo)
- **Valor default**: 360 (06:00) / 1440 (00:00)
- **Uso**: Límite de ingreso más temprano y salida más tardía permitidos al generar horarios candidatos
- **Archivos**: `cambioHorario.ts` función `generateCandidates`
- **Estado**: ✅ FUNCIONAL

### 21. allowMadrugada / madrugadaStartMinutes (Madrugada)
- **Valor default**: true / 1260 (21:00)
- **Uso**: Habilita turnos que cruzan medianoche (p.ej. 21:00–06:00) y define desde qué hora de ingreso se considera madrugada
- **Archivos**: `cambioHorario.ts` función `generateCandidates`
- **Estado**: ✅ FUNCIONAL

### 22. maxShiftDisplacementMinutes / scheduleGranularityMinutes (Búsqueda de candidatos)
- **Valor default**: 240 (4h) / 60 min (1h)
- **Uso**: Rango y paso de los desplazamientos evaluados respecto al horario actual del grupo
- **Archivos**: `cambioHorario.ts` función `generateCandidates`
- **Estado**: ✅ FUNCIONAL
- **Nota**: `scheduleGranularityMinutes` se llamaba antes `shiftDisplacementStepMinutes` (permitía
  15/30/45/60 min). Se renombró y se comparte también con Jornadas Extendidas (parámetro 26) para
  que ambos motores usen la MISMA granularidad de horario configurada en un solo lugar, y se
  restringió a múltiplos de 1 hora (60/120 min) para que ningún horario nuevo quede en medias horas.
  HHEE no usa este campo: por regla de negocio siempre trabaja en horas completas (ver parámetro 27).

### 26. Jornadas Extendidas — paso de reparto (usa scheduleGranularityMinutes)
- **Valor default**: 60 min (1h), heredado del parámetro 22
- **Uso**: `distributeFairly()` reparte las horas de extensión/devolución entre los días con déficit
  en incrementos enteros de este valor (round-robin), en vez de una división continua (ej. 12h/7 días
  = 1.7142857h). Así el "NUEVO HORARIO" de una Jornada Extendida siempre cae en una hora completa
  (ej. 18:00, 19:00), nunca en minutos sueltos ni en medias horas.
- **Archivos**: `jornadasExtendidas.ts` función `distributeFairly`
- **Estado**: ✅ FUNCIONAL
- **Nota**: si la bolsa de horas disponibles no es múltiplo exacto del paso configurado, el
  remanente (menos de un paso completo) no se reparte — es un margen de seguridad, no un error.

### 27. HHEE — horas completas (regla fija, no configurable)
- **Comportamiento**: HHEE siempre agrupa y redondea sus rangos a horas completas, incluyendo
  siempre la hora completa que contiene el último intervalo con déficit (ej. 08:30-11:00 →
  08:00-12:00). Esta regla es fija por diseño (ver comentario de cabecera en `hhee.ts`) y NO usa
  `scheduleGranularityMinutes` ni ningún otro parámetro — ya cumple "solo horas completas" sin
  necesidad de configuración adicional.
- **Archivos**: `hhee.ts` funciones `floorToHour`, `ceilToHour`, `buildHourlyLayers`
- **Estado**: ✅ FUNCIONAL

### 23. Evaluación de GAPS (regla fija, no configurable)
- **Comportamiento**: la evaluación de GAPS siempre es semanal (regla fija del motor).
  No existe un campo `cambioEvaluationScope` en `ActionsEngineConfig` ni control en
  ConfigPage.tsx para esto — es intencional, según el comentario en `types.ts`: "La
  evaluación de GAPS siempre es semanal... Lo único configurable es el ALCANCE DE
  APLICACIÓN" (parámetro 24).
- **Archivos**: `cambioHorario.ts` (los candidatos siempre se simulan sobre `applicableDays`)
- **Estado**: ✅ FUNCIONAL (como regla fija; esta entrada listaba antes un parámetro
  `cambioEvaluationScope` que nunca existió en el código — corregido).

### 24. cambioApplicationScope (Aplicación)
- **Valor default**: "full_week"
- **Alternativas**: "weekdays" (días laborales), "specific_days" (días elegidos por el usuario,
  usa `cambioSpecificDays`), "consecutive_days" (primeros N días consecutivos, usa
  `cambioConsecutiveDaysCount`), "custom_pattern" (patrón libre, usa `cambioCustomPattern`)
- **Uso**: Días en los que se aplica el nuevo horario una vez seleccionado
- **Archivos**: `cambioHorario.ts` función `resolveApplicableDays` (resuelve los 5 modos) y `generateCambioAggregated`
- **Estado**: ✅ FUNCIONAL
- **Nota**: hasta esta revisión, `ConfigPage.tsx` solo exponía "full_week" y "specific_days" en el
  selector — los otros 3 modos existían en el motor pero eran inalcanzables desde la UI.
  Corregido: ahora los 5 modos son seleccionables, cada uno con su control correspondiente.

### 25. dailyDeteriorationTolerance (Tolerancia de deterioro por día)
- **Valor default**: 0
- **Uso**: Deterioro máximo (en agentes) tolerado en otros intervalos/días antes de descartar un candidato
- **Archivos**: `cambioHorario.ts` función `pickBestQuantityForCandidate`
- **Nota**: esta entrada citaba antes la función `pickBestCandidate`, un envoltorio que nunca se
  invocaba (código muerto, eliminado en esta revisión). La lógica real siempre pasó por
  `pickBestQuantityForCandidate`, llamada directamente desde el bucle principal del motor.
- **Estado**: ✅ FUNCIONAL
- **Nota**: este campo se llamaba `minRequiredCoverage`, un nombre que no reflejaba su uso real;
  se renombró a `dailyDeteriorationTolerance` para que coincida con la etiqueta mostrada en
  ConfigPage.tsx ("Tolerancia de deterioro por día") y con su lógica.

## Homogeneización por Franja Horaria (Cambio de Horario)

### 28. enableZoneBalancing / zoneBalancingWeight (Homogeneización)
- **Valor default**: `true` / `20`
- **Uso**: Además de reducir el mismatch (déficit + excedente) TOTAL de la semana,
  `pickBestQuantityForCandidate` calcula el desbalance entre 3 franjas horarias (mañana, cierre,
  madrugada) antes y después de cada candidato (`zoneImbalance`, diferencia entre la franja con
  más GAP remanente y la que tiene menos). Si `enableZoneBalancing` está activo, la mejora de ese
  desbalance (`imbalanceBefore - imbalanceAfter`) se suma al score multiplicada por
  `zoneBalancingWeight`. En `zoneBalancingWeight = 0` el término es cero y el comportamiento es
  idéntico a no tener la homogeneización activada.
- **Archivos**:
  - `utils.ts` función `classifyTimeZone`: clasifica cada intervalo en su franja
  - `cambioHorario.ts` funciones `simulateCandidate` (acumula mismatch por franja),
    `zoneImbalance` y `pickBestQuantityForCandidate` (usa el término en el score)
  - `ConfigPage.tsx` (pestaña Cambio de Horario, sección "Homogeneización por Franja Horaria")
- **Estado**: ✅ FUNCIONAL (agregado en esta revisión, no existía antes)
- **Importante**: esto NO reemplaza la optimización del mismatch total (sigue siendo el término
  de mayor peso, x100, en el score) — es un desempate/ajuste adicional. Un candidato que empeora
  mucho el total no se elige solo por dejar las franjas más parejas.

### 29. zoneMorningStart/EndMinutes, zoneClosingStart/EndMinutes, zoneMadrugadaStart/EndMinutes (Franjas)
- **Valor default**: Mañana 06:00-14:00, Cierre 14:00-22:00, Madrugada 22:00-06:00
- **Uso**: Límites editables de cada franja, en minutos desde las 00:00. Un intervalo que no cae
  en ninguna de las 3 (si el usuario deja huecos) sigue contando para el déficit/excedente TOTAL,
  pero no participa del cálculo de balance entre franjas (queda en el bucket interno "none").
  Un rango con `start > end` se interpreta como cruce de medianoche (ej. Madrugada 22:00→06:00).
- **Archivos**: `utils.ts` función `classifyTimeZone`; `ConfigPage.tsx` (pestaña Cambio de Horario)
- **Estado**: ✅ FUNCIONAL (agregado en esta revisión, no existía antes)

## Resumen

- **Total de parámetros documentados**: 22 (se retiraron 5 entradas a lo largo de las
  revisiones: `hheeMaxHours`, `hheeGapMinutes`, `recurrenceRatio`, `scheduleBufferBefore` y
  `scheduleBufferAfter`, ninguno de los cuales corresponde al código actual; se agregaron 2
  entradas nuevas en esta revisión: homogeneización por franja horaria)
- **Campos reales en `ActionsEngineConfig`**: 34 (contando los de Tipos de Acción, Base de
  Cobertura y los 8 nuevos de homogeneización por franja horaria, documentados en secciones aparte)
- **Parámetros fijos por diseño (no editables, mostrados solo como referencia)**:
  `EDGE_WINDOW_HOURS` (parámetro 2), evaluación semanal de GAPS (parámetro 23) y agrupación en
  horas completas de HHEE (parámetro 27)
- **Parámetros no funcionales**: 0

Esta revisión (auditoría de código — ver `AUDITORIA_CODIGO.md`) corrigió las siguientes
discrepancias entre este documento y el código real:
1. **`edgeWindowHours`** figuraba como editable (rango 0.5–4); en el código es la constante fija `EDGE_WINDOW_HOURS`, sin control editable en ConfigPage.tsx.
2. **`hheeMaxHours`** no existe en `ActionsEngineConfig` ni en ningún archivo del motor — se retiró la entrada.
3. **`hheeGapMinutes`** existía como campo de configuración pero nunca fue leído por `hhee.ts` (código muerto) y no tenía control en la UI — se eliminó del código (`types.ts`, `config.ts`) y de este documento.
4. **`minDeficit`** figuraba como usado también en `hhee.ts`; ese archivo en realidad usa su
   propio umbral fijo `HHEE_MIN_DEFICIT_AGENTS` — se corrigió la entrada 1.
5. **`recurrenceRatio`** (`RECURRENCE_RATIO`) figuraba como "✅ FUNCIONAL" usado para detectar
   patrones recurrentes en `cambioHorario.ts`; esa lógica no existe en el motor — era una
   constante decorativa, solo mostrada como dato informativo. Se eliminó del código y del
   documento.
6. **`scheduleBufferBefore`/`scheduleBufferAfter`** figuraban como "✅ FUNCIONAL" usados en
   `scheduleCalculator.ts` y `cambioHorario.ts`; ninguno de los dos archivos los leía (código
   muerto) y no tenían control en la UI. Se eliminaron del código y del documento.
7. **Base de excedente en Jornadas Extendidas**: se detectó que `compensation.ts` calculaba el
   GAP positivo (bolsa de devolución) siempre sobre la columna "Oficiales", sin respetar
   `coverageBase` como sí lo hace el cálculo de déficit. Se corrigió para que ambos usen
   consistentemente la misma Base de Cobertura configurada (ver parámetro 10).
8. **`roundingThreshold`** figuraba como usado también en `cambioHorario.ts` ("línea 124: Redondea
   agentes en cambio de horario"); ese archivo no lee este campo en ningún lugar — Cambio de
   Horario decide la cantidad de agentes por búsqueda exhaustiva, no por redondeo. Se corrigió la
   entrada 6 y el texto de ayuda equivalente en `ConfigPage.tsx`.


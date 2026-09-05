# Workforce Web App Integrado

Sistema de gestión de workforce con módulos de análisis y acciones para optimización de horarios y cobertura de personal.

## Características

- **Análisis de Cobertura**: Carga y análisis de archivos de planificación para detectar déficit de personal
- **Motor de Acciones**: Generación automática de tres tipos de acciones para cubrir déficit:
  - **Cambio de Horario**: Redistribución semanal de cobertura entre diferentes horarios
  - **Jornadas Extendidas**: Extensión puntual de horarios estándar (mañana/tarde)
  - **HHEE (Horas Extra Económicas)**: Horas extra en bloques completos como última medida
- **Configuración Avanzada**: Panel de configuración con parámetros ajustables para cada tipo de acción
- **Cálculo Acumulativo**: Cada acción toma en cuenta el déficit remanente de las anteriores (cadena de dependencia)

## Requisitos

- Node.js
- npm o pnpm

## Instalación

```bash
npm install
```

## Ejecución

```bash
npm run dev
```

El servidor de desarrollo estará disponible en `http://localhost:3000`

## Estructura del Proyecto

```
src/
├── components/       # Componentes reutilizables (Sidebar, etc.)
├── context/          # Contextos de React (AnalysisDataContext)
├── lib/
│   ├── actions/      # Motor de generación de acciones
│   │   ├── cambioHorario.ts
│   │   ├── jornadasExtendidas.ts
│   │   ├── hhee.ts
│   │   ├── config.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   ├── parsers/      # Parsers de archivos Excel
│   └── types/        # Definiciones de tipos TypeScript
├── pages/            # Páginas principales
│   ├── ActionsPage.tsx
│   ├── AnalysisPage.tsx
│   ├── ConfigPage.tsx
│   └── LoginPage.tsx
└── main.tsx          # Punto de entrada
```

## Configuración

El sistema utiliza configuración por defecto que puede ser ajustada desde la interfaz:

- **Jornada Laboral Estándar**: 8h trabajo + 1h break (9h total)
- **Horarios Estándar**: 
  - Turno mañana: 08:00-17:00
  - Turno tarde: 11:00-20:00
- **Límites de Extensión**: Máximo 2 horas adicionales por día

## Notas de Seguridad

- Este repositorio es privado y contiene lógica de negocio específica
- Las credenciales de acceso no están incluidas en el repositorio por seguridad
- Para desarrollo local, configura las credenciales en `src/pages/LoginPage.tsx`

## Stack Tecnológico

- React 19
- TypeScript 5.7
- Vite 8
- Tailwind CSS v4
- XLSX (para procesamiento de archivos Excel)

## Licencia

Propietario - Uso interno exclusivo

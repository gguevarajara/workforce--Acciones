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

## Configuración de Credenciales

### Método 1: Variables de Entorno (Recomendado - Seguro)

#### En Render:
1. Ve a tu servicio en Render
2. Click en "Environment Variables"
3. Agrega las siguientes variables:
   - `VITE_ADMIN_EMAIL`: tu email de admin
   - `VITE_ADMIN_PASSWORD`: tu contraseña de admin
   - `VITE_DEMO_EMAIL`: email de demo (opcional)
   - `VITE_DEMO_PASSWORD`: contraseña de demo (opcional)
4. Click en "Save Changes"
5. Render hará un redeploy automático

#### En Desarrollo Local:
1. Copia `.env.example` a `.env`
2. Edita `.env` con tus credenciales
3. Reinicia el servidor de desarrollo

### Método 2: Código Directo (Menos Seguro)

Edita directamente `src/pages/LoginPage.tsx` (líneas 28-29) para cambiar las credenciales por defecto.

**Nota:** Este método es menos seguro porque las credenciales quedan en el código fuente.

## Notas de Seguridad

- Este repositorio es privado y contiene lógica de negocio específica
- Recomiendo usar variables de entorno para credenciales en producción
- Para desarrollo local, usa el archivo `.env`

## Stack Tecnológico

- React 19
- TypeScript 5.7
- Vite 8
- Tailwind CSS v4
- XLSX (para procesamiento de archivos Excel)

## Despliegue en Render

Este proyecto está configurado para desplegarse en Render usando el archivo `render.yaml`.

### Pasos para desplegar:

1. **Conectar repositorio:** En Render, selecciona "New +" -> "Web Service" y conecta tu repositorio de GitHub `gguevarajara/workforce--Acciones`

2. **Configuración automática:** Render detectará automáticamente el archivo `render.yaml` y configurará:
   - Entorno: Node.js
   - Comando de build: `npm install && npm run build`
   - Comando de inicio: `npm run preview`

3. **Despliegue:** Render compilará y desplegará automáticamente tu aplicación

### Configuración manual (alternativa):

Si prefieres configurar manualmente en Render:
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run preview`
- **Publish Directory:** `dist`
- **Node Version:** 18

## Licencia

Propietario - Uso interno exclusivo

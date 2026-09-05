import { useState } from "react";

interface Props {
  onLogin: (email: string) => void;
}

/**
 * Credenciales válidas de la aplicación.
 *
 * IMPORTANTE — límite real de esta solución:
 * Esta es una SPA sin backend (todo corre en el navegador y persiste en
 * localStorage). Cualquier valor que pongas aquí queda incluido en el
 * bundle de JavaScript que se descarga al navegador, así que técnicamente
 * cualquier persona con acceso al código del sitio puede leerlo. Esto NO
 * es autenticación segura de nivel servidor — es una validación real de
 * usuario/contraseña (ya no acepta cualquier texto no vacío), pero sigue
 * siendo un control del lado del cliente.
 *
 * Si en algún momento esta app maneja datos sensibles de producción,
 * lo correcto es mover esta validación a un backend (API + hash de
 * contraseñas + sesión/token), no mantenerla aquí.
 *
 * Para agregar o cambiar usuarios, edita este arreglo.
 */
const VALID_CREDENTIALS: { email: string; password: string }[] = [
  // Credenciales configuradas por variables de entorno o valores por defecto
  { 
    email: import.meta.env.VITE_ADMIN_EMAIL || "gguevarajara@gmail.com", 
    password: import.meta.env.VITE_ADMIN_PASSWORD || "Acuario03*" 
  },
  { 
    email: import.meta.env.VITE_KONECTA_EMAIL || "patrick.bazan@konecta.com", 
    password: import.meta.env.VITE_KONECTA_PASSWORD || "Konecta26*" 
  },
  { 
    email: import.meta.env.VITE_DEMO_EMAIL || "demo@workforce.com", 
    password: import.meta.env.VITE_DEMO_PASSWORD || "Demo2026" 
  },
];

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidCredentials(email: string, password: string): boolean {
  const normalizedEmail = normalizeEmail(email);
  return VALID_CREDENTIALS.some(
    c => normalizeEmail(c.email) === normalizedEmail && c.password === password
  );
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Completa todos los campos.");
      return;
    }

    setLoading(true);
    // Delay simulado para dar feedback visual de "verificando" — no hay
    // llamada de red real, la validación es local (ver VALID_CREDENTIALS).
    setTimeout(() => {
      setLoading(false);
      if (isValidCredentials(email, password)) {
        onLogin(email.trim());
      } else {
        setError("Correo o contraseña incorrectos.");
      }
    }, 900);
  };

  return (
    <div
      className="h-full flex"
      style={{ background: "#0a0f1e" }}
    >
      {/* Left panel — brand */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] p-12 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0d1526 0%, #111d35 60%, #162244 100%)" }}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: "#2563eb" }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#2563eb" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-wide" style={{ color: "#f0f4ff" }}>WorkForce Planning Suite</span>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "#2563eb" }}>Planificación Estratégica</p>
          <h1 className="text-4xl font-light leading-tight mb-6" style={{ color: "#f0f4ff" }}>
            Gestión y análisis<br />
            de <span className="font-semibold" style={{ color: "#3b82f6" }}>fuerza laboral</span>
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "#64748b" }}>
            Carga archivos de planificación, visualiza métricas clave<br />
            y ejecuta acciones operativas desde un solo lugar.
          </p>
        </div>

        {/* Stats strip */}
        <div className="relative z-10 grid grid-cols-3 gap-4">
          {[
            { value: "98.4%", label: "Precisión forecast" },
            { value: "1,240", label: "Empleados activos" },
            { value: "12", label: "Departamentos" },
          ].map((s) => (
            <div key={s.label} className="border rounded p-3" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
              <div className="text-xl font-semibold" style={{ color: "#3b82f6", fontFamily: "DM Mono, monospace" }}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: "#475569" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-1.5" style={{ color: "#f0f4ff" }}>Iniciar sesión</h2>
            <p className="text-sm" style={{ color: "#64748b" }}>Accede a tu espacio de planificación</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="analista@empresa.com"
                className="w-full px-3.5 py-2.5 rounded text-sm outline-none transition-all duration-150"
                style={{
                  background: "#111d35",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#f0f4ff",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded text-sm outline-none transition-all duration-150"
                style={{
                  background: "#111d35",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#f0f4ff",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              />
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded text-sm font-semibold transition-all duration-150 mt-1"
              style={{
                background: loading ? "#1e3a6e" : "#2563eb",
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Verificando..." : "Ingresar"}
            </button>
          </form>

          <p className="text-xs text-center mt-4" style={{ color: "#475569" }}>
            Acceso local de la aplicación · valida contra una lista de credenciales local, no contra un servidor
          </p>

          <p className="text-xs text-center mt-2" style={{ color: "#334155" }}>
            © 2026 WorkForce Planning Suite · v2.4.1
          </p>
        </div>
      </div>
    </div>
  );
}

import type { Module } from "../App";
import type { ReactElement } from "react";

interface Props {
  active: Module;
  onNavigate: (m: Module) => void;
  onLogout: () => void;
  userEmail: string;
}

/** Convierte "juan.perez@empresa.com" en "Juan Perez". */
function getDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart.split(/[._-]+/).filter(Boolean);
  if (!words.length) return "Usuario";
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Convierte "Juan Perez" en "JP" (o las 2 primeras letras si es una sola palabra). */
function getInitials(displayName: string): string {
  const words = displayName.split(" ").filter(Boolean);
  if (!words.length) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const nav: { id: Module; label: string; icon: ReactElement }[] = [
  {
    id: "analysis",
    label: "Análisis",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: "actions",
    label: "Acciones",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    id: "config",
    label: "Configuración",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export default function Sidebar({ active, onNavigate, onLogout, userEmail }: Props) {
  const displayName = getDisplayName(userEmail);
  const initials = getInitials(displayName);

  return (
    <aside
      className="flex flex-col w-56 shrink-0 border-r h-full"
      style={{
        background: "#0d1526",
        borderColor: "rgba(255,255,255,0.07)",
      }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded flex items-center justify-center"
            style={{ background: "#2563eb" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide" style={{ color: "#f0f4ff" }}>WorkForce</div>
            <div className="text-[10px]" style={{ color: "#475569" }}>Planning Suite</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {nav.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded text-left w-full transition-all duration-150 text-sm font-medium"
              style={{
                background: isActive ? "rgba(37,99,235,0.18)" : "transparent",
                color: isActive ? "#3b82f6" : "#94a3b8",
                borderLeft: isActive ? "2px solid #2563eb" : "2px solid transparent",
              }}
            >
              <span style={{ opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
            style={{ background: "#1e3a6e", color: "#93c5fd" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: "#f0f4ff" }}>{displayName}</div>
            <div className="text-[10px] truncate" style={{ color: "#475569" }}>{userEmail}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-3 py-2 rounded w-full text-xs transition-colors duration-150"
          style={{ color: "#475569" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "#475569")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

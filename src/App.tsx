import { useState, useEffect } from "react";
import LoginPage from "./pages/LoginPage";
import AnalysisPage from "./pages/AnalysisPage";
import ActionsPage from "./pages/ActionsPage";
import ConfigPage from "./pages/ConfigPage";
import Sidebar from "./components/Sidebar";
import { AnalysisDataProvider } from "./context/AnalysisDataContext";

export type Module = "analysis" | "actions" | "config";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const saved = localStorage.getItem("workforce_auth");
    return saved === "true";
  });
  // Correo con el que se inició sesión (ver VALID_CREDENTIALS en LoginPage.tsx).
  // Se persiste junto con "workforce_auth" para que, al recargar la página
  // con una sesión ya iniciada, el Sidebar siga mostrando el usuario correcto
  // en vez de quedar vacío.
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("workforce_auth_email") ?? "");
  const [activeModule, setActiveModule] = useState<Module>("analysis");

  useEffect(() => {
    localStorage.setItem("workforce_auth", isAuthenticated.toString());
  }, [isAuthenticated]);

  useEffect(() => {
    if (userEmail) {
      localStorage.setItem("workforce_auth_email", userEmail);
    } else {
      localStorage.removeItem("workforce_auth_email");
    }
  }, [userEmail]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserEmail("");
  };

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={email => {
          setUserEmail(email);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <AnalysisDataProvider>
      <div className="flex h-full" style={{ background: "#0a0f1e" }}>
        <Sidebar active={activeModule} onNavigate={setActiveModule} onLogout={handleLogout} userEmail={userEmail} />
        <main className="flex-1 overflow-auto">
          {activeModule === "analysis" && <AnalysisPage />}
          {activeModule === "actions" && <ActionsPage />}
          {activeModule === "config" && <ConfigPage />}
        </main>
      </div>
    </AnalysisDataProvider>
  );
}

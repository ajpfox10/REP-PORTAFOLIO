import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { RequirePermission } from "./auth/RequirePermission";
import { AppLayout } from "./layout/AppLayout";
import { AccountPage } from "./pages/AccountPage";
import { AdminPage } from "./pages/AdminPage";
import { HistoriasClinicasPage } from "./pages/HistoriasClinicasPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { RoadmapPage } from "./pages/RoadmapPage";
import "./styles/base.css";
import "./styles/auth.css";
import "./styles/app.css";

// Monta la aplicacion React y las rutas principales.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><AppLayout><HomePage /></AppLayout></RequireAuth>} />
          <Route path="/administracion" element={<RequireAuth><AppLayout><AdminPage /></AppLayout></RequireAuth>} />
          <Route path="/historias-clinicas" element={<RequireAuth><RequirePermission permission="hc:leer"><AppLayout><HistoriasClinicasPage /></AppLayout></RequirePermission></RequireAuth>} />
          <Route path="/mi-cuenta" element={<RequireAuth><AppLayout><AccountPage /></AppLayout></RequireAuth>} />
          <Route path="/archivo" element={<RequireAuth><AppLayout><RoadmapPage /></AppLayout></RequireAuth>} />
          <Route path="/auditoria" element={<RequireAuth><AppLayout><RoadmapPage /></AppLayout></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

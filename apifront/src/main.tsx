// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./ui/App";
import "./styles/index.css";
import { logEvent } from "./logging/clientLogger";
import { rewriteHostToCurrent } from "./api/env";
declare global {
  interface Window {
    __RUNTIME_CONFIG__?: any;
  }
}

async function bootstrap() {
  try {
    const res = await fetch(`/runtime-config.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (res.ok) {
      window.__RUNTIME_CONFIG__ = await res.json();
    } else {
      window.__RUNTIME_CONFIG__ = {};
    }
  } catch {
    window.__RUNTIME_CONFIG__ = {};
  }

  // Servidor con múltiples redes (p.ej. 192.168.0.x y 10.115.31.x): reescribimos
  // el host de las URLs del runtime-config para que apunten a la MISMA IP por la
  // que el cliente abrió el front. Así cada red habla con la API por su propia IP,
  // sin depender de ruteo entre redes. (Puerto/protocolo/path se mantienen.)
  try {
    const rc = window.__RUNTIME_CONFIG__ || {};
    for (const k of ["apiBaseUrl", "VITE_API_BASE_URL", "scannerApiUrl"]) {
      if (typeof rc[k] === "string" && rc[k]) rc[k] = rewriteHostToCurrent(rc[k]);
    }
  } catch {
    /* noop */
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

bootstrap();

// Captura global: errores de runtime y promesas sin catch.
// Objetivo: saber QUÉ pasó, CUÁNDO y en QUÉ pantalla.
window.addEventListener('error', (ev) => {
  try {
    logEvent({
      level: 'error',
      what: 'window_error',
      where: window.location?.pathname,
      details: {
        message: (ev as any)?.message,
        filename: (ev as any)?.filename,
        lineno: (ev as any)?.lineno,
        colno: (ev as any)?.colno,
      },
    });
  } catch {
    /* noop */
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason: any = (ev as any)?.reason;
    logEvent({
      level: 'error',
      what: 'unhandledrejection',
      where: window.location?.pathname,
      details: {
        message: reason?.message || String(reason),
        reason,
      },
    });
  } catch {
    /* noop */
  }
});

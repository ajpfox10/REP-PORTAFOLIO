// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./ui/App";
import "./styles/index.css";
import { logEvent } from "./logging/clientLogger";
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

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
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

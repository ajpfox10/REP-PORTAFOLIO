// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./ui/App";
import "./styles/index.css";
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

import React from 'react';
import { logEvent } from '../logging/clientLogger';

// ErrorBoundary para errores de render (React).
// - No toca endpoints.
// - Deja log con ruta + stack.
// - Muestra un fallback con opción de recargar.

type State = { hasError: boolean; message: string };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: any): State {
    return { hasError: true, message: err?.message || 'Error inesperado' };
  }

  componentDidCatch(error: any, info: any) {
    try {
      logEvent({
        level: 'error',
        what: 'react_render_error',
        where: window.location?.pathname,
        details: { error: { message: error?.message, stack: error?.stack }, info },
      });
    } catch {
      /* noop */
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="card p5-eb">
        <h2 className="p5-eb-title">Se rompió esta pantalla 🙃</h2>
        <p className="muted">{this.state.message}</p>
        <div className="row p5-eb-actions">
          <button className="btn" type="button" onClick={() => window.location.reload()}>
            Recargar
          </button>
          <button className="btn" type="button" onClick={() => this.setState({ hasError: false, message: '' })}>
            Intentar seguir
          </button>
        </div>
        <p className="muted p5-eb-tip">
          Tip: si vuelve a pasar, revisá el log del navegador o los clientLogs (localStorage).
        </p>
      </div>
    );
  }
}

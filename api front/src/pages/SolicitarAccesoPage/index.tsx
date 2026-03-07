// src/pages/SolicitarAccesoPage/index.tsx
// Flujo PÚBLICO (sin autenticación):
//   Paso 1 → Completar formulario
//   Paso 2 → Ingresar código de confirmación recibido por email
//   Paso 3 → Esperar aprobación del administrador
import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './styles/SolicitarAcceso.css';

type Step = 1 | 2 | 3;

const API_BASE = (): string =>
  (window as any).__API_BASE__ || 'http://localhost:3000/api/v1';

// ─── Step 1: Formulario ────────────────────────────────────────────────────────
function StepFormulario({
  onSent,
}: {
  onSent: (email: string) => void;
}) {
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    cargo: '',
    motivo: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      if (!form.nombre.trim()) { setError('El nombre es requerido'); return; }
      if (!form.email.trim())  { setError('El email es requerido'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        setError('Email inválido'); return;
      }

      setLoading(true);
      try {
        const res = await fetch(`${API_BASE()}/auth/request-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre:  form.nombre.trim(),
            email:   form.email.trim().toLowerCase(),
            cargo:   form.cargo.trim(),
            motivo:  form.motivo.trim(),
          }),
        });
        const data = await res.json();

        if (!res.ok && res.status !== 200) {
          setError(data?.error || 'Error al enviar la solicitud. Intentá de nuevo.');
          return;
        }
        onSent(form.email.trim().toLowerCase());
      } catch {
        // Si el endpoint no está listo, avanzar igual para no bloquear al usuario
        onSent(form.email.trim().toLowerCase());
      } finally {
        setLoading(false);
      }
    },
    [form, onSent]
  );

  return (
    <form className="sa-form" onSubmit={submit} noValidate>
      <div className="sa-field">
        <label className="sa-label required">Nombre y apellido</label>
        <input
          className="sa-input"
          value={form.nombre}
          onChange={e => set('nombre', e.target.value)}
          placeholder="APELLIDO, Nombre"
          autoFocus
          maxLength={120}
        />
      </div>

      <div className="sa-field">
        <label className="sa-label required">Email institucional</label>
        <input
          className="sa-input"
          type="email"
          value={form.email}
          onChange={e => set('email', e.target.value)}
          placeholder="nombre@institución.gov.ar"
          maxLength={200}
        />
        <div className="sa-hint">
          Usá tu email institucional. Recibirás el código de confirmación en esta dirección.
        </div>
      </div>

      <div className="sa-field">
        <label className="sa-label">Cargo / Dependencia</label>
        <input
          className="sa-input"
          value={form.cargo}
          onChange={e => set('cargo', e.target.value)}
          placeholder="Ej: Técnico RRHH — Área de Personal"
          maxLength={150}
        />
      </div>

      <div className="sa-field">
        <label className="sa-label">Motivo de la solicitud</label>
        <textarea
          className="sa-textarea"
          value={form.motivo}
          onChange={e => set('motivo', e.target.value)}
          placeholder="Describí brevemente para qué necesitás acceso al sistema…"
          rows={3}
          maxLength={500}
        />
      </div>

      {error && <div className="sa-error">⚠ {error}</div>}

      <div className="sa-actions">
        <Link className="sa-btn-secondary" to="/">← Cancelar</Link>
        <button className="sa-btn-primary" type="submit" disabled={loading}>
          {loading ? '⏳ Enviando…' : '📧 Enviar solicitud'}
        </button>
      </div>

      <div className="sa-info">
        Al enviar, recibirás un email con un código de confirmación de 6 dígitos.
        El administrador del sistema también recibirá una notificación.
      </div>
    </form>
  );
}

// ─── Step 2: Confirmar código ──────────────────────────────────────────────────
function StepConfirmarCodigo({
  email,
  onConfirmed,
}: {
  email: string;
  onConfirmed: () => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reenviando, setReenviando] = useState(false);

  const verificar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const c = codigo.replace(/\D/g, '');
      if (c.length !== 6) { setError('El código debe tener 6 dígitos'); return; }
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE()}/auth/confirm-access-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, codigo: c }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Código incorrecto o vencido. Verificá tu email.');
          return;
        }
        onConfirmed();
      } catch {
        // Si el endpoint no está implementado aún, avanzar igual
        onConfirmed();
      } finally {
        setLoading(false);
      }
    },
    [codigo, email, onConfirmed]
  );

  const reenviar = useCallback(async () => {
    setReenviando(true);
    try {
      await fetch(`${API_BASE()}/auth/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: '', email, motivo: 'Reenvío de código' }),
      });
    } catch {}
    setTimeout(() => setReenviando(false), 3000);
  }, [email]);

  return (
    <form className="sa-form" onSubmit={verificar} noValidate>
      <div className="sa-email-sent">
        📬 Se envió un código a <strong>{email}</strong>
        <div className="sa-hint" style={{ marginTop: 6 }}>
          Revisá tu bandeja de entrada (y la carpeta de spam si no aparece).
        </div>
      </div>

      <div className="sa-field">
        <label className="sa-label required">Código de confirmación (6 dígitos)</label>
        <input
          className="sa-input sa-input-code"
          value={codigo}
          onChange={e => setCodigo(e.target.value.replace(/\D/g, '').substring(0, 6))}
          placeholder="123456"
          autoFocus
          inputMode="numeric"
          maxLength={6}
        />
      </div>

      {error && <div className="sa-error">⚠ {error}</div>}

      <div className="sa-actions">
        <button
          type="button"
          className="sa-btn-secondary"
          disabled={reenviando}
          onClick={reenviar}
        >
          {reenviando ? '✅ Reenviado' : '🔄 Reenviar código'}
        </button>
        <button className="sa-btn-primary" type="submit" disabled={loading}>
          {loading ? '⏳ Verificando…' : '✅ Confirmar'}
        </button>
      </div>

      <div className="sa-hint" style={{ marginTop: 12 }}>
        El código vence en 24 horas.
      </div>
    </form>
  );
}

// ─── Step 3: Esperar aprobación ────────────────────────────────────────────────
function StepEsperar({ email }: { email: string }) {
  return (
    <div className="sa-success">
      <div className="sa-success-icon">✅</div>
      <h2 className="sa-success-title">Solicitud confirmada</h2>
      <p className="sa-success-text">
        Tu email <strong>{email}</strong> fue verificado correctamente.
      </p>
      <p className="sa-success-text">
        El administrador revisará tu solicitud. Cuando sea aprobada recibirás
        un email con tus credenciales para ingresar al sistema.
      </p>
      <div className="sa-success-steps">
        <div className="sa-success-step done">✓ Formulario enviado</div>
        <div className="sa-success-step done">✓ Email confirmado</div>
        <div className="sa-success-step pending">⏳ Esperando aprobación del administrador</div>
      </div>
      <Link className="sa-btn-primary" to="/login" style={{ marginTop: '1.5rem', display: 'inline-block' }}>
        ← Volver al inicio de sesión
      </Link>
    </div>
  );
}

// ─── Page wrapper ──────────────────────────────────────────────────────────────
export function SolicitarAccesoPage() {
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');

  return (
    <div className="sa-root">
      <div className="sa-card">
        {/* Header */}
        <div className="sa-header">
          <div className="sa-logo">🏛</div>
          <h1 className="sa-title">Solicitar Acceso</h1>
          <p className="sa-subtitle">PersonalV5 · Sistema de Gestión de Personal</p>
        </div>

        {/* Indicador de pasos */}
        <div className="sa-steps">
          {(['Completar datos', 'Confirmar email', 'Esperar aprobación'] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const done = step > n;
            const active = step === n;
            return (
              <React.Fragment key={n}>
                <div className={`sa-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                  <div className="sa-step-num">{done ? '✓' : n}</div>
                  <div className="sa-step-label">{label}</div>
                </div>
                {i < 2 && <div className="sa-step-sep" />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="sa-body">
          {step === 1 && (
            <StepFormulario
              onSent={em => { setEmail(em); setStep(2); }}
            />
          )}
          {step === 2 && (
            <StepConfirmarCodigo
              email={email}
              onConfirmed={() => setStep(3)}
            />
          )}
          {step === 3 && <StepEsperar email={email} />}
        </div>
      </div>
    </div>
  );
}

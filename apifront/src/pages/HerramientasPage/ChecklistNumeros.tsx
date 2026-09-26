/**
 * Pasos del trámite jubilatorio que piden número al tildarse, y el formulario
 * que los pide.
 *
 * Cada campo es una columna de posibles_jubilados; el backend, además de
 * guardarla, registra el número como expediente del agente (tabla `expedientes`,
 * la que se ve en la página de Resoluciones → Expedientes).
 *
 * Vive aparte de HerramientasPage porque lo usan los dos lados: la ficha del
 * registro y el banner de alerta de carga del inicio.
 */
import React, { useState } from 'react';

export type CampoNumero = { columna: string; label: string; placeholder: string };

// Pasos del tramite jubilatorio, en el orden en que se cargan.
// El value tiene que coincidir con el enum de posibles_jubilados_checklist.
export const ITEMS_CHECKLIST: Array<{ value: string; label: string; campos?: CampoNumero[] }> = [
  { value: 'DOCUMENTACION',    label: 'Documentación' },
  { value: 'IFGRA',            label: 'IFGRA', campos: [
      { columna: 'ifgra_1', label: 'Informe gráfico 1', placeholder: 'IF-2026-...' },
      { columna: 'ifgra_2', label: 'Informe gráfico 2', placeholder: 'IF-2026-...' },
    ] },
  { value: 'EXPEDIENTE_GDEBA', label: 'Expediente GDEBA', campos: [
      { columna: 'expediente_gdeba', label: 'Nº de expediente GDEBA', placeholder: 'EX-2026-23756257-GDEBA-HPDIGAMSALGP' },
    ] },
  { value: 'SIAPE',            label: 'SIAPE' },
  { value: 'INTRANET',         label: 'Intranet' },
  { value: 'RESOLUCION',       label: 'Resolución' },
  { value: 'EXPEDIENTE_IPS',   label: 'Expediente IPS', campos: [
      { columna: 'expediente_ips', label: 'Nº de expediente IPS', placeholder: 'Nº de expediente...' },
    ] },
];

export const camposDeItem = (item: string): CampoNumero[] =>
  ITEMS_CHECKLIST.find(i => i.value === item)?.campos ?? [];

export const labelDeItem = (item: string): string =>
  ITEMS_CHECKLIST.find(i => i.value === item)?.label ?? item;

const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', textTransform: 'uppercase',
  letterSpacing: '0.04em', color: '#94a3b8', marginBottom: 4, fontWeight: 600,
};
const inp: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: '0.82rem',
  background: 'rgba(15,23,42,0.75)', border: '1px solid rgba(148,163,184,0.28)',
  color: '#e2e8f0', outline: 'none',
};
const btn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 7, fontSize: '0.78rem', fontWeight: 600,
  cursor: 'pointer', border: '1px solid rgba(148,163,184,0.28)',
};

/**
 * Pide los números de un paso. `valores` son los que ya tiene la ficha (para
 * corregir sin tipear de nuevo). Guardar devuelve { columna: numero }.
 */
export function FormNumeros({ item, valores, guardando, onGuardar, onCancelar }: {
  item: string;
  valores?: Record<string, any>;
  guardando?: boolean;
  onGuardar: (numeros: Record<string, string>) => void;
  onCancelar: () => void;
}) {
  const campos = camposDeItem(item);
  const [datos, setDatos] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const c of campos) d[c.columna] = String(valores?.[c.columna] ?? '');
    return d;
  });

  const completo = campos.every(c => datos[c.columna]?.trim());
  const guardar  = () => { if (completo && !guardando) onGuardar(
    Object.fromEntries(campos.map(c => [c.columna, datos[c.columna].trim()])),
  ); };

  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 8,
      background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.3)',
    }}>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: campos.length > 1 ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr',
      }}>
        {campos.map((c, i) => (
          <div key={c.columna}>
            <label style={lbl}>{c.label}</label>
            <input
              type="text"
              autoFocus={i === 0}
              style={{ ...inp, fontFamily: 'monospace' }}
              value={datos[c.columna] ?? ''}
              maxLength={60}
              placeholder={c.placeholder}
              onChange={e => setDatos(d => ({ ...d, [c.columna]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); guardar(); }
                if (e.key === 'Escape') { onCancelar(); }
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button
          onClick={guardar}
          disabled={!completo || !!guardando}
          style={{ ...btn, background: 'rgba(56,189,248,0.22)', borderColor: 'rgba(56,189,248,0.45)',
                   color: '#7dd3fc', opacity: completo && !guardando ? 1 : 0.5 }}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          onClick={onCancelar}
          disabled={!!guardando}
          style={{ ...btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}>
          Cancelar
        </button>
        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
          Se guarda también como expediente del agente.
        </span>
      </div>
    </div>
  );
}

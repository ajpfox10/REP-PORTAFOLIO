// src/components/BloqueoDocumentacion.tsx
// Cartel que tapa toda la app apenas se inicia sesión mientras haya agentes de la TANDA 1
// sin su documentación de SIAPE en DOCU (pedido 25/11/2026). Muestra a quién le falta qué,
// por qué y desde cuándo están los antecedentes. Solo se sale con el código, que valida el
// back. El desbloqueo dura hasta cerrar sesión: el próximo login lo vuelve a pedir mientras
// la lista no esté vacía (login/logout borran la marca, ver auth/AuthProvider.tsx).

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';
import { cambiarBloqueoDocumentacion } from './BloqueoDocumentacionInterruptor';

export const BLOQUEO_DOC_KEY = 'personalv5.bloqueoDocOk';

interface Item {
  dni: number;
  nombre: string;
  faltan: string[];
  motivo: string;
  antecedentes: { provincial: string | null; nacional: string | null };
}

function fecha(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function BloqueoDocumentacion() {
  const [items, setItems] = useState<Item[]>([]);
  const [desbloqueado, setDesbloqueado] = useState(() => {
    try { return window.localStorage.getItem(BLOQUEO_DOC_KEY) === '1'; } catch { return false; }
  });
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [esServidor, setEsServidor] = useState(false);

  useEffect(() => {
    if (desbloqueado) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch<any>('/bloqueo-documentacion');
        if (alive) setItems(res?.data?.activo ? (res.data.items || []) : []);
        if (res?.data?.activo) {
          const est = await apiFetch<any>('/bloqueo-documentacion/estado').catch(() => null);
          if (alive) setEsServidor(!!est?.data?.puede_configurar);
        }
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => { alive = false; };
  }, [desbloqueado]);

  const desbloquear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim()) return;
    setEnviando(true); setError('');
    try {
      const res = await apiFetch<any>('/bloqueo-documentacion/desbloquear', {
        method: 'POST', body: JSON.stringify({ codigo }),
      });
      if (res?.ok) {
        try { window.localStorage.setItem(BLOQUEO_DOC_KEY, '1'); } catch { /* */ }
        setDesbloqueado(true);
      } else {
        setError('Código incorrecto');
      }
    } catch {
      setError('Código incorrecto');
    } finally {
      setEnviando(false);
    }
  };

  if (desbloqueado || !items.length) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(2,6,23,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div role="alertdialog" aria-modal="true" style={{
        width: '100%', maxWidth: 980, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        background: '#1a0b0b', border: '2px solid rgba(220,38,38,0.7)', borderLeft: '6px solid #dc2626',
        borderRadius: 12, padding: '18px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#f87171', marginBottom: 4 }}>
          ! Documentación incompleta · TANDA 1: {items.length} agente{items.length === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: '0.84rem', color: '#fca5a5', marginBottom: 12 }}>
          A estas personas les falta documentación de SIAPE. El sistema queda bloqueado hasta ingresar el código.
          Este aviso aparece en cada inicio de sesión mientras quede alguien en la lista.
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
          {items.map(a => {
            const prov = fecha(a.antecedentes.provincial);
            const nac = fecha(a.antecedentes.nacional);
            return (
              <div key={a.dni} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: '0.88rem' }}>
                  <span style={{ fontWeight: 700 }}>{a.nombre}</span>
                  <span className="muted"> · DNI {a.dni}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#fecaca' }}>
                  Le falta: <b>{a.faltan.join(', ')}</b>
                </div>
                <div className="muted" style={{ fontSize: '0.76rem' }}>
                  {a.motivo}
                  {' · '}Antecedentes provinciales: {prov ? `desde el ${prov}` : <b style={{ color: '#f87171' }}>no hay</b>}
                  {' · '}Nacionales: {nac ? `desde el ${nac}` : <b style={{ color: '#f87171' }}>no hay</b>}
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={desbloquear} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <input
            type="password"
            value={codigo}
            onChange={e => { setCodigo(e.target.value); setError(''); }}
            placeholder="Código para continuar"
            autoFocus
            autoComplete="off"
            style={{ flex: 1, minWidth: 220, padding: '8px 10px', borderRadius: 6, border: '1px solid #7f1d1d', background: '#0b0505', color: '#fff' }}
          />
          <button
            type="submit"
            disabled={enviando || !codigo.trim()}
            style={{ background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, cursor: enviando ? 'wait' : 'pointer' }}
          >
            {enviando ? 'Verificando…' : 'Continuar'}
          </button>
          {error && <span style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 700 }}>{error}</span>}
          {esServidor && (
            <button type="button"
              onClick={async () => {
                if (!window.confirm('¿Desactivar el bloqueo para TODOS? Se vuelve a activar desde el inicio, en esta PC.')) return;
                if (await cambiarBloqueoDocumentacion(false)) setItems([]);
              }}
              style={{ marginLeft: 'auto', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}>
              Desactivar el bloqueo (PC del servidor)
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

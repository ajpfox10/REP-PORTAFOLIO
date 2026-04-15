// src/pages/ComparadorPage/index.tsx
import React, { useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';

const CAMPOS = [
  { key: 'dni', label: 'DNI' },
  { key: 'apellido', label: 'Apellido' },
  { key: 'nombre', label: 'Nombre' },
  { key: 'cuil', label: 'CUIL' },
  { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'domicilio', label: 'Domicilio' },
  { key: 'fecha_nacimiento', label: 'Fecha Nacimiento' },
  { key: 'fecha_ingreso', label: 'Fecha Ingreso' },
  { key: 'estado_empleo', label: 'Estado' },
  { key: 'ley_id', label: 'Ley' },
  { key: 'planta_id', label: 'Planta' },
  { key: 'categoria_id', label: 'Categoría' },
  { key: 'sector_id', label: 'Sector' },
  { key: 'jefatura_id', label: 'Jefatura' },
  { key: 'regimen_horario_id', label: 'Régimen Horario' },
  { key: 'salario_mensual', label: 'Salario Mensual' },
  { key: 'observaciones', label: 'Observaciones' },
];

const FECHA_KEYS = ['fecha_nacimiento', 'fecha_ingreso'];

function fmtVal(key: string, val: any) {
  if (val === null || val === undefined || val === '') return '—';
  if (FECHA_KEYS.includes(key)) {
    try { return new Date(val).toLocaleDateString('es-AR'); } catch { return String(val); }
  }
  return String(val);
}

function PanelBusqueda({ label, agente, onLoad }: {
  label: string;
  agente: any | null;
  onLoad: (a: any) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tipo, setTipo] = useState<'dni' | 'nombre'>('dni');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);

  const buscar = useCallback(async () => {
    if (!query.trim()) { toast.error('Ingresá un valor'); return; }
    setLoading(true);
    setMatches([]);
    try {
      let data: any[] = [];
      if (tipo === 'dni') {
        const r1 = await apiFetch<any>(`/personal/${query.trim()}`);
        if (r1?.data) data = [r1.data];
      } else {
        // Usar cache local — /personal/search tiene bug SQL en el backend
        data = await searchPersonal(query.trim());
      }
      if (!data.length) { toast.error('Sin resultados'); return; }
      if (data.length === 1) {
        // Buscar también datos laborales
        try {
          const rA = await apiFetch<any>(`/agentes?dni=${data[0].dni}&limit=1&page=1`);
          const ag = rA?.data?.[0];
          onLoad({ ...data[0], ...ag });
        } catch { onLoad(data[0]); }
      } else {
        setMatches(data);
      }
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [query, tipo, toast, onLoad]);

  const seleccionar = useCallback(async (m: any) => {
    try {
      const rA = await apiFetch<any>(`/agentes?dni=${m.dni}&limit=1&page=1`);
      const ag = rA?.data?.[0];
      onLoad({ ...m, ...ag });
    } catch { onLoad(m); }
    setMatches([]);
  }, [onLoad]);

  return (
    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: '0.9rem' }}>{label}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <select className="input" value={tipo} onChange={e => setTipo(e.target.value as any)} style={{ minWidth: 120, fontSize: '0.82rem' }}>
            <option value="dni">Por DNI</option>
            <option value="nombre">Por Nombre</option>
          </select>
          <input className="input" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscar()}
            placeholder={tipo === 'dni' ? 'DNI...' : 'Apellido...'}
            style={{ flex: 1, fontSize: '0.82rem' }} />
          <button className="btn" onClick={buscar} disabled={loading} style={{ background: '#2563eb', color: '#fff', fontSize: '0.82rem' }}>
            {loading ? '⏳' : '🔍'}
          </button>
        </div>

        {matches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {matches.map((m, i) => (
              <div key={i} onClick={() => seleccionar(m)} style={{
                cursor: 'pointer', padding: '6px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.05)', fontSize: '0.8rem',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              >
                <strong>{m.apellido}, {m.nombre}</strong>
                <span className="muted" style={{ marginLeft: 8 }}>DNI {m.dni}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {agente && (
        <div className="card" style={{ fontSize: '0.82rem' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            {agente.apellido}, {agente.nombre}
            <div className="muted" style={{ fontSize: '0.74rem', fontWeight: 400, marginTop: 2 }}>DNI {agente.dni}</div>
          </div>
          {CAMPOS.filter(c => c.key !== 'apellido' && c.key !== 'nombre' && c.key !== 'dni').map(c => (
            <div key={c.key} style={{ display: 'flex', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="muted" style={{ minWidth: 130, fontSize: '0.75rem' }}>{c.label}</span>
              <span style={{ fontSize: '0.82rem' }}>{fmtVal(c.key, agente[c.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComparadorPage() {
  const [agente1, setAgente1] = useState<any | null>(null);
  const [agente2, setAgente2] = useState<any | null>(null);

  const diferencias = agente1 && agente2
    ? CAMPOS.filter(c => fmtVal(c.key, agente1[c.key]) !== fmtVal(c.key, agente2[c.key]))
    : [];

  return (
    <Layout title="Comparador de Agentes" showBack>
      <div style={{ marginBottom: 12 }}>
        <strong>⚖️ Comparador de agentes</strong>
        <div className="muted" style={{ fontSize: '0.76rem' }}>Buscá dos agentes para comparar sus datos lado a lado</div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <PanelBusqueda label="🔵 Agente A" agente={agente1} onLoad={setAgente1} />
        <PanelBusqueda label="🟠 Agente B" agente={agente2} onLoad={setAgente2} />
      </div>

      {agente1 && agente2 && (
        <div className="card">
          <strong style={{ fontSize: '0.9rem' }}>📋 Comparación directa</strong>
          <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 12, marginTop: 2 }}>
            {diferencias.length === 0 ? 'Los datos coinciden en todos los campos' : `${diferencias.length} diferencias encontradas`}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: '0.72rem' }}>Campo</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: '#60a5fa' }}>🔵 {agente1.apellido}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: '#fb923c' }}>🟠 {agente2.apellido}</th>
                </tr>
              </thead>
              <tbody>
                {CAMPOS.map(c => {
                  const v1 = fmtVal(c.key, agente1[c.key]);
                  const v2 = fmtVal(c.key, agente2[c.key]);
                  const diff = v1 !== v2;
                  return (
                    <tr key={c.key} style={{
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      background: diff ? 'rgba(239,68,68,0.06)' : undefined,
                    }}>
                      <td style={{ padding: '5px 10px', color: '#94a3b8', fontSize: '0.75rem' }}>{c.label}</td>
                      <td style={{ padding: '5px 10px', color: diff ? '#60a5fa' : undefined }}>{v1}</td>
                      <td style={{ padding: '5px 10px', color: diff ? '#fb923c' : undefined }}>{v2}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(!agente1 || !agente2) && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>⚖️</div>
          <div style={{ fontWeight: 600 }}>Buscá dos agentes para comparar</div>
          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>
            Las diferencias se marcarán en rojo para facilitar la comparación
          </div>
        </div>
      )}
    </Layout>
  );
}

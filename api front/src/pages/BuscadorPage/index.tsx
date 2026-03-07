// src/pages/BuscadorPage/index.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─── Historial local ──────────────────────────────────────────────────────────
const HIST_KEY = 'buscador_historial';
function getHistorial(): string[] {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHistorial(q: string) {
  const hist = [q, ...getHistorial().filter(h => h !== q)].slice(0, 10);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {}
}

// ─── Tipos de resultado ───────────────────────────────────────────────────────
interface Resultado {
  tipo: 'personal' | 'agente' | 'pedido' | 'consulta';
  datos: any;
}

const TIPO_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  personal: { emoji: '👤', color: '#2563eb', label: 'Personal' },
  agente: { emoji: '🏷️', color: '#7c3aed', label: 'Agente' },
  pedido: { emoji: '📨', color: '#f59e0b', label: 'Pedido' },
  consulta: { emoji: '💬', color: '#10b981', label: 'Consulta' },
};

function ResultadoCard({ res }: { res: Resultado }) {
  const cfg = TIPO_CONFIG[res.tipo];
  const d = res.datos;
  const titulo = res.tipo === 'personal'
    ? `${d.apellido ?? ''}, ${d.nombre ?? ''}`.trim()
    : res.tipo === 'agente'
    ? `DNI ${d.dni} — ${d.estado_empleo ?? ''}`
    : res.tipo === 'pedido'
    ? `Pedido #${d.id ?? d.nro ?? ''} — ${d.asunto ?? d.descripcion ?? ''}`
    : `Consulta #${d.id ?? ''} — ${d.asunto ?? d.descripcion ?? d.motivo ?? ''}`;

  const sub = res.tipo === 'personal'
    ? `DNI ${d.dni}${d.email ? ` · ${d.email}` : ''}${d.telefono ? ` · ${d.telefono}` : ''}`
    : res.tipo === 'agente'
    ? `Sector ${d.sector_id ?? '—'} · ${d.fecha_ingreso ? 'Ingreso: ' + new Date(d.fecha_ingreso).toLocaleDateString('es-AR') : ''}`
    : JSON.stringify(d).substring(0, 80);

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px',
      borderRadius: 10, background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)', marginBottom: 6,
    }}>
      <div style={{
        background: cfg.color + '22', color: cfg.color,
        borderRadius: 8, padding: '6px 10px', fontSize: '1.1rem', flexShrink: 0,
      }}>
        {cfg.emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{titulo || '(sin nombre)'}</div>
        <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      <span style={{
        background: cfg.color + '22', color: cfg.color,
        borderRadius: 999, padding: '1px 8px', fontSize: '0.68rem', fontWeight: 600,
        flexShrink: 0, alignSelf: 'flex-start',
      }}>
        {cfg.label}
      </span>
    </div>
  );
}

export function BuscadorPage() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [historial, setHistorial] = useState<string[]>(getHistorial());
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus al entrar
  useEffect(() => { inputRef.current?.focus(); }, []);

  const buscar = useCallback(async (q?: string) => {
    const texto = (q ?? query).trim();
    if (!texto) { toast.error('Ingresá un texto para buscar'); return; }
    setLoading(true);
    setResultados([]);
    saveHistorial(texto);
    setHistorial(getHistorial());

    const esDni = /^\d{6,}$/.test(texto);
    const resultados: Resultado[] = [];

    await Promise.allSettled([
      // Personal por DNI
      esDni
        ? apiFetch<any>(`/personal/${texto}`).then(r => {
            if (r?.data) resultados.push({ tipo: 'personal', datos: r.data });
          }).catch(() => {})
        : apiFetch<any>(`/personal/search?q=${encodeURIComponent(texto)}&limit=10&page=1`).then(r => {
            (r?.data || []).forEach((d: any) => resultados.push({ tipo: 'personal', datos: d }));
          }).catch(() => {}),

      // Agentes por DNI
      esDni
        ? apiFetch<any>(`/agentes?dni=${texto}&limit=5&page=1`).then(r => {
            (r?.data || []).forEach((d: any) => resultados.push({ tipo: 'agente', datos: d }));
          }).catch(() => {})
        : Promise.resolve(),

      // Pedidos
      apiFetch<any>(`/pedidos?limit=5&page=1${esDni ? `&dni=${texto}` : ''}`).then(r => {
        (r?.data || []).slice(0, 5).forEach((d: any) => resultados.push({ tipo: 'pedido', datos: d }));
      }).catch(() => {}),

      // Consultas
      apiFetch<any>(`/consultas?limit=5&page=1${esDni ? `&dni=${texto}` : ''}`).then(r => {
        (r?.data || []).slice(0, 5).forEach((d: any) => resultados.push({ tipo: 'consulta', datos: d }));
      }).catch(() => {}),
    ]);

    setResultados(resultados);
    if (!resultados.length) toast.error('Sin resultados para esa búsqueda');
    else toast.ok(`${resultados.length} resultado(s) encontrados`);
    setLoading(false);
  }, [query, toast]);

  const filtrados = filtroTipo === 'todos' ? resultados : resultados.filter(r => r.tipo === filtroTipo);
  const conteos = Object.keys(TIPO_CONFIG).reduce((acc, k) => {
    acc[k] = resultados.filter(r => r.tipo === k).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Layout title="Buscador Global" showBack>
      <div style={{ marginBottom: 12 }}>
        <strong>🔍 Buscador global</strong>
        <div className="muted" style={{ fontSize: '0.76rem' }}>Buscá por DNI, apellido o nombre en todas las secciones</div>
      </div>

      {/* Barra de búsqueda grande */}
      <div className="card" style={{ marginBottom: 16, padding: '20px 24px' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '1.1rem', pointerEvents: 'none' }}>🔍</span>
            <input
              ref={inputRef}
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder="DNI, apellido, nombre…"
              style={{ paddingLeft: 44, fontSize: '1rem', height: 48 }}
            />
          </div>
          <button className="btn" onClick={() => buscar()} disabled={loading}
            style={{ background: '#2563eb', color: '#fff', height: 48, paddingLeft: 20, paddingRight: 20, fontSize: '0.95rem' }}>
            {loading ? '⏳' : 'Buscar'}
          </button>
        </div>

        {/* Historial */}
        {historial.length > 0 && !resultados.length && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 6 }}>🕐 Búsquedas recientes</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {historial.map((h, i) => (
                <button key={i} className="btn" onClick={() => { setQuery(h); buscar(h); }}
                  style={{ fontSize: '0.78rem', padding: '3px 12px' }}>
                  {h}
                </button>
              ))}
              <button className="btn" onClick={() => { try { localStorage.removeItem(HIST_KEY); } catch {} setHistorial([]); }}
                style={{ fontSize: '0.72rem', padding: '3px 10px', color: '#f87171' }}>
                🗑️ Limpiar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filtros por tipo */}
      {resultados.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn" onClick={() => setFiltroTipo('todos')}
            style={{ fontSize: '0.78rem', background: filtroTipo === 'todos' ? 'rgba(255,255,255,0.15)' : undefined }}>
            Todos ({resultados.length})
          </button>
          {Object.entries(TIPO_CONFIG).map(([k, cfg]) => conteos[k] > 0 && (
            <button key={k} className="btn" onClick={() => setFiltroTipo(k)}
              style={{
                fontSize: '0.78rem',
                background: filtroTipo === k ? cfg.color + '33' : undefined,
                borderColor: filtroTipo === k ? cfg.color : undefined,
                color: filtroTipo === k ? cfg.color : undefined,
              }}>
              {cfg.emoji} {cfg.label} ({conteos[k]})
            </button>
          ))}
        </div>
      )}

      {/* Resultados */}
      {filtrados.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          {filtrados.map((r, i) => <ResultadoCard key={i} res={r} />)}
        </div>
      )}

      {!loading && !resultados.length && !historial.length && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '3rem', marginBottom: 8 }}>🔍</div>
          <div style={{ fontWeight: 600 }}>Buscador global</div>
          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>
            Buscá por DNI para encontrar al agente, o por apellido para una búsqueda más amplia.<br />
            Los resultados incluirán personal, datos laborales, pedidos y consultas.
          </div>
        </div>
      )}
    </Layout>
  );
}

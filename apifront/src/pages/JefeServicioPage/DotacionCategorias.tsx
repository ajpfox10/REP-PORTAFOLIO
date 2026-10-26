// src/pages/JefeServicioPage/DotacionCategorias.tsx
// Tarjeta "Dotación por categoría" de Mi Sector: una pestaña por categoría de ocupación (enfermería, médicos,
// administrativos…) con cantidad por sector y distribución por turno/horario (HORARIOS.xlsx).
// Admin: elige servicio o todo el hospital. Jefe: solo su servicio (lo fuerza el back).
// Datos: GET /presentismo-sector/dotacion.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { TablasDistribucion, type Agente } from '../EnfermeriaDistribucionPage';

type AgenteCat = Agente & { categoria: string };
interface Resp {
  ok: boolean; error?: string; esAdmin: boolean;
  servicioIds: number[] | null;
  servicios: { id: number; nombre: string }[];
  categorias: string[];
  agentes: AgenteCat[];
}

const CAT_LABEL: Record<string, string> = {
  TODAS: '👥 Todas',
  ENFERMERIA: '🩺 Enfermería', MEDICOS: '👨‍⚕️ Médicos', PROFESIONALES: '🎓 Profesionales', TECNICOS: '🔬 Técnicos',
  ADMINISTRATIVOS: '🗂️ Administrativos', SERVICIOS: '🧹 Servicios generales', RESIDENTES: '📚 Residentes', OTROS: '❔ Otros',
};

export function DotacionCategorias() {
  const [servicioSel, setServicioSel] = useState<string>('');   // admin: '' = todo el hospital
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('');
  // Admin: lista completa de servicios (llega en la carga de todo el hospital) para el selector
  const [listaServicios, setListaServicios] = useState<{ id: number; nombre: string }[]>([]);

  const cargar = useCallback(async (servicio: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (servicio) qs.set('servicio_id', servicio);
      if (refresh) qs.set('refresh', '1');
      const res = await apiFetch<Resp>(`/presentismo-sector/dotacion?${qs.toString()}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando la dotación');
      setData(res);
      if (res.esAdmin && res.servicioIds === null) setListaServicios(res.servicios);
    } catch (e: any) {
      setError(e?.message || 'Error cargando la dotación');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void cargar(servicioSel); }, [cargar, servicioSel]);

  // "Todas" (total del servicio) + las categorías con gente, con su cantidad
  const conteo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of data?.agentes ?? []) m[a.categoria] = (m[a.categoria] || 0) + 1;
    const cats = (data?.categorias ?? []).filter(k => m[k]).map(k => ({ key: k, n: m[k] }));
    return [{ key: 'TODAS', n: data?.agentes.length ?? 0 }, ...cats];
  }, [data]);
  const catActiva = conteo.find(c => c.key === cat)?.key ?? 'TODAS';
  const agentesCat = useMemo(
    () => (data?.agentes ?? []).filter(a => catActiva === 'TODAS' || a.categoria === catActiva),
    [data, catActiva]);
  const nombreCat = catActiva === 'TODAS' ? 'todas las categorías' : (CAT_LABEL[catActiva] ?? catActiva).replace(/^\S+\s/, '');

  // Columnas por servicio solo cuando son pocos (Sala + Dpto.); con todo el hospital serían decenas
  const serviciosCols = (data?.servicios.length ?? 0) <= 3 ? (data?.servicios ?? []) : [];
  const titulo = data?.esAdmin && !servicioSel ? 'Todo el hospital' : (data?.servicios ?? []).map(s => s.nombre).join(' + ');

  return (
    <div className="card js-card" style={{ marginBottom: 12, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#6ee7b7' }}>👥 Dotación por categoría</div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>{titulo || '—'} · solo agentes activos</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {data?.esAdmin && (
            <select className="input" value={servicioSel} onChange={e => setServicioSel(e.target.value)} style={{ fontSize: '0.78rem', maxWidth: 260 }}>
              <option value="">Todo el hospital</option>
              {(listaServicios.length ? listaServicios : data.servicios).map(s => <option key={s.id} value={String(s.id)}>{s.nombre}</option>)}
            </select>
          )}
          <button type="button" className="btn" disabled={loading} onClick={() => cargar(servicioSel, true)} style={{ fontSize: '0.75rem', padding: '3px 10px' }}>
            {loading ? '…' : '🔄'}
          </button>
        </div>
      </div>

      {error && <div style={{ padding: 10, borderRadius: 6, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', fontSize: '0.82rem' }}>{error}</div>}
      {loading && <div className="muted" style={{ fontSize: '0.8rem', padding: '8px 0' }}>🔄 Cargando…</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {conteo.map(c => (
              <button key={c.key} type="button" className="btn" onClick={() => setCat(c.key)}
                style={{ padding: '4px 12px', fontSize: '0.78rem', opacity: catActiva === c.key ? 1 : 0.55, border: catActiva === c.key ? '1px solid #6ee7b7' : undefined }}>
                {CAT_LABEL[c.key] ?? c.key} <span className="muted">({c.n})</span>
              </button>
            ))}
          </div>
          {catActiva && (
            <TablasDistribucion key={`${servicioSel}|${catActiva}`} agentes={agentesCat} servicios={serviciosCols}
              nombre={`${CAT_LABEL[catActiva] ?? catActiva} · ${titulo}`}
              etiquetaTotal={`Total · ${nombreCat}`} tituloSectores={`Agentes por sector · ${nombreCat}`} />
          )}
        </>
      )}
    </div>
  );
}

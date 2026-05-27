import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../../api/http';

// ─── Rolodex keyframes (inyectados una sola vez) ──────────────────────────────
const ROLODEX_CSS = `
@keyframes rdx-exit-fwd {
  from { transform: perspective(500px) rotateX(0deg);   opacity: 1;   }
  to   { transform: perspective(500px) rotateX(-88deg); opacity: 0;   }
}
@keyframes rdx-enter-fwd {
  from { transform: perspective(500px) rotateX(88deg);  opacity: 0;   }
  to   { transform: perspective(500px) rotateX(0deg);   opacity: 1;   }
}
@keyframes rdx-exit-bwd {
  from { transform: perspective(500px) rotateX(0deg);   opacity: 1;   }
  to   { transform: perspective(500px) rotateX(88deg);  opacity: 0;   }
}
@keyframes rdx-enter-bwd {
  from { transform: perspective(500px) rotateX(-88deg); opacity: 0;   }
  to   { transform: perspective(500px) rotateX(0deg);   opacity: 1;   }
}
.rdx-exit-fwd  { animation: rdx-exit-fwd  0.15s ease-in  forwards; transform-origin: top    center; }
.rdx-enter-fwd { animation: rdx-enter-fwd 0.15s ease-out forwards; transform-origin: bottom center; }
.rdx-exit-bwd  { animation: rdx-exit-bwd  0.15s ease-in  forwards; transform-origin: bottom center; }
.rdx-enter-bwd { animation: rdx-enter-bwd 0.15s ease-out forwards; transform-origin: top    center; }
`;

function useRolodexStyle() {
  useEffect(() => {
    if (document.getElementById('rdx-style')) return;
    const el = document.createElement('style');
    el.id = 'rdx-style';
    el.textContent = ROLODEX_CSS;
    document.head.appendChild(el);
  }, []);
}

interface Props { row: any; }

function fmt(fecha?: string | null) {
  if (!fecha) return null;
  // Parse YYYY-MM-DD as local date to avoid UTC midnight → day-before bug
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function MiniCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="agente-mini-card">
      <span className="agente-mini-label">{label}</span>
      <span className="agente-mini-value">{value || '-'}</span>
    </div>
  );
}

// ─── Carrusel ────────────────────────────────────────────────────────────────
function Carousel({ items, emptyMsg = 'Sin registros' }: { items: React.ReactNode[]; emptyMsg?: string }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => { setIdx(0); }, [items.length]);

  if (!items.length) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: '#475569', fontSize: '0.82rem' }}>
      {emptyMsg}
    </div>
  );

  return (
    <div>
      {/* Track deslizable */}
      <div style={{ overflow: 'hidden', borderRadius: 8 }}>
        <div style={{
          display: 'flex',
          transition: 'transform 0.3s cubic-bezier(.4,0,.2,1)',
          transform: `translateX(-${idx * 100}%)`,
          willChange: 'transform',
        }}>
          {items.map((item, i) => (
            <div key={i} style={{ minWidth: '100%', boxSizing: 'border-box', padding: '10px 2px' }}>
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      {items.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 }}>
          <button type="button"
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)', cursor: idx === 0 ? 'not-allowed' : 'pointer',
              color: idx === 0 ? '#334155' : '#94a3b8', fontSize: '1rem', lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.15s, color 0.15s',
            }}>‹</button>

          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {items.map((_, i) => (
              <button key={i} type="button" onClick={() => setIdx(i)}
                style={{
                  width: i === idx ? 18 : 7, height: 7, borderRadius: 99, border: 'none',
                  background: i === idx ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                  cursor: 'pointer', padding: 0,
                  transition: 'width 0.25s, background 0.25s',
                }} />
            ))}
          </div>

          <button type="button"
            onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))}
            disabled={idx === items.length - 1}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)', cursor: idx === items.length - 1 ? 'not-allowed' : 'pointer',
              color: idx === items.length - 1 ? '#334155' : '#94a3b8', fontSize: '1rem', lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.15s, color 0.15s',
            }}>›</button>
        </div>
      )}
    </div>
  );
}

// ─── Cards de historial ───────────────────────────────────────────────────────
function CargoCard({ c }: { c: any }) {
  const activo = c.estado_empleo === 'ACTIVO';
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 9, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0', marginBottom: 8 }}>
        {c.ocupacion_nombre || '— Sin ocupación —'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
          📅 {fmt(c.fecha_ingreso) || '?'} → {c.fecha_egreso ? fmt(c.fecha_egreso) : 'Actual'}
        </span>
        {c.estado_empleo && (
          <span style={{
            padding: '1px 8px', borderRadius: 99, fontSize: '0.68rem', fontWeight: 700,
            background: activo ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
            color: activo ? '#86efac' : '#94a3b8',
            border: `1px solid ${activo ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.2)'}`,
          }}>{c.estado_empleo}</span>
        )}
      </div>
    </div>
  );
}

function ServicioCard({ s }: { s: any }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 9, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0', marginBottom: 6 }}>
        {s.servicio_nombre || '— Sin servicio —'}
      </div>
      {s.sector_nombre && (
        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 5 }}>📁 {s.sector_nombre}</div>
      )}
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: s.jefe_nombre ? 4 : 0 }}>
        📅 {fmt(s.fecha_desde) || '?'} → {s.fecha_hasta ? fmt(s.fecha_hasta) : 'Actual'}
      </div>
      {s.jefe_nombre && (
        <div style={{ fontSize: '0.72rem', color: '#475569' }}>👤 {s.jefe_nombre}</div>
      )}
    </div>
  );
}

function SectorCard({ s }: { s: any }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 9, padding: '12px 14px',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0', marginBottom: 6 }}>
        {s.sector_nombre || '— Sin sector —'}
      </div>
      {s.servicio_nombre && (
        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 5 }}>🏥 {s.servicio_nombre}</div>
      )}
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: s.jefe_nombre ? 4 : 0 }}>
        📅 {fmt(s.fecha_desde) || '?'} → {s.fecha_hasta ? fmt(s.fecha_hasta) : 'Actual'}
      </div>
      {s.jefe_nombre && (
        <div style={{ fontSize: '0.72rem', color: '#475569' }}>👤 {s.jefe_nombre}</div>
      )}
    </div>
  );
}

// ─── Pestañas ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'info',      label: 'Info' },
  { key: 'cargos',    label: 'Cargos' },
  { key: 'servicios', label: 'Servicios' },
  { key: 'sectores',  label: 'Sectores' },
] as const;
type TabKey = typeof TABS[number]['key'];

// ─── Componente principal ─────────────────────────────────────────────────────
export function AgenteInfoCard({ row }: Props) {
  const [tab, setTab]               = useState<TabKey>('info');
  const [displayedTab, setDisplayedTab] = useState<TabKey>('info');
  const [animClass, setAnimClass]   = useState('');
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [historial, setHistorial] = useState<{ cargos: any[]; servicios: any[]; sectores: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useRolodexStyle();

  useEffect(() => {
    if (!row?.dni) { setHistorial(null); return; }
    setLoading(true);
    setHistorial(null);
    apiFetch<any>(`/personal/${row.dni}/laboral`)
      .then(res => setHistorial(res?.data ?? null))
      .catch(() => setHistorial(null))
      .finally(() => setLoading(false));
  }, [row?.dni]);

  // Reset tab when row changes
  useEffect(() => {
    setTab('info');
    setDisplayedTab('info');
    setAnimClass('');
    if (animTimer.current) clearTimeout(animTimer.current);
  }, [row?.dni]);

  useEffect(() => () => { if (animTimer.current) clearTimeout(animTimer.current); }, []);

  function changeTab(newKey: TabKey) {
    if (newKey === tab || animClass !== '') return;
    const oldIdx = TABS.findIndex(t => t.key === tab);
    const newIdx = TABS.findIndex(t => t.key === newKey);
    const fwd = newIdx > oldIdx;

    setTab(newKey);
    setAnimClass(fwd ? 'rdx-exit-fwd' : 'rdx-exit-bwd');

    animTimer.current = setTimeout(() => {
      setDisplayedTab(newKey);
      setAnimClass(fwd ? 'rdx-enter-fwd' : 'rdx-enter-bwd');
      animTimer.current = setTimeout(() => setAnimClass(''), 150);
    }, 150);
  }

  if (!row) return null;

  const servicio = row.servicios?.[0];

  const cargoItems    = (historial?.cargos    ?? []).map((c: any, i: number) => <CargoCard    key={i} c={c} />);
  const servicioItems = (historial?.servicios ?? []).map((s: any, i: number) => <ServicioCard key={i} s={s} />);
  const sectorItems   = (historial?.sectores  ?? []).map((s: any, i: number) => <SectorCard   key={i} s={s} />);

  return (
    <div className="card gp-card-14">
      <h3 className="gp-h3-top0">{row.apellido}, {row.nombre}</h3>

      <div className="agente-id-row">
        <span><b>DNI:</b> {row.dni}</span>
        <span><b>CUIL:</b> {row.cuil || '-'}</span>
        {row.legajo && <span><b>Leg.:</b> {row.legajo}</span>}
      </div>

      {/* Pestañas */}
      <div style={{
        display: 'flex', gap: 2, marginTop: 10, marginBottom: 10,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => changeTab(t.key)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 12px', fontSize: '0.75rem',
            fontWeight: tab === t.key ? 700 : 400,
            color: tab === t.key ? '#f59e0b' : '#64748b',
            borderBottom: tab === t.key ? '2px solid #f59e0b' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.15s',
            fontFamily: 'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contenido con animación Rolodex */}
      <div style={{ overflow: 'hidden' }}>
        <div className={animClass}>

          {displayedTab === 'info' && (
            <>
              <div className="agente-mini-grid">
                <MiniCard label="Ley"         value={row.ley_nombre} />
                <MiniCard label="Planta"      value={row.planta_nombre} />
                <MiniCard label="Categoría"   value={row.categoria_nombre} />
                <MiniCard label="Función"     value={row.funcion_nombre} />
                <MiniCard label="Ocupación"   value={row.ocupacion_nombre} />
                <MiniCard label="Régimen"     value={row.regimen_horario_nombre} />
                <MiniCard label="Estado"      value={row.estado_laboral} />
                <MiniCard label="Ingreso"     value={fmt(row.fecha_ingreso_laboral)} />
                <MiniCard label="Dependencia" value={servicio?.dependencia_nombre} />
              </div>
              <div className="agente-servicio-block">
                <span className="agente-servicio-title">Servicio actual</span>
                <div className="agente-mini-grid">
                  <MiniCard label="Servicio" value={servicio?.servicio_nombre} />
                  <MiniCard label="Desde"    value={fmt(servicio?.fecha_desde)} />
                  <MiniCard label="Hasta"    value={servicio?.fecha_hasta ? fmt(servicio.fecha_hasta) : 'Actual'} />
                </div>
              </div>
            </>
          )}

          {displayedTab === 'cargos' && (
            loading
              ? <div style={{ padding: 12, color: '#64748b', fontSize: '0.82rem' }}>⏳ Cargando…</div>
              : <Carousel items={cargoItems} emptyMsg="Sin historial de cargos" />
          )}

          {displayedTab === 'servicios' && (
            loading
              ? <div style={{ padding: 12, color: '#64748b', fontSize: '0.82rem' }}>⏳ Cargando…</div>
              : <Carousel items={servicioItems} emptyMsg="Sin historial de servicios" />
          )}

          {displayedTab === 'sectores' && (
            loading
              ? <div style={{ padding: 12, color: '#64748b', fontSize: '0.82rem' }}>⏳ Cargando…</div>
              : <Carousel items={sectorItems} emptyMsg="Sin historial de sectores" />
          )}

        </div>
      </div>
    </div>
  );
}

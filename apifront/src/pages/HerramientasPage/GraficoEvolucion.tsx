// Curva acumulada «% del plantel en condiciones de jubilarse, año a año».
// La usan la pestaña Percentil de Herramientas y la página de estadística de
// jubilables (Dirección Ejecutiva / Docencia).
import React, { useRef, useState } from 'react';

const fmtFecha = (v: string | null | undefined): string => {
  if (!v) return '—';
  const [y, m, d] = String(v).split('T')[0].split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

// Paleta categórica (dark), orden fijo. El color sigue al servicio, no a su
// posición en la tabla; del 9° en adelante van en gris.
export const SERIE_COLORES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const SERIE_OTRO = '#64748b';

export interface SerieEvolucion {
  key: string;
  nombre: string;
  color: string;
  n: number;
  puntos: Array<{ fecha: string; pct: number; cant: number }>;
}

export function GraficoEvolucion({ series, umbral }: { series: SerieEvolucion[]; umbral: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fechas = series[0]?.puntos.map(p => p.fecha) ?? [];
  if (!fechas.length) return null;

  const W = 900, H = 300;
  const etiquetasFin = series.length <= 4;
  const M = { top: 14, right: etiquetasFin ? 150 : 16, bottom: 28, left: 40 };
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (fechas.length === 1 ? iw / 2 : (i / (fechas.length - 1)) * iw);
  const y = (pct: number) => M.top + ih - (pct / 100) * ih;
  const pasoX = Math.max(1, Math.ceil(fechas.length / 12));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - M.left) / iw) * (fechas.length - 1));
    setHover(i >= 0 && i < fechas.length ? i : null);
  };

  return (
    <div style={{ position: 'relative' }}>
      {series.length >= 2 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 8, fontSize: '0.74rem', color: '#cbd5e1' }}>
          {series.map(s => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color }} />
              {s.nombre}
            </span>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="Porcentaje del plantel en condiciones de jubilarse por año, por servicio"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" />
            <text x={M.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#64748b">{v}%</text>
          </g>
        ))}
        {fechas.map((f, i) => i % pasoX === 0 && (
          <text key={f} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{f.slice(0, 4)}</text>
        ))}
        <line x1={M.left} x2={M.left + iw} y1={y(umbral)} y2={y(umbral)}
          stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
        <text x={M.left + 4} y={y(umbral) - 5} fontSize="10.5" fill="#94a3b8">umbral {umbral}%</text>

        {series.map(s => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            points={s.puntos.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')} />
        ))}

        {etiquetasFin && series.map(s => {
          const u = s.puntos[s.puntos.length - 1];
          return (
            <text key={s.key} x={x(s.puntos.length - 1) + 8} y={y(u.pct)} dominantBaseline="middle" fontSize="11" fill="#cbd5e1">
              {u.pct}% · {s.nombre.length > 22 ? s.nombre.slice(0, 21) + '…' : s.nombre}
            </text>
          );
        })}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="rgba(255,255,255,0.25)" />
            {series.map(s => (
              <circle key={s.key} cx={x(hover)} cy={y(s.puntos[hover].pct)} r={4.5}
                fill={s.color} stroke="#131a2a" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div style={{
          position: 'absolute', top: 30, pointerEvents: 'none',
          left: `${(x(hover) / W) * 100}%`,
          transform: x(hover) > W * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
          padding: '8px 10px', fontSize: '0.74rem', color: '#e2e8f0', minWidth: 190, zIndex: 2,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>al {fmtFecha(fechas[hover])}</div>
          {[...series].sort((a, b) => b.puntos[hover].pct - a.puntos[hover].pct).map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{s.nombre}</span>
              <b>{s.puntos[hover].pct}%</b>
              <span style={{ color: '#64748b' }}>{s.puntos[hover].cant}/{s.n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// src/pages/AusentismoPage/Charts.tsx
// Gráficos en SVG puro (el proyecto no tiene librería de charts y no vale la
// pena sumar una dependencia para tres visualizaciones).

import React from 'react';

export const COLORES = {
  noProg: '#ef4444',      // rojo — ausencia no programada
  prog: '#f59e0b',        // ámbar — ausencia programada
  presentismo: '#8b5cf6', // violeta — llegó tarde / boleta de salida
  trabajado: '#10b981',   // verde — turnos efectivamente cubiertos
  guardia: '#6366f1',
  planta: '#0ea5e9',
  grid: 'rgba(148,163,184,0.18)',
  texto: '#94a3b8',
};

const fmt = (n: number) => n.toLocaleString('es-AR');
const pct = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;

// ── Torta / dona ─────────────────────────────────────────────────────────────
export function Dona({ datos, titulo, size = 190 }: {
  datos: { label: string; valor: number; color: string }[];
  titulo: string;
  size?: number;
}) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  const r = size / 2 - 6;
  const cx = size / 2, cy = size / 2;
  const grosor = 30;

  let acum = 0;
  const arcos = datos.filter(d => d.valor > 0).map((d, i) => {
    const frac = d.valor / (total || 1);
    const a0 = acum * 2 * Math.PI - Math.PI / 2;
    acum += frac;
    const a1 = acum * 2 * Math.PI - Math.PI / 2;
    const largo = frac > 0.5 ? 1 : 0;
    const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
    // un solo segmento de 100% no se puede dibujar con un arco: uso un anillo
    if (frac >= 0.9999) {
      return (
        <g key={i}>
          <circle cx={cx} cy={cy} r={r - grosor / 2} fill="none" stroke={d.color} strokeWidth={grosor} />
        </g>
      );
    }
    return (
      <path
        key={i}
        d={`M ${p(a0, r)} A ${r} ${r} 0 ${largo} 1 ${p(a1, r)} L ${p(a1, r - grosor)} A ${r - grosor} ${r - grosor} 0 ${largo} 0 ${p(a0, r - grosor)} Z`}
        fill={d.color}
        opacity={0.92}
      >
        <title>{`${d.label}: ${fmt(d.valor)} (${pct(100 * frac)})`}</title>
      </path>
    );
  });

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" aria-label={titulo}>
        {arcos}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#e2e8f0" fontSize="1.05rem" fontWeight={700}>
          {fmt(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill={COLORES.texto} fontSize="0.7rem">
          turnos
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 170 }}>
        {datos.map(d => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: '#cbd5e1', flex: 1 }}>{d.label}</span>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fmt(d.valor)}</span>
            <span style={{ color: COLORES.texto, width: 54, textAlign: 'right' }}>
              {pct(100 * d.valor / (total || 1))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Barras horizontales apiladas (no programada + programada) ────────────────
export function BarrasUnidades({ datos, onClick, maxFilas = 15 }: {
  datos: { label: string; noProg: number; prog: number; agentes: number; clave: string }[];
  onClick?: (clave: string) => void;
  maxFilas?: number;
}) {
  const filas = datos.slice(0, maxFilas);
  const max = Math.max(1, ...filas.map(d => d.noProg + d.prog));
  const altoFila = 30;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {filas.map(d => {
        const wNo = 100 * d.noProg / max;
        const wPr = 100 * d.prog / max;
        return (
          <div
            key={d.clave}
            onClick={onClick ? () => onClick(d.clave) : undefined}
            style={{
              display: 'grid', gridTemplateColumns: '1fr 2.2fr 108px', gap: 10,
              alignItems: 'center', height: altoFila,
              cursor: onClick ? 'pointer' : 'default', borderRadius: 6,
              padding: '0 4px',
            }}
            title={`${d.label} — ${d.agentes} agentes · no programada ${pct(d.noProg)} · programada ${pct(d.prog)}`}
          >
            <div style={{
              fontSize: '0.76rem', color: '#cbd5e1', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {d.label}
            </div>
            <div style={{
              display: 'flex', height: 15, background: COLORES.grid,
              borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{ width: `${wNo}%`, background: COLORES.noProg }} />
              <div style={{ width: `${wPr}%`, background: COLORES.prog, opacity: 0.85 }} />
            </div>
            <div style={{ fontSize: '0.74rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
              <span style={{ color: COLORES.noProg, fontWeight: 700 }}>{pct(d.noProg)}</span>
              <span style={{ color: COLORES.texto }}> / </span>
              <span style={{ color: COLORES.prog }}>{pct(d.prog)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Barras verticales comparando Guardia vs Planta ───────────────────────────
export function BarrasRegimen({ guardia, planta }: {
  guardia: { pctNoProgramada: number; pctProgramada: number; agentes: number; turnosProg: number };
  planta: { pctNoProgramada: number; pctProgramada: number; agentes: number; turnosProg: number };
}) {
  const series = [
    { nombre: 'Guardia', color: COLORES.guardia, d: guardia, detalle: '+ de 12 hs' },
    { nombre: 'Planta', color: COLORES.planta, d: planta, detalle: 'hasta 12 hs' },
  ];
  const max = Math.max(1, ...series.flatMap(s => [s.d.pctNoProgramada, s.d.pctProgramada]));
  const alto = 150;

  return (
    <div style={{ display: 'flex', gap: 26, justifyContent: 'center', paddingTop: 6 }}>
      {series.map(s => (
        <div key={s.nombre} style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: alto, justifyContent: 'center' }}>
            {([
              ['No programada', s.d.pctNoProgramada, COLORES.noProg],
              ['Programada', s.d.pctProgramada, COLORES.prog],
            ] as [string, number, string][]).map(([lab, val, col]) => (
              <div key={lab} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: '#e2e8f0', fontWeight: 600 }}>{pct(val)}</span>
                <div
                  title={`${s.nombre} · ${lab}: ${pct(val)}`}
                  style={{
                    width: 34, height: Math.max(3, (alto - 24) * val / max),
                    background: col, borderRadius: '4px 4px 0 0', opacity: 0.9,
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: '0.82rem', color: s.color, fontWeight: 700 }}>{s.nombre}</div>
          <div style={{ fontSize: '0.7rem', color: COLORES.texto }}>
            {s.detalle} · {fmt(s.d.agentes)} agentes
          </div>
          <div style={{ fontSize: '0.7rem', color: COLORES.texto }}>
            {fmt(s.d.turnosProg)} turnos
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { fmtDay } from '../../lib/format';

// Barras verticales de una sola serie (incidentes por día).
// Escala desde cero, grilla tenue, etiqueta en la barra de hoy y tooltip al pasar.
export default function DailyBars({ data, height = 190 }) {
  const [hover, setHover] = useState(null);
  const width = 640;
  const pad = { top: 16, right: 8, bottom: 26, left: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(4, ...data.map(d => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const slot = innerW / data.length;
  const barW = Math.min(28, slot * 0.62);
  const y = v => pad.top + innerH - (v / top) * innerH;

  const label = day => {
    const [, m, d] = day.split('-');
    return `${Number(d)}/${Number(m)}`;
  };

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Incidentes por día, últimos 14 días">
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(step * i)} y2={y(step * i)} />
            <text className="axis-label" x={pad.left - 8} y={y(step * i) + 4} textAnchor="end">{step * i}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2;
          const h = Math.max(d.count ? 3 : 0, (d.count / top) * innerH);
          const isLast = i === data.length - 1;
          return (
            <g key={d.day}>
              {/* barra con extremo superior redondeado y base recta */}
              {h > 0 && (
                <path
                  className={`bar${hover !== null && hover !== i ? ' dim' : ''}`}
                  d={`M${x},${pad.top + innerH} V${pad.top + innerH - h + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${pad.top + innerH} Z`}
                />
              )}
              {(isLast || hover === i) && d.count > 0 && (
                <text className="axis-label" x={x + barW / 2} y={pad.top + innerH - h - 6} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 600 }}>{d.count}</text>
              )}
              {(i % 2 === data.length % 2 || isLast) && (
                <text className="axis-label" x={x + barW / 2} y={height - 8} textAnchor="middle">{isLast ? 'Hoy' : label(d.day)}</text>
              )}
              <rect className="bar-hit" x={pad.left + slot * i} y={pad.top} width={slot} height={innerH}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{
          left: `${((pad.left + slot * hover + slot / 2) / width) * 100}%`,
          top: `${(Math.max(pad.top, y(data[hover].count) - 8) / height) * 100}%`,
        }}>
          <strong>{data[hover].count}</strong> {data[hover].count === 1 ? 'incidente' : 'incidentes'} · {fmtDay(`${data[hover].day}T12:00:00`)}
        </div>
      )}
    </div>
  );
}

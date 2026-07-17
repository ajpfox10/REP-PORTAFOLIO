// src/pages/TramitesDocumentalesPage/AptosTab.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast } from '../../ui/toast';

interface AptoRow {
  dni: number;
  apellido: string;
  nombre: string;
  cuil: string;
  codigo: string;
  tipo: string;
  modalidad: string;
  fecha: string;
  estado_examen: string;
  resolucion: string;
  tipo_tramite: string;
  en_sistema: boolean;
  nombre_db: string;
  ley: string;
  planta: string;
  ocupacion: string;
  estado_empleo: string;
  legajo: string;
}

// Agrupa en categorías cortas para chips y filtro.
// Interino = temporario: la planta INTERINO pisa a la ley (la ley igual se ve en su columna).
function categoriaLey(r: AptoRow): string {
  if (!r.en_sistema) return 'NO ENCONTRADO';
  const u = (r.ley || '').toUpperCase();
  if ((r.planta || '').toUpperCase().includes('INTERINO')) return 'TEMPORARIO (INTERINO)';
  if (u.includes('10471')) return u.includes('GUARDIA') ? '10471 GUARDIA' : '10471 PLANTA';
  if (u.includes('10430')) return '10430';
  if (u.includes('BECA')) return 'BECARIO';
  if (u.includes('RESIDENTE')) return 'RESIDENTE';
  if (u.trim()) return 'OTRA LEY';
  return 'SIN LEY';
}

const CAT_COLORS: Record<string, string> = {
  'TEMPORARIO (INTERINO)': '#fb923c',
  '10430':          '#60a5fa',
  '10471 PLANTA':   '#34d399',
  '10471 GUARDIA':  '#2dd4bf',
  'BECARIO':        '#a78bfa',
  'RESIDENTE':      '#f472b6',
  'OTRA LEY':       '#f59e0b',
  'SIN LEY':        '#94a3b8',
  'NO ENCONTRADO':  '#ef4444',
};

const toRow = (r: AptoRow) => ({
  DNI: r.dni, Apellido: r.apellido, Nombre: r.nombre, CUIL: r.cuil,
  'En sistema': r.en_sistema ? 'SI' : 'NO',
  'Nombre en base': r.nombre_db, Legajo: r.legajo,
  Ley: r.ley, Categoria: '', Planta: r.planta, Ocupacion: r.ocupacion, 'Estado empleo': r.estado_empleo,
  'Tipo examen': r.tipo, Modalidad: r.modalidad, Fecha: r.fecha,
  'Estado examen': r.estado_examen, Resolucion: r.resolucion, 'Tipo tramite': r.tipo_tramite,
});

export function AptosTab() {
  const toast = useToast();
  const [rows, setRows]       = useState<AptoRow[]>([]);
  const [existe, setExiste]   = useState(true);
  const [pathXlsx, setPathXlsx] = useState('');
  const [loading, setLoading] = useState(false);
  const [cat, setCat]         = useState('todas');
  const [resol, setResol]     = useState('todas');
  const [texto, setTexto]     = useState('');

  async function cargar() {
    setLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; data: { rows: AptoRow[]; existe: boolean; path: string }; error?: string }>(
        '/tramites-documentales/aptos'
      );
      if (r?.ok) {
        setRows(r.data.rows ?? []);
        setExiste(r.data.existe);
        setPathXlsx(r.data.path ?? '');
      } else {
        toast.error(r?.error ?? 'Error al leer APTOS.xlsx');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  const categorias = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const r of rows) {
      const c = categoriaLey(r);
      conteo.set(c, (conteo.get(c) ?? 0) + 1);
    }
    // orden fijo por CAT_COLORS, después el resto
    const orden = Object.keys(CAT_COLORS);
    return [...conteo.entries()].sort((a, b) => {
      const ia = orden.indexOf(a[0]); const ib = orden.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [rows]);

  const resoluciones = useMemo(
    () => [...new Set(rows.map(r => r.resolucion).filter(Boolean))].sort(),
    [rows]
  );

  const filtradas = useMemo(() => {
    let r = rows;
    if (cat !== 'todas') r = r.filter(x => categoriaLey(x) === cat);
    if (resol !== 'todas') r = r.filter(x => x.resolucion === resol);
    if (texto.trim()) {
      const t = texto.toLowerCase().trim();
      r = r.filter(x =>
        x.apellido.toLowerCase().includes(t) || x.nombre.toLowerCase().includes(t) ||
        String(x.dni).includes(t) || x.nombre_db.toLowerCase().includes(t) ||
        x.ocupacion.toLowerCase().includes(t)
      );
    }
    return r;
  }, [rows, cat, resol, texto]);

  const exportar = () => exportToExcel('aptos_cruce_personal', filtradas.map(r => {
    const row = toRow(r);
    row.Categoria = categoriaLey(r);
    return row;
  }));

  if (!existe) {
    return (
      <section className="td-card" style={{ padding: 24, textAlign: 'center' }}>
        No se encontró <b>{pathXlsx || 'D:\\G\\APTOS\\APTOS.xlsx'}</b>. Dejá el Excel ahí y recargá.
        <div style={{ marginTop: 10 }}>
          <button className="btn" type="button" onClick={() => void cargar()}>🔄 Reintentar</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Chips por categoría (clickeables como filtro) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="card" style={{ flex: '1 1 80px', textAlign: 'center', padding: '7px 10px', cursor: 'pointer', outline: cat === 'todas' ? '1px solid rgba(255,255,255,0.35)' : 'none' }}
          onClick={() => setCat('todas')}>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{rows.length}</div>
          <div className="muted" style={{ fontSize: '0.66rem' }}>Total aptos</div>
        </div>
        {categorias.map(([c, n]) => (
          <div key={c} className="card"
            style={{ flex: '1 1 80px', textAlign: 'center', padding: '7px 10px', cursor: 'pointer', outline: cat === c ? `1px solid ${CAT_COLORS[c] ?? '#94a3b8'}` : 'none' }}
            onClick={() => setCat(cat === c ? 'todas' : c)}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: CAT_COLORS[c] ?? '#94a3b8' }}>{n}</div>
            <div className="muted" style={{ fontSize: '0.66rem' }}>{c}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="card" style={{ marginBottom: 12, padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: '0.72rem', marginRight: 4 }}>{pathXlsx}</span>

        <select className="input" value={cat} onChange={e => setCat(e.target.value)}
          style={{ fontSize: '0.78rem', width: 170 }}>
          <option value="todas">Todas las categorías</option>
          {categorias.map(([c]) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select className="input" value={resol} onChange={e => setResol(e.target.value)}
          style={{ fontSize: '0.78rem', width: 150 }}>
          <option value="todas">Toda resolución</option>
          {resoluciones.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <input className="input" placeholder="Apellido, nombre, DNI u ocupación..."
          value={texto} onChange={e => setTexto(e.target.value)}
          style={{ fontSize: '0.78rem', flex: '1 1 160px', minWidth: 140 }} />

        <button className="btn" type="button" onClick={() => void cargar()} disabled={loading}
          style={{ fontSize: '0.76rem', background: 'rgba(255,255,255,0.07)', whiteSpace: 'nowrap' }}>
          {loading ? '⏳...' : '🔄 Recargar'}
        </button>
        <button className="btn" type="button" onClick={exportar} disabled={!filtradas.length}
          style={{ fontSize: '0.76rem', background: 'rgba(255,255,255,0.07)', whiteSpace: 'nowrap' }}>
          📥 Exportar ({filtradas.length})
        </button>
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                {['Categoría', 'DNI', 'Apellido y Nombre (aptos)', 'En base', 'Nombre en base', 'Ley', 'Planta', 'Ocupación', 'Estado', 'Tipo examen', 'Fecha', 'Estado examen', 'Resolución'].map(c => (
                  <th key={c} style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r, i) => {
                const c = categoriaLey(r);
                return (
                  <tr key={`${r.dni}-${r.codigo}-${i}`} style={{
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    background: !r.en_sistema ? 'rgba(239,68,68,0.05)' : undefined,
                  }}>
                    <td style={{ padding: '5px 8px', color: CAT_COLORS[c] ?? '#94a3b8', whiteSpace: 'nowrap', fontWeight: 600 }}>{c}</td>
                    <td style={{ padding: '5px 8px' }}>{r.dni || '—'}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.apellido}, {r.nombre}</td>
                    <td style={{ padding: '5px 8px', color: r.en_sistema ? '#22c55e' : '#ef4444' }}>{r.en_sistema ? '✓' : '✗'}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.nombre_db}</td>
                    <td style={{ padding: '5px 8px' }}>{r.ley}</td>
                    <td style={{ padding: '5px 8px' }}>{r.planta}</td>
                    <td style={{ padding: '5px 8px' }}>{r.ocupacion}</td>
                    <td style={{ padding: '5px 8px' }}>{r.estado_empleo}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.tipo}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.fecha}</td>
                    <td style={{ padding: '5px 8px' }}>{r.estado_examen}</td>
                    <td style={{ padding: '5px 8px', color: r.resolucion.toUpperCase() === 'APTO' ? '#22c55e' : '#f59e0b' }}>{r.resolucion}</td>
                  </tr>
                );
              })}
              {!filtradas.length && !loading && (
                <tr><td colSpan={13} className="muted" style={{ padding: 16, textAlign: 'center' }}>Sin filas con los filtros actuales</td></tr>
              )}
              {loading && (
                <tr><td colSpan={13} className="muted" style={{ padding: 16, textAlign: 'center' }}>⏳ Leyendo APTOS.xlsx...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

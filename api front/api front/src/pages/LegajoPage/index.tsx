// src/pages/LegajoPage/index.tsx
import React, { useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';
import { exportToPdf } from '../../utils/export';

const FECHA_KEYS = ['fecha_nacimiento', 'fecha_ingreso', 'fecha_baja', 'fecha_desde', 'fecha_hasta', 'created_at'];
const fmtDate = (v: any) => { try { return new Date(v).toLocaleDateString('es-AR'); } catch { return String(v); } };
const fmtVal = (k: string, v: any) => {
  if (v === null || v === undefined || v === '') return '—';
  if (FECHA_KEYS.some(f => k.includes(f.split('_')[0])) && String(v).includes('-')) return fmtDate(v);
  return String(v);
};

function Bloque({ titulo, datos }: { titulo: string; datos: [string, any][] }) {
  const filled = datos.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (filled.length === 0) return null;
  return (
    <div style={{ marginBottom: 16, pageBreakInside: 'avoid' }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em',
        color: '#7c3aed', borderBottom: '1px solid rgba(124,58,237,0.3)', paddingBottom: 4, marginBottom: 8 }}>
        {titulo}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px' }}>
        {filled.map(([label, val], i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ fontSize: '0.82rem' }}>{fmtVal(label, val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TablaSeccion({ titulo, rows, cols }: { titulo: string; rows: any[]; cols: string[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em',
        color: '#2563eb', borderBottom: '1px solid rgba(37,99,235,0.3)', paddingBottom: 4, marginBottom: 8 }}>
        {titulo} ({rows.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
              {cols.map(c => <th key={c} style={{ padding: '4px 8px', textAlign: 'left', color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{c.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {cols.map(c => <td key={c} style={{ padding: '3px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(r[c] ?? '')}>{fmtVal(c, r[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LegajoPage() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [apellido, setApellido] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [matchPage, setMatchPage] = useState(1);
  const MATCH_PAGE_SIZE = 50;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    personal: any; agente: any;
    consultas: any[]; pedidos: any[]; documentos: any[]; servicios: any[];
  } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).trim().replace(/\D/g, '');
    if (!clean) { toast.error('Ingresá un DNI'); return; }
    setLoading(true);
    setData(null);
    setMatches([]);
    try {
      const [rP, rA, rC, rPed, rDoc, rSrv] = await Promise.allSettled([
        apiFetch<any>(`/personal/${clean}`),
        apiFetch<any>(`/agentes?dni=${clean}&limit=5&page=1`),
        apiFetch<any>(`/consultas?dni=${clean}&limit=200&page=1`),
        apiFetch<any>(`/pedidos?dni=${clean}&limit=200&page=1`),
        apiFetch<any>(`/tblarchivos?dni=${clean}&limit=200&page=1`),
        apiFetch<any>(`/agentes_servicios?dni=${clean}&limit=200&page=1`),
      ]);
      const personal = rP.status === 'fulfilled' ? rP.value?.data : null;
      if (!personal) { toast.error('No se encontró el agente'); setLoading(false); return; }
      setData({
        personal,
        agente: rA.status === 'fulfilled' ? (rA.value?.data?.[0] || null) : null,
        consultas: rC.status === 'fulfilled' ? (rC.value?.data || []) : [],
        pedidos: rPed.status === 'fulfilled' ? (rPed.value?.data || []) : [],
        documentos: rDoc.status === 'fulfilled' ? (rDoc.value?.data || []) : [],
        servicios: rSrv.status === 'fulfilled' ? (rSrv.value?.data || []) : [],
      });
      toast.ok('Legajo cargado');
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [dni, toast]);

  const buscarPorApellido = useCallback(async () => {
    const q = apellido.trim();
    if (!q) { toast.error('Ingresá un apellido'); return; }
    setLoading(true);
    setMatches([]);
    setData(null);
    try {
      const results = await searchPersonal(q);
      if (!results.length) { toast.error('Sin resultados', `No se encontró "${q}"`); }
      else if (results.length === 1) {
        setApellido('');
        await buscarPorDni(String(results[0].dni));
      } else {
        setMatchPage(1);
        setMatches(results);
        toast.ok(`${results.length} resultado(s) — seleccioná uno`);
      }
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [apellido, toast, buscarPorDni]);

  const imprimir = () => {
    if (!printRef.current) return;
    const html = `<html><head><title>Legajo</title>
      <style>
        body{font-family:system-ui,Arial;padding:24px;color:#111;font-size:12px;}
        table{border-collapse:collapse;width:100%;margin-bottom:16px;}
        th,td{border:1px solid #ddd;padding:4px 8px;font-size:11px;}
        th{background:#f5f5f5;}
        h2{color:#333;margin:0 0 4px 0;}
        .bloque-title{font-size:10px;text-transform:uppercase;color:#666;border-bottom:1px solid #ccc;padding-bottom:3px;margin-bottom:8px;font-weight:bold;}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}
        .field label{font-size:9px;text-transform:uppercase;color:#888;}
        .field span{font-size:11px;display:block;}
      </style>
    </head><body>${printRef.current.innerHTML}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  };

  const hoy = new Date();

  return (
    <Layout title="Legajo Completo" showBack>
      <div style={{ marginBottom: 12 }}>
        <strong>📋 Legajo completo del agente</strong>
        <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>Buscá un agente por DNI para ver e imprimir su legajo completo</div>
      </div>

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>DNI</div>
          <input className="input" value={dni} onChange={e => setDni(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorDni()} placeholder="Ej: 25123456" />
        </div>
        <button className="btn" onClick={() => buscarPorDni()} disabled={loading} style={{ background: '#2563eb', color: '#fff', height: 38 }}>
          {loading ? '⏳' : '🔍 Buscar DNI'}
        </button>
        <div style={{ flex: '2 1 200px' }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>APELLIDO</div>
          <input className="input" value={apellido} onChange={e => setApellido(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarPorApellido()} placeholder="Ej: García" />
        </div>
        <button className="btn" onClick={buscarPorApellido} disabled={loading} style={{ background: '#7c3aed', color: '#fff', height: 38 }}>
          🔍 Buscar apellido
        </button>
        {data && (
          <>
            <button className="btn" onClick={imprimir} style={{ height: 38 }}>🖨️ Imprimir</button>
            <button className="btn" onClick={() => {
              const rows = [
                { tipo: 'Personal', ...data.personal },
                ...(data.agente ? [{ tipo: 'Datos laborales', ...data.agente }] : []),
              ];
              exportToPdf(`legajo_${dni}`, rows);
            }} style={{ height: 38, background: '#dc2626', color: '#fff' }}>📕 PDF</button>
          </>
        )}
      </div>

      {/* Lista de coincidencias por apellido */}
      {matches.length > 0 && !data && (() => {
        const totalPages = Math.ceil(matches.length / MATCH_PAGE_SIZE);
        const pageMatches = matches.slice((matchPage - 1) * MATCH_PAGE_SIZE, matchPage * MATCH_PAGE_SIZE);
        return (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
              {matches.length} personas encontradas{totalPages > 1 ? ` — página ${matchPage} de ${totalPages}` : ' — seleccioná una:'}
            </div>
            {pageMatches.map((m, i) => (
              <div key={i} onClick={() => { setMatches([]); buscarPorDni(String(m.dni)); }}
                style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)', marginBottom: 4,
                  display: 'flex', gap: 12, alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
                <strong style={{ fontSize: '0.85rem' }}>{m.apellido}, {m.nombre}</strong>
                <span className="muted" style={{ fontSize: '0.75rem' }}>DNI {m.dni}</span>
                {m.cuil && <span className="muted" style={{ fontSize: '0.75rem' }}>CUIL {m.cuil}</span>}
              </div>
            ))}
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={matchPage === 1}
                  onClick={() => setMatchPage(p => p - 1)}
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}>← Ant</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} className="btn"
                    onClick={() => setMatchPage(p)}
                    style={{ padding: '3px 10px', fontSize: '0.8rem',
                      background: p === matchPage ? 'rgba(124,58,237,0.5)' : undefined,
                      fontWeight: p === matchPage ? 700 : undefined }}>
                    {p}
                  </button>
                ))}
                <button className="btn" disabled={matchPage === totalPages}
                  onClick={() => setMatchPage(p => p + 1)}
                  style={{ padding: '3px 10px', fontSize: '0.8rem' }}>Sig →</button>
              </div>
            )}
          </div>
        );
      })()}

      {data && (
        <div ref={printRef} className="card" style={{ padding: 24 }}>
          {/* Encabezado */}
          <div style={{ borderBottom: '2px solid rgba(255,255,255,0.15)', paddingBottom: 16, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                  {data.personal.apellido}, {data.personal.nombre}
                </div>
                <div className="muted" style={{ fontSize: '0.82rem' }}>DNI {data.personal.dni} · CUIL {data.personal.cuil || '—'}</div>
                {data.agente?.estado_empleo && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{
                      background: data.agente.estado_empleo === 'activo' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                      color: data.agente.estado_empleo === 'activo' ? '#10b981' : '#ef4444',
                      borderRadius: 999, padding: '2px 12px', fontSize: '0.78rem', fontWeight: 600,
                    }}>
                      {data.agente.estado_empleo.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="muted" style={{ fontSize: '0.74rem', textAlign: 'right' }}>
                Generado: {hoy.toLocaleDateString('es-AR')} {hoy.toLocaleTimeString('es-AR')}
              </div>
            </div>
          </div>

          <Bloque titulo="Datos personales" datos={[
            ['Email', data.personal.email],
            ['Teléfono', data.personal.telefono],
            ['Domicilio', data.personal.domicilio],
            ['Fecha Nacimiento', data.personal.fecha_nacimiento],
            ['Nacionalidad', data.personal.nacionalidad],
            ['Estado Civil', data.personal.estado_civil],
            ['Observaciones', data.personal.observaciones],
          ]} />

          {data.agente && (
            <Bloque titulo="Datos laborales" datos={[
              ['Fecha Ingreso', data.agente.fecha_ingreso],
              ['Fecha Baja', data.agente.fecha_baja],
              ['Estado Empleo', data.agente.estado_empleo],
              ['Ley', data.agente.ley_id],
              ['Planta', data.agente.planta_id],
              ['Categoría', data.agente.categoria_id],
              ['Sector', data.agente.sector_id],
              ['Jefatura', data.agente.jefatura_id],
              ['Régimen Horario', data.agente.regimen_horario_id],
              ['Salario Mensual', data.agente.salario_mensual],
            ]} />
          )}

          <TablaSeccion titulo="Servicios / Destinos" rows={data.servicios}
            cols={['dependencia_id','servicio_nombre','jefe_nombre','fecha_desde','fecha_hasta','motivo']} />
          <TablaSeccion titulo="Consultas" rows={data.consultas}
            cols={Object.keys(data.consultas[0] || {}).slice(0, 6)} />
          <TablaSeccion titulo="Pedidos" rows={data.pedidos}
            cols={Object.keys(data.pedidos[0] || {}).slice(0, 6)} />
          <TablaSeccion titulo="Documentos" rows={data.documentos}
            cols={Object.keys(data.documentos[0] || {}).slice(0, 5)} />
        </div>
      )}

      {!data && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '3rem', marginBottom: 8 }}>📋</div>
          <div style={{ fontWeight: 600 }}>Ingresá el DNI para ver el legajo</div>
          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 4 }}>Se cargarán todos los datos del agente: personal, laboral, servicios, pedidos y documentos.</div>
        </div>
      )}
    </Layout>
  );
}

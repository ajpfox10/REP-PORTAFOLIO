// src/pages/AlertasPage/index.tsx
// estado_empleo ENUM: 'ACTIVO', 'INACTIVO', 'BAJA' (mayúsculas - según test.sql)
// Paginación completa para obtener los ~1400 registros reales

import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf } from '../../utils/export';

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Paginación completa ──
async function fetchAll<T = any>(endpoint: string): Promise<T[]> {
  const PAGE = 200;
  let page = 1;
  let all: T[] = [];
  let total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

function AlertaCard({ emoji, title, count, color, children, rows, filename }: {
  emoji: string; title: string; count: number; color: string;
  children: React.ReactNode; rows?: any[]; filename?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: '1.3rem' }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{title}</div>
        </div>
        <span style={{ background: color + '33', color, borderRadius: 999, padding: '2px 14px', fontWeight: 700, fontSize: '1rem' }}>
          {count}
        </span>
        {rows && rows.length > 0 && filename && (
          <>
            <button className="btn" onClick={e => { e.stopPropagation(); exportToExcel(filename, rows); }}
              style={{ fontSize: '0.7rem', padding: '3px 9px', background: '#16a34a', color: '#fff' }}>📊 Excel</button>
            <button className="btn" onClick={e => { e.stopPropagation(); exportToPdf(filename, rows); }}
              style={{ fontSize: '0.7rem', padding: '3px 9px', background: '#dc2626', color: '#fff' }}>📕 PDF</button>
          </>
        )}
        <span className="muted" style={{ fontSize: '0.76rem' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && count > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MiniTabla({ rows, cols }: { rows: any[]; cols: { key: string; label: string }[] }) {
  if (!rows.length) return <div className="muted" style={{ fontSize: '0.8rem' }}>Sin datos.</div>;
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
            {cols.map(c => <th key={c.key} style={{ padding: '5px 9px', textAlign: 'left', color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {cols.map(c => <td key={c.key} style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlertasPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('');
  const [personal, setPersonal] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [mesVista, setMesVista] = useState<number>(new Date().getMonth() + 1);
  const [anioVista, setAnioVista] = useState<number>(new Date().getFullYear());

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setStep('Cargando personal…');
      const p = await fetchAll('/personal');
      setPersonal(p);
      setStep('Cargando agentes…');
      const a = await fetchAll('/agentes');
      setAgentes(a);
      toast.ok(`${a.length} agentes · ${p.length} personas`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const hoy = new Date();
  const anioActual = hoy.getFullYear();

  const calcAnios = (fi: string) => {
    if (!fi) return 0;
    const d = new Date(fi);
    if (isNaN(d.getTime())) return 0;
    return anioActual - d.getFullYear() -
      (hoy < new Date(anioActual, d.getMonth(), d.getDate()) ? 1 : 0);
  };

  // ── Derivados ──
  // Cumpleaños del mes seleccionado
  const cumpleMes = personal
    .filter(p => p.fecha_nacimiento && new Date(p.fecha_nacimiento).getMonth() + 1 === mesVista)
    .map(p => ({
      Día: new Date(p.fecha_nacimiento).getDate(),
      DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre,
      'Fecha Nacimiento': new Date(p.fecha_nacimiento).toLocaleDateString('es-AR'),
      Email: p.email || '', Teléfono: p.telefono || '',
    })).sort((a, b) => a.Día - b.Día);

  // Antigüedad 20 años — mes/año seleccionado
  const anioIngreso20 = anioVista - 20;
  const antiguedad20 = agentes
    .filter(a => {
      if (!a.fecha_ingreso) return false;
      const fi = new Date(a.fecha_ingreso);
      return fi.getFullYear() === anioIngreso20 && fi.getMonth() + 1 === mesVista;
    })
    .map(a => ({
      DNI: a.dni, Estado: a.estado_empleo,
      'Fecha Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
      'Años': 20,
    }));

  // Próximos cumpleaños 7 días
  const en7dias = personal.filter(p => {
    if (!p.fecha_nacimiento) return false;
    const fn = new Date(p.fecha_nacimiento);
    let prox = new Date(anioActual, fn.getMonth(), fn.getDate());
    if (prox < hoy) prox = new Date(anioActual + 1, fn.getMonth(), fn.getDate());
    const diff = (prox.getTime() - hoy.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  }).map(p => {
    const fn = new Date(p.fecha_nacimiento);
    let prox = new Date(anioActual, fn.getMonth(), fn.getDate());
    if (prox < hoy) prox = new Date(anioActual + 1, fn.getMonth(), fn.getDate());
    return {
      'En días': Math.ceil((prox.getTime() - hoy.getTime()) / 86400000),
      DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre,
      'Cumple': prox.toLocaleDateString('es-AR'),
      Email: p.email || '',
    };
  }).sort((a, b) => a['En días'] - b['En días']);

  // Aniversarios múltiplos de 5 este año (activos)
  const aniversarios5 = agentes
    .filter(a => {
      if (!a.fecha_ingreso || a.estado_empleo === 'BAJA') return false;
      const anios = anioActual - new Date(a.fecha_ingreso).getFullYear();
      return anios > 0 && anios % 5 === 0;
    })
    .map(a => ({
      DNI: a.dni, Estado: a.estado_empleo,
      'Fecha Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
      'Años': anioActual - new Date(a.fecha_ingreso).getFullYear(),
      'Hito': `${anioActual - new Date(a.fecha_ingreso).getFullYear()} años`,
    })).sort((a, b) => b.Años - a.Años);

  // Ingresos último año
  const hace1Anio = new Date(anioActual - 1, hoy.getMonth(), hoy.getDate());
  const ingresosRecientes = agentes
    .filter(a => a.fecha_ingreso && new Date(a.fecha_ingreso) >= hace1Anio)
    .map(a => ({
      DNI: a.dni, Estado: a.estado_empleo,
      'Fecha Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
    })).sort((a, b) => b['Fecha Ingreso'].localeCompare(a['Fecha Ingreso']));

  // Bajas último año
  const bajasRecientes = agentes
    .filter(a => a.fecha_baja && new Date(a.fecha_baja) >= hace1Anio)
    .map(a => ({
      DNI: a.dni, Estado: a.estado_empleo,
      'Fecha Baja': new Date(a.fecha_baja).toLocaleDateString('es-AR'),
    })).sort((a, b) => b['Fecha Baja'].localeCompare(a['Fecha Baja']));

  // Sin email
  const sinEmail = personal.filter(p => !p.email || !p.email.trim())
    .map(p => ({ DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre, Teléfono: p.telefono || '' }));

  // Sin teléfono
  const sinTel = personal.filter(p => !p.telefono || !p.telefono.trim())
    .map(p => ({ DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre, Email: p.email || '' }));

  // INACTIVOS
  const inactivos = agentes.filter(a => a.estado_empleo === 'INACTIVO')
    .map(a => ({
      DNI: a.dni, Estado: a.estado_empleo,
      'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '—',
      'Fecha Baja': a.fecha_baja ? new Date(a.fecha_baja).toLocaleDateString('es-AR') : '—',
    }));

  return (
    <Layout title="Alertas" showBack>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: '1.05rem' }}>🔔 Alertas del sistema</strong>
          <div className="muted" style={{ fontSize: '0.74rem', marginTop: 2 }}>
            {loading ? step : `${agentes.length} agentes · ${personal.length} personas`}
          </div>
        </div>
        <button className="btn" onClick={cargar} disabled={loading}>{loading ? `⏳ ${step}` : '🔄 Actualizar'}</button>
      </div>

      {/* Selector de mes/año */}
      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 4 }}>Mes para cumpleaños y antigüedad</div>
          <select className="input" value={mesVista} onChange={e => setMesVista(Number(e.target.value))} style={{ minWidth: 160 }}>
            {MESES_ES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 4 }}>Año (para calcular 20 años de antigüedad)</div>
          <select className="input" value={anioVista} onChange={e => setAnioVista(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => anioActual + i).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
          <div>{step}</div>
        </div>
      ) : (
        <>
          <AlertaCard emoji="📅" title="Próximos cumpleaños (7 días)" count={en7dias.length} color="#ec4899"
            rows={en7dias} filename="proximos_cumpleanos_7_dias">
            <MiniTabla rows={en7dias} cols={[
              { key: 'En días', label: 'En días' }, { key: 'Cumple', label: 'Fecha' },
              { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' },
              { key: 'Nombre', label: 'Nombre' }, { key: 'Email', label: 'Email' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🎂" title={`Cumpleaños en ${MESES_ES[mesVista-1]}`} count={cumpleMes.length} color="#f97316"
            rows={cumpleMes} filename={`cumpleanos_${MESES_ES[mesVista-1]}`}>
            <MiniTabla rows={cumpleMes} cols={[
              { key: 'Día', label: 'Día' }, { key: 'DNI', label: 'DNI' },
              { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Email', label: 'Email' }, { key: 'Teléfono', label: 'Teléfono' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🏅" title={`Antigüedad 20 años — ${MESES_ES[mesVista-1]} ${anioVista}`}
            count={antiguedad20.length} color="#7c3aed"
            rows={antiguedad20} filename={`antiguedad_20_${MESES_ES[mesVista-1]}_${anioVista}`}>
            {antiguedad20.length
              ? <MiniTabla rows={antiguedad20} cols={[
                  { key: 'DNI', label: 'DNI' }, { key: 'Fecha Ingreso', label: 'Ingreso' },
                  { key: 'Años', label: 'Años' }, { key: 'Estado', label: 'Estado' },
                ]} />
              : <div className="muted" style={{ fontSize: '0.8rem' }}>Nadie cumple 20 años de antigüedad en {MESES_ES[mesVista-1]} {anioVista}.</div>
            }
          </AlertaCard>

          <AlertaCard emoji="🎖️" title={`Aniversarios múltiplos de 5 en ${anioActual}`}
            count={aniversarios5.length} color="#f59e0b"
            rows={aniversarios5} filename={`aniversarios_multiplos_5_${anioActual}`}>
            <MiniTabla rows={aniversarios5} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Años', label: 'Años' },
              { key: 'Hito', label: 'Hito' }, { key: 'Fecha Ingreso', label: 'Ingreso' },
              { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🟢" title={`Ingresos último año (${ingresosRecientes.length})`}
            count={ingresosRecientes.length} color="#10b981"
            rows={ingresosRecientes} filename="ingresos_ultimo_anio">
            <MiniTabla rows={ingresosRecientes.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Fecha Ingreso', label: 'Ingreso' },
              { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🔴" title={`Bajas último año (${bajasRecientes.length})`}
            count={bajasRecientes.length} color="#ef4444"
            rows={bajasRecientes} filename="bajas_ultimo_anio">
            <MiniTabla rows={bajasRecientes.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Fecha Baja', label: 'Baja' },
              { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="⏸️" title={`INACTIVOS en sistema (${inactivos.length})`}
            count={inactivos.length} color="#f59e0b"
            rows={inactivos} filename="agentes_inactivos">
            <MiniTabla rows={inactivos.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Estado', label: 'Estado' },
              { key: 'Fecha Ingreso', label: 'Ingreso' }, { key: 'Fecha Baja', label: 'Baja' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="📧" title={`Sin email registrado (${sinEmail.length})`}
            count={sinEmail.length} color="#94a3b8"
            rows={sinEmail} filename="personal_sin_email">
            <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 6 }}>
              {sinEmail.length} personas sin dirección de e-mail en el sistema.
            </div>
          </AlertaCard>

          <AlertaCard emoji="📞" title={`Sin teléfono registrado (${sinTel.length})`}
            count={sinTel.length} color="#64748b"
            rows={sinTel} filename="personal_sin_telefono">
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {sinTel.length} personas sin número de teléfono en el sistema.
            </div>
          </AlertaCard>
        </>
      )}
    </Layout>
  );
}

// src/pages/AlertasPage/index.tsx
// estado_empleo ENUM: 'ACTIVO', 'INACTIVO', 'BAJA' (mayúsculas - según test.sql)
// Paginación completa para obtener los ~1400 registros reales

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf } from '../../utils/export';
import {
  CumpleanosAlerta,
  cargarCumpleanosAlertas,
  cumpleNombre,
  fmtCumpleFecha,
  marcarCumpleanos,
} from './CumpleanosBanner';

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

function CumpleanosTabla({
  rows,
  loadingId,
  onAction,
}: {
  rows: CumpleanosAlerta[];
  loadingId: string | null;
  onAction: (row: CumpleanosAlerta, accion: 'avisar' | 'omitir' | 'pendiente') => void;
}) {
  if (!rows.length) return <div className="muted" style={{ fontSize: '0.8rem' }}>Sin datos.</div>;
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
            {['En dias', 'Fecha', 'DNI', 'Apellido', 'Nombre', 'Email', 'Aviso', 'Acciones'].map(h => (
              <th key={h} style={{ padding: '5px 9px', textAlign: 'left', color: '#94a3b8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const id = `${row.dni}-${row.anio}`;
            return (
              <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.dias}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{fmtCumpleFecha(row.fecha_cumple)}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.dni}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.apellido}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.nombre}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.email || '—'}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>{row.estado_aviso}</td>
                <td style={{ padding: '4px 9px', whiteSpace: 'nowrap' }}>
                  {row.estado_aviso === 'AVISADO' ? (
                    <button className="btn" style={{ padding: '3px 8px', fontSize: '0.7rem' }} disabled={loadingId === id} onClick={() => onAction(row, 'pendiente')}>Pendiente</button>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn" style={{ padding: '3px 8px', fontSize: '0.7rem', background: '#16a34a', color: '#fff' }} disabled={loadingId === id} onClick={() => onAction(row, 'avisar')}>Avisado</button>
                      <button className="btn" style={{ padding: '3px 8px', fontSize: '0.7rem' }} disabled={loadingId === id} onClick={() => onAction(row, 'omitir')}>Omitir</button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
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
  const [filtroAnioIngresos, setFiltroAnioIngresos] = useState<string>('ultimo');
  const [filtroCumples, setFiltroCumples] = useState<'pendientes' | 'avisados' | 'todos'>('pendientes');
  const [cumplesBanner, setCumplesBanner] = useState<CumpleanosAlerta[]>([]);
  const [cumpleGuardando, setCumpleGuardando] = useState<string | null>(null);

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

  const cargarCumples = useCallback(async () => {
    try {
      setCumplesBanner(await cargarCumpleanosAlertas(filtroCumples, 7));
    } catch (e: any) {
      toast.error('Error cargando cumpleanos', e?.message || 'Error');
      setCumplesBanner([]);
    }
  }, [filtroCumples, toast]);

  useEffect(() => { cargarCumples(); }, [cargarCumples]);

  const marcarCumple = async (row: CumpleanosAlerta, accion: 'avisar' | 'omitir' | 'pendiente') => {
    const id = `${row.dni}-${row.anio}`;
    setCumpleGuardando(id);
    try {
      await marcarCumpleanos(row.dni, row.anio, accion);
      toast.ok(accion === 'avisar' ? 'Cumpleanos marcado como avisado' : accion === 'omitir' ? 'Cumpleanos omitido' : 'Cumpleanos pendiente');
      await cargarCumples();
    } catch (e: any) {
      toast.error('No se pudo actualizar cumpleanos', e?.message || 'Error');
    } finally {
      setCumpleGuardando(null);
    }
  };

  const hoy = new Date();
  const anioActual = hoy.getFullYear();

  const fechaValida = (valor: any) => {
    if (!valor) return null;
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d;
  };

  const anioDeFecha = (valor: any) => {
    if (!valor) return null;
    const isoYear = String(valor).match(/^(\d{4})-/)?.[1];
    if (isoYear) return Number(isoYear);
    return fechaValida(valor)?.getFullYear() ?? null;
  };

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
      'Dia': new Date(p.fecha_nacimiento).getDate(),
      DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre,
      'Fecha Nacimiento': new Date(p.fecha_nacimiento).toLocaleDateString('es-AR'),
      Email: p.email || '', 'Telefono': p.telefono || '',
    })).sort((a, b) => a.Dia - b.Dia);

  // Antigüedad 20 años — mes/año seleccionado
  const anioIngreso20 = anioVista - 20;
  const personalMap = useMemo(() => {
    const m: Record<number, any> = {};
    personal.forEach(p => { m[p.dni] = p; });
    return m;
  }, [personal]);

  const aniosIngresoDisponibles = useMemo(() => {
    const anios = new Set<number>();
    agentes.forEach(a => {
      const anio = anioDeFecha(a.fecha_ingreso);
      if (anio) anios.add(anio);
    });
    return Array.from(anios).sort((a, b) => b - a);
  }, [agentes]);

  const antiguedad20 = agentes
    .filter(a => {
      if (!a.fecha_ingreso) return false;
      const fi = new Date(a.fecha_ingreso);
      return fi.getFullYear() === anioIngreso20 && fi.getMonth() + 1 === mesVista;
    })
    .map(a => {
      const p = personalMap[a.dni];
      return {
        DNI: a.dni,
        Apellido: p?.apellido ?? '—', Nombre: p?.nombre ?? '—',
        'Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
        'Anios': 20, Estado: a.estado_empleo,
      };
    });

  // Proximos cumpleanos 7 dias con estado de aviso persistido en backend
  const en7dias = cumplesBanner.map(row => ({
    'En dias': row.dias,
    DNI: row.dni,
    Apellido: row.apellido,
    Nombre: row.nombre,
    'Cumple': fmtCumpleFecha(row.fecha_cumple),
    Email: row.email || '',
    Servicio: row.servicio_nombre || '',
    Sector: row.sector_nombre || '',
    'Aviso': row.estado_aviso,
    'Avisado por': row.avisado_por_nombre || '',
  }));

  // Aniversarios múltiplos de 5 este año (activos)
  const aniversarios5 = agentes
    .filter(a => {
      if (!a.fecha_ingreso || a.estado_empleo === 'BAJA' || a.estado_empleo === 'TRAMITE') return false;
      const anios = anioActual - new Date(a.fecha_ingreso).getFullYear();
      return anios > 0 && anios % 5 === 0;
    })
    .map(a => {
      const p = personalMap[a.dni];
      const anios = anioActual - new Date(a.fecha_ingreso).getFullYear();
      return {
        DNI: a.dni,
        Apellido: p?.apellido ?? '—', Nombre: p?.nombre ?? '—',
        'Anios': anios, 'Hito': `${anios} años`,
        'Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
        Estado: a.estado_empleo,
      };
    }).sort((a, b) => b.Anios - a.Anios);

  // Ingresos último año
  const hace1Anio = new Date(anioActual - 1, hoy.getMonth(), hoy.getDate());
  const ingresosRecientes = agentes
    .filter(a => {
      const fecha = fechaValida(a.fecha_ingreso);
      if (!fecha) return false;
      if (filtroAnioIngresos === 'ultimo') return fecha >= hace1Anio;
      return anioDeFecha(a.fecha_ingreso) === Number(filtroAnioIngresos);
    })
    .sort((a, b) => (fechaValida(b.fecha_ingreso)?.getTime() ?? 0) - (fechaValida(a.fecha_ingreso)?.getTime() ?? 0))
    .map(a => {
      const p = personalMap[a.dni];
      return {
        DNI: a.dni, Apellido: p?.apellido ?? '—', Nombre: p?.nombre ?? '—',
        Servicio: a.servicio_nombre ?? p?.servicio_nombre ?? '—',
        Sector: a.sector_nombre ?? p?.sector_nombre ?? '—',
        'Fecha Ingreso': new Date(a.fecha_ingreso).toLocaleDateString('es-AR'),
        Estado: a.estado_empleo,
      };
    });

  // Bajas último año
  const bajasRecientes = agentes
    .filter(a => a.fecha_baja && new Date(a.fecha_baja) >= hace1Anio)
    .map(a => {
      const p = personalMap[a.dni];
      return {
        DNI: a.dni, Apellido: p?.apellido ?? '—', Nombre: p?.nombre ?? '—',
        'Fecha Baja': new Date(a.fecha_baja).toLocaleDateString('es-AR'),
        Estado: a.estado_empleo,
      };
    }).sort((a, b) => b['Fecha Baja'].localeCompare(a['Fecha Baja']));

  // Sin email
  const sinEmail = personal.filter(p => !p.email || !p.email.trim())
    .map(p => ({ DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre, 'Telefono': p.telefono || '' }));

  // Sin teléfono
  const sinTel = personal.filter(p => !p.telefono || !p.telefono.trim())
    .map(p => ({ DNI: p.dni, Apellido: p.apellido, Nombre: p.nombre, Email: p.email || '' }));

  // INACTIVOS
  const inactivos = agentes.filter(a => a.estado_empleo === 'INACTIVO')
    .map(a => {
      const p = personalMap[a.dni];
      return {
        DNI: a.dni, Apellido: p?.apellido ?? '—', Nombre: p?.nombre ?? '—',
        Estado: a.estado_empleo,
        'Fecha Ingreso': a.fecha_ingreso ? new Date(a.fecha_ingreso).toLocaleDateString('es-AR') : '—',
        'Fecha Baja': a.fecha_baja ? new Date(a.fecha_baja).toLocaleDateString('es-AR') : '—',
      };
    });

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
          <label htmlFor="al-mes" className="muted" style={{ fontSize: '0.74rem', marginBottom: 4, display: 'block' }}>Mes para cumpleaños y antigüedad</label>
          <select id="al-mes" name="mesVista" className="input" value={mesVista} onChange={e => setMesVista(Number(e.target.value))} style={{ minWidth: 160 }}>
            {MESES_ES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="al-anio" className="muted" style={{ fontSize: '0.74rem', marginBottom: 4, display: 'block' }}>Año (para calcular 20 años de antigüedad)</label>
          <select id="al-anio" name="anioVista" className="input" value={anioVista} onChange={e => setAnioVista(Number(e.target.value))}>
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
          <AlertaCard emoji="" title={`Proximos cumpleanos (${filtroCumples})`} count={en7dias.length} color="#ec4899"
            rows={en7dias} filename={`proximos_cumpleanos_7_dias_${filtroCumples}`}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <label htmlFor="al-cumples-estado" className="muted" style={{ fontSize: '0.74rem' }}>Estado aviso</label>
              <select id="al-cumples-estado" className="input" value={filtroCumples} onChange={e => setFiltroCumples(e.target.value as any)} style={{ minWidth: 150, height: 34, padding: '4px 10px' }}>
                <option value="pendientes">Pendientes</option>
                <option value="avisados">Avisados</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <CumpleanosTabla rows={cumplesBanner} loadingId={cumpleGuardando} onAction={marcarCumple} />
          </AlertaCard>

          <AlertaCard emoji="🎂" title={`Cumpleaños en ${MESES_ES[mesVista-1]}`} count={cumpleMes.length} color="#f97316"
            rows={cumpleMes} filename={`cumpleanos_${MESES_ES[mesVista-1]}`}>
            <MiniTabla rows={cumpleMes} cols={[
              { key: 'Dia', label: 'Dia' }, { key: 'DNI', label: 'DNI' },
              { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Email', label: 'Email' }, { key: 'Telefono', label: 'Telefono' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🏅" title={`Antigüedad 20 años — ${MESES_ES[mesVista-1]} ${anioVista}`}
            count={antiguedad20.length} color="#7c3aed"
            rows={antiguedad20} filename={`antiguedad_20_${MESES_ES[mesVista-1]}_${anioVista}`}>
            {antiguedad20.length
              ? <MiniTabla rows={antiguedad20} cols={[
                  { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
                  { key: 'Ingreso', label: 'Ingreso' }, { key: 'Anios', label: 'Anios' }, { key: 'Estado', label: 'Estado' },
                ]} />
              : <div className="muted" style={{ fontSize: '0.8rem' }}>Nadie cumple 20 años de antigüedad en {MESES_ES[mesVista-1]} {anioVista}.</div>
            }
          </AlertaCard>

          <AlertaCard emoji="🎖️" title={`Aniversarios múltiplos de 5 en ${anioActual}`}
            count={aniversarios5.length} color="#f59e0b"
            rows={aniversarios5} filename={`aniversarios_multiplos_5_${anioActual}`}>
            <MiniTabla rows={aniversarios5} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Anios', label: 'Anios' }, { key: 'Hito', label: 'Hito' },
              { key: 'Ingreso', label: 'Ingreso' }, { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🟢" title={`Ingresos ${filtroAnioIngresos === 'ultimo' ? 'ultimo año' : filtroAnioIngresos} (${ingresosRecientes.length})`}
            count={ingresosRecientes.length} color="#10b981"
            rows={ingresosRecientes} filename={`ingresos_${filtroAnioIngresos === 'ultimo' ? 'ultimo_anio' : filtroAnioIngresos}`}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <label htmlFor="al-ingresos-anio" className="muted" style={{ fontSize: '0.74rem' }}>Filtrar ingresos</label>
              <select
                id="al-ingresos-anio"
                name="filtroAnioIngresos"
                className="input"
                value={filtroAnioIngresos}
                onChange={e => setFiltroAnioIngresos(e.target.value)}
                style={{ minWidth: 150, height: 34, padding: '4px 10px' }}
              >
                <option value="ultimo">Ultimo año</option>
                {aniosIngresoDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <MiniTabla rows={ingresosRecientes.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Servicio', label: 'Servicio' }, { key: 'Sector', label: 'Sector' },
              { key: 'Fecha Ingreso', label: 'Ingreso' }, { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="🔴" title={`Bajas último año (${bajasRecientes.length})`}
            count={bajasRecientes.length} color="#ef4444"
            rows={bajasRecientes} filename="bajas_ultimo_anio">
            <MiniTabla rows={bajasRecientes.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Fecha Baja', label: 'Baja' }, { key: 'Estado', label: 'Estado' },
            ]} />
          </AlertaCard>

          <AlertaCard emoji="⏸️" title={`INACTIVOS en sistema (${inactivos.length})`}
            count={inactivos.length} color="#f59e0b"
            rows={inactivos} filename="agentes_inactivos">
            <MiniTabla rows={inactivos.slice(0, 100)} cols={[
              { key: 'DNI', label: 'DNI' }, { key: 'Apellido', label: 'Apellido' }, { key: 'Nombre', label: 'Nombre' },
              { key: 'Estado', label: 'Estado' }, { key: 'Fecha Ingreso', label: 'Ingreso' }, { key: 'Fecha Baja', label: 'Baja' },
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


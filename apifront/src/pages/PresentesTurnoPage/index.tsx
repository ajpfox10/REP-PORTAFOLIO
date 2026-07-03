import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Servicio = { id: number; nombre: string };
type Archivo = { name: string };
type Justificacion = { fuente: 'SIAP' | 'Ministerio'; novedad: string; desde: string; hasta: string };
type AgenteTurno = {
  dni: string;
  nombre: string;
  entrada: string;
  salida: string;
  turno: string;
  ficho: boolean;
  fichajes: string[];
  justificaciones: Justificacion[];
};
type TurnoData = {
  turno: string;
  esperadoBruto: number;
  ficharon: number;
  noFicharon: number;
  justificados: number;
  sinJustificar: number;
  ficharonDetalle: AgenteTurno[];
  noFicharonDetalle: AgenteTurno[];
};
type Resultado = {
  ok: boolean;
  fecha: string;
  servicio: Servicio;
  archivos: { horarios: string | null; siap: string | null; ministerio: string | null };
  totalEsperado: number;
  totalFicharon: number;
  totalNoFicharon: number;
  dbError: string | null;
  turnos: TurnoData[];
};

const TURNO_LABEL: Record<string, string> = {
  manana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
  '24hs': '24hs',
};

const TURNO_COLOR: Record<string, string> = {
  manana: '#38bdf8',
  tarde: '#f59e0b',
  noche: '#818cf8',
  '24hs': '#f472b6',
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFecha(s: string) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function Modal({
  title,
  rows,
  mode,
  onClose,
}: {
  title: string;
  rows: AgenteTurno[];
  mode: 'ficharon' | 'noFicharon';
  onClose: () => void;
}) {
  const [openDni, setOpenDni] = useState<string | null>(null);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', zIndex: 90,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div className="card" style={{ width: 'min(920px, 96vw)', maxHeight: '88vh', overflow: 'hidden', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem' }}>{title}</div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>{rows.length} agente{rows.length !== 1 ? 's' : ''}</div>
          </div>
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 'calc(88vh - 76px)' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th>Agente</th>
                <th>DNI</th>
                <th>Horario</th>
                {mode === 'ficharon' ? <th>Fichadas</th> : <th>Justificación</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openDni === r.dni;
                return (
                  <React.Fragment key={r.dni}>
                    <tr
                      onClick={() => mode === 'noFicharon' && setOpenDni(open ? null : r.dni)}
                      style={{ cursor: mode === 'noFicharon' ? 'pointer' : 'default' }}
                    >
                      <td style={{ fontWeight: 700 }}>{r.nombre}</td>
                      <td>{r.dni}</td>
                      <td>{r.entrada} - {r.salida}</td>
                      <td>
                        {mode === 'ficharon' ? (
                          r.fichajes.length ? r.fichajes.join(' · ') : <span className="muted">Sin detalle</span>
                        ) : r.justificaciones.length ? (
                          <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                            {r.justificaciones.length} justificación{r.justificaciones.length !== 1 ? 'es' : ''}
                          </span>
                        ) : (
                          <span style={{ color: '#f87171', fontWeight: 700 }}>Sin justificación</span>
                        )}
                      </td>
                    </tr>
                    {mode === 'noFicharon' && open && (
                      <tr>
                        <td colSpan={4} style={{ background: 'rgba(15,23,42,0.72)', padding: '10px 16px' }}>
                          {r.justificaciones.length ? (
                            <div style={{ display: 'grid', gap: 6 }}>
                              {r.justificaciones.map((j, idx) => (
                                <div key={`${r.dni}-${idx}`} style={{ border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, padding: '8px 10px' }}>
                                  <div style={{ fontWeight: 800, color: j.fuente === 'SIAP' ? '#93c5fd' : '#c4b5fd' }}>{j.fuente}</div>
                                  <div>{j.novedad || 'Sin novedad'}</div>
                                  <div className="muted" style={{ fontSize: '0.74rem' }}>{fmtFecha(j.desde)} a {fmtFecha(j.hasta)}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: '#f87171', fontWeight: 700 }}>No hay licencia/novedad cargada en SIAP ni Ministerio para esa fecha.</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 18 }}>Sin agentes.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PresentesTurnoPage() {
  const toast = useToast();
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [servicioId, setServicioId] = useState('');
  const [fecha, setFecha] = useState(todayIso);
  const [horariosFile, setHorariosFile] = useState('');
  const [siapFile, setSiapFile] = useState('');
  const [ministerioFile, setMinisterioFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [modal, setModal] = useState<{ title: string; rows: AgenteTurno[]; mode: 'ficharon' | 'noFicharon' } | null>(null);

  useEffect(() => {
    apiFetch<any>('/servicios?limit=500&sort=nombre')
      .then((r) => setServicios(Array.isArray(r?.data) ? r.data : []))
      .catch(() => {});

    apiFetch<any>('/asistencia/archivos')
      .then((r) => {
        const files = Array.isArray(r?.files) ? r.files : [];
        setArchivos(files);
        const h = files.find((f: Archivo) => f.name.toUpperCase().includes('HORARIO'));
        const s = files.find((f: Archivo) => f.name.toUpperCase().includes('SIAP'));
        const m = files.find((f: Archivo) => f.name.toUpperCase().includes('MINISTERIO'));
        if (h) setHorariosFile(h.name);
        if (s) setSiapFile(s.name);
        if (m) setMinisterioFile(m.name);
      })
      .catch(() => {});
  }, []);

  const generar = async () => {
    if (!servicioId) return toast.error('Falta servicio', 'Seleccioná un servicio.');
    if (!fecha) return toast.error('Falta fecha', 'Seleccioná una fecha.');
    setLoading(true);
    setResultado(null);
    try {
      const params = new URLSearchParams({ servicio_id: servicioId, fecha });
      if (horariosFile) params.set('horariosFile', horariosFile);
      if (siapFile) params.set('siapFile', siapFile);
      if (ministerioFile) params.set('ministerioFile', ministerioFile);
      const r = await apiFetch<Resultado>(`/asistencia/presentes-turno?${params}`);
      if (!r?.ok) throw new Error((r as any)?.error || 'Error del servidor');
      setResultado(r);
      if (r.dbError) toast.error('Aviso biométrico', r.dbError);
      toast.ok('Control generado', `${r.totalFicharon} ficharon · ${r.totalNoFicharon} no ficharon`);
    } catch (e: any) {
      toast.error('Error', e?.message || 'No se pudo generar');
    } finally {
      setLoading(false);
    }
  };

  const archivosTexto = useMemo(() => {
    if (!resultado) return '';
    return [
      resultado.archivos.horarios ? `Horarios: ${resultado.archivos.horarios}` : null,
      resultado.archivos.siap ? `SIAP: ${resultado.archivos.siap}` : null,
      resultado.archivos.ministerio ? `Ministerio: ${resultado.archivos.ministerio}` : null,
    ].filter(Boolean).join(' · ');
  }, [resultado]);

  return (
    <Layout title="Presentes por turno" showBack>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="h2" style={{ marginBottom: 12 }}>Control por servicio y turno</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          <div style={fg}>
            <label htmlFor="pt-servicio" style={lbl}>Servicio</label>
            <select id="pt-servicio" className="input" value={servicioId} onChange={e => setServicioId(e.target.value)}>
              <option value="">Seleccionar</option>
              {servicios.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label htmlFor="pt-fecha" style={lbl}>Fecha</label>
            <input id="pt-fecha" className="input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div style={fg}>
            <label htmlFor="pt-horarios" style={lbl}>Excel horarios</label>
            <select id="pt-horarios" className="input" value={horariosFile} onChange={e => setHorariosFile(e.target.value)}>
              <option value="">Auto</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label htmlFor="pt-siap" style={lbl}>SIAP</label>
            <select id="pt-siap" className="input" value={siapFile} onChange={e => setSiapFile(e.target.value)}>
              <option value="">Sin SIAP</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
          <div style={fg}>
            <label htmlFor="pt-ministerio" style={lbl}>Ministerio</label>
            <select id="pt-ministerio" className="input" value={ministerioFile} onChange={e => setMinisterioFile(e.target.value)}>
              <option value="">Sin Ministerio</option>
              {archivos.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={generar} disabled={loading}>
            {loading ? 'Generando...' : 'Generar control'}
          </button>
        </div>
      </div>

      {resultado && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem' }}>{resultado.servicio.nombre} · {fmtFecha(resultado.fecha)}</div>
            <div className="muted" style={{ fontSize: '0.76rem' }}>{archivosTexto}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Stat label="Esperados por horario" value={resultado.totalEsperado} color="#cbd5e1" />
            <Stat label="Ficharon" value={resultado.totalFicharon} color="#22c55e" />
            <Stat label="No ficharon" value={resultado.totalNoFicharon} color="#f97316" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {resultado.turnos.map(t => {
              const color = TURNO_COLOR[t.turno] || '#94a3b8';
              return (
                <div key={t.turno} className="card" style={{ borderLeft: `3px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '1rem', color }}>{TURNO_LABEL[t.turno] || t.turno}</div>
                      <div className="muted" style={{ fontSize: '0.76rem' }}>Esperados: {t.esperadoBruto}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.76rem', color: '#94a3b8' }}>
                      Justificados: <b style={{ color: '#fbbf24' }}>{t.justificados}</b><br />
                      Sin justificar: <b style={{ color: '#f87171' }}>{t.sinJustificar}</b>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      type="button"
                      className="card"
                      style={{ padding: 12, cursor: 'pointer', textAlign: 'left', borderColor: 'rgba(34,197,94,0.35)' }}
                      onClick={() => setModal({ title: `${TURNO_LABEL[t.turno] || t.turno} · Ficharon`, rows: t.ficharonDetalle, mode: 'ficharon' })}
                    >
                      <div style={{ color: '#22c55e', fontSize: '1.6rem', fontWeight: 900 }}>{t.ficharon}</div>
                      <div style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>Ficharon</div>
                    </button>
                    <button
                      type="button"
                      className="card"
                      style={{ padding: 12, cursor: 'pointer', textAlign: 'left', borderColor: 'rgba(249,115,22,0.35)' }}
                      onClick={() => setModal({ title: `${TURNO_LABEL[t.turno] || t.turno} · No ficharon`, rows: t.noFicharonDetalle, mode: 'noFicharon' })}
                    >
                      <div style={{ color: '#f97316', fontSize: '1.6rem', fontWeight: 900 }}>{t.noFicharon}</div>
                      <div style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>No ficharon</div>
                    </button>
                  </div>
                </div>
              );
            })}
            {!resultado.turnos.length && (
              <div className="card muted" style={{ textAlign: 'center', padding: 24 }}>
                No hay agentes esperados para ese servicio y fecha según el Excel de horarios.
              </div>
            )}
          </div>
        </>
      )}

      {modal && <Modal title={modal.title} rows={modal.rows} mode={modal.mode} onClose={() => setModal(null)} />}
    </Layout>
  );
}

const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.78rem', color: '#94a3b8' };

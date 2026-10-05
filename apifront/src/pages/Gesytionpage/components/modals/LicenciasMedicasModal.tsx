// src/pages/GestionPage/components/modals/LicenciasMedicasModal.tsx
// Licencias médicas no otorgadas del agente (mismo control que /app/licencias-medicas-control,
// filtrado por DNI): tilde "Reclamó", cargar/corregir notas de reclamo, detalle día por día.
// Datos: GET /licencias-medicas-control?desde&hasta&dni=<dni actual + anteriores>
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../../api/http';
import {
  ANIOS, ANIO_ACTUAL, LicenciasMedicasTabla, MESES, Resp, Tab,
  enTab, rangoDe, useReclamoAcciones,
} from '../../../LicenciasMedicasControlPage/shared';

interface Props {
  row: any;
  dnis?: string[];
  onClose: () => void;
  onCountChange: (c: { noOtorgadas: number; debenReclamar: number }) => void;
}

/** Contadores de la card: no otorgadas vigentes y las que deben reclamar sin reclamo todavía. */
export function contarLicenciasMedicas(data: Resp['data']) {
  return {
    noOtorgadas: data.filter(l => !l.resuelta).length,
    debenReclamar: data.filter(l => enTab(l, 'reclamar', false)).length,
  };
}

const TABS: { k: Tab; label: string }[] = [
  { k: 'reclamar', label: '⚠️ Deben reclamar' },
  { k: 'reclamaron', label: '📨 Reclamaron' },
  { k: 'resueltas', label: '✅ Resueltas' },
  { k: 'pendientes', label: '⏳ Pendientes' },
];

export function LicenciasMedicasModal({ row, dnis, onClose, onCountChange }: Props) {
  // DNIs a consultar: el del agente + los anteriores por cambio de DNI.
  const dnisConsulta = (dnis && dnis.length) ? dnis : (row?.dni ? [String(row.dni)] : []);
  const dnisKey = dnisConsulta.join(',');

  const [anio, setAnio] = useState(ANIO_ACTUAL);
  const [mes, setMes] = useState(''); // '' = todo el año
  const { desde, hasta } = rangoDe(anio, mes);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('reclamar');
  const [verNoReclamar, setVerNoReclamar] = useState(false);

  const cargar = useCallback(async (silencioso = false) => {
    if (!dnisKey) return;
    if (!silencioso) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta, dni: dnisKey });
      const res = await apiFetch<Resp>(`/licencias-medicas-control?${params.toString()}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando datos');
      setData(res);
      // La card cuenta el año en curso: solo se actualiza si el modal está mirando todo ese año
      if (anio === ANIO_ACTUAL && !mes) onCountChange(contarLicenciasMedicas(res.data));
    } catch (e: any) {
      setError(e?.message || 'Error cargando datos');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, dnisKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void cargar(); }, [cargar]);

  const { guardando, tildar, abrirNota, modalNota } = useReclamoAcciones(() => cargar(true));

  const todas = data?.data ?? [];
  const filas = useMemo(
    () => todas.filter(l => enTab(l, tab, verNoReclamar)).sort((a, b) => b.desde.localeCompare(a.desde)),
    [todas, tab, verNoReclamar],
  );
  const cuenta = (t: Tab) => todas.filter(l => enTab(l, t, false)).length;

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }} onClick={onClose}>
        <div
          style={{
            maxWidth: 1180, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            padding: '1.25rem', borderRadius: 14, color: '#e2e8f0',
            background: '#0f1422', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Cabecera */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
            <div>
              <strong style={{ fontSize: '0.98rem' }}>🩺 Licencias médicas no otorgadas</strong>
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                {row?.apellido}, {row?.nombre} · DNI {dnisConsulta.join(' / ')}
                {data?.licencias_actualizado ? ` · Listado del Ministerio del ${new Date(data.licencias_actualizado).toLocaleDateString('es-AR')}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select className="input" value={mes} onChange={e => setMes(e.target.value)}>
                <option value="">Todo el año</option>
                {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              </select>
              <select className="input" value={anio} onChange={e => setAnio(Number(e.target.value))}>
                {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <button className="btn" type="button" onClick={() => cargar()} disabled={loading}>
                {loading ? 'Cargando…' : '🔄'}
              </button>
              <button className="btn" type="button" onClick={onClose}>✕ Cerrar</button>
            </div>
          </div>

          {/* Pestañas */}
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
            {TABS.map(t => (
              <button key={t.k} type="button" onClick={() => setTab(t.k)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 18px', fontSize: '0.86rem', fontWeight: tab === t.k ? 700 : 400,
                color: tab === t.k ? '#e2e8f0' : '#64748b',
                borderBottom: tab === t.k ? '2px solid #7c3aed' : '2px solid transparent',
                marginBottom: -1,
              }}>
                {t.label}{data ? ` · ${cuenta(t.k)}` : ''}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, flexShrink: 0 }}>
            <div className="muted" style={{ fontSize: '0.76rem' }}>
              {tab === 'reclamar'
                ? <>No otorgadas con algún día en que <b>le tocaba venir</b>. Tildá <b>Reclamó</b> o cargá la nota con <b>+ Cargar</b>.</>
                : tab === 'reclamaron'
                ? <>Con reclamo registrado. <b>↻ Volver a reclamar</b> carga una nota nueva; desplegá la fila para ver el historial.</>
                : tab === 'resueltas'
                ? <>Reclamadas que el Ministerio terminó <b>otorgando</b>.</>
                : <>Resolución <b>PENDIENTE</b>. Click en la fila para ver el detalle día por día.</>}
            </div>
            {tab === 'reclamar' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                <input type="checkbox" checked={verNoReclamar} onChange={e => setVerNoReclamar(e.target.checked)} />
                Ver también las que no tenían día de trabajo
              </label>
            )}
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: '0.84rem' }}>
              {error}
            </div>
          )}
          {data?.error_fichadas && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)', color: '#fde68a', fontSize: '0.84rem' }}>
              ⚠️ {data.error_fichadas}. La columna de fichadas puede estar incompleta.
            </div>
          )}

          {/* Tabla */}
          <div style={{ marginTop: 10, overflow: 'auto', flex: 1, minHeight: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
            {loading && !data
              ? <div className="muted" style={{ padding: 16 }}>Cargando…</div>
              : (
                <LicenciasMedicasTabla
                  filas={filas}
                  tab={tab}
                  loading={loading}
                  licenciasActualizado={data?.licencias_actualizado}
                  guardando={guardando}
                  onTildar={tildar}
                  onAbrirNota={abrirNota}
                  resetKey={`${tab}|${verNoReclamar}|${anio}|${mes}`}
                  porPagina={15}
                />
              )}
          </div>
        </div>
      </div>

      {modalNota}
    </>
  );
}

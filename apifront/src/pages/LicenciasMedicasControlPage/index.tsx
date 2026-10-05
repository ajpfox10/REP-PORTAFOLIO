// src/pages/LicenciasMedicasControlPage/index.tsx
// Control de licencias médicas NO OTORGADAS: pendientes, denegadas, observadas, etc. (solo admin).
// Por cada licencia muestra, día por día: si le tocaba venir (HORARIOS.xlsx),
// si fichó (reloj biométrico) y qué cargó el jefe en SIAPE.
// Pestaña "Deben reclamar" = no justificadas (todo salvo PENDIENTE) con algún día del rango en que le tocaba venir.
// Filtro por mes/año (el período se manda como desde/hasta) y export a Excel del filtro actual.
// Pestaña "Reclamaron" = no justificadas con el tilde de reclamo. Se puede volver a reclamar:
// cada reclamo es una nota nueva (POST /reclamo/nota → nº 1, 2, 3…; PUT /reclamo/nota/:id la corrige).
// Pestaña "Resueltas" = licencias reclamadas que el Ministerio terminó OTORGANDO.
// Pestaña "Observadas" = las OBSERVADAS sin reclamo, separadas de "Deben reclamar" (por ahora no se les avisa).
// Pestaña "WhatsApp" = las mismas de "Deben reclamar" (sin observadas), para avisarles por WhatsApp (./WhatsappTab).
// Datos: GET /licencias-medicas-control?desde&hasta
// La tabla y el modal de nota viven en ./shared (los reusa el modal de Gestión).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';
import {
  ANIOS, ANIO_ACTUAL, DIA_CORTO, LicenciasMedicasTabla, MESES, Resp, Tab,
  enTab, fmtFecha, hoy, noJustificada, normTxt, rangoDe, txtFichada, txtNota, txtTocaba, useReclamoAcciones,
} from './shared';
import { WhatsappTab } from './WhatsappTab';

export function LicenciasMedicasControlPage() {
  const [anio, setAnio] = useState(ANIO_ACTUAL);
  const [mes, setMes] = useState(hoy.slice(5, 7));
  const { desde, hasta } = rangoDe(anio, mes);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('reclamar');
  const [whatsapp, setWhatsapp] = useState(false); // pestaña WhatsApp: lista = "Deben reclamar"
  const tabLista: Tab = whatsapp ? 'reclamar' : tab;
  const [q, setQ] = useState('');
  const [servicio, setServicio] = useState('TODOS');
  const [resolucion, setResolucion] = useState('TODAS');
  const [verNoReclamar, setVerNoReclamar] = useState(false);

  const cargar = useCallback(async (refresh = false, silencioso = false) => {
    if (!silencioso) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (refresh) params.set('refresh', '1');
      const res = await apiFetch<Resp>(`/licencias-medicas-control?${params.toString()}`);
      if (!res?.ok) throw new Error(res?.error || 'Error cargando datos');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Error cargando datos');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(false); }, [cargar]);

  const { guardando, tildar, abrirNota, modalNota } = useReclamoAcciones(() => cargar(false, true));

  const servicios = useMemo(
    () => [...new Set((data?.data ?? []).map(l => l.servicio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [data],
  );

  const filtrados = useMemo(() => {
    const nq = normTxt(q).trim();
    return (data?.data ?? []).filter(l => {
      if (!enTab(l, tabLista, verNoReclamar)) return false;
      if (resolucion !== 'TODAS' && l.resolucion !== resolucion) return false;
      if (servicio !== 'TODOS' && l.servicio !== servicio) return false;
      if (nq && !normTxt(l.nombre).includes(nq) && !l.dni.includes(nq)) return false;
      return true;
    }).sort((a, b) =>
      // "APELLIDO, NOMBRE" → alfabético por apellido y después nombre; mismo agente: por fecha
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
      || a.dni.localeCompare(b.dni)
      || a.desde.localeCompare(b.desde));
  }, [data, tabLista, q, servicio, resolucion, verNoReclamar]);

  const exportar = () => {
    const filas = filtrados.flatMap(l => l.detalle.map(d => ({
      'Apellido y nombre': l.nombre,
      DNI: l.dni,
      Legajo: l.legajo,
      Servicio: l.servicio,
      Novedad: l.novedad,
      Resolución: l.resolucion,
      'Licencia desde': fmtFecha(l.desde),
      'Licencia hasta': fmtFecha(l.hasta),
      'Debe reclamar': noJustificada(l) ? (l.debe_reclamar ? 'SI' : 'NO') : '',
      'Reclamó': noJustificada(l) ? (l.reclamo ? 'SI' : 'NO') : '',
      'Reclamos': l.notas.length || '',
      'Notas de reclamo': l.notas.map(txtNota).join(' / '),
      'Sigue sin otorgar': l.sigue_sin_otorgar ? 'SI' : '',
      Fecha: fmtFecha(d.fecha),
      Día: DIA_CORTO[d.dia_semana] ?? d.dia_semana,
      'Le tocaba venir': txtTocaba(d),
      Fichada: txtFichada(d.fichada),
      'Cargado por el jefe (SIAPE)': d.siape_jefe.join(' / '),
    })));
    exportToExcel(`licencias_medicas_${tab}_${mes ? `${anio}-${mes}` : anio}`, filas);
  };

  const r = data?.resumen;
  // Contadores de "Deben reclamar" / "Observadas" calculados acá (el resumen del back mezcla las observadas)
  const nReclamar = useMemo(() => (data?.data ?? []).filter(l => enTab(l, 'reclamar', false)).length, [data]);
  const nObservadas = useMemo(() => (data?.data ?? []).filter(l => enTab(l, 'observadas', false)).length, [data]);

  return (
    <Layout title="Licencias médicas no otorgadas">
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="h2" style={{ margin: 0 }}>🩺 Licencias médicas no otorgadas</div>
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
              {data?.archivos
                ? <>Fuentes: <b>{data.archivos.licencias}</b> · <b>{data.archivos.horarios.join(', ') || '—'}</b> · SIAPE <b>{data.archivos.siape.join(', ') || '—'}</b> · reloj biométrico</>
                : 'Fuentes: —'}
              {data?.generado ? ` · Actualizado ${new Date(data.generado).toLocaleString('es-AR')}` : ''}
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
            <button className="btn" type="button" onClick={() => cargar(true)} disabled={loading}>
              {loading ? 'Cargando…' : '🔄 Actualizar'}
            </button>
            <button className="btn" type="button" onClick={exportar} disabled={loading || !filtrados.length}>
              ⬇️ Excel
            </button>
          </div>
        </div>

        {r && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            {[
              { k: 'Pendientes', v: r.pendientes },
              ...Object.entries(r.por_resolucion ?? {})
                .filter(([res]) => res !== 'PENDIENTE')
                .sort((a, b) => b[1] - a[1])
                .map(([res, v]) => ({ k: res.charAt(0) + res.slice(1).toLowerCase(), v })),
              { k: 'Deben reclamar', v: nReclamar },
              { k: 'Reclamaron', v: r.reclamaron },
              { k: 'Siguen sin otorgar', v: r.sigue_sin_otorgar ?? 0 },
              { k: 'Resueltas', v: r.resueltas ?? 0 },
              { k: '…de ellas ficharon', v: r.reclamar_con_fichada },
            ].map(t => (
              <div key={t.k} className="card" style={{ padding: '8px 14px', minWidth: 120, textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{t.v}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{t.k}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {(['reclamar', 'observadas', 'reclamaron', 'resueltas', 'pendientes'] as const).map(t => (
            <button key={t} type="button" onClick={() => { setTab(t); setWhatsapp(false); }} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 22px', fontSize: '0.9rem', fontWeight: !whatsapp && tab === t ? 700 : 400,
              color: !whatsapp && tab === t ? '#e2e8f0' : '#64748b',
              borderBottom: !whatsapp && tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1,
            }}>
              {t === 'reclamar' ? `⚠️ Deben reclamar (no otorgadas)${r ? ` · ${nReclamar}` : ''}`
                : t === 'observadas' ? `🔍 Observadas${r ? ` · ${nObservadas}` : ''}`
                : t === 'reclamaron' ? `📨 Reclamaron${r ? ` · ${r.reclamaron}` : ''}`
                : t === 'resueltas' ? `✅ Resueltas${r ? ` · ${r.resueltas ?? 0}` : ''}`
                : `⏳ Pendientes${r ? ` · ${r.pendientes}` : ''}`}
            </button>
          ))}
          <button type="button" onClick={() => setWhatsapp(true)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 22px', fontSize: '0.9rem', fontWeight: whatsapp ? 700 : 400,
            color: whatsapp ? '#e2e8f0' : '#64748b',
            borderBottom: whatsapp ? '2px solid #22c55e' : '2px solid transparent',
            marginBottom: -1,
          }}>📲 WhatsApp</button>
        </div>

        <div className="muted" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          {whatsapp
            ? <>Avisá por WhatsApp a los de <b>Deben reclamar</b>. Tildá por agente o todos y mandá la tanda (con la extensión de Chrome), o usá <b>Abrir</b> para hacerlo a mano. Empezá siempre en <b>modo prueba</b>.</>
            : tab === 'reclamar'
            ? <>Licencias <b>no otorgadas</b> (denegadas, domicilio erróneo…; las observadas van aparte) en las que al menos un día del rango <b>le tocaba venir</b> según el horario. Si igual fichó ese día, queda marcado. Tildá <b>Reclamó</b> cuando se le avisó; <b>doble click en el nombre</b> para cargar la nota de reclamo.</>
            : tab === 'observadas'
            ? <>Licencias <b>OBSERVADAS</b> en las que al menos un día del rango <b>le tocaba venir</b>. Están separadas de "Deben reclamar" y no entran en el aviso por WhatsApp. Tildá <b>Reclamó</b> o hacé <b>doble click en el nombre</b> para cargar la nota.</>
            : tab === 'reclamaron'
            ? <>Licencias <b>no otorgadas</b> con el reclamo registrado. Si sigue sin otorgarse, <b>↻ Volver a reclamar</b> carga una nota nueva (reclamo nº 2, 3…); desplegá la fila para ver el historial de notas. Destildá para devolverla a "Deben reclamar".</>
            : tab === 'resueltas'
            ? <>Licencias que se reclamaron y el Ministerio terminó <b>otorgando</b>. Desplegá la fila para ver las notas de reclamo.</>
            : <>Licencias con resolución <b>PENDIENTE</b>. Hacé click en una fila para ver el detalle día por día.</>}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Buscar por apellido, nombre o DNI…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ minWidth: 240, flex: '1 1 240px' }}
          />
          <select className="input" value={servicio} onChange={e => setServicio(e.target.value)}>
            <option value="TODOS">Todos los servicios</option>
            {servicios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(tabLista === 'reclamar' || tabLista === 'reclamaron') && (
            <select className="input" value={resolucion} onChange={e => setResolucion(e.target.value)}>
              <option value="TODAS">Todas las resoluciones</option>
              {Object.keys(r?.por_resolucion ?? {}).filter(x => x !== 'PENDIENTE').sort().map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {(tabLista === 'reclamar' || tabLista === 'observadas') && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={verNoReclamar} onChange={e => setVerNoReclamar(e.target.checked)} />
              Ver también las que no tenían día de trabajo
            </label>
          )}
          <span className="muted" style={{ fontSize: '0.8rem' }}>{filtrados.length} licencias</span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          {error}
        </div>
      )}
      {data?.error_fichadas && (
        <div className="card" style={{ marginTop: 12, padding: 14, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)' }}>
          ⚠️ {data.error_fichadas}. La columna de fichadas puede estar incompleta.
        </div>
      )}

      {whatsapp ? (
        <div className="card" style={{ marginTop: 12, padding: 0, overflowX: 'auto' }}>
          <WhatsappTab licencias={filtrados} />
        </div>
      ) : (
      <div className="card" style={{ marginTop: 12, padding: 0, overflowX: 'auto' }}>
        <LicenciasMedicasTabla
          filas={filtrados}
          tab={tab}
          loading={loading}
          licenciasActualizado={data?.licencias_actualizado}
          guardando={guardando}
          onTildar={tildar}
          onAbrirNota={abrirNota}
          resetKey={`${tab}|${q}|${servicio}|${resolucion}|${verNoReclamar}|${anio}|${mes}`}
        />
      </div>
      )}

      {modalNota}
    </Layout>
  );
}

export default LicenciasMedicasControlPage;

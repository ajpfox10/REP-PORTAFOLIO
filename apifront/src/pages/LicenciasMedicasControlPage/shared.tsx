// src/pages/LicenciasMedicasControlPage/shared.tsx
// Piezas compartidas del control de licencias médicas no otorgadas: tipos, helpers, la tabla
// (fila + detalle día por día + historial de notas + paginado) y las acciones de reclamo
// (tilde + modal de nota). Las usan la página /app/licencias-medicas-control y el modal de Gestión.
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// Clave para deshacer errores (la misma que desbloquea el escaneo). Acceso estático para que Vite la hornee.
const BYPASS_CODE = import.meta.env.VITE_SCAN_BYPASS_CODE || '';

export interface Fichada { primera: string; ultima: string; marcas: number }
export interface Dia {
  fecha: string;
  dia_semana: string;
  le_tocaba: boolean | null;
  horario: string;
  fichada: Fichada | null;
  siape_jefe: string[];
}
export interface Licencia {
  legajo: string;
  dni: string;
  nombre: string;
  novedad: string;
  resolucion: string; // PENDIENTE, DENEGADA, OBSERVADA, DOMICILIO ERRONEO… (todo lo no otorgado)
  fecha_solicitud: string | null;
  desde: string;
  hasta: string;
  dias: number;
  justificado: string;
  codigo_oms: string;
  diagnostico: string;
  modalidad: string;
  junta_medica: string;
  servicio: string;
  sin_horario: boolean;
  dias_tocaba: number;
  dias_ficho: number;
  dias_ficho_tocaba: number;
  siape_jefe: string[];
  debe_reclamar: boolean;
  resuelta: boolean;
  reclamo_id: number | null;
  reclamo: boolean;
  reclamo_at: string | null;
  reclamo_por: string | null;
  notas: Nota[];
  sigue_sin_otorgar: boolean;
  detalle: Dia[];
}
export interface Nota {
  id: number;
  nro: number;
  numero: string;
  fecha: string | null;
  observaciones: string | null;
  cargada_por: string | null;
  created_at: string | null;
}
export interface Resp {
  ok: boolean;
  periodo: { desde: string; hasta: string };
  archivos: { licencias: string; horarios: string[]; siape: string[] };
  error_fichadas: string | null;
  licencias_actualizado?: string;
  resumen: {
    pendientes: number; denegadas: number; deben_reclamar: number; reclamaron: number;
    reclamar_con_fichada: number; denegadas_sin_horario: number; por_resolucion?: Record<string, number>;
    sigue_sin_otorgar?: number; resueltas?: number;
  };
  data: Licencia[];
  generado: string;
  error?: string;
}

export type Tab = 'pendientes' | 'reclamar' | 'observadas' | 'reclamaron' | 'resueltas';

export const DIA_CORTO: Record<string, string> = {
  lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom',
};

export function normTxt(s: any) {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/** No justificada = todo lo que no es PENDIENTE (denegada, observada, domicilio erróneo…). */
export const noJustificada = (l: { resolucion: string }) => l.resolucion !== 'PENDIENTE';
/** Observadas: van en su propia pestaña (fuera de "Deben reclamar" y de WhatsApp: por ahora no se les avisa). */
export const esObservada = (l: { resolucion: string }) => l.resolucion.startsWith('OBSERVAD');
export const COLOR_RES: Record<string, string> = {
  DENEGADA: 'rgba(239,68,68,0.25)', OBSERVADA: 'rgba(234,179,8,0.25)', PENDIENTE: 'rgba(59,130,246,0.2)',
  OTORGADA: 'rgba(34,197,94,0.25)', APROBADA: 'rgba(34,197,94,0.25)',
};

export function fmtFecha(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
export function txtTocaba(d: Dia) {
  if (d.le_tocaba === null) return 'Sin horario';
  return d.le_tocaba ? `Sí (${d.horario})` : 'No';
}
export const txtNota = (n: Nota) => `#${n.nro} ${n.numero}${n.fecha ? ` (${fmtFecha(n.fecha)})` : ''}`;
export function txtFichada(f: Fichada | null) {
  if (!f) return 'No fichó';
  return f.marcas > 1 ? `${f.primera} – ${f.ultima}` : f.primera;
}

export const hoy = new Date().toISOString().slice(0, 10);
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const ANIO_ACTUAL = Number(hoy.slice(0, 4));
export const ANIOS = Array.from({ length: 5 }, (_, i) => ANIO_ACTUAL - i);

/** Mes '' = todo el año. Devuelve el rango YYYY-MM-DD del período. */
export function rangoDe(anio: number, mes: string) {
  if (!mes) return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  const ultimo = new Date(Date.UTC(anio, Number(mes), 0)).getUTCDate();
  return { desde: `${anio}-${mes}-01`, hasta: `${anio}-${mes}-${String(ultimo).padStart(2, '0')}` };
}

export const keyDe = (l: Licencia) => `${l.dni}|${l.desde}|${l.hasta}|${l.resolucion}|${l.novedad}`;
const idLic = (l: Licencia) => ({ reclamo_id: l.reclamo_id, dni: l.dni, desde: l.desde, hasta: l.hasta, novedad: l.novedad });

/** ¿La licencia va en la pestaña? (sin filtros de búsqueda/servicio/resolución) */
export function enTab(l: Licencia, tab: Tab, verNoReclamar: boolean) {
  if (tab === 'resueltas') return l.resuelta;
  if (l.resuelta) return false;
  if (tab === 'pendientes') return l.resolucion === 'PENDIENTE';
  if (tab === 'reclamar') return noJustificada(l) && !esObservada(l) && !l.reclamo && (l.debe_reclamar || verNoReclamar);
  if (tab === 'observadas') return esObservada(l) && !l.reclamo && (l.debe_reclamar || verNoReclamar);
  return noJustificada(l) && l.reclamo; // reclamaron
}

/** Tilde "Reclamó" + modal de nota (nueva o corrección). `recargar` refresca los datos después de guardar. */
export function useReclamoAcciones(recargar: () => Promise<void>) {
  const toast = useToast();
  const [guardando, setGuardando] = useState<Set<string>>(new Set());
  // Modal de nota: nota null = reclamo nuevo (nº siguiente); con nota = corregir esa
  const [notaDe, setNotaDe] = useState<{ lic: Licencia; nota: Nota | null } | null>(null);
  const [notaForm, setNotaForm] = useState({ numero: '', fecha: '', observaciones: '' });
  const [guardandoNota, setGuardandoNota] = useState(false);
  // Deshacer errores (destildar, corregir o eliminar nota) pide la clave de desbloqueo del escaneo
  const [pideClave, setPideClave] = useState<{ titulo: string; accion: () => void } | null>(null);
  const [clave, setClave] = useState('');
  const conClave = (titulo: string, accion: () => void) => { setClave(''); setPideClave({ titulo, accion }); };
  const confirmarClave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pideClave) return;
    if (!BYPASS_CODE) { toast.error('Sin clave configurada', 'Falta VITE_SCAN_BYPASS_CODE en el .env del front'); return; }
    if (clave !== BYPASS_CODE) { toast.error('Clave incorrecta'); setClave(''); return; }
    const { accion } = pideClave;
    setPideClave(null);
    setClave('');
    accion();
  };

  const tildar = async (l: Licencia, valor: boolean) => {
    if (!valor) {
      conClave(`Destildar "Reclamó" de ${l.nombre}`, () => { void guardarTilde(l, false); });
      return;
    }
    await guardarTilde(l, true);
  };

  const guardarTilde = async (l: Licencia, valor: boolean) => {
    const k = keyDe(l);
    setGuardando(prev => new Set(prev).add(k));
    try {
      await apiFetch('/licencias-medicas-control/reclamo', {
        method: 'PUT',
        body: JSON.stringify({ ...idLic(l), reclamo: valor }),
      });
      toast.ok(valor ? 'Reclamo registrado' : 'Reclamo desmarcado', l.nombre);
      await recargar(); // los Excel quedan cacheados en el server: es barato
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(prev => { const n = new Set(prev); n.delete(k); return n; });
    }
  };

  const abrirNota = (lic: Licencia, nota: Nota | null) => {
    if (nota) { conClave(`Corregir la nota ${nota.numero} de ${lic.nombre}`, () => abrirNotaYa(lic, nota)); return; }
    abrirNotaYa(lic, null);
  };

  const abrirNotaYa = (lic: Licencia, nota: Nota | null) => {
    setNotaDe({ lic, nota });
    setNotaForm(nota
      ? { numero: nota.numero, fecha: nota.fecha || '', observaciones: nota.observaciones || '' }
      : { numero: '', fecha: hoy, observaciones: '' });
  };

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notaDe) return;
    const numero = notaForm.numero.trim();
    if (!numero) { toast.error('Requerido', 'Cargá el número de la nota'); return; }
    setGuardandoNota(true);
    try {
      const datos = { nota_numero: numero, nota_fecha: notaForm.fecha || null, observaciones: notaForm.observaciones.trim() || null };
      if (notaDe.nota) {
        await apiFetch(`/licencias-medicas-control/reclamo/nota/${notaDe.nota.id}`, { method: 'PUT', body: JSON.stringify(datos) });
        toast.ok('Nota corregida', `${notaDe.lic.nombre} · Nota ${numero}`);
      } else {
        // Reclamo nuevo: nota nº siguiente; deja tildado "Reclamó"
        await apiFetch('/licencias-medicas-control/reclamo/nota', {
          method: 'POST', body: JSON.stringify({ ...idLic(notaDe.lic), ...datos }),
        });
        toast.ok(`Reclamo nº ${notaDe.lic.notas.length + 1} registrado`, `${notaDe.lic.nombre} · Nota ${numero}`);
      }
      setNotaDe(null);
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo guardar la nota', e?.message);
    } finally {
      setGuardandoNota(false);
    }
  };

  // Solo se llega desde el modal de corrección (ya pasó por la clave)
  const eliminarNota = async () => {
    if (!notaDe?.nota) return;
    const { lic, nota } = notaDe;
    if (!window.confirm(`¿Eliminar la nota ${nota.numero} (reclamo nº ${nota.nro}) de ${lic.nombre}?`)) return;
    setGuardandoNota(true);
    try {
      await apiFetch(`/licencias-medicas-control/reclamo/nota/${nota.id}`, { method: 'DELETE' });
      toast.ok('Nota eliminada', `${lic.nombre} · Nota ${nota.numero}`);
      setNotaDe(null);
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo eliminar la nota', e?.message);
    } finally {
      setGuardandoNota(false);
    }
  };

  const modalClave = pideClave && (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) setPideClave(null); }}
    >
      <form className="card" onSubmit={confirmarClave} style={{ width: '100%', maxWidth: 380, padding: 20, background: '#0f1422', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>🔒 Requiere clave</div>
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>{pideClave.titulo}</div>
        <input type="password" className="input" autoFocus style={{ width: '100%', marginTop: 12 }} placeholder="Clave de desbloqueo"
          value={clave} onChange={e => setClave(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setPideClave(null)}>Cancelar</button>
          <button type="submit" className="btn" style={{ background: '#7c3aed', color: '#fff' }}>Confirmar</button>
        </div>
      </form>
    </div>
  );

  const modalEdicion = notaDe && (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000 /* arriba del modal de Gestión (8000) */, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !guardandoNota) setNotaDe(null); }}
    >
      <form className="card" onSubmit={guardarNota} style={{ width: '100%', maxWidth: 460, padding: 20, background: '#0f1422', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>
          {notaDe.nota ? `✏️ Corregir nota del reclamo nº ${notaDe.nota.nro}` : `📝 Reclamo nº ${notaDe.lic.notas.length + 1}`}
        </div>
        <div style={{ marginTop: 6, fontWeight: 600 }}>{notaDe.lic.nombre}</div>
        <div className="muted" style={{ fontSize: '0.78rem' }}>
          DNI {notaDe.lic.dni} · {notaDe.lic.novedad} · {fmtFecha(notaDe.lic.desde)}{notaDe.lic.hasta !== notaDe.lic.desde ? ` → ${fmtFecha(notaDe.lic.hasta)}` : ''}
        </div>
        {!notaDe.nota && notaDe.lic.notas.length > 0 && (
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
            Reclamos anteriores: {notaDe.lic.notas.map(txtNota).join(' · ')}
          </div>
        )}

        <label htmlFor="nota-numero" className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: 14 }}>Número de nota *</label>
        <input id="nota-numero" className="input" autoFocus style={{ width: '100%' }} placeholder="Ej: 1234/2026"
          value={notaForm.numero} onChange={e => setNotaForm(f => ({ ...f, numero: e.target.value }))} />

        <label htmlFor="nota-fecha" className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: 10 }}>Fecha</label>
        <input id="nota-fecha" type="date" className="input" style={{ width: '100%' }}
          value={notaForm.fecha} onChange={e => setNotaForm(f => ({ ...f, fecha: e.target.value }))} />

        <label htmlFor="nota-obs" className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: 10 }}>Observaciones</label>
        <input id="nota-obs" className="input" style={{ width: '100%' }} placeholder="Texto corto…" maxLength={255}
          value={notaForm.observaciones} onChange={e => setNotaForm(f => ({ ...f, observaciones: e.target.value }))} />

        <div className="muted" style={{ fontSize: '0.75rem', marginTop: 10 }}>
          {notaDe.nota ? 'Corrige esta nota; no crea un reclamo nuevo.' : 'Se guarda como nota nueva (Resoluciones → Archivos) y queda tildado "Reclamó".'}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {notaDe.nota && (
            <button type="button" className="btn" onClick={eliminarNota} disabled={guardandoNota} style={{ marginRight: 'auto', background: 'rgba(239,68,68,0.25)' }}>
              🗑 Eliminar nota
            </button>
          )}
          <button type="button" className="btn" onClick={() => setNotaDe(null)} disabled={guardandoNota}>Cancelar</button>
          <button type="submit" className="btn" disabled={guardandoNota} style={{ background: '#7c3aed', color: '#fff' }}>
            {guardandoNota ? 'Guardando…' : 'Guardar nota'}
          </button>
        </div>
      </form>
    </div>
  );

  const modalNota = <>{modalEdicion}{modalClave}</>;

  return { guardando, tildar, abrirNota, modalNota };
}

/**
 * Tabla de licencias con fila desplegable (datos de la licencia, historial de notas y detalle
 * día por día) y paginado. Vuelve a la página 1 cuando cambia `resetKey`.
 */
export function LicenciasMedicasTabla({
  filas, tab, loading, licenciasActualizado, guardando, onTildar, onAbrirNota, resetKey, porPagina = 25,
}: {
  filas: Licencia[];
  tab: Tab;
  loading: boolean;
  licenciasActualizado?: string;
  guardando: Set<string>;
  onTildar: (l: Licencia, valor: boolean) => void;
  onAbrirNota: (l: Licencia, nota: Nota | null) => void;
  resetKey: string;
  porPagina?: number;
}) {
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(0);
  useEffect(() => { setPagina(0); }, [resetKey]);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const paginaOk = Math.min(pagina, totalPaginas - 1);
  const visibles = filas.slice(paginaOk * porPagina, (paginaOk + 1) * porPagina);

  const toggle = (k: string) => setExpandido(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const conReclamo = tab !== 'pendientes';
  const nCols = conReclamo ? 9 : 7;

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
            <th style={{ padding: '8px 6px' }}>Agente / servicio</th>
            {conReclamo && <th style={{ padding: '8px 6px', textAlign: 'center' }}>Reclamó</th>}
            {conReclamo && <th style={{ padding: '8px 6px' }}>Nota</th>}
            <th style={{ padding: '8px 6px' }}>Novedad</th>
            <th style={{ padding: '8px 6px' }}>Rango</th>
            <th style={{ padding: '8px 6px', textAlign: 'center' }}>Le tocaba</th>
            <th style={{ padding: '8px 6px', textAlign: 'center' }}>Fichó</th>
            <th style={{ padding: '8px 6px' }}>Jefe en SIAPE</th>
            <th style={{ padding: '8px 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {!loading && filas.length === 0 && (
            <tr><td colSpan={nCols} style={{ padding: 16, textAlign: 'center' }} className="muted">Sin resultados.</td></tr>
          )}
          {visibles.map((l, i) => {
            const k = `${keyDe(l)}|${paginaOk * porPagina + i}`;
            const abierto = expandido.has(k);
            const nDias = l.detalle.length;
            return (
              <React.Fragment key={k}>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }} onClick={() => toggle(k)}>
                  <td style={{ padding: '6px 6px', maxWidth: 230 }}>
                    <div
                      style={{ fontWeight: 600, whiteSpace: 'nowrap', userSelect: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={noJustificada(l) && !l.resuelta ? (l.notas.length ? 'Doble click para reclamar de nuevo' : 'Doble click para cargar la nota de reclamo') : undefined}
                      onDoubleClick={e => { if (!noJustificada(l) || l.resuelta) return; e.stopPropagation(); onAbrirNota(l, null); }}
                    >{l.nombre}</div>
                    <div className="muted" style={{ fontSize: '0.72rem' }}>DNI {l.dni}{l.legajo && l.legajo !== '-' ? ` · Leg. ${l.legajo}` : ''}</div>
                    <div className="muted" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.servicio || undefined}>
                      {l.servicio || '—'}
                    </div>
                  </td>
                  {conReclamo && (
                    <td style={{ padding: '6px 6px', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={l.reclamo}
                        disabled={guardando.has(keyDe(l)) || l.resuelta}
                        onChange={e => onTildar(l, e.target.checked)}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                        title={l.reclamo ? 'Destildar reclamo' : 'Marcar que reclamó'}
                      />
                      {tab === 'reclamaron' && l.reclamo_at && (
                        <div className="muted" style={{ fontSize: '0.7rem' }}>
                          {new Date(l.reclamo_at).toLocaleDateString('es-AR')}{l.reclamo_por ? ` · ${l.reclamo_por}` : ''}
                        </div>
                      )}
                    </td>
                  )}
                  {conReclamo && (
                    <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {l.notas.length > 0 && (() => {
                        const ult = l.notas[l.notas.length - 1];
                        return (
                          <span onClick={() => onAbrirNota(l, ult)} title="Corregir la última nota" style={{ cursor: 'pointer' }}>
                            <span className="badge" style={{ background: 'rgba(34,197,94,0.18)' }}>📝 {ult.numero}</span>
                            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                              {l.notas.length === 1 ? '1 reclamo' : `${l.notas.length} reclamos`}{ult.fecha ? ` · ${fmtFecha(ult.fecha)}` : ''}
                            </div>
                          </span>
                        );
                      })()}
                      {!l.resuelta && (
                        <div style={{ marginTop: l.notas.length ? 4 : 0 }}>
                          <button type="button" className="btn" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => onAbrirNota(l, null)}>
                            {l.notas.length ? '↻ Volver a reclamar' : '+ Cargar'}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '6px 6px', maxWidth: 150, fontSize: '0.78rem' }}>
                    {l.novedad}
                    <div><span className="badge" style={{ background: COLOR_RES[l.resolucion] ?? 'rgba(168,85,247,0.25)' }}>{l.resolucion}</span></div>
                    {l.sigue_sin_otorgar && (
                      <div><span className="badge" style={{ background: 'rgba(239,68,68,0.35)' }} title={`Después del último reclamo, el listado del Ministerio${licenciasActualizado ? ` del ${new Date(licenciasActualizado).toLocaleDateString('es-AR')}` : ''} la sigue trayendo ${l.resolucion}`}>Sigue {l.resolucion.toLowerCase()}</span></div>
                    )}
                    {noJustificada(l) && !l.resuelta && !l.debe_reclamar && (
                      <div><span className="badge" style={{ background: 'rgba(100,116,139,0.25)' }}>No le tocaba venir</span></div>
                    )}
                  </td>
                  <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                    {fmtFecha(l.desde)}
                    {l.hasta !== l.desde && <div>→ {fmtFecha(l.hasta)}</div>}
                    <div className="muted" style={{ fontSize: '0.72rem' }}>{nDias} día{nDias === 1 ? '' : 's'}</div>
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {l.sin_horario
                      ? <span className="badge" style={{ background: 'rgba(100,116,139,0.25)' }}>Sin horario</span>
                      : <span className="badge" style={{ background: l.dias_tocaba ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.18)' }}>
                          {l.dias_tocaba} de {nDias}
                        </span>}
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {l.dias_ficho
                      ? <span className="badge" style={{ background: 'rgba(234,179,8,0.22)' }} title="Fichó en días de la licencia">✋ {l.dias_ficho} día{l.dias_ficho === 1 ? '' : 's'}</span>
                      : <span className="muted">No</span>}
                  </td>
                  <td style={{ padding: '6px 6px', maxWidth: 150 }}>
                    {l.siape_jefe.length
                      ? l.siape_jefe.map(n => <span key={n} className="badge" style={{ background: 'rgba(59,130,246,0.18)', marginRight: 4, marginBottom: 2, display: 'inline-block' }}>{n}</span>)
                      : <span className="muted">Nada cargado</span>}
                  </td>
                  <td style={{ padding: '6px 6px', textAlign: 'center' }}>{abierto ? '▲' : '▼'}</td>
                </tr>
                {abierto && (
                  <tr>
                    <td colSpan={nCols} style={{ padding: '4px 12px 12px 24px', background: 'rgba(255,255,255,0.02)' }}>
                      <div className="muted" style={{ fontSize: '0.78rem', margin: '6px 0' }}>
                        Solicitud {fmtFecha(l.fecha_solicitud)} · Modalidad {l.modalidad || '—'} · Junta médica {l.junta_medica || '—'}
                        {l.diagnostico && l.diagnostico !== '-' ? ` · Diagnóstico: ${l.codigo_oms} ${l.diagnostico}` : ''}
                      </div>
                      {l.notas.length > 0 && (
                        <div style={{ margin: '8px 0 12px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 4 }}>📝 Historial de reclamos</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                              <tr className="muted" style={{ textAlign: 'left' }}>
                                <th style={{ padding: '4px 8px' }}>Nº</th>
                                <th style={{ padding: '4px 8px' }}>Nota</th>
                                <th style={{ padding: '4px 8px' }}>Fecha</th>
                                <th style={{ padding: '4px 8px' }}>Observaciones</th>
                                <th style={{ padding: '4px 8px' }}>Cargada por</th>
                                <th style={{ padding: '4px 8px' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {l.notas.map(n => (
                                <tr key={n.id}>
                                  <td style={{ padding: '4px 8px' }}>{n.nro}</td>
                                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{n.numero}</td>
                                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtFecha(n.fecha)}</td>
                                  <td style={{ padding: '4px 8px' }} className={n.observaciones ? '' : 'muted'}>{n.observaciones || '—'}</td>
                                  <td style={{ padding: '4px 8px' }} className="muted">
                                    {n.cargada_por || '—'}{n.created_at ? ` · ${new Date(n.created_at).toLocaleDateString('es-AR')}` : ''}
                                  </td>
                                  <td style={{ padding: '4px 8px' }}>
                                    <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: '0.72rem' }} onClick={() => onAbrirNota(l, n)}>✏️ Corregir</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr className="muted" style={{ textAlign: 'left' }}>
                            <th style={{ padding: '6px 8px' }}>Fecha</th>
                            <th style={{ padding: '6px 8px' }}>Le tocaba venir</th>
                            <th style={{ padding: '6px 8px' }}>Fichada</th>
                            <th style={{ padding: '6px 8px' }}>Cargado por el jefe (SIAPE)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l.detalle.map(d => (
                            <tr key={d.fecha} style={{ background: d.le_tocaba ? 'rgba(239,68,68,0.06)' : undefined }}>
                              <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{DIA_CORTO[d.dia_semana] ?? d.dia_semana} {fmtFecha(d.fecha)}</td>
                              <td style={{ padding: '5px 8px' }}>{txtTocaba(d)}</td>
                              <td style={{ padding: '5px 8px', fontWeight: d.fichada ? 600 : 400 }} className={d.fichada ? '' : 'muted'}>{txtFichada(d.fichada)}</td>
                              <td style={{ padding: '5px 8px' }} className={d.siape_jefe.length ? '' : 'muted'}>{d.siape_jefe.join(' / ') || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {totalPaginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button type="button" className="btn" disabled={paginaOk === 0} onClick={() => setPagina(0)}>«</button>
          <button type="button" className="btn" disabled={paginaOk === 0} onClick={() => setPagina(paginaOk - 1)}>‹ Anterior</button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Página {paginaOk + 1} de {totalPaginas} · {paginaOk * porPagina + 1}–{Math.min((paginaOk + 1) * porPagina, filas.length)} de {filas.length}
          </span>
          <button type="button" className="btn" disabled={paginaOk >= totalPaginas - 1} onClick={() => setPagina(paginaOk + 1)}>Siguiente ›</button>
          <button type="button" className="btn" disabled={paginaOk >= totalPaginas - 1} onClick={() => setPagina(totalPaginas - 1)}>»</button>
        </div>
      )}
    </>
  );
}

// src/pages/FicheroPage/index.tsx
// Módulo Fichero — reemplazo del exe VB.NET

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FicheroConfig {
  mysqlHost: string; mysqlPort: number; mysqlUser: string; mysqlPass: string; mysqlDb: string;
  sftpHost: string;  sftpPort: number;  sftpUser: string;  sftpPass: string;  sftpDir: string;
  sftpLocalAddr: string;
  outputDir: string; prefijo: string;   sufijo: string;    limite: number;    intervaloMin: number;
  modoContinu: boolean; fechaDesdeContinu: string | null; horaDesdeContinu: string | null;
}

interface LogEntry {
  fechaCreacion: string;
  nombreArchivo: string;
  fechaSubida:   string;
  exitoso:       boolean;
  error:         string;
  rangoDesde?:   string;
  rangoHasta?:   string;
  registros?:    number;
}

interface EstadoFichero {
  corriendo: boolean; redCaida: boolean;
  total: number; exitosos: number; fallidos: number;
  primerArchivo: string | null; ultimoArchivo: string | null; ultimaSubidaExitosa: string | null;
  intervaloMin: number | null;
  proximaEjecucionMs: number | null;
  entradas: LogEntry[];
}

interface DbPreview {
  columna:  { COLUMN_TYPE: string; COLUMN_NAME: string } | null;
  minFecha: string | null;
  maxFecha: string | null;
  muestras: { badgenumber: string; checktime: string; checktype: number; name: string }[];
}

const REFRESH_MS = 30_000;

// ─── Página ───────────────────────────────────────────────────────────────────

export function FicheroPage() {
  const toast = useToast();

  const [estado,     setEstado]     = useState<EstadoFichero | null>(null);
  const [config,     setConfig]     = useState<FicheroConfig | null>(null);
  const [editConfig, setEditConfig] = useState<FicheroConfig | null>(null);
  const [redActiva,  setRedActiva]  = useState<boolean | null>(null);
  const [dbPreview,  setDbPreview]  = useState<DbPreview | null>(null);
  const [dbError,    setDbError]    = useState<string | null>(null);

  const [cargando,   setCargando]   = useState(false);
  const [guardando,  setGuardando]  = useState(false);
  const [accionando, setAccionando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const [tab, setTab] = useState<'monitor' | 'exportar' | 'continu' | 'config'>('monitor');
  const [ultimaAct, setUltimaAct] = useState<Date | null>(null);

  // Rango de exportación puntual
  const hoy = new Date().toISOString().slice(0, 10);
  const [fechaDesde, setFechaDesde] = useState(hoy);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [horaDesde,  setHoraDesde]  = useState('00:00');
  const [horaHasta,  setHoraHasta]  = useState('23:59');
  const [resultExport, setResultExport] = useState<{ ok: boolean; registros: number; archivo: string; error?: string } | null>(null);

  // Modo continuo
  const [continuDesde,     setContinuDesde]     = useState(hoy);
  const [continuHoraDesde, setContinuHoraDesde] = useState('00:00');
  const [guardandoContinu, setGuardandoContinu] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Carga de datos ──────────────────────────────────────────────────────────

  const cargarEstado = useCallback(async () => {
    setCargando(true);
    try {
      const [resEstado, resRed] = await Promise.all([
        apiFetch<{ ok: boolean; data: EstadoFichero }>('/fichero/estado'),
        apiFetch<{ ok: boolean; red: string }>('/fichero/red'),
      ]);
      if (resEstado?.ok) setEstado(resEstado.data);
      if (resRed?.ok)    setRedActiva(resRed.red === 'activa');
      setUltimaAct(new Date());
    } catch {
      toast.error('Error al obtener estado');
    } finally {
      setCargando(false);
    }
  }, [toast]);

  const cargarConfig = useCallback(async () => {
    const res = await apiFetch<{ ok: boolean; data: FicheroConfig }>('/fichero/config');
    if (res?.ok) {
      setConfig(res.data);
      setEditConfig(res.data);
      if (res.data.fechaDesdeContinu) setContinuDesde(res.data.fechaDesdeContinu);
      if (res.data.horaDesdeContinu)  setContinuHoraDesde(res.data.horaDesdeContinu);
    }
  }, []);

  const cargarDbPreview = useCallback(async () => {
    setDbError(null);
    setDbPreview(null);
    try {
      const res = await apiFetch<{ ok: boolean } & DbPreview & { error?: string }>('/fichero/db-preview');
      if (res?.ok) {
        setDbPreview({ columna: res.columna, minFecha: res.minFecha, maxFecha: res.maxFecha, muestras: res.muestras });
        // Pre-cargar rangos de fecha con los datos reales de la DB
        if (res.minFecha) setFechaDesde(res.minFecha.slice(0, 10));
        if (res.maxFecha) setFechaHasta(res.maxFecha.slice(0, 10));
      } else {
        setDbError((res as any)?.error ?? 'No se pudo conectar a la DB del reloj');
      }
    } catch (e: any) {
      setDbError(e?.message ?? 'Error de conexión a la DB');
    }
  }, []);

  useEffect(() => { cargarEstado(); cargarConfig(); }, [cargarEstado, cargarConfig]);
  useEffect(() => {
    timerRef.current = setInterval(cargarEstado, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [cargarEstado]);

  // Cuando se abre la tab "exportar", cargar preview de la DB
  useEffect(() => {
    if (tab === 'exportar' && !dbPreview && !dbError) cargarDbPreview();
  }, [tab, dbPreview, dbError, cargarDbPreview]);

  // ── Acciones ────────────────────────────────────────────────────────────────

  async function accion(endpoint: string, msg: string) {
    setAccionando(true);
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string }>(`/fichero/${endpoint}`, { method: 'POST' });
      if (r?.ok) { toast.ok(r.msg ?? msg); await cargarEstado(); }
    } catch { toast.error(`Error: ${endpoint}`); }
    finally { setAccionando(false); }
  }

  async function guardarConfig() {
    if (!editConfig) return;
    setGuardando(true);
    try {
      const r = await apiFetch<{ ok: boolean }>('/fichero/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editConfig),
      });
      if (r?.ok) { toast.ok('Configuración guardada'); await cargarConfig(); setTab('monitor'); }
    } catch { toast.error('Error al guardar'); }
    finally { setGuardando(false); }
  }

  async function activarModoContinu() {
    if (!continuDesde) return;
    setGuardandoContinu(true);
    try {
      // 1. Guardar config con modoContinu=true y la fecha elegida
      const r = await apiFetch<{ ok: boolean }>('/fichero/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editConfig,
          modoContinu:       true,
          fechaDesdeContinu: continuDesde,
          horaDesdeContinu:  continuHoraDesde,
        }),
      });
      if (!r?.ok) { toast.error('Error al guardar config'); return; }
      // 2. (Re)arrancar el timer para que tome la nueva config
      const r2 = await apiFetch<{ ok: boolean; msg?: string }>('/fichero/iniciar', { method: 'POST' });
      if (r2?.ok) {
        toast.ok(`Modo continuo activado desde ${continuDesde} ${continuHoraDesde}`);
        await cargarConfig();
        await cargarEstado();
        setTab('monitor');
      }
    } catch { toast.error('Error al activar modo continuo'); }
    finally { setGuardandoContinu(false); }
  }

  async function desactivarModoContinu() {
    setGuardandoContinu(true);
    try {
      const r = await apiFetch<{ ok: boolean }>('/fichero/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editConfig, modoContinu: false, fechaDesdeContinu: null, horaDesdeContinu: null }),
      });
      if (r?.ok) {
        toast.ok('Modo continuo desactivado — el timer ahora trae los últimos N registros sin filtro de fecha');
        await cargarConfig();
        await cargarEstado();
      }
    } catch { toast.error('Error al desactivar'); }
    finally { setGuardandoContinu(false); }
  }

  async function exportarRango() {
    setExportando(true);
    setResultExport(null);
    try {
      const r = await apiFetch<{ ok: boolean; registros: number; archivo: string; error?: string }>(
        '/fichero/exportar',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fechaDesde, fechaHasta, horaDesde, horaHasta }),
        }
      );
      setResultExport(r);
      if (r?.ok) {
        toast.ok(`Exportado: ${r.registros} registros`);
        await cargarEstado();
      } else {
        toast.error(r?.error ?? 'Error al exportar');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Error al exportar');
    } finally {
      setExportando(false);
    }
  }

  // ── Helpers UI ──────────────────────────────────────────────────────────────

  const fmtF = (s: string | null | undefined) => s ? s.replace('T', ' ').substring(0, 16) : '—';
  const hayRedCaida = estado?.redCaida || redActiva === false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Layout title="Módulo Fichero">

      {hayRedCaida && (
        <div style={S.alertaRed}>
          <span>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Red caída</strong> — La subida está suspendida. Se reintentará automáticamente. Actualizando cada {REFRESH_MS / 1000}s…
            <div style={{ fontSize: '0.78rem', marginTop: 3, opacity: 0.8 }}>
              Nota: el servidor ({config?.sftpLocalAddr || 'automático'}) es quien se conecta al SFTP y a la DB del reloj,
              no esta PC. Esta página puede abrirse desde cualquier equipo.
            </div>
          </div>
          <button onClick={() => accion('resetear', 'Estado reseteado')}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Resetear estado
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={S.tabs}>
        {(['monitor', 'exportar', 'continu', 'config'] as const).map(t => (
          <button key={t} style={{ ...S.tab, ...(tab === t ? S.tabActive : {}), ...(t === 'continu' && config?.modoContinu ? S.tabContinu : {}) }} onClick={() => setTab(t)}>
            {t === 'monitor'  ? '📊 Monitor'
           : t === 'exportar' ? '📅 Exportar por rango'
           : t === 'continu'  ? (config?.modoContinu ? '🔄 Continuo ●' : '🔄 Continuo desde fecha')
           :                    '⚙️ Configuración'}
          </button>
        ))}
      </div>

      {/* ══════════════════ TAB MONITOR ══════════════════════════════════════ */}
      {tab === 'monitor' && (
        <>
          {estado && (
            <>
              <div style={S.cards}>
                <StatusCard label="Estado"   value={estado.corriendo ? '▶ Corriendo' : '⏹ Detenido'}
                  color={estado.corriendo ? '#16a34a' : '#6b7280'}
                  bg={estado.corriendo ? '#f0fdf4' : '#f9fafb'}
                  border={estado.corriendo ? '#86efac' : '#e2e8f0'} />
                <StatusCard label="Red"
                  value={redActiva === null ? '…' : hayRedCaida ? '⚠ Caída' : '✓ Activa'}
                  color={hayRedCaida ? '#b91c1c' : '#16a34a'}
                  bg={hayRedCaida ? '#fef2f2' : '#f0fdf4'}
                  border={hayRedCaida ? '#fca5a5' : '#86efac'} />
                <NumCard label="Archivos creados" value={estado.total}    color="#2563eb" />
                <NumCard label="Subidos OK"        value={estado.exitosos} color="#16a34a" />
                <NumCard label="Fallidos" value={estado.fallidos} color={estado.fallidos > 0 ? '#dc2626' : '#6b7280'} />
                <InfoCard label="Primer archivo"   value={fmtF(estado.primerArchivo)} />
                <InfoCard label="Último archivo"   value={fmtF(estado.ultimoArchivo)} />
                <InfoCard label="Última subida OK" value={fmtF(estado.ultimaSubidaExitosa)} />
                {estado.corriendo && estado.proximaEjecucionMs && (
                  <CountdownCard
                    proximaEjecucionMs={estado.proximaEjecucionMs}
                    intervaloMin={estado.intervaloMin ?? 50}
                  />
                )}
              </div>
            </>
          )}

          <div style={S.controles}>
            <button className="btn" onClick={() => accion('iniciar', 'Timer iniciado')}
              disabled={accionando || !!estado?.corriendo}
              style={{ background: '#16a34a', color: '#fff', border: 'none', minWidth: 120 }}>
              ▶ Iniciar
            </button>
            <button className="btn" onClick={() => accion('detener', 'Timer detenido')}
              disabled={accionando || !estado?.corriendo}
              style={{ background: '#dc2626', color: '#fff', border: 'none', minWidth: 120 }}>
              ⏹ Detener
            </button>
            <button className="btn" onClick={() => accion('forzar', 'Ciclo forzado…')}
              disabled={accionando} style={{ minWidth: 150 }}>
              ⚡ Forzar ahora
            </button>
            <button className="btn" onClick={cargarEstado} disabled={cargando} style={{ minWidth: 110 }}>
              {cargando ? 'Actualizando…' : '↻ Actualizar'}
            </button>
            {ultimaAct && (
              <span style={{ fontSize: '0.78rem', color: '#9ca3af', alignSelf: 'center' }}>
                {ultimaAct.toLocaleTimeString()} · auto cada {REFRESH_MS / 1000}s
              </span>
            )}
          </div>

          {estado && estado.entradas.length > 0 ? (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={S.tabla}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <Th>#</Th><Th>Creación</Th><Th>Archivo</Th>
                    <Th>Desde</Th><Th>Hasta</Th>
                    <Th>Registros</Th><Th>Subida</Th><Th>Estado</Th><Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {estado.entradas.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: !e.exitoso ? '#fff5f5' : undefined }}>
                      <Td style={{ color: '#9ca3af', textAlign: 'right' }}>{estado.total - i}</Td>
                      <Td>{fmtF(e.fechaCreacion)}</Td>
                      <Td style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>{e.nombreArchivo}.txt</Td>
                      <Td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{fmtF(e.rangoDesde)}</Td>
                      <Td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{fmtF(e.rangoHasta)}</Td>
                      <Td style={{ textAlign: 'right' }}>{e.registros ?? '—'}</Td>
                      <Td>{fmtF(e.fechaSubida)}</Td>
                      <Td>
                        <span style={{ ...S.badge, background: e.exitoso ? '#dcfce7' : '#fee2e2', color: e.exitoso ? '#15803d' : '#b91c1c' }}>
                          {e.exitoso ? '✓ OK' : '✗ Falló'}
                        </span>
                      </Td>
                      <Td style={{ color: '#9ca3af', maxWidth: 260, fontSize: '0.78rem' }}>
                        <span title={e.error}>{e.error || '—'}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : estado && (
            <p className="muted" style={{ marginTop: 16 }}>
              Sin registros. Usá <strong>Iniciar</strong>, <strong>Forzar ahora</strong> o la tab <strong>Exportar por rango</strong>.
            </p>
          )}
        </>
      )}

      {/* ══════════════════ TAB EXPORTAR ═════════════════════════════════════ */}
      {tab === 'exportar' && (
        <div style={{ maxWidth: 700 }}>

          {/* Preview DB */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={S.sectionTitle}>🗄️ Datos reales en la DB</span>
              <button className="btn" onClick={cargarDbPreview} style={{ fontSize: '0.78rem', padding: '3px 10px' }}>
                ↻ Consultar DB
              </button>
            </div>

            {dbError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 14px', color: '#b91c1c', fontSize: '0.85rem' }}>
                ⚠ {dbError}
                <br /><small>Verificá la conexión MySQL en la pestaña Configuración.</small>
              </div>
            )}

            {dbPreview && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <InfoCard label="Tipo de columna checktime" value={dbPreview.columna?.COLUMN_TYPE ?? '—'} />
                <InfoCard label="Fecha más antigua" value={dbPreview.minFecha?.slice(0, 16) ?? '—'} />
                <InfoCard label="Fecha más reciente" value={dbPreview.maxFecha?.slice(0, 16) ?? '—'} />
              </div>
            )}

            {dbPreview && dbPreview.muestras.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#6b7280', userSelect: 'none' }}>
                  Ver 10 registros más recientes (formato real de fechas)
                </summary>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ ...S.tabla, fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <Th>Badge</Th><Th>checktime (crudo)</Th><Th>Tipo</Th><Th>Nombre</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbPreview.muestras.map((m, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <Td>{m.badgenumber}</Td>
                          <Td style={{ fontFamily: 'monospace', color: '#2563eb' }}>{m.checktime}</Td>
                          <Td>{m.checktype === 0 ? 'E (entrada)' : 'S (salida)'}</Td>
                          <Td>{m.name}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>

          {/* Formulario de rango */}
          <div style={{ ...S.section, marginBottom: 20 }}>
            <div style={S.sectionTitle as React.CSSProperties}>📅 Seleccionar rango a exportar</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <Field label="Fecha desde">
                <input type="date" style={S.input} value={fechaDesde}
                  min={dbPreview?.minFecha?.slice(0, 10)}
                  max={dbPreview?.maxFecha?.slice(0, 10)}
                  onChange={e => setFechaDesde(e.target.value)} />
              </Field>
              <Field label="Fecha hasta">
                <input type="date" style={S.input} value={fechaHasta}
                  min={dbPreview?.minFecha?.slice(0, 10)}
                  max={dbPreview?.maxFecha?.slice(0, 10)}
                  onChange={e => setFechaHasta(e.target.value)} />
              </Field>
              <Field label="Hora desde">
                <input type="time" style={S.input} value={horaDesde}
                  onChange={e => setHoraDesde(e.target.value)} />
              </Field>
              <Field label="Hora hasta">
                <input type="time" style={S.input} value={horaHasta}
                  onChange={e => setHoraHasta(e.target.value)} />
              </Field>
            </div>

            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#6b7280' }}>
              Exportará fichadas entre <code>{fechaDesde} {horaDesde}:00</code> y <code>{fechaHasta} {horaHasta}:59</code>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={exportarRango}
                disabled={exportando || !fechaDesde || !fechaHasta}
                style={{ background: '#2563eb', color: '#fff', border: 'none', minWidth: 200 }}
              >
                {exportando ? '⏳ Exportando…' : '📤 Generar y subir por SFTP'}
              </button>
            </div>
          </div>

          {/* Resultado */}
          {resultExport && (
            <div style={{
              padding: '12px 16px', borderRadius: 6, marginTop: 4,
              background: resultExport.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${resultExport.ok ? '#86efac' : '#fca5a5'}`,
              color: resultExport.ok ? '#15803d' : '#b91c1c',
              fontSize: '0.88rem',
            }}>
              {resultExport.ok
                ? <>✓ <strong>Subida exitosa</strong> — {resultExport.registros} registros → <code>{resultExport.archivo}.txt</code></>
                : <>✗ <strong>Error:</strong> {resultExport.error}</>
              }
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ TAB CONTINUO ════════════════════════════════════ */}
      {tab === 'continu' && (
        <div style={{ maxWidth: 560 }}>

          {/* Estado actual */}
          {config?.modoContinu ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '1.4rem' }}>🟢</span>
              <div>
                <div style={{ fontWeight: 700, color: '#15803d' }}>Modo continuo ACTIVO</div>
                <div style={{ fontSize: '0.82rem', color: '#166534', marginTop: 2 }}>
                  Subiendo fichadas desde <strong>{config.fechaDesdeContinu} {config.horaDesdeContinu ?? '00:00'}</strong> hasta ahora, cada <strong>{config.intervaloMin} min</strong>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
              <span style={{ color: '#6b7280', fontSize: '0.88rem' }}>
                ⚪ Modo continuo <strong>inactivo</strong> — el timer sube los últimos {config?.limite ?? '…'} registros sin filtro de fecha.
              </span>
            </div>
          )}

          {/* Explicación */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', marginBottom: 22, fontSize: '0.84rem', color: '#1e40af', lineHeight: 1.6 }}>
            <strong>¿Cómo funciona?</strong><br />
            Cada vez que el timer dispara, genera y sube un archivo con <em>todos</em> los registros
            desde la fecha/hora que elijas hasta el momento actual. Útil para mantener sincronizadas
            todas las fichadas a partir de una fecha de corte fija.
          </div>

          {/* Formulario */}
          <div style={S.section}>
            <div style={S.sectionTitle as React.CSSProperties}>📅 Fecha y hora de inicio del continuo</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
              <Field label="Fecha desde (inclusive)">
                <input type="date" style={S.input} value={continuDesde}
                  onChange={e => setContinuDesde(e.target.value)} />
              </Field>
              <Field label="Hora desde">
                <input type="time" style={S.input} value={continuHoraDesde}
                  onChange={e => setContinuHoraDesde(e.target.value)} />
              </Field>
            </div>
            <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#6b7280' }}>
              Cada ciclo exportará: <code>{continuDesde} {continuHoraDesde}:00</code> → <em>ahora</em>
            </div>
          </div>

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={activarModoContinu}
              disabled={guardandoContinu || !continuDesde}
              style={{ background: '#16a34a', color: '#fff', border: 'none', minWidth: 220 }}
            >
              {guardandoContinu ? '⏳ Guardando…' : config?.modoContinu ? '🔄 Actualizar y reiniciar' : '▶ Activar modo continuo'}
            </button>

            {config?.modoContinu && (
              <button
                className="btn"
                onClick={desactivarModoContinu}
                disabled={guardandoContinu}
                style={{ background: '#dc2626', color: '#fff', border: 'none', minWidth: 160 }}
              >
                ⏹ Desactivar
              </button>
            )}
          </div>

          <p className="muted" style={{ marginTop: 16, fontSize: '0.78rem' }}>
            Al activar, se guarda la configuración y el timer se (re)arranca inmediatamente.
            Para volver al modo normal (últimos N registros) usá <strong>Desactivar</strong>.
          </p>
        </div>
      )}

      {/* ══════════════════ TAB CONFIG ═══════════════════════════════════════ */}
      {tab === 'config' && editConfig && (
        <div style={{ maxWidth: 680, marginTop: 8 }}>

          <section style={S.section}>
            <div style={S.sectionTitle as React.CSSProperties}>🗄️ MySQL — reloj biométrico</div>
            <div style={S.grid2}>
              <Field label="Host / IP"><input style={S.input} value={editConfig.mysqlHost} onChange={e => setEditConfig({ ...editConfig, mysqlHost: e.target.value })} /></Field>
              <Field label="Puerto"><input style={S.input} type="number" value={editConfig.mysqlPort} onChange={e => setEditConfig({ ...editConfig, mysqlPort: +e.target.value })} /></Field>
              <Field label="Usuario"><input style={S.input} value={editConfig.mysqlUser} onChange={e => setEditConfig({ ...editConfig, mysqlUser: e.target.value })} /></Field>
              <Field label="Contraseña"><input style={S.input} type="password" value={editConfig.mysqlPass} placeholder="(sin cambios)" onChange={e => setEditConfig({ ...editConfig, mysqlPass: e.target.value })} /></Field>
              <Field label="Base de datos"><input style={S.input} value={editConfig.mysqlDb} onChange={e => setEditConfig({ ...editConfig, mysqlDb: e.target.value })} /></Field>
            </div>
          </section>

          <section style={S.section}>
            <div style={S.sectionTitle as React.CSSProperties}>📡 SFTP — servidor destino</div>
            <div style={S.grid2}>
              <Field label="Host / IP"><input style={S.input} value={editConfig.sftpHost} onChange={e => setEditConfig({ ...editConfig, sftpHost: e.target.value })} /></Field>
              <Field label="Puerto"><input style={S.input} type="number" value={editConfig.sftpPort} onChange={e => setEditConfig({ ...editConfig, sftpPort: +e.target.value })} /></Field>
              <Field label="Usuario"><input style={S.input} value={editConfig.sftpUser} onChange={e => setEditConfig({ ...editConfig, sftpUser: e.target.value })} /></Field>
              <Field label="Contraseña"><input style={S.input} type="password" value={editConfig.sftpPass} placeholder="(sin cambios)" onChange={e => setEditConfig({ ...editConfig, sftpPass: e.target.value })} /></Field>
              <Field label="Carpeta remota"><input style={S.input} value={editConfig.sftpDir} onChange={e => setEditConfig({ ...editConfig, sftpDir: e.target.value })} /></Field>
            </div>
          </section>

          <section style={S.section}>
            <div style={S.sectionTitle as React.CSSProperties}>📁 Generación de archivos</div>
            <div style={S.grid2}>
              <Field label="Carpeta local de salida"><input style={S.input} value={editConfig.outputDir} onChange={e => setEditConfig({ ...editConfig, outputDir: e.target.value })} /></Field>
              <Field label="Prefijo"><input style={S.input} value={editConfig.prefijo} onChange={e => setEditConfig({ ...editConfig, prefijo: e.target.value })} /></Field>
              <Field label="Sufijo"><input style={S.input} value={editConfig.sufijo} onChange={e => setEditConfig({ ...editConfig, sufijo: e.target.value })} /></Field>
              <Field label="Límite de registros"><input style={S.input} type="number" value={editConfig.limite} onChange={e => setEditConfig({ ...editConfig, limite: +e.target.value })} /></Field>
              <Field label="Intervalo automático (min)"><input style={S.input} type="number" min={1} value={editConfig.intervaloMin} onChange={e => setEditConfig({ ...editConfig, intervaloMin: +e.target.value })} /></Field>
            </div>
            <p className="muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
              Nombre: <code>{editConfig.prefijo}_Fichadas_YYMMDD_HHmm_{editConfig.sufijo}.txt</code>
            </p>
          </section>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={guardarConfig} disabled={guardando}
              style={{ background: '#2563eb', color: '#fff', border: 'none', minWidth: 140 }}>
              {guardando ? 'Guardando…' : '💾 Guardar'}
            </button>
            <button className="btn" onClick={() => { setEditConfig(config); setTab('monitor'); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ─── CountdownCard ────────────────────────────────────────────────────────────

function CountdownCard({ proximaEjecucionMs, intervaloMin }: { proximaEjecucionMs: number; intervaloMin: number }) {
  const [ahora, setAhora] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const restanMs = proximaEjecucionMs - ahora;
  let display: string;
  let color: string;
  if (restanMs <= 0) {
    display = 'Ejecutando…';
    color = '#f59e0b';
  } else {
    const mins = Math.floor(restanMs / 60_000);
    const segs = Math.floor((restanMs % 60_000) / 1000);
    display = `${String(mins).padStart(2, '0')}:${String(segs).padStart(2, '0')}`;
    color = restanMs < 60_000 ? '#ef4444' : '#1e293b';
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>Próxima subida</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{display}</span>
    </div>
  );
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function StatusCard({ label, value, color, bg, border }: { label: string; value: string; color: string; bg: string; border: string }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '12px 20px', minWidth: 130, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '1rem', fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
function NumCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{value}</span>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>{label}</label>
      {children}
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '7px 12px', color: '#374151', verticalAlign: 'middle', ...style }}>{children}</td>;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = {
  alertaRed:    { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, color: '#b91c1c' } as React.CSSProperties,
  tabs:         { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e2e8f0', paddingBottom: 0 } as React.CSSProperties,
  tab:          { padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#6b7280', borderBottom: '2px solid transparent', marginBottom: -2 } as React.CSSProperties,
  tabActive:    { color: '#2563eb', borderBottomColor: '#2563eb', fontWeight: 600 } as React.CSSProperties,
  tabContinu:   { color: '#16a34a', fontWeight: 600 } as React.CSSProperties,
  cards:        { display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 20 },
  controles:    { display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center', marginBottom: 16 },
  tabla:        { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  badge:        { display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 } as React.CSSProperties,
  section:      { marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' } as React.CSSProperties,
  sectionTitle: { fontSize: '0.9rem', fontWeight: 700, color: '#374151', margin: '0 0 14px 0' },
  grid2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
  input:        { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: '0.88rem', boxSizing: 'border-box' as const },
};

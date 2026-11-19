// src/pages/GestionUsuarioPage/BackupPanel.tsx
// Pestaña 💾 Backup de Mi cuenta (solo admin): estado y política del backup MySQL.
// Lee GET /backup-estado (solo lectura; el backup corre aparte en C:\apps\backup_mysql).
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/http';

type Tarea = { existe: boolean; estado?: string; proxima?: string | null; ultima?: string | null; ultimoResultado?: number | null };
type Run = { script: string; estado: string; motivo: string | null; filas: number | null; duracion_seg: number | null; actualizado_at: string; items?: { nombre: string; estado: string; detalle: string }[]; id?: number };
type Estado = {
  dir: string;
  tareas: Record<string, Tarea>;
  ultimas: Record<string, Run>;
  historial: Run[];
  diarios: { nombre: string; bases: number; bytes: number; usuarios: number | null }[];
  binlogs: { cantidad: number; bytes: number; mas_viejo: string | null; mas_nuevo: string | null };
  disco: { libre: number; total: number } | null;
  avisos: string[];
};

const TIPOS = [
  { script: 'backup_mysql_diario',  tarea: 'Backup_MySQL_Diario',  titulo: 'Copia completa (diaria)', cuando: 'Todos los días 02:00' },
  { script: 'backup_mysql_binlogs', tarea: 'Backup_MySQL_Binlogs', titulo: 'Binlogs (cambios)',       cuando: 'Cada hora' },
  { script: 'backup_mysql_prueba',  tarea: 'Backup_MySQL_Prueba',  titulo: 'Prueba de restauración',  cuando: 'Cada 4 domingos 04:00' },
];
const NOMBRE_SCRIPT: Record<string, string> = Object.fromEntries(TIPOS.map(t => [t.script, t.titulo]));

const mb = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;
const fh = (s?: string | null) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fDiario = (n: string) => `${n.slice(6, 8)}/${n.slice(4, 6)}/${n.slice(0, 4)} ${n.slice(9, 11)}:${n.slice(11, 13)}`;

const COLOR = { ok: '#4ade80', aviso: '#fbbf24', error: '#f87171', nada: '#94a3b8' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: '0.84rem', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' };

function colorRun(r?: Run) {
  if (!r) return COLOR.nada;
  if (r.estado === 'error') return COLOR.error;
  if (/FALL/i.test(r.motivo || '') || (r.items || []).some(i => i.estado !== 'ok')) return COLOR.aviso;
  return COLOR.ok;
}

export function BackupPanel() {
  const [d, setD] = useState<Estado | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setErr(null);
    try {
      const r = await apiFetch<{ ok: boolean; data?: Estado; error?: string }>('/backup-estado');
      if (!r?.ok || !r.data) throw new Error(r?.error || 'No se pudo leer el estado');
      setD(r.data);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const ultDiario = d?.ultimas['backup_mysql_diario'];
  const enDrive = ultDiario ? /copiado a Drive/i.test(ultDiario.motivo || '') : null;

  return (
    <>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="h2" style={{ marginBottom: 4 }}>💾 Backup de MySQL</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Corre solo, aparte de la app (C:\apps\backup_mysql). Acá solo se consulta.
            </div>
          </div>
          <button className="btn" onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : '↻ Actualizar'}</button>
        </div>
        {err && <div style={{ color: COLOR.error, marginTop: 10 }}>{err}</div>}
        {d?.avisos?.map((a, i) => <div key={i} style={{ color: COLOR.aviso, marginTop: 8, fontSize: '0.85rem' }}>⚠ {a}</div>)}

        {d && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 14 }}>
            {TIPOS.map(t => {
              const r = d.ultimas[t.script];
              const ta = d.tareas[t.tarea];
              const c = colorRun(r);
              return (
                <div key={t.script} style={{ border: `1px solid ${c}55`, borderLeft: `4px solid ${c}`, borderRadius: 8, padding: 12, background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ fontWeight: 700 }}>{t.titulo}</div>
                  <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>{t.cuando}</div>
                  <div style={{ fontSize: '0.84rem' }}>
                    <div>Última: <b>{r ? fh(r.actualizado_at) : 'todavía no corrió'}</b>{r && <span style={{ color: c }}> · {r.estado.toUpperCase()}</span>}</div>
                    {r?.motivo && <div className="muted" style={{ marginTop: 4 }}>{r.motivo}</div>}
                    <div style={{ marginTop: 6 }}>Próxima: <b>{ta?.existe ? fh(ta.proxima) : <span style={{ color: COLOR.error }}>tarea no encontrada</span>}</b></div>
                    {ta?.existe && ta.estado !== 'Ready' && ta.estado !== 'Running' && <div style={{ color: COLOR.aviso }}>Tarea en estado {ta.estado}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {d && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2" style={{ marginBottom: 10 }}>Copias guardadas</div>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap', fontSize: '0.88rem', marginBottom: 12 }}>
            <div>Google Drive (última diaria): <b style={{ color: enDrive ? COLOR.ok : enDrive === false ? COLOR.error : COLOR.nada }}>{enDrive ? 'subida' : enDrive === false ? 'NO subida' : '—'}</b></div>
            <div>Binlogs locales: <b>{d.binlogs.cantidad}</b> ({mb(d.binlogs.bytes)}){d.binlogs.mas_viejo && <span className="muted"> · desde {fh(d.binlogs.mas_viejo)}</span>}</div>
            {d.disco && <div>Disco ({d.dir.slice(0, 2)}): <b style={{ color: d.disco.libre < 20 * 1024 ** 3 ? COLOR.aviso : undefined }}>{mb(d.disco.libre)}</b> libres de {mb(d.disco.total)}</div>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead><tr><th style={th}>Copia diaria local</th><th style={th}>Bases</th><th style={th}>Usuarios MySQL</th><th style={th}>Tamaño (cifrado)</th></tr></thead>
              <tbody>
                {d.diarios.length === 0 && <tr><td style={td} colSpan={4} className="muted">No hay copias en {d.dir}\diario</td></tr>}
                {d.diarios.map(x => (
                  <tr key={x.nombre}>
                    <td style={td}>{fDiario(x.nombre)}</td>
                    <td style={td}>{x.bases || <span style={{ color: COLOR.error }}>incompleta</span>}</td>
                    <td style={td}>{x.usuarios ?? '—'}</td>
                    <td style={td}>{mb(x.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2" style={{ marginBottom: 10 }}>Historial (últimas 30 corridas)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr><th style={th}>Fecha</th><th style={th}>Tipo</th><th style={th}>Estado</th><th style={th}>Detalle</th><th style={th}>Duración</th></tr></thead>
              <tbody>
                {d.historial.length === 0 && <tr><td style={td} colSpan={5} className="muted">Sin corridas registradas</td></tr>}
                {d.historial.map((h, i) => (
                  <tr key={h.id ?? i}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fh(h.actualizado_at)}</td>
                    <td style={td}>{NOMBRE_SCRIPT[h.script] || h.script}</td>
                    <td style={{ ...td, color: colorRun(h), fontWeight: 600 }}>{h.estado.toUpperCase()}</td>
                    <td style={td}>
                      {h.motivo}
                      {(h.items || []).map((it, j) => (
                        <div key={j} style={{ color: it.estado === 'error' ? COLOR.error : COLOR.aviso, fontSize: '0.8rem' }}>⚠ {it.nombre}: {it.detalle}</div>
                      ))}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{h.duracion_seg != null ? `${h.duracion_seg} s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12, fontSize: '0.88rem', lineHeight: 1.55 }}>
        <div className="h2" style={{ marginBottom: 10 }}>Política de backup</div>

        <b>Qué se respalda</b>
        <ul style={{ margin: '4px 0 10px 18px' }}>
          <li>Todas las bases de producción + los usuarios de MySQL, comprimidas y <b>cifradas</b> (AES-256). Sin la clave <code>BK_CLAVE</code> no se pueden abrir.</li>
          <li>Diaria completa a las 02:00 + binlogs cada hora: si pasa algo se pierde como máximo ~1 hora de datos.</li>
          <li>Cada 4 domingos se restaura la copia en una base aparte y se comparan las tablas, para saber que la copia sirve.</li>
        </ul>

        <b>Cuánto se guarda</b>
        <ul style={{ margin: '4px 0 10px 18px' }}>
          <li><b>Local</b> ({d?.dir || 'D:\\backups_mysql'}): 14 diarias + 8 semanales + 12 mensuales; binlogs 15 días.</li>
          <li><b>Google Drive</b> (carpeta “Backups MySQL RRHH”): 7 diarias + 4 semanales + 6 mensuales; binlogs 7 días. Nunca pisa archivos ya subidos.</li>
        </ul>

        <b>Bases excluidas a propósito</b>
        <ul style={{ margin: '4px 0 10px 18px' }}>
          <li><code>personalv5_dev</code> (copia de desarrollo), <code>personalv5_test</code> (pruebas), <code>sakila</code> (ejemplo de MySQL), <code>restore_prueba</code> (la usa la prueba de restauración).</li>
        </ul>

        <b style={{ color: COLOR.aviso }}>Lo que este backup NO cubre (solo es MySQL)</b>
        <ul style={{ margin: '4px 0 10px 18px' }}>
          <li>Documentos escaneados y archivos: DOCU por DNI, <code>D:\G</code>, PDFs de resoluciones/juntas, adjuntos en disco.</li>
          <li>Los <code>.env</code> de la app (dev, prod, scanner, farmacia) y el <code>.env</code> / <code>rclone.conf</code> del propio backup.</li>
          <li>Robots: scripts, perfiles de Chrome, logs. Bases Access por ODBC. Tareas de Windows y configuración de pm2.</li>
        </ul>

        <b style={{ color: COLOR.error }}>Pendiente</b>
        <ul style={{ margin: '4px 0 0 18px' }}>
          <li>Guardar <code>BK_CLAVE</code> fuera del servidor (gestor de contraseñas o papel). Sin ella las copias de Drive no sirven si se pierde el servidor.</li>
          <li>La clave de root de MySQL está en el <code>.env</code> de scanner1-prod: conviene sacarla.</li>
        </ul>
      </div>
    </>
  );
}

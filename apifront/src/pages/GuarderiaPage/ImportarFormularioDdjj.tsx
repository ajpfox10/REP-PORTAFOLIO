// src/pages/GuarderiaPage/ImportarFormularioDdjj.tsx
// Importa a la DDJJ de guardería las respuestas del formulario de Google: se sube el
// Excel/CSV bajado de la planilla de respuestas, se revisa la vista previa y se confirma.
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

const CAMPOS: Record<string, string> = {
  ninos_a_cargo: 'Niños a cargo', condicion_tutela: 'Tutela/guarda', motivo_no_ingresa: 'Motivo',
  lugar: 'Lugar', fecha: 'Fecha',
  otro_apellido_nombre: 'Otro prog.', otro_documento: 'Otro prog. DNI', otro_domicilio: 'Otro prog. domicilio',
  otro_fecha_nacimiento: 'Otro prog. nac.', otro_estado_civil: 'Otro prog. estado civil',
  otro_nacionalidad: 'Otro prog. nacionalidad', otro_lugar_trabajo: 'Otro prog. trabajo',
};

const ESTADOS: Record<string, { label: string; color: string }> = {
  OK:           { label: 'Para importar', color: '#34d399' },
  NO_EXISTE:    { label: 'DNI no está en el sistema', color: '#f87171' },
  DNI_INVALIDO: { label: 'DNI inválido', color: '#f87171' },
  REEMPLAZADA:  { label: 'Hay una respuesta posterior', color: 'rgba(255,255,255,0.4)' },
};

// Celdas de fecha de Excel → texto 'YYYY-MM-DD HH:mm:ss' (hora local, como la muestra la planilla)
const celda = (v: any) => {
  if (!(v instanceof Date)) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
};

export function ImportarFormularioDdjj({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [archivo, setArchivo] = useState('');
  const [filas, setFilas] = useState<any[]>([]);
  const [plan, setPlan] = useState<any[] | null>(null);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [pisar, setPisar] = useState(false);
  const [cargando, setCargando] = useState(false);

  const leerArchivo = async (file: File) => {
    setCargando(true);
    setPlan(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const crudas = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: true });
      const limpias = crudas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, celda(v)])));
      if (!limpias.length) throw new Error('La planilla no tiene respuestas');
      if (!Object.keys(limpias[0]).some(k => k.trim().toUpperCase() === 'DNI'))
        throw new Error('No encuentro la columna "DNI": ¿es la planilla de respuestas del formulario?');
      const res = await apiFetch<{ ok: boolean; data: any[] }>('/guarderia-ddjj/importar-formulario/preview', {
        method: 'POST', body: JSON.stringify({ filas: limpias }), headers: { 'Content-Type': 'application/json' },
      });
      setArchivo(file.name);
      setFilas(limpias);
      setPlan(res.data);
      setElegidos(new Set(res.data.filter(r => r.estado === 'OK').map(r => r.dni)));
    } catch (e: any) {
      toast.error('No se pudo leer el archivo', e?.message);
    } finally {
      setCargando(false);
    }
  };

  const importar = async () => {
    if (!elegidos.size) return;
    if (!window.confirm(`¿Importar ${elegidos.size} DDJJ de guardería?${pisar ? '\nSe van a PISAR los datos y menores que difieran.' : ''}`)) return;
    setCargando(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: any }>('/guarderia-ddjj/importar-formulario/confirmar', {
        method: 'POST', body: JSON.stringify({ filas, dnis: [...elegidos], pisar }),
        headers: { 'Content-Type': 'application/json' },
      });
      const r = res.data;
      toast.ok('Importación terminada',
        `${r.agentes} DDJJ: ${r.nuevas} nueva(s), ${r.actualizadas} actualizada(s), ${r.menores} menor(es)`);
      onClose();
    } catch (e: any) {
      toast.error('Error al importar', e?.message);
    } finally {
      setCargando(false);
    }
  };

  const toggle = (dni: number) => setElegidos(s => {
    const n = new Set(s);
    n.has(dni) ? n.delete(dni) : n.add(dni);
    return n;
  });

  const okRows = plan?.filter(r => r.estado === 'OK') ?? [];
  const conConflictos = okRows.filter(r => r.conflictos?.length || r.menoresAccion === 'EXISTEN').length;
  const th: React.CSSProperties = { padding: '5px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.5)',
    fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'top' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && !cargando && onClose()}>
      <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 24, width: '100%', maxWidth: 1150,
        maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: '0.95rem' }}>Importar DDJJ de guardería desde el formulario de Google</strong>
          <button onClick={onClose} disabled={cargando}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 12 }}>
          En la planilla de respuestas: <b>Archivo → Descargar → Microsoft Excel (.xlsx)</b> y subilo acá.
          Los datos del agente salen del sistema; del formulario se toman niños a cargo, tutela, motivo,
          otro progenitor, menores y lugar. Si el agente ya tiene DDJJ, solo se completan los vacíos.
          Nada se guarda hasta confirmar.
        </div>

        <input type="file" accept=".xlsx,.xls,.csv" disabled={cargando}
          onChange={e => { const f = e.target.files?.[0]; if (f) leerArchivo(f); e.target.value = ''; }} />
        {cargando && <span className="muted" style={{ marginLeft: 10, fontSize: '0.8rem' }}>⏳ Procesando…</span>}

        {plan && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '14px 0 8px', fontSize: '0.8rem' }}>
              <span><b>{archivo}</b> — {plan.length} respuesta(s)</span>
              <span style={{ color: '#34d399' }}>{okRows.length} para importar</span>
              {plan.length - okRows.length > 0 && (
                <span style={{ color: '#f87171' }}>{plan.length - okRows.length} no se importan</span>
              )}
              {conConflictos > 0 && <span style={{ color: '#fbbf24' }}>{conConflictos} con datos distintos a la DDJJ guardada</span>}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th style={th}>
                      <input type="checkbox" aria-label="Seleccionar todos"
                        checked={okRows.length > 0 && elegidos.size === okRows.length}
                        onChange={e => setElegidos(new Set(e.target.checked ? okRows.map(r => r.dni) : []))} />
                    </th>
                    <th style={th}>Fila</th><th style={th}>DNI</th><th style={th}>Agente</th><th style={th}>Estado</th>
                    <th style={th}>DDJJ</th><th style={th}>Datos nuevos</th><th style={th}>Distintos a lo guardado</th>
                    <th style={th}>Menores</th><th style={th}>WhatsApp</th><th style={th}>Avisos</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(r => {
                    const est = ESTADOS[r.estado] ?? { label: r.estado, color: '#fff' };
                    const ok = r.estado === 'OK';
                    const nMen = r.menoresFormulario?.length ?? 0;
                    return (
                      <tr key={r.fila} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', opacity: ok ? 1 : 0.6 }}>
                        <td style={td}>{ok && <input type="checkbox" aria-label={`Importar ${r.dni}`}
                          checked={elegidos.has(r.dni)} onChange={() => toggle(r.dni)} />}</td>
                        <td style={td}>{r.fila}</td>
                        <td style={td}>{r.dni ?? '—'}</td>
                        <td style={td}>{r.nombreSistema ?? r.nombreFormulario ?? '—'}</td>
                        <td style={{ ...td, color: est.color, whiteSpace: 'nowrap' }}>{est.label}</td>
                        <td style={td}>{ok ? (r.tieneDdjj ? 'Ya guardada' : 'Nueva') : ''}</td>
                        <td style={td}>{ok ? Object.keys(r.datosNuevos).length : ''}</td>
                        <td style={td}>
                          {ok && r.conflictos.map((c: any) => (
                            <div key={c.campo} style={{ color: '#fbbf24' }}>
                              {CAMPOS[c.campo] ?? c.campo}: <s>{String(c.actual)}</s> → {String(c.nuevo)}
                            </div>
                          ))}
                        </td>
                        <td style={{ ...td, color: r.menoresAccion === 'EXISTEN' ? '#fbbf24' : undefined }}>
                          {ok && nMen > 0 && (r.menoresAccion === 'EXISTEN'
                            ? `${nMen} (ya hay menores cargados)` : `${nMen} nuevo(s)`)}
                        </td>
                        <td style={td}>{r.whatsapp ?? ''}</td>
                        <td style={{ ...td, color: '#fbbf24' }}>{ok && r.avisos.join(' · ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={pisar} onChange={e => setPisar(e.target.checked)} />
                Pisar con lo del formulario los datos distintos (y reemplazar los menores ya cargados)
              </label>
              <button onClick={importar} disabled={cargando || !elegidos.size}
                style={{ background: elegidos.size ? 'rgba(37,99,235,0.8)' : 'rgba(255,255,255,0.1)', color: '#fff',
                  border: 'none', borderRadius: 6, padding: '8px 20px', cursor: elegidos.size ? 'pointer' : 'not-allowed',
                  fontSize: '0.82rem', fontWeight: 600 }}>
                Importar {elegidos.size} DDJJ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

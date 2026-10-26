// src/pages/FeriadosPage/index.tsx
// Feriados por año (tablas feriados + feriados_anios, mig 091). Solo administradores (crud:*:*).
// Un año cuenta como cargado recién cuando se confirma completo: si al 4.º día hábil de enero el año
// en curso no está confirmado, la app se bloquea para los administradores hasta confirmarlo
// (AlertasJubilacionBloqueo) y el robot de ausentes de la Intranet no carga ese año.
import React, { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type Tipo = 'nacional' | 'provincial' | 'puente' | 'trasladable' | 'no_laborable';
const TIPOS: { v: Tipo; label: string }[] = [
  { v: 'nacional', label: 'Nacional' },
  { v: 'trasladable', label: 'Trasladable' },
  { v: 'puente', label: 'Puente' },
  { v: 'provincial', label: 'Provincial' },
  { v: 'no_laborable', label: 'No laborable' },
];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

interface Feriado { id: number; fecha: string; nombre: string; tipo: Tipo }
interface Anio { anio: number; cantidad: number; confirmado: number }
interface Confirmacion { anio: number; confirmado_por_nombre: string | null; confirmado_at: string }

const sel: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: '#1e293b', color: 'inherit', fontSize: '0.82rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.85rem' };

const fmt = (f: string) => f.split('-').reverse().join('/');
const diaSemana = (f: string) => DIAS[new Date(`${f}T12:00:00`).getDay()];

export function FeriadosPage() {
  const toast = useToast();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [anios, setAnios] = useState<Anio[]>([]);
  const [conf, setConf] = useState<Confirmacion | null>(null);
  const [corte, setCorte] = useState('');
  const [nuevo, setNuevo] = useState<{ fecha: string; nombre: string; tipo: Tipo }>({ fecha: '', nombre: '', tipo: 'nacional' });
  const [editando, setEditando] = useState<Feriado | null>(null);

  const cargar = async (a = anio) => {
    try {
      const r = await apiFetch<any>(`/feriados?anio=${a}`);
      setFeriados(r.data || []);
      setAnios(r.anios || []);
      setConf(r.confirmacion || null);
      setCorte(r.corte || '');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudieron leer los feriados');
    }
  };
  useEffect(() => { cargar(anio); }, [anio]);

  const opcionesAnio = Array.from(new Set([
    ...anios.map(a => a.anio), new Date().getFullYear(), new Date().getFullYear() + 1, anio,
  ])).sort((a, b) => b - a);

  const guardarNuevo = async () => {
    if (!nuevo.fecha || !nuevo.nombre.trim()) return toast.error('Falta la fecha o el nombre');
    try {
      await apiFetch('/feriados', { method: 'POST', body: JSON.stringify(nuevo) });
      toast.ok('Feriado agregado');
      setNuevo({ fecha: '', nombre: '', tipo: 'nacional' });
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo agregar');
    }
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    try {
      await apiFetch(`/feriados/${editando.id}`, { method: 'PUT', body: JSON.stringify(editando) });
      toast.ok('Feriado guardado');
      setEditando(null);
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    }
  };

  const borrar = async (f: Feriado) => {
    if (!window.confirm(`¿Borrar el feriado del ${fmt(f.fecha)} (${f.nombre})?`)) return;
    try {
      await apiFetch(`/feriados/${f.id}`, { method: 'DELETE' });
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo borrar');
    }
  };

  const traerFijos = async () => {
    try {
      const r = await apiFetch<any>(`/feriados/anio/${anio}/fijos`, { method: 'POST' });
      toast.ok(r.agregados ? `Se agregaron ${r.agregados} feriados de fecha fija` : 'Ya estaban todos los de fecha fija');
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudieron agregar');
    }
  };

  const confirmar = async () => {
    if (!window.confirm(`¿Confirmás que los feriados de ${anio} están completos (${feriados.length} días)?\nQueda registrado tu usuario.`)) return;
    try {
      await apiFetch(`/feriados/anio/${anio}/confirmar`, { method: 'POST' });
      toast.ok(`Feriados de ${anio} confirmados`);
      // el bloqueo del Layout se vuelve a consultar al recargar
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo confirmar');
    }
  };

  const desconfirmar = async () => {
    if (!window.confirm(`¿Dejar ${anio} sin confirmar? Si ya pasó el ${fmt(corte)}, se bloquea el sistema para los administradores.`)) return;
    try {
      await apiFetch(`/feriados/anio/${anio}/confirmar`, { method: 'DELETE' });
      await cargar();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo cambiar');
    }
  };

  return (
    <Layout title="Feriados" showBack>
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem' }}>Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={sel}>
            {opcionesAnio.map(a => {
              const info = anios.find(x => x.anio === a);
              return <option key={a} value={a}>{a}{info ? ` · ${info.cantidad} días${info.confirmado ? ' · confirmado' : ''}` : ' · sin cargar'}</option>;
            })}
          </select>
          <button type="button" className="btn" onClick={traerFijos}>Traer los de fecha fija</button>
          <div style={{ flex: 1 }} />
          {conf ? (
            <>
              <span className="badge" style={{ background: 'rgba(22,163,74,0.25)', color: '#86efac' }}>
                ✔ Confirmado por {conf.confirmado_por_nombre || '—'} el {conf.confirmado_at}
              </span>
              <button type="button" className="btn" onClick={desconfirmar} style={{ fontSize: '0.78rem' }}>Quitar confirmación</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={confirmar} disabled={!feriados.length}
              style={{ background: '#16a34a', color: '#fff', fontWeight: 700 }}>
              Confirmar {anio} completo
            </button>
          )}
        </div>

        {!conf && (
          <div style={{ marginTop: 10, fontSize: '0.82rem', color: '#fbbf24' }}>
            {anio} no está confirmado. Desde el {fmt(corte)} (4.º día hábil de enero) el sistema se bloquea para los administradores
            y el robot de ausentes no carga ese año hasta confirmarlo.
          </div>
        )}
        <div className="muted" style={{ marginTop: 6, fontSize: '0.78rem' }}>
          "Traer los de fecha fija" agrega 1/1, 24/3, 2/4, 1/5, 25/5, 20/6, 9/7, 8/12 y 25/12. Carnaval, Semana Santa,
          los trasladables y los puentes se cargan a mano según el decreto de cada año.
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr><th style={th}>Fecha</th><th style={th}>Día</th><th style={th}>Nombre</th><th style={th}>Tipo</th><th style={th} /></tr>
          </thead>
          <tbody>
            {feriados.map(f => editando?.id === f.id ? (
              <tr key={f.id}>
                <td style={td}><input type="date" value={editando.fecha} onChange={(e) => setEditando({ ...editando, fecha: e.target.value })} style={sel} /></td>
                <td style={td}>{editando.fecha ? diaSemana(editando.fecha) : ''}</td>
                <td style={td}><input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} style={{ ...sel, width: '100%' }} /></td>
                <td style={td}>
                  <select value={editando.tipo} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as Tipo })} style={sel}>
                    {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn" onClick={guardarEdicion}>Guardar</button>{' '}
                  <button type="button" className="btn" onClick={() => setEditando(null)}>Cancelar</button>
                </td>
              </tr>
            ) : (
              <tr key={f.id}>
                <td style={td}>{fmt(f.fecha)}</td>
                <td style={td}>{diaSemana(f.fecha)}</td>
                <td style={td}>{f.nombre}</td>
                <td style={td}>{TIPOS.find(t => t.v === f.tipo)?.label ?? f.tipo}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn" onClick={() => setEditando(f)}>Editar</button>{' '}
                  <button type="button" className="btn danger" onClick={() => borrar(f)}>Borrar</button>
                </td>
              </tr>
            ))}
            {!feriados.length && (
              <tr><td style={td} colSpan={5} className="muted">No hay feriados cargados para {anio}.</td></tr>
            )}
            <tr>
              <td style={td}><input type="date" value={nuevo.fecha} min={`${anio}-01-01`} max={`${anio}-12-31`} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} style={sel} /></td>
              <td style={td}>{nuevo.fecha ? diaSemana(nuevo.fecha) : ''}</td>
              <td style={td}><input placeholder="Nombre del feriado" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} style={{ ...sel, width: '100%' }} /></td>
              <td style={td}>
                <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as Tipo })} style={sel}>
                  {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </td>
              <td style={td}><button type="button" className="btn" onClick={guardarNuevo}>+ Agregar</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

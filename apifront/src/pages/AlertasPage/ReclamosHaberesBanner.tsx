import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

export interface ReclamoHaberes {
  id: number;
  dni: number;
  agente_nombre: string | null;
  ley_id: number | null;
  ley_nombre: string | null;
  fecha_baja: string;
  estado: 'PENDIENTE' | 'RECLAMADO' | 'OMITIDO';
  reclamado_at: string | null;
  reclamado_por_nombre: string | null;
}

export function fmtBajaFecha(fecha: string) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return fecha || '';
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
}

export async function cargarReclamosHaberes(estado = 'pendientes') {
  const res = await apiFetch<any>(`/reclamos-haberes?estado=${estado}`);
  return Array.isArray(res?.data) ? (res.data as ReclamoHaberes[]) : [];
}

export async function marcarReclamoHaberes(id: number, accion: 'reclamado' | 'omitir' | 'pendiente') {
  return apiFetch(`/reclamos-haberes/${id}/${accion}`, { method: 'POST' });
}

export function ReclamosHaberesDashboardBanner() {
  const toast = useToast();
  const [rows, setRows] = useState<ReclamoHaberes[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setRows(await cargarReclamosHaberes('pendientes'));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (row: ReclamoHaberes, accion: 'reclamado' | 'omitir') => {
    setLoadingId(row.id);
    try {
      await marcarReclamoHaberes(row.id, accion);
      setRows(prev => prev.filter(r => r.id !== row.id));
      toast.ok(accion === 'reclamado' ? 'Reclamo marcado como hecho' : 'Reclamo omitido');
    } catch (e: any) {
      toast.error('No se pudo actualizar el reclamo', e?.message || 'Error');
    } finally {
      setLoadingId(null);
    }
  };

  if (dismissed || rows.length === 0) return null;

  const mostradas = rows.slice(0, 6);
  const restantes = rows.length - mostradas.length;

  return (
    <div style={{
      margin: '0 0 16px 0',
      padding: '14px 16px',
      background: 'rgba(234,179,8,0.12)',
      border: '2px solid rgba(234,179,8,0.42)',
      borderLeft: '5px solid #eab308',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>💰</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#fde047', marginBottom: 6 }}>
          Pendientes de reclamo de haberes: {rows.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {mostradas.map(row => (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto auto', gap: 8, alignItems: 'center', fontSize: '0.82rem' }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 800 }}>{row.agente_nombre || `DNI ${row.dni}`}</span>
                <span className="muted"> · DNI {row.dni}{row.ley_nombre ? ` · ${row.ley_nombre}` : ''} · Baja {fmtBajaFecha(row.fecha_baja)}</span>
              </div>
              <button className="btn" style={{ padding: '4px 10px', fontSize: '0.74rem', background: '#16a34a', color: '#fff' }} disabled={loadingId === row.id} onClick={() => cambiar(row, 'reclamado')}>
                Reclamado
              </button>
              <button className="btn" style={{ padding: '4px 10px', fontSize: '0.74rem' }} disabled={loadingId === row.id} onClick={() => cambiar(row, 'omitir')}>
                Omitir
              </button>
            </div>
          ))}
          {restantes > 0 && <div style={{ fontSize: '0.78rem', color: '#fde68a' }}>+{restantes} pendientes mas.</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fde68a' }}>
          Ver detalle en <Link to="/app/alertas" style={{ color: '#fde047', fontWeight: 800 }}>Alertas</Link>.
        </div>
      </div>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.55)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)}
        title="Cerrar"
      >x</button>
    </div>
  );
}

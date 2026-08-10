import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

export interface CumpleanosAlerta {
  dni: number;
  apellido: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  servicio_nombre: string | null;
  sector_nombre: string | null;
  anio: number;
  fecha_cumple: string;
  dias: number;
  estado_aviso: 'PENDIENTE' | 'AVISADO' | 'OMITIDO';
  avisado_at: string | null;
  avisado_por_nombre: string | null;
}

export function fmtCumpleFecha(fecha: string) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return fecha || '';
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
}

export function cumpleNombre(row: CumpleanosAlerta) {
  return [row.apellido, row.nombre].filter(Boolean).join(', ');
}

export async function cargarCumpleanosAlertas(estado = 'pendientes', dias = 7) {
  const res = await apiFetch<any>(`/alertas-cumpleanos?dias=${dias}&estado=${estado}`);
  return Array.isArray(res?.data) ? res.data as CumpleanosAlerta[] : [];
}

export async function marcarCumpleanos(dni: number, anio: number, accion: 'avisar' | 'omitir' | 'pendiente') {
  return apiFetch(`/alertas-cumpleanos/${dni}/${anio}/${accion}`, { method: 'POST' });
}

export function CumpleanosDashboardBanner() {
  const toast = useToast();
  const [rows, setRows] = useState<CumpleanosAlerta[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setRows(await cargarCumpleanosAlertas('pendientes', 0));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (row: CumpleanosAlerta, accion: 'avisar' | 'omitir') => {
    const id = `${row.dni}-${row.anio}`;
    setLoadingId(id);
    try {
      await marcarCumpleanos(row.dni, row.anio, accion);
      setRows(prev => prev.filter(r => !(r.dni === row.dni && r.anio === row.anio)));
      toast.ok(accion === 'avisar' ? 'Cumpleanos marcado como avisado' : 'Cumpleanos omitido');
    } catch (e: any) {
      toast.error('No se pudo actualizar cumpleanos', e?.message || 'Error');
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
      background: 'rgba(236,72,153,0.12)',
      border: '2px solid rgba(236,72,153,0.42)',
      borderLeft: '5px solid #ec4899',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🎂</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#f9a8d4', marginBottom: 6 }}>
          Cumpleanos de hoy sin avisar: {rows.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {mostradas.map(row => {
            const id = `${row.dni}-${row.anio}`;
            return (
              <div key={id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto auto', gap: 8, alignItems: 'center', fontSize: '0.82rem' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800 }}>{cumpleNombre(row)}</span>
                  <span className="muted"> · DNI {row.dni} · {fmtCumpleFecha(row.fecha_cumple)} · {row.dias === 0 ? 'hoy' : `en ${row.dias} dias`}</span>
                  {row.email && <span style={{ color: '#fbcfe8' }}> · {row.email}</span>}
                </div>
                <button className="btn" style={{ padding: '4px 10px', fontSize: '0.74rem', background: '#16a34a', color: '#fff' }} disabled={loadingId === id} onClick={() => cambiar(row, 'avisar')}>
                  Avisado
                </button>
                <button className="btn" style={{ padding: '4px 10px', fontSize: '0.74rem' }} disabled={loadingId === id} onClick={() => cambiar(row, 'omitir')}>
                  Omitir
                </button>
              </div>
            );
          })}
          {restantes > 0 && <div style={{ fontSize: '0.78rem', color: '#fbcfe8' }}>+{restantes} cumpleanos de hoy mas.</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fbcfe8' }}>
          Ver detalle en <Link to="/app/alertas" style={{ color: '#f9a8d4', fontWeight: 800 }}>Alertas</Link>.
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

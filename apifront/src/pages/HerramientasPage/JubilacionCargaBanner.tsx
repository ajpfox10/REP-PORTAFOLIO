/**
 * Banner de alerta de carga del trámite jubilatorio.
 *
 * Salta a mitad del hueco que queda entre la ventana de presentación de papeles
 * de un corte y la del siguiente: ahí es cuando hay que tener cargado el trámite
 * en SIAPE. El cálculo lo hace el backend (services/jubilacionCarga.service.ts)
 * a partir del cronograma del IPS.
 *
 * Tiene dos motivos:
 *   · IFGRA → el agente recién entró al registro y todavía no tiene cargados
 *             los dos informes gráficos. No espera al cronograma: se carga
 *             desde el propio banner y ahí se tilda el paso.
 *   · CARGA → el resto de los pasos, según el cronograma del IPS.
 *
 * No tiene botón de cerrar a propósito. Sale de la vista de dos maneras:
 *   · OK  → acuse del usuario que lo mira; se lo esconde a él hasta mañana,
 *           queda registrado quién avisó y el resto lo sigue viendo.
 *   · Se cierra de verdad cuando están tildados todos los pasos de la ficha.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { FormNumeros } from './ChecklistNumeros';

export interface AlertaCarga {
  id: number;
  dni: number;
  apellido: string;
  nombre: string;
  mes_corte: string | null;
  estado: string;
  /** IFGRA = recien agregado, faltan los informes graficos. CARGA = cronograma del IPS. */
  motivo: 'IFGRA' | 'CARGA';
  periodo: string;
  fecha_alerta: string | null;
  items_faltantes: string[];
  items_hechos: string[];
  ok_dados: Array<{ por: string | null; el: string }>;
}

const LABEL_ITEM: Record<string, string> = {
  DOCUMENTACION: 'Documentación',
  IFGRA:         'IFGRA',
  EXPEDIENTE_GDEBA:'Expediente GDEBA',
  SIAPE:         'SIAPE',
  INTRANET:      'Intranet',
  RESOLUCION:    'Resolución',
  EXPEDIENTE_IPS:'Expediente IPS',
};

const fmtFechaISO = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
};

export async function cargarAlertasCarga(): Promise<AlertaCarga[]> {
  const res = await apiFetch<any>('/jubilacion/alerta-carga');
  return Array.isArray(res?.data) ? res.data as AlertaCarga[] : [];
}

export function JubilacionCargaBanner() {
  const toast = useToast();
  const [rows, setRows] = useState<AlertaCarga[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  // Fila que esta cargando sus dos informes graficos desde el banner.
  const [pidiendoIfgra, setPidiendoIfgra] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try { setRows(await cargarAlertasCarga()); }
    catch { setRows([]); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const darOk = async (row: AlertaCarga) => {
    setLoadingId(row.id);
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${row.id}/alerta-ok`, { method: 'POST' });
      if (res?.ok) {
        setRows(prev => prev.filter(r => r.id !== row.id));
        toast.ok('OK registrado. El aviso vuelve mañana si el trámite sigue sin cargar.');
      } else {
        toast.error(res?.error ?? 'No se pudo registrar el OK');
      }
    } catch (e: any) {
      toast.error('No se pudo registrar el OK', e?.message || 'Error');
    } finally {
      setLoadingId(null);
    }
  };

  // Cargar los dos IFGRA desde el banner: los guarda, tilda el paso y saca la
  // fila del aviso (el backend la deja de devolver).
  const guardarIfgra = async (row: AlertaCarga, numeros: Record<string, string>) => {
    setLoadingId(row.id);
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${row.id}/checklist`, {
        method: 'PUT',
        body: JSON.stringify({ item: 'IFGRA', tildado: true, numeros }),
      });
      if (res?.ok) {
        setPidiendoIfgra(null);
        toast.ok('Informes gráficos cargados', 'Quedaron como expedientes del agente.');
        await cargar();
      } else {
        toast.error(res?.error ?? 'No se pudieron guardar los informes');
      }
    } catch (e: any) {
      toast.error('No se pudieron guardar los informes', e?.message || 'Error');
    } finally {
      setLoadingId(null);
    }
  };

  if (rows.length === 0) return null;

  const mostradas = rows.slice(0, 6);
  const restantes = rows.length - mostradas.length;

  return (
    <div style={{
      margin: '0 0 16px 0',
      padding: '14px 16px',
      background: 'rgba(239,68,68,0.12)',
      border: '2px solid rgba(239,68,68,0.42)',
      borderLeft: '5px solid #ef4444',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🚨</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#fca5a5', marginBottom: 6 }}>
          Alerta de carga · jubilaciones con trámite incompleto: {rows.length}
          {rows.some(r => r.motivo === 'IFGRA') && (
            <span style={{ fontWeight: 600, color: '#fecaca' }}>
              {' '}· {rows.filter(r => r.motivo === 'IFGRA').length} sin informes gráficos
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {mostradas.map(row => (
            <div key={row.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto',
              gap: 8, alignItems: 'center', fontSize: '0.82rem',
            }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 800 }}>{row.apellido}, {row.nombre}</span>
                <span className="muted">
                  {' '}· DNI {row.dni}
                  {row.mes_corte    && ` · corte ${row.mes_corte.toLowerCase()}`}
                  {row.fecha_alerta && ` · avisa desde ${fmtFechaISO(row.fecha_alerta)}`}
                </span>
                <div style={{ color: '#fecaca', fontSize: '0.78rem' }}>
                  {row.motivo === 'IFGRA'
                    ? 'Faltan los dos informes gráficos (IFGRA).'
                    : `Falta: ${row.items_faltantes.map(i => LABEL_ITEM[i] ?? i).join(' · ')}`}
                </div>
                {row.ok_dados.length > 0 && (
                  <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                    OK de {row.ok_dados.map(o => o.por || 'usuario').join(', ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {row.motivo === 'IFGRA' && (
                  <button
                    className="btn"
                    style={{ padding: '4px 14px', fontSize: '0.74rem', background: '#0284c7', color: '#fff' }}
                    disabled={loadingId === row.id}
                    onClick={() => setPidiendoIfgra(p => p === row.id ? null : row.id)}
                  >Cargar IFGRA</button>
                )}
                <button
                  className="btn"
                  style={{ padding: '4px 14px', fontSize: '0.74rem', background: '#16a34a', color: '#fff' }}
                  disabled={loadingId === row.id}
                  onClick={() => darOk(row)}
                >OK</button>
              </div>
              {pidiendoIfgra === row.id && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <FormNumeros
                    item="IFGRA"
                    guardando={loadingId === row.id}
                    onGuardar={numeros => guardarIfgra(row, numeros)}
                    onCancelar={() => setPidiendoIfgra(null)}
                  />
                </div>
              )}
            </div>
          ))}
          {restantes > 0 && <div style={{ fontSize: '0.78rem', color: '#fecaca' }}>+{restantes} más.</div>}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fecaca' }}>
          Tildar los pasos en <Link to="/app/herramientas" style={{ color: '#fca5a5', fontWeight: 800 }}>Posibles Jubilados</Link>.
          El aviso se va solo cuando están todos.
        </div>
      </div>
    </div>
  );
}

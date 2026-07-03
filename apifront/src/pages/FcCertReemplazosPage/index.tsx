// src/pages/FcCertReemplazosPage/index.tsx
// FC - Certificación de Servicios - Reemplazo de Guardias
// Visible solo para admin (crud:*:*) y user con crud:fc_cert_reemplazos:read

import React, { useState, useCallback, useEffect } from 'react';
import { Layout }   from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { useAuth }  from '../../auth/AuthProvider';

type Seccion = 'FRANCOS_COMPENSATORIOS' | 'CERTIFICACION_SERVICIOS' | 'REEMPLAZOS_GUARDIA';

interface Registro {
  id: number;
  anio: number;
  seccion: Seccion;
  agente: string;
  enero:      string | null;
  febrero:    string | null;
  marzo:      string | null;
  abril:      string | null;
  mayo:       string | null;
  junio:      string | null;
  julio:      string | null;
  agosto:     string | null;
  septiembre: string | null;
  octubre:    string | null;
  noviembre:  string | null;
  diciembre:  string | null;
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'] as const;
type Mes = typeof MESES[number];

const MESES_CORTOS: Record<Mes, string> = {
  enero:'ENE', febrero:'FEB', marzo:'MAR', abril:'ABR', mayo:'MAY', junio:'JUN',
  julio:'JUL', agosto:'AGO', septiembre:'SEP', octubre:'OCT', noviembre:'NOV', diciembre:'DIC',
};

const SECCIONES: { key: Seccion; label: string }[] = [
  { key: 'FRANCOS_COMPENSATORIOS',  label: 'Francos Compensatorios' },
  { key: 'CERTIFICACION_SERVICIOS', label: 'Certificación de Servicios' },
  { key: 'REEMPLAZOS_GUARDIA',      label: 'Reemplazos de Guardia' },
];

const SECCION_COLORS: Record<Seccion, string> = {
  FRANCOS_COMPENSATORIOS:  '#1e40af',
  CERTIFICACION_SERVICIOS: '#065f46',
  REEMPLAZOS_GUARDIA:      '#7c2d12',
};

const AÑO_ACTUAL = new Date().getFullYear();

const S: Record<string, React.CSSProperties> = {
  card:   { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 16, marginBottom: 14 },
  label:  { fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:  { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box', fontSize: '0.85rem' } as React.CSSProperties,
  btn:    { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  th:     { padding: '5px 7px', textAlign: 'center', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', whiteSpace: 'nowrap' } as React.CSSProperties,
  td:     { padding: '3px 5px', textAlign: 'center', fontSize: '0.78rem' },
  tdName: { padding: '4px 10px', textAlign: 'left', fontSize: '0.8rem', whiteSpace: 'nowrap' } as React.CSSProperties,
};

function ValorCell({ val }: { val: string | null }) {
  const v = (val ?? '').trim().toUpperCase();
  const isSi = v === 'SI' || v === 'S';
  const isEmpty = !v;

  const bg = isEmpty
    ? 'transparent'
    : isSi
    ? 'rgba(16,185,129,0.18)'
    : 'rgba(239,68,68,0.16)';

  const color = isEmpty ? '#475569' : isSi ? '#34d399' : '#f87171';

  return (
    <td style={{ ...S.td, background: bg }}>
      <span style={{ color, fontWeight: isSi ? 700 : 400, fontSize: '0.72rem' }}>
        {isEmpty ? '—' : (val ?? '').trim()}
      </span>
    </td>
  );
}

const REGISTRO_VACIO: Omit<Registro, 'id' | 'created_at' | 'updated_at'> = {
  anio: AÑO_ACTUAL,
  seccion: 'REEMPLAZOS_GUARDIA',
  agente: '',
  enero: null, febrero: null, marzo: null, abril: null, mayo: null, junio: null,
  julio: null, agosto: null, septiembre: null, octubre: null, noviembre: null, diciembre: null,
};

export function FcCertReemplazosPage() {
  const toast = useToast();
  const { hasPerm } = useAuth();
  const esAdmin = hasPerm('crud:*:*');

  const [data,     setData]     = useState<Registro[]>([]);
  const [cargando, setCargando] = useState(false);
  const [anioFiltro,    setAnioFiltro]    = useState<string>(String(AÑO_ACTUAL));
  const [seccionFiltro, setSeccionFiltro] = useState<string>('');
  const [qFiltro,       setQFiltro]       = useState('');

  const [showForm,  setShowForm]  = useState(false);
  const [editando,  setEditando]  = useState<Registro | null>(null);
  const [form,      setForm]      = useState<typeof REGISTRO_VACIO>({ ...REGISTRO_VACIO });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (anioFiltro)    params.set('anio',    anioFiltro);
      if (seccionFiltro) params.set('seccion', seccionFiltro);
      if (qFiltro)       params.set('q',       qFiltro);

      const res = await apiFetch<{ ok: boolean; data: Registro[] }>(`/fc-cert-reemplazos?${params}`);
      setData(Array.isArray(res?.data) ? res.data : []);
    } catch (e: unknown) {
      toast.error('Error al cargar: ' + (e instanceof Error ? e.message : 'Error'));
    } finally {
      setCargando(false);
    }
  }, [anioFiltro, seccionFiltro, qFiltro, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ ...REGISTRO_VACIO });
    setShowForm(true);
  };

  const abrirEditar = (r: Registro) => {
    setEditando(r);
    const { id: _id, ...rest } = r as Registro & { id: number };
    setForm(rest as typeof REGISTRO_VACIO);
    setShowForm(true);
  };

  const guardar = async () => {
    if (!form.agente.trim()) return toast.error('El nombre del agente es requerido');
    setGuardando(true);
    try {
      if (editando) {
        await apiFetch(`/fc-cert-reemplazos/${editando.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        toast.ok('Registro actualizado');
      } else {
        await apiFetch('/fc-cert-reemplazos', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast.ok('Registro creado');
      }
      setShowForm(false);
      cargar();
    } catch (e: unknown) {
      toast.error('Error: ' + (e instanceof Error ? e.message : 'Error'));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (r: Registro) => {
    if (!window.confirm(`¿Eliminar "${r.agente}"?`)) return;
    try {
      await apiFetch(`/fc-cert-reemplazos/${r.id}`, { method: 'DELETE' });
      toast.ok('Eliminado');
      cargar();
    } catch (e: unknown) {
      toast.error('Error: ' + (e instanceof Error ? e.message : 'Error'));
    }
  };

  // Agrupar por sección para mostrar en bloques
  const porSeccion = SECCIONES.map(s => ({
    ...s,
    rows: data.filter(r => r.seccion === s.key),
  })).filter(s => !seccionFiltro || s.key === seccionFiltro);

  return (
    <Layout title="FC / Cert. Servicios / Reemplazos" showBack>
      <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>

        {/* Encabezado */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 4 }}>
            FC – Cert. Servicios – Reemplazo de Guardias
          </h1>
          <p style={{ fontSize: '0.76rem', color: '#94a3b8', margin: 0 }}>
            Seguimiento mensual de Francos Compensatorios, Certificación de Servicios y Reemplazos de Guardia.
          </p>
        </div>

        {/* Filtros */}
        <div style={{ ...S.card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 90 }}>
            <label style={S.label}>Año</label>
            <input
              style={{ ...S.input, width: 90 }}
              type="number"
              value={anioFiltro}
              onChange={e => setAnioFiltro(e.target.value)}
              min={2020}
              max={2099}
            />
          </div>
          <div style={{ minWidth: 220 }}>
            <label style={S.label}>Sección</label>
            <select style={S.input} value={seccionFiltro} onChange={e => setSeccionFiltro(e.target.value)}>
              <option value="">Todas las secciones</option>
              {SECCIONES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={S.label}>Buscar agente</label>
            <input
              style={S.input}
              placeholder="Apellido o nombre..."
              value={qFiltro}
              onChange={e => setQFiltro(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && cargar()}
            />
          </div>
          <button
            style={{ ...S.btn, background: '#1e40af', color: '#fff' }}
            onClick={cargar}
            disabled={cargando}
          >
            {cargando ? 'Cargando...' : 'Buscar'}
          </button>
          {esAdmin && (
            <button
              style={{ ...S.btn, background: '#065f46', color: '#fff' }}
              onClick={abrirNuevo}
            >
              + Nuevo
            </button>
          )}
        </div>

        {/* Formulario (nuevo / editar) */}
        {showForm && (
          <div style={{ ...S.card, border: '1px solid rgba(255,255,255,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: 14, color: '#94a3b8' }}>
              {editando ? `Editar: ${editando.agente}` : 'Nuevo registro'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={S.label}>Año</label>
                <input style={S.input} type="number" value={form.anio}
                  onChange={e => setForm(f => ({ ...f, anio: parseInt(e.target.value) || AÑO_ACTUAL }))} />
              </div>
              <div>
                <label style={S.label}>Sección</label>
                <select style={S.input} value={form.seccion}
                  onChange={e => setForm(f => ({ ...f, seccion: e.target.value as Seccion }))}>
                  {SECCIONES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={S.label}>Agente</label>
                <input style={S.input} value={form.agente}
                  onChange={e => setForm(f => ({ ...f, agente: e.target.value }))}
                  placeholder="Apellido Nombre / Departamento..." />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
              {MESES.map(m => (
                <div key={m}>
                  <label style={S.label}>{MESES_CORTOS[m]}</label>
                  <input
                    style={{ ...S.input, padding: '5px 8px' }}
                    value={form[m] ?? ''}
                    onChange={e => setForm(f => ({ ...f, [m]: e.target.value || null }))}
                    placeholder="SI / NO"
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                style={{ ...S.btn, background: guardando ? '#374151' : '#065f46', color: '#fff' }}
                onClick={guardar}
                disabled={guardando}
              >
                {guardando ? 'Guardando...' : editando ? 'Actualizar' : 'Crear'}
              </button>
              <button
                style={{ ...S.btn, background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}
                onClick={() => setShowForm(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Tablas por sección */}
        {cargando ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Cargando...</div>
        ) : data.length === 0 ? (
          <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 40 }}>
            Sin registros para los filtros seleccionados.
          </div>
        ) : (
          porSeccion.map(sec => sec.rows.length === 0 ? null : (
            <div key={sec.key} style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              {/* Header sección */}
              <div style={{
                background: SECCION_COLORS[sec.key],
                padding: '10px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {sec.label}
                </span>
                <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>{sec.rows.length} agentes</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
                      <th style={{ ...S.th, textAlign: 'left', minWidth: 200 }}>Agente</th>
                      {MESES.map(m => <th key={m} style={S.th}>{MESES_CORTOS[m]}</th>)}
                      {esAdmin && <th style={S.th}>Acc.</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={S.tdName}>{r.agente}</td>
                        {MESES.map(m => <ValorCell key={m} val={r[m]} />)}
                        {esAdmin && (
                          <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => abrirEditar(r)}
                              style={{ ...S.btn, padding: '3px 10px', fontSize: '0.7rem', background: '#1e40af', color: '#fff', marginRight: 4 }}
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminar(r)}
                              style={{ ...S.btn, padding: '3px 8px', fontSize: '0.7rem', background: '#450a0a', color: '#fca5a5' }}
                            >
                              ×
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}

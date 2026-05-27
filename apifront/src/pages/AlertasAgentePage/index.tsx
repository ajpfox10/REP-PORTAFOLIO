// src/pages/AlertasAgentePage/index.tsx
// Gestión de alertas manuales por agente (RRHH interno)

import React, { useState, useCallback, useEffect } from 'react';
import { Layout }          from '../../components/Layout';
import { apiFetch }        from '../../api/http';
import { searchPersonal }  from '../../api/searchPersonal';
import { useToast }        from '../../ui/toast';

interface Alerta {
  id:                number;
  dni:               number;
  titulo:            string;
  mensaje:           string;
  urgente:           number;
  activa:            number;
  creado_por:        number | null;
  creado_por_nombre: string | null;
  agente_nombre:     string | null;
  created_at:        string;
  visto_count:       number;
  cerrado_count:     number;
}

interface EstadoUsuario {
  usuario_id:  number;
  email:       string;
  nombre:      string | null;
  visto_at:    string | null;
  cerrado_at:  string | null;
}

const S: Record<string, React.CSSProperties> = {
  card:    { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, marginBottom: 12 },
  label:   { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:   { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  btn:     { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  badge:   { display: 'inline-block', borderRadius: 4, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 },
};

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function agenteLabel(ag: any) {
  const nombre = [ag?.apellido, ag?.nombre].filter(Boolean).join(', ');
  return nombre || (ag?.dni ? `DNI ${ag.dni}` : 'Agente seleccionado');
}

// Banner para Dashboard: resume alertas activas cargadas desde esta pagina.
export function AlertasAgenteDashboardBanner() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await apiFetch<any>('/alertas-agente?activas=true');
        const rows: Alerta[] = Array.isArray(res?.data) ? res.data : [];
        if (!alive) return;
        setAlertas(rows);
        setVisible(rows.length > 0);
      } catch {
        if (!alive) return;
        setAlertas([]);
        setVisible(false);
      }
    })();

    return () => { alive = false; };
  }, []);

  if (!visible || dismissed || !alertas.length) return null;

  const urgentes = alertas.filter(a => Number(a.urgente)).length;
  const mostradas = alertas.slice(0, 5);
  const restantes = alertas.length - mostradas.length;

  return (
    <div style={{
      margin: '0 0 16px 0',
      padding: '14px 16px',
      background: 'rgba(139,0,0,0.14)',
      border: '2px solid rgba(220,38,38,0.55)',
      borderLeft: '5px solid #dc2626',
      borderRadius: 12,
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '1.4rem', lineHeight: 1, fontWeight: 900, color: '#f87171' }}>!</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: '#f87171', marginBottom: 4 }}>
          Alertas por agente activas: {alertas.length}
          {urgentes > 0 ? ` (${urgentes} urgente${urgentes > 1 ? 's' : ''})` : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mostradas.map(a => (
            <div key={a.id} style={{ fontSize: '0.84rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                background: a.urgente ? '#8b0000' : 'rgba(180,83,9,0.25)',
                color: a.urgente ? '#fff' : '#fbbf24',
                borderRadius: 6,
                padding: '1px 7px',
                fontSize: '0.68rem',
                fontWeight: 800,
              }}>
                {a.urgente ? 'URGENTE' : 'ALERTA'}
              </span>
              <span style={{ fontWeight: 700 }}>{a.agente_nombre || `DNI ${a.dni}`}</span>
              <span className="muted">-</span>
              <span style={{ color: '#fecaca' }}>{a.titulo}</span>
              <span className="muted">-</span>
              <span className="muted">{fmt(a.created_at)}</span>
            </div>
          ))}
          {restantes > 0 && (
            <div style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
              +{restantes} alerta{restantes > 1 ? 's' : ''} mas.
            </div>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fca5a5' }}>
          Ir a <a href="/app/alertas-agente" style={{ color: '#f87171', textDecoration: 'underline', fontWeight: 700 }}>Alertas por Agente</a> para crear, desactivar o revisar estados.
        </div>
      </div>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: '1.1rem', padding: 0 }}
        onClick={() => setDismissed(true)}
        title="Cerrar"
      >x</button>
    </div>
  );
}

export function AlertasAgentePage() {
  const toast = useToast();

  // ── Form nueva alerta ─────────────────────────────────────────────────────
  const [dniBusqueda,    setDniBusqueda]    = useState('');
  const [nombreBusqueda, setNombreBusqueda] = useState('');
  const [matches,        setMatches]        = useState<any[]>([]);
  const [agenteSelec, setAgenteSelec] = useState<any | null>(null);
  const [buscando,    setBuscando]    = useState(false);

  const [titulo,   setTitulo]   = useState('');
  const [mensaje,  setMensaje]  = useState('');
  const [urgente,  setUrgente]  = useState(false);
  const [guardando, setGuardando] = useState(false);

  // ── Lista de alertas ──────────────────────────────────────────────────────
  const [alertas,      setAlertas]      = useState<Alerta[]>([]);
  const [cargando,     setCargando]     = useState(false);
  const [soloActivas,  setSoloActivas]  = useState(true);
  const [expandedId,   setExpandedId]   = useState<number | null>(null);
  const [estados,      setEstados]      = useState<Record<number, EstadoUsuario[]>>({});
  const [cargandoEst,  setCargandoEst]  = useState<number | null>(null);

  // ── Búsqueda de agente ────────────────────────────────────────────────────
  const seleccionarAgente = useCallback((ag: any) => {
    setAgenteSelec(ag);
    setMatches([]);
    setDniBusqueda(String(ag?.dni ?? ''));
    setNombreBusqueda(agenteLabel(ag));
  }, []);

  // ── Cargar alertas ────────────────────────────────────────────────────────
  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = String(dniOverride ?? dniBusqueda).replace(/\D/g, '');
    if (!clean) return toast.error('DNI invalido', 'Ingresa un DNI valido');

    setBuscando(true);
    setMatches([]);
    setAgenteSelec(null);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) {
        toast.error('Sin resultados', `No se encontro DNI ${clean}`);
        return;
      }
      seleccionarAgente({ ...res.data, dni: res.data.dni ?? Number(clean) });
    } catch (e: any) {
      toast.error('Error buscando agente', e?.message || 'Error');
    } finally {
      setBuscando(false);
    }
  }, [dniBusqueda, seleccionarAgente, toast]);

  const buscarPorNombre = useCallback(async () => {
    const q = nombreBusqueda.trim();
    if (!q) return toast.error('Busqueda invalida', 'Ingresa apellido y/o nombre');

    setBuscando(true);
    setMatches([]);
    setAgenteSelec(null);
    try {
      const results = await searchPersonal(q);
      setMatches(results.slice(0, 30));
      if (!results.length) toast.error('Sin resultados', `No se encontro "${q}"`);
    } catch (e: any) {
      toast.error('No se pudo buscar', e?.message || 'Error');
    } finally {
      setBuscando(false);
    }
  }, [nombreBusqueda, toast]);

  const limpiarAgente = useCallback(() => {
    setDniBusqueda('');
    setNombreBusqueda('');
    setMatches([]);
    setAgenteSelec(null);
  }, []);

  const cargarAlertas = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch<any>(`/alertas-agente?activas=${soloActivas}`);
      setAlertas(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('Error cargando alertas: ' + e?.message);
    } finally {
      setCargando(false);
    }
  }, [soloActivas, toast]);

  useEffect(() => { cargarAlertas(); }, [cargarAlertas]);

  // ── Crear alerta ──────────────────────────────────────────────────────────
  const crear = async () => {
    if (!agenteSelec) return toast.error('Seleccioná un agente');
    if (!titulo.trim()) return toast.error('Ingresá un título');
    if (!mensaje.trim()) return toast.error('Ingresá un mensaje');

    setGuardando(true);
    try {
      await apiFetch('/alertas-agente', {
        method: 'POST',
        body: JSON.stringify({ dni: agenteSelec.dni, titulo: titulo.trim(), mensaje: mensaje.trim(), urgente }),
      });
      toast.ok('Alerta creada');
      setTitulo(''); setMensaje(''); setUrgente(false);
      limpiarAgente();
      cargarAlertas();
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally {
      setGuardando(false);
    }
  };

  // ── Ver estados de una alerta ─────────────────────────────────────────────
  const verEstados = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (estados[id]) return;
    setCargandoEst(id);
    try {
      const res = await apiFetch<any>(`/alertas-agente/${id}/estados`);
      setEstados(prev => ({ ...prev, [id]: Array.isArray(res?.data) ? res.data : [] }));
    } catch { /* silencioso */ }
    finally { setCargandoEst(null); }
  };

  // ── Eliminar alerta ───────────────────────────────────────────────────────
  const eliminar = async (id: number) => {
    if (!window.confirm('¿Desactivar esta alerta para todos?')) return;
    try {
      await apiFetch(`/alertas-agente/${id}`, { method: 'DELETE' });
      toast.ok('Alerta desactivada');
      cargarAlertas();
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    }
  };

  return (
    <Layout title="Alertas por Agente" showBack>
      <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 40 }}>

        {/* ── Encabezado ── */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 4 }}>
            🚨 Alertas internas por agente
          </h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            Uso exclusivo RRHH. Las alertas aparecen como banner al consultar al agente en Gestión, Legajo, Documentos y Buscador.
          </p>
        </div>

        {/* ── Formulario nueva alerta ── */}
        <div style={{ ...S.card, borderColor: 'rgba(139,0,0,0.4)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
            Nueva alerta
          </div>

          {/* Buscar agente */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 0.8fr) minmax(240px, 1.4fr)', gap: 10 }}>
              <div>
                <label style={S.label}>DNI</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={S.input}
                    placeholder="Enter para buscar"
                    value={dniBusqueda}
                    onChange={e => setDniBusqueda(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                  />
                  <button
                    type="button"
                    style={{ ...S.btn, padding: '7px 10px', background: '#1e40af', color: '#fff', whiteSpace: 'nowrap' }}
                    onClick={() => buscarPorDni()}
                    disabled={buscando}
                  >
                    Buscar
                  </button>
                </div>
              </div>
              <div>
                <label style={S.label}>Apellido y nombre</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={S.input}
                    placeholder="Apellido Nombre (Enter)"
                    value={nombreBusqueda}
                    onChange={e => setNombreBusqueda(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                  />
                  <button
                    type="button"
                    style={{ ...S.btn, padding: '7px 10px', background: '#1e40af', color: '#fff', whiteSpace: 'nowrap' }}
                    onClick={buscarPorNombre}
                    disabled={buscando}
                  >
                    Buscar
                  </button>
                </div>
              </div>
            </div>

            {buscando && (
              <div style={{ marginTop: 8, fontSize: '0.76rem', color: '#64748b' }}>Buscando...</div>
            )}

            {agenteSelec && (
              <div style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(20,184,166,0.10)', border: '1px solid rgba(20,184,166,0.30)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{agenteLabel(agenteSelec)}</div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>DNI {agenteSelec.dni}</div>
                </div>
                <button type="button" style={{ ...S.btn, padding: '4px 10px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }} onClick={limpiarAgente}>
                  Limpiar
                </button>
              </div>
            )}

            {matches.length > 0 && (
              <div style={{ marginTop: 10, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
                {matches.map((s, i) => (
                  <button
                    key={`${s.dni ?? i}`}
                    type="button"
                    onClick={() => seleccionarAgente(s)}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 12px', cursor: 'pointer', fontSize: '0.83rem', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#e2e8f0' }}
                  >
                    <strong>{agenteLabel(s)}</strong>
                    <span style={{ color: '#64748b', marginLeft: 8, fontSize: '0.74rem' }}>DNI {s.dni}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Título */}
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Título</label>
            <input
              style={S.input}
              placeholder="Título breve de la alerta..."
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              maxLength={255}
            />
          </div>

          {/* Mensaje */}
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Mensaje</label>
            <textarea
              style={{ ...S.input, minHeight: 90, resize: 'vertical' as const }}
              placeholder="Descripción detallada..."
              value={mensaje}
              onChange={e => setMensaje(e.target.value)}
            />
          </div>

          {/* Urgente */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={urgente}
              onChange={e => setUrgente(e.target.checked)}
              style={{ width: 17, height: 17, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.85rem' }}>
              Marcar como <span style={{ fontWeight: 700, color: '#f87171' }}>URGENTE</span> (banner rojo destacado)
            </span>
          </label>

          <button
            style={{ ...S.btn, background: guardando ? '#374151' : '#8b0000', color: '#fff' }}
            onClick={crear}
            disabled={guardando}
          >
            {guardando ? '⏳ Guardando...' : '🚨 Crear alerta'}
          </button>
        </div>

        {/* ── Lista de alertas ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>
            Alertas {soloActivas ? 'activas' : 'todas'} ({alertas.length})
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={soloActivas} onChange={e => setSoloActivas(e.target.checked)} />
              Solo activas
            </label>
            <button style={{ ...S.btn, padding: '5px 12px', fontSize: '0.78rem', background: '#1e40af', color: '#fff' }}
              onClick={cargarAlertas} disabled={cargando}>
              {cargando ? '⏳' : '🔄'} Actualizar
            </button>
          </div>
        </div>

        {cargando ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Cargando...</div>
        ) : alertas.length === 0 ? (
          <div style={{ ...S.card, textAlign: 'center', color: '#64748b', padding: 40 }}>
            No hay alertas {soloActivas ? 'activas' : ''}.
          </div>
        ) : (
          alertas.map(a => (
            <div key={a.id} style={{
              ...S.card,
              borderLeft: `4px solid ${a.urgente ? '#8b0000' : '#b45309'}`,
              opacity: a.activa ? 1 : 0.5,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{a.urgente ? '🚨' : '⚠️'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    {a.urgente && (
                      <span style={{ ...S.badge, background: '#8b0000', color: '#fff' }}>URGENTE</span>
                    )}
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{a.titulo}</span>
                    <span style={{ ...S.badge, background: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                      DNI {a.dni}
                    </span>
                    {a.agente_nombre && (
                      <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{a.agente_nombre}</span>
                    )}
                    {!a.activa && (
                      <span style={{ ...S.badge, background: '#374151', color: '#94a3b8' }}>INACTIVA</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginBottom: 6, whiteSpace: 'pre-line' }}>
                    {a.mensaje}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>Creado: {fmt(a.created_at)}</span>
                    {a.creado_por_nombre && <span>Por: {a.creado_por_nombre}</span>}
                    <span
                      onClick={() => verEstados(a.id)}
                      style={{ color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Visto: {a.visto_count} · Cerrado: {a.cerrado_count} — ver detalle
                    </span>
                  </div>
                </div>

                {a.activa ? (
                  <button
                    onClick={() => eliminar(a.id)}
                    style={{ ...S.btn, padding: '4px 10px', fontSize: '0.74rem', background: '#450a0a', color: '#fca5a5', flexShrink: 0 }}
                  >
                    Desactivar
                  </button>
                ) : null}
              </div>

              {/* Panel estados */}
              {expandedId === a.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                  {cargandoEst === a.id ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Cargando...</div>
                  ) : (estados[a.id] ?? []).length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Ningún usuario la vio aún.</div>
                  ) : (
                    <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#64748b' }}>
                          {['Usuario', 'Email', 'Visto', 'Cerrado'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(estados[a.id] ?? []).map((e, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '4px 8px' }}>{e.nombre ?? '—'}</td>
                            <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{e.email}</td>
                            <td style={{ padding: '4px 8px', color: e.visto_at ? '#86efac' : '#64748b' }}>{fmt(e.visto_at)}</td>
                            <td style={{ padding: '4px 8px', color: e.cerrado_at ? '#fca5a5' : '#64748b' }}>{fmt(e.cerrado_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}

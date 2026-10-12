import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

type DiaRow = {
  id: number; reconocimiento_id: number; dni: string; nombre: string | null; fecha: string;
  estado: 'CARGADO' | 'YA_EXISTIA' | 'ERROR'; categoria: string | null; detalle: string | null;
  intentos: number; actualizado_en: string;
};
type Conteo = { estado: string; categoria: string; n: number; agotados: number | string | null };

const ESTADO_COLOR: Record<string, string> = { CARGADO: '#22c55e', YA_EXISTIA: '#38bdf8', ERROR: '#f87171' };
const ESTADO_LABEL: Record<string, string> = { CARGADO: 'Cargado', YA_EXISTIA: 'Ya existía', ERROR: 'Error' };
const CATEGORIA_LABEL: Record<string, string> = {
  YA_EXISTE: 'Ya existía en SiAPe',
  FALTA_FECHA: 'No tomó la fecha',
  COMBO_TIPO: 'Combo de tipo',
  TIPO_VACIO: 'Tipo no tomado',
  DATOS_EN_BLANCO: 'Datos en blanco',
  AVISO_VIEJO: 'Aviso de otro día',
  SIN_CONFIRMAR: 'SiAPe no confirmó',
  SUPERPOSICION: 'Se superpone',
  AGENTE_NO_ENCONTRADO: 'No está en SiAPe',
  NO_ABRIO_AGENTE: 'No pudo abrir el agente',
  OTRO: 'Otro',
};

const fmtFecha = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

/** Estado por día de la carga de francos (tabla siape_carga_dias, la llena el robot). */
function EstadoDiasCarga() {
  const toast = useToast();
  const [filas, setFilas] = useState<DiaRow[]>([]);
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [maxIntentos, setMaxIntentos] = useState(3);
  const [estado, setEstado] = useState('ERROR');
  const [categoria, setCategoria] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (estado) params.set('estado', estado);
      if (categoria) params.set('categoria', categoria);
      if (q.trim()) params.set('q', q.trim());
      const r = await apiFetch<{ ok: boolean; filas: DiaRow[]; conteos: Conteo[]; maxIntentos: number; error?: string }>(
        `/intranet/carga-francos/dias?${params.toString()}`);
      if (r?.ok) {
        setFilas(r.filas ?? []);
        setConteos(r.conteos ?? []);
        setMaxIntentos(r.maxIntentos ?? 3);
        setSel(new Set());
      } else toast.error(r?.error ?? 'No se pudo leer el estado de la carga');
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo leer el estado de la carga');
    } finally {
      setLoading(false);
    }
  }, [estado, categoria, q, toast]);

  useEffect(() => { cargar(); }, [estado, categoria]); // eslint-disable-line react-hooks/exhaustive-deps

  const porEstado = useMemo(() => {
    const m: Record<string, number> = {};
    conteos.forEach(c => { m[c.estado] = (m[c.estado] ?? 0) + Number(c.n); });
    return m;
  }, [conteos]);
  const errorPorCategoria = useMemo(
    () => conteos.filter(c => c.estado === 'ERROR').sort((a, b) => Number(b.n) - Number(a.n)),
    [conteos]);

  const seleccionables = filas.filter(f => f.estado === 'ERROR');
  const toggle = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const reintentar = async () => {
    if (!sel.size) return;
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string; error?: string }>('/intranet/carga-francos/reintentar', {
        method: 'POST', body: JSON.stringify({ ids: [...sel] }),
      });
      if (r?.ok) { toast.ok(r.msg ?? 'Listo'); cargar(); } else toast.error(r?.error ?? 'No se pudo');
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo');
    }
  };

  const chip = (activo: boolean, color: string) => ({
    padding: '4px 10px', borderRadius: 999, fontSize: '0.75rem', cursor: 'pointer',
    border: `1px solid ${activo ? color : 'rgba(255,255,255,0.12)'}`,
    background: activo ? `${color}22` : 'transparent', color: activo ? color : '#cbd5e1',
  } as React.CSSProperties);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="h2" style={{ marginBottom: 8 }}>Estado por día</div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        Lo cargado o que ya existía no se vuelve a intentar. Las fallas del robot se reintentan siempre; los rechazos
        de SiAPe hasta {maxIntentos} veces y después quedan para revisar (o “Reintentar” los vuelve a la cola).
      </p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['', 'CARGADO', 'YA_EXISTIA', 'ERROR'] as const).map(e => (
          <button key={e || 'todos'} type="button" style={chip(estado === e, ESTADO_COLOR[e] ?? '#a78bfa')}
            onClick={() => { setEstado(e); setCategoria(''); }}>
            {e ? ESTADO_LABEL[e] : 'Todos'} ({e ? (porEstado[e] ?? 0) : Object.values(porEstado).reduce((a, b) => a + b, 0)})
          </button>
        ))}
      </div>

      {estado === 'ERROR' && errorPorCategoria.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" style={chip(categoria === '', '#f87171')} onClick={() => setCategoria('')}>Todas las causas</button>
          {errorPorCategoria.map(c => (
            <button key={c.categoria} type="button" style={chip(categoria === c.categoria, '#f87171')}
              onClick={() => setCategoria(c.categoria)}
              title={`${Number(c.agotados ?? 0)} con los ${maxIntentos} intentos agotados`}>
              {CATEGORIA_LABEL[c.categoria] ?? (c.categoria || 'Sin categoría')} ({c.n})
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input className="input" placeholder="Nombre o DNI..." value={q}
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') cargar(); }}
          style={{ minWidth: 220 }} />
        <button className="btn" type="button" onClick={cargar} disabled={loading}>{loading ? 'Cargando...' : '🔄 Actualizar'}</button>
        {estado === 'ERROR' && (
          <>
            <button className="btn" type="button" disabled={!seleccionables.length}
              onClick={() => setSel(sel.size === seleccionables.length ? new Set() : new Set(seleccionables.map(f => f.id)))}>
              {sel.size === seleccionables.length && sel.size ? 'Destildar todo' : 'Tildar todo'}
            </button>
            <button className="btn ok" type="button" disabled={!sel.size} onClick={reintentar}>
              Reintentar ({sel.size})
            </button>
          </>
        )}
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.06)' }}>
              {['', 'Agente', 'DNI', 'Fecha', 'Estado', 'Causa', 'Intentos', 'Detalle', 'Actualizado'].map(h => (
                <th key={h} style={{ padding: '4px 6px', textAlign: 'left', color: '#94a3b8', fontSize: '0.64rem', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!filas.length
              ? <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>{loading ? 'Cargando...' : 'Sin resultados'}</td></tr>
              : filas.map(f => {
                  const agotado = f.estado === 'ERROR' && f.intentos >= maxIntentos;
                  return (
                    <tr key={f.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '3px 6px' }}>
                        {f.estado === 'ERROR' && <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} />}
                      </td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>{f.nombre ?? '—'}</td>
                      <td style={{ padding: '3px 6px' }}>{f.dni}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha)}</td>
                      <td style={{ padding: '3px 6px', color: ESTADO_COLOR[f.estado], fontWeight: 600 }}>{ESTADO_LABEL[f.estado] ?? f.estado}</td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>{f.categoria ? (CATEGORIA_LABEL[f.categoria] ?? f.categoria) : ''}</td>
                      <td style={{ padding: '3px 6px', color: agotado ? '#f87171' : undefined, fontWeight: agotado ? 700 : 400 }}>
                        {f.estado === 'ERROR' ? `${f.intentos}/${maxIntentos}` : ''}
                      </td>
                      <td style={{ padding: '3px 6px', color: '#94a3b8', maxWidth: 380 }} title={f.detalle ?? ''}>
                        {(f.detalle ?? '').slice(0, 120)}
                      </td>
                      <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', color: '#64748b' }}>{f.actualizado_en}</td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Contenido de Carga SiAPe (sin Layout): su pagina y la pestaña del Comparador SIAPE. */
export function CargaSiapeContent() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const handleCargar = async () => {
    setLoading(true);
    setLastMessage(null);
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string; error?: string }>('/intranet/cargar-francos-siape', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (r?.ok) {
        const msg = r.msg ?? 'Carga de compensatorios en SiAPe iniciada';
        setLastMessage(msg);
        toast.ok(msg);
      } else {
        const msg = r?.error ?? 'No se pudo iniciar la carga en SiAPe';
        setLastMessage(msg);
        toast.error(msg);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'No se pudo iniciar la carga en SiAPe';
      setLastMessage(msg);
      toast.error('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="h2" style={{ marginBottom: 8 }}>Carga de compensatorios</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Inicia la carga en SiAPe de los reconocimientos médicos pendientes.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            className="btn ok"
            type="button"
            disabled={loading}
            onClick={handleCargar}
            title="Abre SiAPe y carga los pendientes por el flujo de compensatorios"
          >
            {loading ? 'Abriendo SiAPe...' : 'Cargar en SiAPe'}
          </button>
          {lastMessage && <span className="muted">{lastMessage}</span>}
        </div>
      </div>
      <EstadoDiasCarga />
    </>
  );
}

export function CargaSiapePage() {
  return (
    <Layout title="Carga SiAPe" showBack>
      <CargaSiapeContent />
    </Layout>
  );
}

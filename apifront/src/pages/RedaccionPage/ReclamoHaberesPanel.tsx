// Redaccion → tarjeta 20: Formulario de Reclamo de Haberes por Cese del Agente.
// Solo se genera si el agente está de baja y tiene la resolución de cese con su
// PDF en Resoluciones y Varios. Los datos salen de la base; CBU, registro de
// cargo y conceptos adeudados los completa el operador.
import React, { useEffect, useState } from 'react';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';

type Campos = Record<string, string>;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const inp: React.CSSProperties = {
  width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
  fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', color: '#111',
};
const lbl: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 600, color: '#555', marginBottom: 6, display: 'block' };
const titulo: React.CSSProperties = {
  fontWeight: 700, fontSize: '0.75rem', color: '#374151', margin: '14px 0 6px',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

const DATOS: Array<[string, string]> = [
  ['APELLIDO_NOMBRE', 'Apellido y nombres'],
  ['CUIL', 'CUIL'],
  ['LEGAJO', 'Legajo'],
  ['DOMICILIO', 'Domicilio'],
  ['EMAIL', 'Correo electrónico'],
  ['TELEFONO', 'Teléfono / celular'],
  ['CBU', 'CBU'],
  ['REGISTRO', 'Registro de cargo'],
  ['LEY', 'Régimen estatutario (ley)'],
  ['ENCASILLAMIENTO', 'Encasillamiento / disciplina'],
  ['FECHA_BAJA', 'Fecha de baja'],
  ['ACTO_CESE', 'Acto administrativo de cese / causal'],
  ['ANTIGUEDAD', 'Antigüedad total'],
];

// Licencias: clave, etiqueta, ¿año anterior o año de cese?
const LICENCIAS: Array<[string, string, 'ant' | 'cese']> = [
  ['LAD_ANT', 'Lic. anual denegada (año anterior)', 'ant'],
  ['LA_ANT', 'Licencia anual (año anterior)', 'ant'],
  ['LA_CESE', 'Licencia anual proporcional (año de cese)', 'cese'],
  ['LACD_ANT', 'Lic. anual complementaria denegada (año anterior)', 'ant'],
  ['LAC_ANT', 'Lic. anual complementaria (año anterior)', 'ant'],
  ['LAC_CESE', 'Lic. anual complementaria proporcional (año de cese)', 'cese'],
];

export function ReclamoHaberesPanel({ agente }: { agente: any }) {
  const toast = useToast();
  const [datos, setDatos] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [campos, setCampos] = useState<Campos>({});
  const [resolucionId, setResolucionId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/certificados/reclamo-haberes/datos?dni=${agente.dni}`)
      .then(r => {
        const d = r?.data ?? null;
        setDatos(d);
        if (!d) return;
        setCampos(d.campos ?? {});
        setResolucionId(d.resolucionId ?? null);
      })
      .catch(() => setDatos(null))
      .finally(() => setLoading(false));
  }, [agente.dni]);

  const payload = () => ({ dni: agente.dni, campos, resolucionId });

  useEffect(() => {
    if (!datos?.habilitado) return;
    const t = setTimeout(() => {
      setLoadingPreview(true);
      apiFetchBlob('/certificados/reclamo-haberes/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
        .then(b => b.text())
        .then(setPreviewHtml)
        .catch(() => setPreviewHtml(''))
        .finally(() => setLoadingPreview(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, campos, resolucionId]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setCampos(p => ({ ...p, [k]: v }));
  };

  const elegirResolucion = (id: number) => {
    setResolucionId(id);
    const r = (datos?.resoluciones ?? []).find((x: any) => x.id === id);
    if (r) {
      const f = r.fecha ? ` del ${r.fecha.split('-').reverse().join('/')}` : '';
      setCampos(p => ({ ...p, ACTO_CESE: `${r.numero}${f} – ${r.motivo}` }));
    }
  };

  const descargar = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/reclamo-haberes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      triggerDownload(blob, filename || `reclamo_haberes_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar el formulario: ' + (e?.message || 'Error'));
    } finally {
      setDescargando(false);
    }
  };

  const imprimir = (pdf: boolean) => {
    if (!previewHtml) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(pdf ? previewHtml.replace('</style>', '@media print { @page { margin: 0; } }</style>') : previewHtml);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  if (loading) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
  if (!datos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;

  if (!datos.habilitado) {
    return (
      <div style={{ padding: 24, color: '#111' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>No se puede generar el reclamo de haberes</div>
        {(datos.motivosNoHabilitado ?? []).map((m: string, i: number) => (
          <div key={i} style={{ fontSize: '0.82rem', color: '#991b1b', background: '#fee2e2', borderRadius: 6, padding: '6px 10px', marginBottom: 6 }}>{m}</div>
        ))}
        <div style={{ fontSize: '0.76rem', color: '#555', marginTop: 8 }}>
          Solo se genera para agentes dados de baja con la resolución de cese cargada y su PDF en Resoluciones y Varios.
        </div>
      </div>
    );
  }

  const anioAnt = datos.anioCese ? String(datos.anioCese - 1) : '';
  const anioCese = datos.anioCese ? String(datos.anioCese) : '';

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 560 }}>
      <div style={{ width: 340, flexShrink: 0, padding: '14px 14px', overflowY: 'auto', maxHeight: '72vh',
        borderRight: '1px solid #e5e7eb', background: '#f9fafb', color: '#111' }}>

        {(datos.avisos ?? []).map((a: string, i: number) => (
          <div key={i} style={{ fontSize: '0.72rem', color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '5px 8px', marginBottom: 6 }}>{a}</div>
        ))}

        {(datos.resoluciones ?? []).length > 1 && (
          <label style={lbl}>Resolución de cese
            <select style={inp} value={resolucionId ?? ''} onChange={e => elegirResolucion(Number(e.target.value))}>
              {datos.resoluciones.map((r: any) => (
                <option key={r.id} value={r.id}>{r.numero} · {r.fecha ? r.fecha.split('-').reverse().join('/') : 's/f'} · {r.motivo}</option>
              ))}
            </select>
          </label>
        )}

        <div style={titulo}>Datos del agente</div>
        {DATOS.map(([k, l]) => (
          <label key={k} style={lbl}>{l}
            <input style={{ ...inp, ...(k === 'CBU' || k === 'REGISTRO' ? { borderColor: '#f59e0b' } : {}) }}
              value={campos[k] ?? ''} onChange={set(k)} />
          </label>
        ))}

        <div style={titulo}>Conceptos adeudados</div>
        <label style={lbl}>Días trabajados<input style={inp} value={campos.DIAS_TRABAJADOS ?? ''} onChange={set('DIAS_TRABAJADOS')} /></label>
        <label style={lbl}>SAC<input style={inp} value={campos.SAC ?? ''} onChange={set('SAC')} /></label>
        {LICENCIAS.map(([k, l, cual]) => {
          const anio = cual === 'ant' ? anioAnt : anioCese;
          const marcado = !!(campos[k] ?? '').trim();
          return (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input type="checkbox" checked={marcado}
                onChange={e => setCampos(p => ({ ...p, [k]: e.target.checked ? anio : '' }))} />
              <span style={{ fontSize: '0.74rem', flex: 1 }}>{l}</span>
              <input style={{ ...inp, width: 64 }} value={campos[k] ?? ''} onChange={set(k)} placeholder={anio} />
            </div>
          );
        })}

        <div style={titulo}>Cierre</div>
        <label style={lbl}>Firma / aclaración<input style={inp} value={campos.FIRMA ?? ''} onChange={set('FIRMA')} /></label>
        <label style={lbl}>Fecha<input style={inp} value={campos.FECHA ?? ''} onChange={set('FECHA')} /></label>

        <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn" onClick={descargar} disabled={descargando} style={{ background: '#7c3aed', color: '#fff' }}>
            {descargando ? 'Generando...' : 'Descargar DOCX'}
          </button>
          <button className="btn" onClick={() => imprimir(false)} disabled={!previewHtml} style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
          <button className="btn" onClick={() => imprimir(true)} disabled={!previewHtml} style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', background: '#fff', position: 'relative' }}>
        {previewHtml
          ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', minHeight: 560, border: 'none', opacity: loadingPreview ? 0.6 : 1 }}
              title="Preview Reclamo de Haberes" />
          : <p style={{ color: loadingPreview ? '#888' : '#c00', textAlign: 'center', padding: 24 }}>
              {loadingPreview ? 'Actualizando preview...' : 'No se pudo cargar la vista previa.'}
            </p>}
      </div>
    </div>
  );
}

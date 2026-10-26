// Redaccion → tarjeta 19: Certificado Diferencial 2%.
// 14 % desde el nombramiento hasta el 30/06/2015, con licencias sin goce y
// jefaturas del periodo. La base no tiene licencias SIAPE previas a 2016 ni
// jefaturas historicas: las grillas se completan a mano (con sugerencias).
import React, { useEffect, useState } from 'react';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';

type Licencia = { desde: string; hasta: string; expediente: string };
type Jefatura = { cargo: string; desde: string; hasta: string; acto: string };
type Reconocimiento = { desde: string; hasta: string; acto: string };

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
const lbl: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
const titulo: React.CSSProperties = {
  fontWeight: 700, fontSize: '0.75rem', color: '#374151', margin: '14px 0 6px',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const fila: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, marginBottom: 6, background: '#fff', position: 'relative',
};
const quitar: React.CSSProperties = {
  position: 'absolute', top: 4, right: 6, fontSize: '0.7rem', color: '#ef4444',
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
};
const agregar: React.CSSProperties = {
  fontSize: '0.75rem', color: '#2563eb', background: 'none', border: '1px dashed #2563eb',
  borderRadius: 6, padding: '4px 0', cursor: 'pointer', width: '100%',
};
const chip: React.CSSProperties = {
  fontSize: '0.7rem', color: '#1e40af', background: '#dbeafe', border: 'none', borderRadius: 999,
  padding: '3px 9px', cursor: 'pointer', margin: '0 4px 4px 0',
};
const dos: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 };

export function Diferencial2pctPanel({ agente }: { agente: any }) {
  const toast = useToast();
  const [datos, setDatos] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('2015-06-30');
  const [licencias, setLicencias] = useState<Licencia[]>([]);
  const [jefaturas, setJefaturas] = useState<Jefatura[]>([]);
  const [reconocimientos, setReconocimientos] = useState<Reconocimiento[]>([]);
  const [verificado, setVerificado] = useState(false);
  const [destino, setDestino] = useState('el Instituto de Previsión Social (IPS)');
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>(`/certificados/diferencial-2pct/datos?dni=${agente.dni}`)
      .then(r => {
        const d = r?.data ?? null;
        setDatos(d);
        if (!d) return;
        setDesde(d.desde || '');
        setHasta(d.hasta || '2015-06-30');
        setLicencias(d.licencias ?? []);
        setReconocimientos(d.reconocimientos ?? []);
      })
      .catch(() => setDatos(null))
      .finally(() => setLoading(false));
  }, [agente.dni]);

  const payload = () => ({ dni: agente.dni, desde, hasta, licencias, jefaturas, reconocimientos, verificado, destino });

  useEffect(() => {
    if (!datos) return;
    const t = setTimeout(() => {
      setLoadingPreview(true);
      apiFetchBlob('/certificados/diferencial-2pct/preview', {
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
  }, [datos, desde, hasta, licencias, jefaturas, reconocimientos, verificado, destino]);

  const descargar = async () => {
    if (!desde) { toast.error('Falta la fecha de nombramiento'); return; }
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/diferencial-2pct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      triggerDownload(blob, filename || `certificado_diferencial_2pct_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar el certificado: ' + (e?.message || 'Error'));
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

  const editar = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, k: keyof T) =>
    (e: React.ChangeEvent<HTMLInputElement>) => set(prev => prev.map((x, idx) => idx === i ? { ...x, [k]: e.target.value } : x));
  const sacar = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number) => () => set(prev => prev.filter((_, idx) => idx !== i));
  const sinRegistros = !licencias.length && !jefaturas.length;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 560 }}>
      <div style={{ width: 330, flexShrink: 0, padding: '14px 14px', overflowY: 'auto', maxHeight: '72vh',
        borderRight: '1px solid #e5e7eb', background: '#f9fafb', color: '#111' }}>

        <div style={{ fontSize: '0.8rem', textAlign: 'center', marginBottom: 2 }}><strong>{datos.apellidoNombre}</strong></div>
        <div style={{ fontSize: '0.74rem', color: '#555', textAlign: 'center' }}>
          {[datos.cargo, datos.ley].filter(Boolean).join(' · ') || '—'}
        </div>

        {(datos.avisos ?? []).map((a: string, i: number) => (
          <div key={i} style={{ fontSize: '0.72rem', color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '5px 8px', marginTop: 8 }}>{a}</div>
        ))}

        <div style={titulo}>Período al 14 %</div>
        <div style={dos}>
          <label style={lbl}>Nombramiento
            <input type="date" style={inp} value={desde} onChange={e => setDesde(e.target.value)} />
          </label>
          <label style={lbl}>Hasta
            <input type="date" style={inp} value={hasta} onChange={e => setHasta(e.target.value)} />
          </label>
        </div>

        <div style={titulo}>Tramos al 16 % por acto</div>
        {reconocimientos.map((r, i) => (
          <div key={i} style={fila}>
            <button type="button" style={quitar} onClick={sacar(setReconocimientos, i)}>✕</button>
            <div style={dos}>
              <label style={lbl}>Desde<input type="date" style={inp} value={r.desde} onChange={editar(setReconocimientos, i, 'desde')} /></label>
              <label style={lbl}>Hasta<input type="date" style={inp} value={r.hasta} onChange={editar(setReconocimientos, i, 'hasta')} /></label>
            </div>
            <label style={lbl}>Acto<input style={inp} value={r.acto} onChange={editar(setReconocimientos, i, 'acto')} placeholder="Res. N° ..." /></label>
          </div>
        ))}
        <button type="button" style={agregar} onClick={() => setReconocimientos(p => [...p, { desde: '', hasta: '', acto: '' }])}>+ Agregar tramo al 16 %</button>

        <div style={titulo}>Licencias sin goce</div>
        {(datos.expedientesSinGoce?.length > 0 || datos.resolucionesSinGoce?.length > 0) && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: 4 }}>Encontrados en el sistema (sin fechas):</div>
            {(datos.expedientesSinGoce ?? []).map((e: any, i: number) => {
              const nro = e.anio ? `${e.numero}/${e.anio}` : e.numero;
              return (
                <button key={`e${i}`} type="button" style={chip} title={e.caratula}
                  onClick={() => setLicencias(p => [...p, { desde: '', hasta: '', expediente: nro }])}>+ Expte. {nro}</button>
              );
            })}
            {(datos.resolucionesSinGoce ?? []).map((r: any, i: number) => (
              <button key={`r${i}`} type="button" style={chip} title={r.detalle}
                onClick={() => setLicencias(p => [...p, { desde: '', hasta: '', expediente: r.numero }])}>+ Res. {r.numero}</button>
            ))}
          </div>
        )}
        {licencias.map((l, i) => (
          <div key={i} style={fila}>
            <button type="button" style={quitar} onClick={sacar(setLicencias, i)}>✕</button>
            <div style={dos}>
              <label style={lbl}>Desde<input type="date" style={inp} value={l.desde} onChange={editar(setLicencias, i, 'desde')} /></label>
              <label style={lbl}>Hasta<input type="date" style={inp} value={l.hasta} onChange={editar(setLicencias, i, 'hasta')} /></label>
            </div>
            <label style={lbl}>Expediente<input style={inp} value={l.expediente} onChange={editar(setLicencias, i, 'expediente')} placeholder="2965-..." /></label>
          </div>
        ))}
        <button type="button" style={agregar} onClick={() => setLicencias(p => [...p, { desde: '', hasta: '', expediente: '' }])}>+ Agregar licencia</button>

        <div style={titulo}>Jefaturas</div>
        {(datos.jefaturas ?? []).length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: 4 }}>Jefaturas actuales en el sistema (sin fechas):</div>
            {datos.jefaturas.map((j: Jefatura, i: number) => (
              <button key={i} type="button" style={chip}
                onClick={() => setJefaturas(p => [...p, { ...j }])}>+ {j.cargo}</button>
            ))}
          </div>
        )}
        {jefaturas.map((j, i) => (
          <div key={i} style={fila}>
            <button type="button" style={quitar} onClick={sacar(setJefaturas, i)}>✕</button>
            <label style={{ ...lbl, marginBottom: 6 }}>Cargo / función<input style={inp} value={j.cargo} onChange={editar(setJefaturas, i, 'cargo')} placeholder="Jefe/a de Sala" /></label>
            <div style={dos}>
              <label style={lbl}>Desde<input type="date" style={inp} value={j.desde} onChange={editar(setJefaturas, i, 'desde')} /></label>
              <label style={lbl}>Hasta<input type="date" style={inp} value={j.hasta} onChange={editar(setJefaturas, i, 'hasta')} /></label>
            </div>
            <label style={lbl}>Acto<input style={inp} value={j.acto} onChange={editar(setJefaturas, i, 'acto')} placeholder="Res. N° ..." /></label>
          </div>
        ))}
        <button type="button" style={agregar} onClick={() => setJefaturas(p => [...p, { cargo: '', desde: '', hasta: '', acto: '' }])}>+ Agregar jefatura</button>

        <div style={titulo}>Cierre</div>
        <label style={lbl}>Presentar ante
          <input style={inp} value={destino} onChange={e => setDestino(e.target.value)} placeholder="quien corresponda" />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.76rem', marginTop: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={verificado} onChange={e => setVerificado(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Verifiqué el legajo: lo que no figura arriba no existe (el texto dirá "no registra").</span>
        </label>
        {sinRegistros && !verificado && (
          <div style={{ fontSize: '0.7rem', color: '#92400e', marginTop: 4 }}>
            Sin la tilde, el certificado no menciona licencias ni jefaturas.
          </div>
        )}

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
              title="Preview Diferencial 2%" />
          : <p style={{ color: loadingPreview ? '#888' : '#c00', textAlign: 'center', padding: 24 }}>
              {loadingPreview ? 'Actualizando preview...' : 'No se pudo cargar la vista previa.'}
            </p>}
      </div>
    </div>
  );
}

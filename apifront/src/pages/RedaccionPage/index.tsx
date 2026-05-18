// src/pages/RedaccionPage/index.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';

const DOCS = [
  { id: 1,  label: 'Certificado de Trabajo',   implementado: false,
    frase: 'Se certifica que el/la agente presta servicios en esta reparticion con el cargo y antiguedad que se detalla a continuacion.' },
  { id: 2,  label: 'IOMA',                      implementado: true,
    frase: 'Se certifica para presentar ante IOMA que el/la agente se encuentra en actividad en la fecha indicada.' },
  { id: 3,  label: 'Constancia de Empleo',      implementado: false,
    frase: 'La presente constancia acredita la relacion de empleo publico vigente entre el agente y esta reparticion.' },
  { id: 4,  label: 'Certificado de Haberes',    implementado: false,
    frase: 'Se certifica la remuneracion mensual percibida por el/la agente de acuerdo a su categoria y adicionales correspondientes.' },
  { id: 5,  label: 'Licencia / Francos',        implementado: false,
    frase: 'Se informa el estado de licencias y francos compensatorios correspondientes al agente en el periodo indicado.' },
  { id: 6,  label: 'Alta Medica',               implementado: false,
    frase: 'Se certifica que el/la agente se encuentra en condiciones de retomar sus funciones a partir de la fecha indicada.' },
  { id: 7,  label: 'Prestamo Bancario',         implementado: false,
    frase: 'Se certifica la situacion de revista del agente a los efectos de tramitar creditos ante entidades bancarias.' },
  { id: 8,  label: 'Jubilacion / Retiro',       implementado: false,
    frase: 'Se certifica la antiguedad y condiciones de revista a los efectos previsionales correspondientes.' },
  { id: 9,  label: 'Resolucion Interna',        implementado: false,
    frase: 'Se confecciona la presente resolucion interna segun los antecedentes obrantes en el legajo del agente.' },
  { id: 10, label: 'Nota a Direccion',          implementado: false,
    frase: 'Por medio de la presente nota se eleva a la Direccion el pedido correspondiente segun lo actuado en autos.' },
  { id: 11, label: 'Cedula de Notificacion',    implementado: true,
    frase: 'Se notifica al agente la resolucion o acto administrativo correspondiente en su domicilio declarado.' },
  { id: 12, label: 'Nota a Comisaria',          implementado: true,
    frase: 'Solicitud de Certificado de Antecedentes Penales emitida al Comisario de la Provincia de Buenos Aires.' },
  { id: 13, label: 'Cert. Base Vieja',          implementado: true,
    frase: 'Certificacion de servicios con cargo, carga horaria y servicio para presentar ante quien corresponda.' },
  { id: 14, label: 'Cert. Laboral Rotacion',    implementado: true,
    frase: 'Certificado laboral de rotacion para medico residente cubierto por ART Provincia.' },
];

function DocModal({ agente, doc, onClose }: {
  agente: any;
  doc: typeof DOCS[0];
  onClose: () => void;
}) {
  const toast = useToast();
  const [descargando, setDescargando] = useState(false);
  const [iomaDatos, setIomaDatos] = useState<any>(null);
  const [loadingDatos, setLoadingDatos] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [cedulaDatos, setCedulaDatos] = useState<any>(null);
  const [cedulaFields, setCedulaFields] = useState({
    tipoNotif: 'la Resolucion',
    vistoText: '',
    considerandoText: '',
  });
  const [articulos, setArticulos] = useState<string[]>(['', '']);

  const [notaComisariaDatos, setNotaComisariaDatos] = useState<any>(null);

  const [certBaseViejaDatos, setCertBaseViejaDatos] = useState<any>(null);
  const [certBaseViejaFields, setCertBaseViejaFields] = useState({ cargo: '', hsSemanales: '', servicio: '' });

  const [certRotacionDatos, setCertRotacionDatos] = useState<any>(null);
  const [certRotacionFields, setCertRotacionFields] = useState({ servicio: '', numArt: '' });

  const nombre = `${agente.apellido ?? ''} ${agente.nombre ?? ''}`.trim();

  useEffect(() => {
    if (doc.id !== 2) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/certificado-trabajo/datos?dni=${agente.dni}`)
      .then(r => setIomaDatos(r?.data ?? null))
      .catch(() => setIomaDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 2 || !iomaDatos) return;
    setLoadingPreview(true);
    apiFetchBlob(`/certificados/certificado-trabajo/preview?dni=${agente.dni}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, iomaDatos, agente.dni]);

  useEffect(() => {
    if (doc.id !== 11) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/cedula/datos?dni=${agente.dni}`)
      .then(r => setCedulaDatos(r?.data ?? null))
      .catch(() => setCedulaDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 11 || !cedulaDatos) return;
    setLoadingPreview(true);
    const params: Record<string, string> = {
      dni: String(agente.dni),
      tipoNotif: cedulaFields.tipoNotif,
      vistoText: cedulaFields.vistoText,
      considerandoText: cedulaFields.considerandoText,
    };
    articulos.forEach((a, i) => { params[`art${i + 1}`] = a; });
    apiFetchBlob(`/certificados/cedula/preview?${new URLSearchParams(params)}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, cedulaDatos, cedulaFields, articulos, agente.dni]);

  // Nota Comisaria — fetch datos + preview
  useEffect(() => {
    if (doc.id !== 12) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/nota-comisaria/datos?dni=${agente.dni}`)
      .then(r => setNotaComisariaDatos(r?.data ?? null))
      .catch(() => setNotaComisariaDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 12 || !notaComisariaDatos) return;
    setLoadingPreview(true);
    apiFetchBlob(`/certificados/nota-comisaria/preview?dni=${agente.dni}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, notaComisariaDatos, agente.dni]);

  // Cert Base Vieja — fetch datos + preview
  useEffect(() => {
    if (doc.id !== 13) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/cert-base-vieja/datos?dni=${agente.dni}`)
      .then(r => setCertBaseViejaDatos(r?.data ?? null))
      .catch(() => setCertBaseViejaDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 13 || !certBaseViejaDatos) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({
      dni: String(agente.dni),
      cargo: certBaseViejaFields.cargo,
      hsSemanales: certBaseViejaFields.hsSemanales,
      servicio: certBaseViejaFields.servicio,
    });
    apiFetchBlob(`/certificados/cert-base-vieja/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, certBaseViejaDatos, certBaseViejaFields, agente.dni]);

  // Cert Rotacion — fetch datos + preview
  useEffect(() => {
    if (doc.id !== 14) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/cert-rotacion/datos?dni=${agente.dni}`)
      .then(r => setCertRotacionDatos(r?.data ?? null))
      .catch(() => setCertRotacionDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 14 || !certRotacionDatos) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({
      dni: String(agente.dni),
      servicio: certRotacionFields.servicio,
      numArt: certRotacionFields.numArt,
    });
    apiFetchBlob(`/certificados/cert-rotacion/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, certRotacionDatos, certRotacionFields, agente.dni]);

  const descargarDocxIoma = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/certificado-trabajo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `ioma_${agente.dni}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Error al generar IOMA: ' + (e?.message || 'Error'));
    } finally {
      setDescargando(false);
    }
  };

  const descargarDocxCedula = async () => {
    setDescargando(true);
    try {
      const artObj: Record<string, string> = {};
      articulos.forEach((a, i) => { artObj[`art${i + 1}`] = a; });
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/cedula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ...cedulaFields, ...artObj }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `cedula_${agente.dni}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Error al generar Cedula: ' + (e?.message || 'Error'));
    } finally {
      setDescargando(false);
    }
  };

  const descargarDocxNotaComisaria = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/nota-comisaria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || `nota_comisaria_${agente.dni}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Error al generar Nota Comisaria: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxCertBaseVieja = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/cert-base-vieja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ...certBaseViejaFields }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || `cert_base_vieja_${agente.dni}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Error al generar Cert Base Vieja: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxCertRotacion = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/cert-rotacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ...certRotacionFields }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || `cert_rotacion_${agente.dni}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error('Error al generar Cert Rotacion: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const imprimirDoc = () => {
    if (!previewHtml) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(previewHtml);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const exportarPdf = () => {
    if (!previewHtml) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(previewHtml.replace('</style>', `@media print { @page { margin: 0; } }</style>`));
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const renderPreview = () => {
    if (doc.id === 2) {
      if (loadingDatos || loadingPreview) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando documento...</p>;
      if (!iomaDatos)   return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      if (!previewHtml) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>;
      return (
        <iframe
          srcDoc={previewHtml}
          style={{ width: '100%', height: 620, border: 'none', borderRadius: 4 }}
          title="Preview IOMA"
        />
      );
    }

    if (doc.id === 11) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      const area: React.CSSProperties = { ...inp, resize: 'vertical', minHeight: 56 };

      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!cedulaDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;

      const setF = (key: keyof typeof cedulaFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setCedulaFields(prev => ({ ...prev, [key]: e.target.value }));

      const addArticulo = () => {
        if (articulos.length >= 7) return;
        setArticulos(prev => [...prev, '']);
      };
      const removeArticulo = (i: number) =>
        setArticulos(prev => prev.filter((_, idx) => idx !== i));
      const setArticulo = (i: number) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        setArticulos(prev => prev.map((v, idx) => idx === i ? e.target.value : v));

      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>

          {/* Panel izquierdo */}
          <div style={{ width: 270, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>

            {/* Datos del agente */}
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>
              Datos del agente
            </div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{cedulaDatos.apellidoNombre}</strong>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>
              {cedulaDatos.domicilio} {cedulaDatos.numeroDom}
            </div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>
              {cedulaDatos.piso ? `Piso ${cedulaDatos.piso}` : ''}{cedulaDatos.depto ? ` Dpto ${cedulaDatos.depto}` : ''}
            </div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 12, textAlign: 'center' }}>
              {cedulaDatos.localidad}{cedulaDatos.cp ? `  CP ${cedulaDatos.cp}` : ''}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', marginBottom: 12 }} />

            {/* Campos a completar */}
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Completar
            </div>
            <label style={lbl}>Se le notifica</label>
            <input style={inp} value={cedulaFields.tipoNotif}
              onChange={setF('tipoNotif')} placeholder="la Resolucion N..." />
            <label style={lbl}>VISTO</label>
            <textarea style={area} value={cedulaFields.vistoText}
              onChange={setF('vistoText')} placeholder="Expediente N..." />
            <label style={lbl}>CONSIDERANDO</label>
            <textarea style={area} value={cedulaFields.considerandoText}
              onChange={setF('considerandoText')} placeholder="Que..." />

            {/* Artículos dinámicos */}
            {articulos.map((art, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <label style={lbl}>
                  Artículo {i + 1}
                  {articulos.length > 1 && (
                    <button type="button" onClick={() => removeArticulo(i)}
                      style={{ marginLeft: 8, fontSize: '0.68rem', color: '#ef4444',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      ✕ quitar
                    </button>
                  )}
                </label>
                <textarea style={area} value={art}
                  onChange={setArticulo(i)} placeholder="Texto del artículo..." />
              </div>
            ))}
            {articulos.length < 7 && (
              <button type="button" onClick={addArticulo}
                style={{ fontSize: '0.75rem', color: '#2563eb', background: 'none',
                  border: '1px dashed #2563eb', borderRadius: 6, padding: '4px 0',
                  cursor: 'pointer', marginBottom: 14, width: '100%' }}>
                + Agregar artículo
              </button>
            )}

          </div>

          {/* Preview */}
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }}
                    title="Preview Cedula" />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>
                    No se pudo cargar la vista previa.
                  </p>
            }
          </div>
        </div>
      );
    }

    if (doc.id === 12) {
      if (loadingDatos || loadingPreview) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando documento...</p>;
      if (!notaComisariaDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      if (!previewHtml) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>;
      return <iframe srcDoc={previewHtml} style={{ width: '100%', height: 620, border: 'none', borderRadius: 4 }} title="Preview Nota Comisaria" />;
    }

    if (doc.id === 13) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!certBaseViejaDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      const setF13 = (key: keyof typeof certBaseViejaFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setCertBaseViejaFields(prev => ({ ...prev, [key]: e.target.value }));
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 240, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Datos del agente</div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{certBaseViejaDatos.apellidoNombre}</strong></div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>DNI: {certBaseViejaDatos.dni}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Legajo: {certBaseViejaDatos.legajo}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Ingreso: {certBaseViejaDatos.fechaIngreso}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label style={lbl}>Cargo</label>
            <input style={inp} value={certBaseViejaFields.cargo} onChange={setF13('cargo')} placeholder="Ej: Enfermero" />
            <label style={lbl}>Hs. Semanales</label>
            <input style={inp} value={certBaseViejaFields.hsSemanales} onChange={setF13('hsSemanales')} placeholder="Ej: 30" />
            <label style={lbl}>Servicio</label>
            <input style={inp} value={certBaseViejaFields.servicio} onChange={setF13('servicio')} placeholder="Ej: Guardia" />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title="Preview Cert Base Vieja" />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    if (doc.id === 14) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!certRotacionDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      const setF14 = (key: keyof typeof certRotacionFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setCertRotacionFields(prev => ({ ...prev, [key]: e.target.value }));
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 240, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Datos del agente</div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{certRotacionDatos.apellidoNombre}</strong></div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>DNI: {certRotacionDatos.dni}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Legajo: {certRotacionDatos.legajo}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Ingreso: {certRotacionDatos.fechaIngreso}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label style={lbl}>Servicio / Rotacion</label>
            <input style={inp} value={certRotacionFields.servicio} onChange={setF14('servicio')} placeholder="Ej: Clínica Médica" />
            <label style={lbl}>N° Registro ART</label>
            <input style={inp} value={certRotacionFields.numArt} onChange={setF14('numArt')} placeholder="Ej: 12345" />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title="Preview Cert Rotacion" />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>&#x1F6A7;</div>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#92400e', marginBottom: 6 }}>En proceso</div>
        <div style={{ fontSize: '0.82rem', color: '#78350f' }}>
          El documento <strong>{doc.label}</strong> esta en desarrollo.<br />
          Proximamente disponible con generacion automatica.
        </div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      padding: '16px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 16, padding: 24, maxWidth: [11, 13, 14].includes(doc.id) ? 1100 : 860, width: '100%',
        maxHeight: '95vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{doc.label}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{nombre} &mdash; DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: '2px 10px', flexShrink: 0 }}>X</button>
        </div>

        <div style={{
          borderRadius: 8, overflow: [11, 13, 14].includes(doc.id) ? 'hidden' : 'auto', flex: 1,
          boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          background: doc.implementado ? ([11, 13, 14].includes(doc.id) ? '#f9fafb' : '#fff') : '#fffbeb',
          border: doc.implementado ? ([11, 13, 14].includes(doc.id) ? '1px solid #e5e7eb' : 'none') : '1px solid #fcd34d',
        }}>
          {renderPreview()}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {doc.id === 2 && (
            <>
              <button className="btn" onClick={descargarDocxIoma} disabled={descargando || !iomaDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!iomaDatos}
                style={{ background: '#0369a1', color: '#fff' }}>
                Imprimir
              </button>
              <button className="btn" onClick={exportarPdf} disabled={!iomaDatos}
                style={{ background: '#dc2626', color: '#fff' }}>
                PDF
              </button>
            </>
          )}
          {doc.id === 11 && (
            <>
              <button className="btn" onClick={descargarDocxCedula} disabled={descargando || !cedulaDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>
                Imprimir
              </button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>
                PDF
              </button>
            </>
          )}
          {doc.id === 12 && (
            <>
              <button className="btn" onClick={descargarDocxNotaComisaria} disabled={descargando || !notaComisariaDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          {doc.id === 13 && (
            <>
              <button className="btn" onClick={descargarDocxCertBaseVieja} disabled={descargando || !certBaseViejaDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          {doc.id === 14 && (
            <>
              <button className="btn" onClick={descargarDocxCertRotacion} disabled={descargando || !certRotacionDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          <button className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Cerrar</button>
        </div>
        {doc.implementado && (
          <div className="muted" style={{ fontSize: '0.72rem', marginTop: 8 }}>
            Modelo orientativo. Completar segun requerimiento antes de imprimir.
          </div>
        )}
      </div>
    </div>
  );
}

export function RedaccionPage() {
  const toast = useToast();
  const [searchType, setSearchType] = useState<'dni' | 'nombre'>('dni');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [activeDoc, setActiveDoc] = useState<typeof DOCS[0] | null>(null);

  const buscar = useCallback(async () => {
    if (!query.trim()) { toast.error('Ingresa un valor'); return; }
    setLoading(true);
    setMatches([]);
    setSelected(null);
    try {
      let data: any[] = [];
      if (searchType === 'dni') {
        const r = await apiFetch<any>(`/personal/${query.trim()}`);
        if (r?.data) data = [r.data];
        if (!data.length) {
          const r2 = await apiFetch<any>(`/agentexdni1?dni=${query.trim()}&limit=5&page=1`);
          data = r2?.data || [];
        }
      } else {
        data = await searchPersonal(query.trim());
      }

      if (!data.length) { toast.error('Sin resultados'); return; }

      const enriched = await Promise.all(data.slice(0, 5).map(async (p: any) => {
        try {
          const ra = await apiFetch<any>(`/agentes?dni=${p.dni}&limit=1&page=1`);
          return { ...p, ...(ra?.data?.[0] || {}) };
        } catch { return p; }
      }));
      const rest = data.slice(5);

      setMatches([...enriched, ...rest]);
      if (data.length === 1) setSelected(enriched[0]);
      else toast.ok(`${data.length} resultado(s) - selecciona uno`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [query, searchType, toast]);

  return (
    <Layout title="Redaccion" showBack>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}><strong>Redaccion de documentos</strong></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Buscar por</div>
            <select className="input" value={searchType}
              onChange={e => { setSearchType(e.target.value as any); setQuery(''); setMatches([]); setSelected(null); }}
              style={{ minWidth: 160 }}>
              <option value="dni">DNI</option>
              <option value="nombre">Apellido / Nombre</option>
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
              {searchType === 'dni' ? 'Numero de DNI' : 'Apellido o nombre'}
            </div>
            <input className="input" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder={searchType === 'dni' ? 'Ej: 25123456' : 'Ej: Garcia'}
            />
          </div>
          <button className="btn" style={{ background: '#2563eb', color: '#fff', height: 38 }}
            disabled={loading} onClick={buscar}>
            {loading ? '...' : 'Buscar'}
          </button>
        </div>
      </div>

      {matches.length > 1 && !selected && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>{matches.length} resultados &mdash; selecciona un agente</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {matches.map((a, i) => (
              <div key={i} onClick={() => setSelected(a)}
                style={{
                  cursor: 'pointer', padding: '8px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', gap: 14, alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              >
                <span style={{ fontWeight: 600 }}>{a.apellido}, {a.nombre}</span>
                <span className="muted" style={{ fontSize: '0.8rem' }}>DNI {a.dni}</span>
                {a.estado_empleo && <span className="badge" style={{ fontSize: '0.72rem' }}>{a.estado_empleo}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selected.apellido}, {selected.nombre}</div>
                <div className="muted" style={{ fontSize: '0.8rem', marginTop: 3 }}>
                  DNI {selected.dni}
                  {selected.cuil ? ` - CUIL ${selected.cuil}` : ''}
                  {selected.email ? ` - ${selected.email}` : ''}
                  {selected.telefono ? ` - Tel: ${selected.telefono}` : ''}
                  {selected.fecha_ingreso ? ` - Ingreso: ${new Date(selected.fecha_ingreso).toLocaleDateString('es-AR')}` : ''}
                  {selected.estado_empleo ? ` - ${selected.estado_empleo}` : ''}
                  {selected.sector_id ? ` - Sector: ${selected.sector_id}` : ''}
                </div>
              </div>
              <button className="btn" onClick={() => { setSelected(null); if (matches.length <= 1) setMatches([]); }}
                style={{ fontSize: '0.78rem' }}>Cambiar</button>
            </div>
          </div>

          <div className="card">
            <div style={{ marginBottom: 14 }}>
              <strong>Selecciona el documento</strong>
              <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>
                Haz clic para abrir el modelo con los datos del agente
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {DOCS.map(doc => (
                <button key={doc.id} onClick={() => setActiveDoc(doc)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 6, padding: '12px 14px', borderRadius: 12,
                    border: `1px solid ${doc.implementado ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    background: doc.implementado ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.04)',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = doc.implementado ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.09)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = doc.implementado ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>#{doc.id}</span>
                    {doc.implementado
                      ? <span style={{ fontSize: '0.62rem', background: '#7c3aed', color: '#fff', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>Listo</span>
                      : <span style={{ fontSize: '0.62rem', background: '#92400e', color: '#fef3c7', padding: '1px 7px', borderRadius: 99 }}>En proceso</span>
                    }
                  </div>
                  <span style={{ fontSize: '0.83rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3 }}>
                    {doc.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!selected && matches.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: 10 }}>&#x1F4C4;</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>Busca un agente para comenzar</div>
          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 6 }}>
            Busca por DNI o apellido. Una vez seleccionado el agente, elige el documento para generar el modelo.
          </div>
        </div>
      )}

      {activeDoc && selected && (
        <DocModal agente={selected} doc={activeDoc} onClose={() => setActiveDoc(null)} />
      )}
    </Layout>
  );
}

// src/pages/RedaccionPage/index.tsx
import React, { useState, useCallback, useEffect } from 'react';

/** Descarga un blob como archivo. Usa appendChild para compatibilidad con Firefox. */
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
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast }                     from '../../ui/toast';
import { AlertaBannerAgenteConMensaje } from '../../components/AlertaBannerAgente';

const JUB_WIN_START = parseInt((import.meta as any).env?.VITE_JUB_WINDOW_DAY_START ?? '1');
const JUB_WIN_END   = parseInt((import.meta as any).env?.VITE_JUB_WINDOW_DAY_END   ?? '10');
const LEY_IDS_NOMBRADOS = [1, 2, 3, 4, 5, 14];
// mes (0-based) → { dia de baja, mes texto, offset de año }
const JUB_BAJA: Record<number, { dia: string; mes: string; yearOffset: number }> = {
  11: { dia: '31', mes: 'de marzo',        yearOffset: 1 },
  2:  { dia: '30', mes: 'de junio',        yearOffset: 0 },
  5:  { dia: '30', mes: 'de septiembre',   yearOffset: 0 },
  8:  { dia: '31', mes: 'de diciembre',    yearOffset: 0 },
};
function getJubVentana(): { activa: boolean; fechaBaja: string | null } {
  const now  = new Date();
  const mes  = now.getMonth();
  const dia  = now.getDate();
  if (dia < JUB_WIN_START || dia > JUB_WIN_END) return { activa: false, fechaBaja: null };
  const baja = JUB_BAJA[mes];
  if (!baja) return { activa: false, fechaBaja: null };
  const year = now.getFullYear() + baja.yearOffset;
  return { activa: true, fechaBaja: `${baja.dia} ${baja.mes} de ${year}` };
}

function formatDateDMY(value: any): string {
  if (!value) return '';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  if (
    dt.getUTCHours() === 0 &&
    dt.getUTCMinutes() === 0 &&
    dt.getUTCSeconds() === 0 &&
    dt.getUTCMilliseconds() === 0
  ) {
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  }
  return dt.toLocaleDateString('es-AR');
}

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
  { id: 7,  label: 'Dispo Rectificacion',        implementado: true,
    frase: 'Disposicion de rectificacion para subsanar errores en expedientes administrativos.' },
  { id: 8,  label: 'Jubilacion / Retiro',       implementado: true,
    frase: 'Notas de comunicacion de cese jubilatorio y constancia de antecedentes sumariales.' },
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
  { id: 15, label: 'Nota Certificacion',         implementado: true,
    frase: 'Certificacion de servicios para becarios de contingencia del Programa de Becas para Contingencias Institucionales Criticas.' },
  { id: 16, label: 'Curriculum Vitae',           implementado: true,
    frase: 'Curriculum vitae con datos personales, domicilio, estudios y experiencia laboral del agente.' },
  { id: 17, label: 'Nota Designacion Becario',    implementado: true,
    frase: 'Solicitud de designacion de agente becario con cargo, ley y regimen horario seleccionable.' },
  { id: 18, label: 'Nota Elevacion Becario',       implementado: true,
    frase: 'Elevacion administrativa de la solicitud de designacion del agente becario.' },
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

  const [certServiciosDatos, setCertServiciosDatos] = useState<any>(null);
  const [certServiciosOcupacion, setCertServiciosOcupacion] = useState('');

  const [designacionDatos, setDesignacionDatos] = useState<any>(null);
  const [designacionFields, setDesignacionFields] = useState({
    cargo: '',
    ley: '10471',
    regimen10471: 'planta',
  });

  const [cvDatos, setCvDatos] = useState<any>(null);
  const [cvFields, setCvFields] = useState({
    estadoCivil: 'SOLTERO',
    secundario: 'BACHILLER',
    terciario: '',
    profesion: '',
  });

  const [jubDatos, setJubDatos] = useState<any>(null);
  const [loadingJub, setLoadingJub] = useState(false);

  const [dispRectFields, setDispRectFields] = useState({
    expNro: '', tramite: '', agentes: '', ifgra1: '', orden1: '', motivo1: '',
    ifgra2: '', orden2: '', motivo2: '',
  });

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
      .then(r => {
        const data = r?.data ?? null;
        setCertBaseViejaDatos(data);
        setCertBaseViejaFields(prev => ({
          ...prev,
          servicio:    data?.servicio    ?? '',
          cargo:       data?.cargo       ?? '',
          hsSemanales: data?.hsSemanales ?? '',
        }));
      })
      .catch(() => {
        setCertBaseViejaDatos(null);
        setCertBaseViejaFields({ cargo: '', hsSemanales: '', servicio: '' });
      })
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

  useEffect(() => {
    if (doc.id !== 8) return;
    setLoadingJub(true);
    apiFetch<any>(`/certificados/jubilacion/datos?dni=${agente.dni}`)
      .then(r => setJubDatos(r?.data ?? null))
      .catch(() => setJubDatos(null))
      .finally(() => setLoadingJub(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 7) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({ ...dispRectFields });
    apiFetchBlob(`/certificados/disp-rectificacion/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, dispRectFields]);

  useEffect(() => {
    if (doc.id !== 15) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/cert-servicios/datos?dni=${agente.dni}`)
      .then(r => {
        setCertServiciosDatos(r?.data ?? null);
        if (r?.data?.ocupacion) setCertServiciosOcupacion(r.data.ocupacion);
      })
      .catch(() => setCertServiciosDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 15 || !certServiciosDatos) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({ dni: String(agente.dni), ocupacion: certServiciosOcupacion });
    apiFetchBlob(`/certificados/cert-servicios/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, certServiciosDatos, certServiciosOcupacion, agente.dni]);

  const esNotaBecario = doc.id === 17 || doc.id === 18;
  const endpointNotaBecario = doc.id === 18 ? 'elevacion-becario' : 'designacion-becario';

  useEffect(() => {
    if (!esNotaBecario) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/${endpointNotaBecario}/datos?dni=${agente.dni}`)
      .then(r => {
        const data = r?.data ?? null;
        setDesignacionDatos(data);
        setDesignacionFields({
          cargo: data?.cargo || data?.ocupacionSugerida || '',
          ley: data?.leySugerida || data?.ley || '10471',
          regimen10471: data?.regimen10471 || 'planta',
        });
      })
      .catch(() => {
        setDesignacionDatos(null);
        setDesignacionFields({ cargo: '', ley: '10471', regimen10471: 'planta' });
      })
      .finally(() => setLoadingDatos(false));
  }, [esNotaBecario, endpointNotaBecario, agente.dni]);

  useEffect(() => {
    if (!esNotaBecario || !designacionDatos) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({ dni: String(agente.dni), ...designacionFields });
    apiFetchBlob(`/certificados/${endpointNotaBecario}/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [esNotaBecario, endpointNotaBecario, designacionDatos, designacionFields, agente.dni]);

  useEffect(() => {
    if (doc.id !== 16) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/cv/datos?dni=${agente.dni}`)
      .then(r => {
        const data = r?.data ?? null;
        setCvDatos(data);
        setCvFields({
          estadoCivil: data?.estadoCivil || 'SOLTERO',
          secundario: data?.secundario || 'BACHILLER',
          terciario: data?.terciario || '',
          profesion: data?.profesion || data?.terciario || data?.ocupacion || '',
        });
      })
      .catch(() => {
        setCvDatos(null);
        setCvFields({ estadoCivil: 'SOLTERO', secundario: 'BACHILLER', terciario: '', profesion: '' });
      })
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

  useEffect(() => {
    if (doc.id !== 16 || !cvDatos) return;
    setLoadingPreview(true);
    const params = new URLSearchParams({ dni: String(agente.dni), ...cvFields });
    apiFetchBlob(`/certificados/cv/preview?${params}`)
      .then(blob => blob.text())
      .then(html => setPreviewHtml(html))
      .catch(() => setPreviewHtml(''))
      .finally(() => setLoadingPreview(false));
  }, [doc.id, cvDatos, cvFields, agente.dni]);

  const descargarDocxIoma = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/certificado-trabajo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni }),
      });
      triggerDownload(blob, filename || `ioma_${agente.dni}.docx`);
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
      triggerDownload(blob, filename || `cedula_${agente.dni}.docx`);
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
      triggerDownload(blob, filename || `nota_comisaria_${agente.dni}.docx`);
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
      triggerDownload(blob, filename || `cert_base_vieja_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar Cert Base Vieja: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxCertServicios = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/cert-servicios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ocupacion: certServiciosOcupacion }),
      });
      triggerDownload(blob, filename || `nota_certificacion_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar Nota Certificacion: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxDesignacionBecario = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta(`/certificados/${endpointNotaBecario}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ...designacionFields }),
      });
      triggerDownload(blob, filename || `${endpointNotaBecario}_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar la nota: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxDispRect = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/disp-rectificacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dispRectFields }),
      });
      triggerDownload(blob, filename || 'disp_rectificacion.docx');
    } catch (e: any) {
      toast.error('Error al generar Dispo Rectificacion: ' + (e?.message || 'Error'));
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
      triggerDownload(blob, filename || `cert_rotacion_${agente.dni}.docx`);
    } catch (e: any) {
      toast.error('Error al generar Cert Rotacion: ' + (e?.message || 'Error'));
    } finally { setDescargando(false); }
  };

  const descargarDocxCv = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/certificados/cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: agente.dni, ...cvFields }),
      });
      triggerDownload(blob, filename || `cv_${agente.dni}.docx`);
      toast.ok('CV DOCX y JPG guardados en DOCU');
    } catch (e: any) {
      toast.error('Error al generar CV: ' + (e?.message || 'Error'));
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
            <label htmlFor="rd-cedula-notif" style={lbl}>Se le notifica</label>
            <input id="rd-cedula-notif" name="tipoNotif" style={inp} value={cedulaFields.tipoNotif}
              onChange={setF('tipoNotif')} placeholder="la Resolucion N..." />
            <label htmlFor="rd-cedula-visto" style={lbl}>VISTO</label>
            <textarea id="rd-cedula-visto" name="vistoText" style={area} value={cedulaFields.vistoText}
              onChange={setF('vistoText')} placeholder="Expediente N..." />
            <label htmlFor="rd-cedula-consid" style={lbl}>CONSIDERANDO</label>
            <textarea id="rd-cedula-consid" name="considerandoText" style={area} value={cedulaFields.considerandoText}
              onChange={setF('considerandoText')} placeholder="Que..." />

            {/* Artículos dinámicos */}
            {articulos.map((art, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <label htmlFor={`rd-cedula-art-${i}`} style={lbl}>
                  Artículo {i + 1}
                  {articulos.length > 1 && (
                    <button type="button" onClick={() => removeArticulo(i)}
                      style={{ marginLeft: 8, fontSize: '0.68rem', color: '#ef4444',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      ✕ quitar
                    </button>
                  )}
                </label>
                <textarea id={`rd-cedula-art-${i}`} name={`articulo_${i}`} style={area} value={art}
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
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Servicio: {certBaseViejaDatos.servicio || '—'}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label htmlFor="rd-13-cargo" style={lbl}>Cargo</label>
            <input id="rd-13-cargo" name="cargo" style={inp} value={certBaseViejaFields.cargo} onChange={setF13('cargo')} placeholder="Ej: Enfermero" />
            <label htmlFor="rd-13-hs" style={lbl}>Hs. Semanales</label>
            <input id="rd-13-hs" name="hsSemanales" style={inp} value={certBaseViejaFields.hsSemanales} onChange={setF13('hsSemanales')} placeholder="Ej: 30" />
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
            <label htmlFor="rd-14-srv" style={lbl}>Servicio / Rotacion</label>
            <input id="rd-14-srv" name="servicio" style={inp} value={certRotacionFields.servicio} onChange={setF14('servicio')} placeholder="Ej: Clínica Médica" />
            <label htmlFor="rd-14-art" style={lbl}>N° Registro ART</label>
            <input id="rd-14-art" name="numArt" style={inp} value={certRotacionFields.numArt} onChange={setF14('numArt')} placeholder="Ej: 12345" />
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

    if (doc.id === 15) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!certServiciosDatos) return (
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#b45309', marginBottom: 6 }}>Solo para becarios de contingencia</div>
          <div style={{ fontSize: '0.83rem', color: '#78350f' }}>
            Este documento esta disponible unicamente para becarios del Programa de Becas para Contingencias Institucionales Criticas.
          </div>
        </div>
      );
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 240, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Datos del agente</div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{certServiciosDatos.apellidoNombre}</strong></div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>DNI: {certServiciosDatos.dni}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Clase: {certServiciosDatos.clase}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label htmlFor="rd-15-occ" style={lbl}>Profesion / Funcion</label>
            <input id="rd-15-occ" name="ocupacion" style={inp} value={certServiciosOcupacion}
              onChange={e => setCertServiciosOcupacion(e.target.value)}
              placeholder="Ej: Enfermero vacunador" />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title="Preview Nota Certificacion" />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    if (esNotaBecario) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!designacionDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      const setF17 = (key: keyof typeof designacionFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setDesignacionFields(prev => ({ ...prev, [key]: e.target.value }));
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 270, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Datos del agente</div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{designacionDatos.apellidoNombre}</strong></div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>DNI: {designacionDatos.dni}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Ley base: {designacionDatos.leyBase || '-'}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Ocupacion: {designacionDatos.ocupacionSugerida || '-'}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Dependencia: {designacionDatos.dependencia || '-'}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label htmlFor="rd-17-ley" style={lbl}>Ley de nombramiento</label>
            <select id="rd-17-ley" name="ley" style={inp} value={designacionFields.ley} onChange={setF17('ley')}>
              <option value="10471">10471</option>
              <option value="10430">10430</option>
            </select>
            <label htmlFor="rd-17-cargo" style={lbl}>Profesion / cargo</label>
            <input id="rd-17-cargo" name="cargo" style={inp} value={designacionFields.cargo}
              onChange={setF17('cargo')} placeholder="Ej: Enfermero" />
            {designacionFields.ley === '10471' && (
              <>
                <label htmlFor="rd-17-regimen" style={lbl}>Regimen 10471</label>
                <select id="rd-17-regimen" name="regimen10471" style={inp} value={designacionFields.regimen10471}
                  onChange={setF17('regimen10471')}>
                  <option value="planta">36 horas semanales planta</option>
                  <option value="guardia">36 horas semanales guardia</option>
                </select>
              </>
            )}
            {designacionFields.ley === '10430' && (
              <div style={{ fontSize: '0.78rem', color: '#374151', background: '#e0f2fe',
                border: '1px solid #bae6fd', borderRadius: 6, padding: '8px 10px' }}>
                Para 10430 se imprime con {doc.id === 18 ? '48 horas semanales de labor' : '48 horas semanales'}.
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title={`Preview ${doc.label}`} />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    if (doc.id === 16) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!cvDatos) return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      const setF16 = (key: keyof typeof cvFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setCvFields(prev => ({ ...prev, [key]: e.target.value }));
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 270, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Datos del agente</div>
            <div style={{ fontSize: '0.8rem', color: '#111', marginBottom: 2, textAlign: 'center' }}>
              <strong>{cvDatos.apellidoNombre}</strong></div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>DNI: {cvDatos.dni}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>{cvDatos.domicilio} {cvDatos.numeroDom}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>{cvDatos.localidad}{cvDatos.cp ? ` CP ${cvDatos.cp}` : ''}</div>
            <div style={{ fontSize: '0.76rem', color: '#555', marginBottom: 1, textAlign: 'center' }}>Ingreso: {cvDatos.fechaIngreso || '-'}</div>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completar</div>
            <label htmlFor="rd-16-estado" style={lbl}>Estado civil</label>
            <select id="rd-16-estado" name="estadoCivil" style={inp} value={cvFields.estadoCivil} onChange={setF16('estadoCivil')}>
              <option value="SOLTERO">SOLTERO</option>
              <option value="SOLTERA">SOLTERA</option>
              <option value="CASADO">CASADO</option>
              <option value="CASADA">CASADA</option>
              <option value="DIVORCIADO">DIVORCIADO</option>
              <option value="DIVORCIADA">DIVORCIADA</option>
              <option value="VIUDO">VIUDO</option>
              <option value="VIUDA">VIUDA</option>
              <option value="UNION CONVIVENCIAL">UNION CONVIVENCIAL</option>
              <option value="SEPARADO">SEPARADO</option>
              <option value="SEPARADA">SEPARADA</option>
            </select>
            <label htmlFor="rd-16-sec" style={lbl}>Estudios secundarios</label>
            <input id="rd-16-sec" name="secundario" style={inp} value={cvFields.secundario}
              onChange={setF16('secundario')} placeholder="Ej: BACHILLER" />
            <label htmlFor="rd-16-ter" style={lbl}>Terciario / universitario</label>
            <input id="rd-16-ter" name="terciario" style={inp} value={cvFields.terciario}
              onChange={setF16('terciario')} placeholder="Ej: ENFERMERA" />
            <label htmlFor="rd-16-prof" style={lbl}>Profesion experiencia</label>
            <input id="rd-16-prof" name="profesion" style={inp} value={cvFields.profesion}
              onChange={setF16('profesion')} placeholder="Ej: ENFERMERIA" />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title="Preview CV" />
                : <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se pudo cargar la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    if (doc.id === 7) {
      const inp: React.CSSProperties = {
        width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
        fontSize: '0.83rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8,
      };
      const lbl: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: 2, display: 'block' };
      const setF7 = (key: keyof typeof dispRectFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDispRectFields(prev => ({ ...prev, [key]: e.target.value }));
      return (
        <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 540 }}>
          <div style={{ width: 260, flexShrink: 0, padding: '16px 14px', overflowY: 'auto',
            borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Expediente</div>
            <label htmlFor="rd-7-exp" style={lbl}>Nro. Expediente</label>
            <input id="rd-7-exp" name="expNro" style={inp} value={dispRectFields.expNro} onChange={setF7('expNro')} placeholder="EX-2025-..." />
            <label htmlFor="rd-7-tram" style={lbl}>Tipo de Trámite</label>
            <input id="rd-7-tram" name="tramite" style={inp} value={dispRectFields.tramite} onChange={setF7('tramite')} placeholder="Ej: JUBILACION" />
            <label htmlFor="rd-7-ag" style={lbl}>Agente(s)</label>
            <input id="rd-7-ag" name="agentes" style={inp} value={dispRectFields.agentes} onChange={setF7('agentes')} placeholder="APELLIDO NOMBRE" />
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Artículo 1°</div>
            <label htmlFor="rd-7-ifgra1" style={lbl}>Nro. IFGRA</label>
            <input id="rd-7-ifgra1" name="ifgra1" style={inp} value={dispRectFields.ifgra1} onChange={setF7('ifgra1')} placeholder="IF-2025-..." />
            <label htmlFor="rd-7-ord1" style={lbl}>Orden en Expediente</label>
            <input id="rd-7-ord1" name="orden1" style={inp} value={dispRectFields.orden1} onChange={setF7('orden1')} placeholder="Ej: 3" />
            <label htmlFor="rd-7-mot1" style={lbl}>Motivo del Error</label>
            <textarea id="rd-7-mot1" name="motivo1" style={{ ...inp, resize: 'vertical', minHeight: 48 }} value={dispRectFields.motivo1}
              onChange={setF7('motivo1')} placeholder="error involuntario de tipeo..." />
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#374151', marginBottom: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>Artículo 2°</div>
            <label htmlFor="rd-7-ifgra2" style={lbl}>Nro. IFGRA</label>
            <input id="rd-7-ifgra2" name="ifgra2" style={inp} value={dispRectFields.ifgra2} onChange={setF7('ifgra2')} placeholder="IF-2025-..." />
            <label htmlFor="rd-7-ord2" style={lbl}>Orden en Expediente</label>
            <input id="rd-7-ord2" name="orden2" style={inp} value={dispRectFields.orden2} onChange={setF7('orden2')} placeholder="Ej: 4" />
            <label htmlFor="rd-7-mot2" style={lbl}>Motivo del Error</label>
            <textarea id="rd-7-mot2" name="motivo2" style={{ ...inp, resize: 'vertical', minHeight: 48 }} value={dispRectFields.motivo2}
              onChange={setF7('motivo2')} placeholder="error involuntario de tipeo..." />
          </div>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
            {loadingPreview
              ? <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Actualizando preview...</p>
              : previewHtml
                ? <iframe srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 'none' }} title="Preview Dispo Rectificacion" />
                : <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Completá los campos para ver la vista previa.</p>
            }
          </div>
        </div>
      );
    }

    if (doc.id === 8) {
      if (loadingJub) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Cargando datos del agente...</p>;
      if (!jubDatos)  return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;

      const ventana    = getJubVentana();
      const esNombrado = LEY_IDS_NOMBRADOS.includes(jubDatos.ley_id);
      const esActivo   = jubDatos.estado_empleo === 'ACTIVO';
      const esFemenino = String(jubDatos.sexo ?? '').toUpperCase().includes('FEMENINO');
      const tratamiento = esFemenino ? 'doña' : 'don';
      const encabezado  = esFemenino ? 'SRA' : 'SR';

      if (!esActivo || !esNombrado) {
        return (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#dc2626', marginBottom: 8 }}>No habilitado</div>
            <div style={{ fontSize: '0.84rem', color: '#555' }}>
              {!esActivo
                ? 'El agente no se encuentra en estado ACTIVO.'
                : 'Este documento solo está disponible para agentes nombrados (no becados ni residentes).'}
            </div>
          </div>
        );
      }

      if (!ventana.activa) {
        return (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#b45309', marginBottom: 8 }}>Fuera del período de impresión</div>
            <div style={{ fontSize: '0.84rem', color: '#78350f' }}>
              La impresión está habilitada del <strong>{JUB_WIN_START}</strong> al <strong>{JUB_WIN_END}</strong> de diciembre, marzo, junio y septiembre.
            </div>
          </div>
        );
      }

      const bodyStyle: React.CSSProperties = { marginTop: 0, marginBottom: 0, textAlign: 'justify' };
      const secLabel: React.CSSProperties  = { fontSize: '0.68rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
      const dato: React.CSSProperties      = { fontWeight: 700 };

      return (
        <div style={{ padding: '28px 36px', fontFamily: 'Georgia, serif', fontSize: '0.95rem', color: '#111', lineHeight: 1.9, overflowY: 'auto' }}>

          {/* Nota 1 */}
          <div style={secLabel as any}>Nota de jubilación</div>
          <p style={{ ...bodyStyle, marginBottom: 4 }}><span style={dato}>{encabezado}: {jubDatos.apellidoNombre}</span></p>
          <p style={{ ...bodyStyle, marginBottom: 4 }}>DNI: <span style={dato}>{jubDatos.dni}</span></p>
          <p style={{ ...bodyStyle, marginBottom: 20 }}><span style={dato}>{jubDatos.dependencia}.</span></p>
          <p style={{ ...bodyStyle, marginBottom: 36 }}>
            Me dirijo a Usted por medio de la presente, a fin de llevar a vuestro conocimiento que, habiendo reunido
            las condiciones para acogerse a los beneficios jubilatorios, se dará cumplimiento a lo estatuido por el
            decreto N° 431/13, sustituyente del artículo 14 inciso g de la Ley 10430 (Texto Ordenado 1.869/96),
            reglamentada por Decreto N° 4161/96-Decreto Acuerdo N°2760/97, a partir del <span style={dato}>{ventana.fechaBaja}</span>.
          </p>

          {/* Nota 2 */}
          <div style={secLabel as any}>Constancia de antecedentes sumariales</div>
          <p style={{ ...bodyStyle }}>
            Por intermedio de la presente, se deja establecido que {tratamiento}{' '}
            <span style={dato}>{jubDatos.apellidoNombre}</span> DNI:{' '}
            <span style={dato}>{jubDatos.dni}</span> LEGAJO DE CONTADURÍA N°{' '}
            <span style={dato}>{jubDatos.legajo || '—'}</span> no registra a la actualidad, ningún tipo de antecedentes
            de actuaciones sumariales pendientes ni en trámite, por lo que se estima que el particular, se encuentra
            apto para ser cursado su cese bajo la modalidad ejecutiva (Decreto 1770/11).
          </p>
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
        borderRadius: 16, padding: 24, maxWidth: [11, 13, 14, 16, 17, 18].includes(doc.id) ? 1100 : 860, width: '100%',
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
          borderRadius: 8, overflow: [11, 13, 14, 16, 17, 18].includes(doc.id) ? 'hidden' : 'auto', flex: 1,
          boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          background: doc.implementado ? ([7, 11, 13, 14, 15, 16, 17, 18].includes(doc.id) ? '#f9fafb' : '#fff') : '#fffbeb',
          border: doc.implementado ? ([7, 11, 13, 14, 15, 16, 17, 18].includes(doc.id) ? '1px solid #e5e7eb' : 'none') : '1px solid #fcd34d',
        }}>
          {renderPreview()}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {doc.id === 15 && (
            <>
              <button className="btn" onClick={descargarDocxCertServicios} disabled={descargando || !certServiciosDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          {esNotaBecario && (
            <>
              <button className="btn" onClick={descargarDocxDesignacionBecario} disabled={descargando || !designacionDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          {doc.id === 16 && (
            <>
              <button className="btn" onClick={descargarDocxCv} disabled={descargando || !cvDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Generar y guardar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
          {doc.id === 7 && (
            <>
              <button className="btn" onClick={descargarDocxDispRect} disabled={descargando}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? 'Generando...' : 'Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!previewHtml}
                style={{ background: '#0369a1', color: '#fff' }}>Imprimir</button>
              <button className="btn" onClick={exportarPdf} disabled={!previewHtml}
                style={{ background: '#dc2626', color: '#fff' }}>PDF</button>
            </>
          )}
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
          {doc.id === 8 && (() => {
            const ventana    = getJubVentana();
            const esNombrado = jubDatos ? LEY_IDS_NOMBRADOS.includes(jubDatos.ley_id) : false;
            const esActivo   = jubDatos?.estado_empleo === 'ACTIVO';
            const habilitado = !!jubDatos && ventana.activa && esNombrado && esActivo;
            const esFemenino = String(jubDatos?.sexo ?? '').toUpperCase().includes('FEMENINO');
            const tratamiento = esFemenino ? 'doña' : 'don';
            const encabezado  = esFemenino ? 'SRA' : 'SR';
            const imprimirJub = () => {
              if (!jubDatos || !ventana.fechaBaja) return;
              const w = window.open('', '_blank');
              if (!w) return;
              w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
                <style>
                  body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.9;
                         margin: 2.5cm 3cm; color: #000; }
                  p { text-align: justify; margin: 0 0 6pt 0; }
                  .sep { margin-bottom: 2cm; }
                  @page { margin: 2cm; }
                </style></head><body>
                <p><b>${encabezado}: ${jubDatos.apellidoNombre}</b></p>
                <p>DNI: <b>${jubDatos.dni}</b></p>
                <p class="sep"><b>${jubDatos.dependencia}.</b></p>
                <p class="sep">Me dirijo a Usted por medio de la presente, a fin de llevar a vuestro
                conocimiento que, habiendo reunido las condiciones para acogerse a los beneficios
                jubilatorios, se dará cumplimiento a lo estatuido por el decreto N° 431/13, sustituyente
                del artículo 14 inciso g de la Ley 10430 (Texto Ordenado 1.869/96), reglamentada por
                Decreto N° 4161/96-Decreto Acuerdo N°2760/97, a partir del <b>${ventana.fechaBaja}</b>.</p>
                <p>Por intermedio de la presente, se deja establecido que ${tratamiento}
                <b>${jubDatos.apellidoNombre}</b> DNI: <b>${jubDatos.dni}</b>
                LEGAJO DE CONTADURÍA N° <b>${jubDatos.legajo || '—'}</b> no registra a la actualidad,
                ningún tipo de antecedentes de actuaciones sumariales pendientes ni en trámite, por lo
                que se estima que el particular, se encuentra apto para ser cursado su cese bajo la
                modalidad ejecutiva (Decreto 1770/11).</p>
                </body></html>`);
              w.document.close();
              w.focus();
              setTimeout(() => { w.print(); }, 400);
            };
            return (
              <button className="btn" onClick={imprimirJub} disabled={!habilitado}
                style={{ background: habilitado ? '#0369a1' : '#64748b', color: '#fff' }}>
                Imprimir
              </button>
            );
          })()}
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
            <label htmlFor="rd-search-type" className="muted" style={{ fontSize: '0.75rem', marginBottom: 4, display: 'block' }}>Buscar por</label>
            <select id="rd-search-type" name="searchType" className="input" value={searchType}
              onChange={e => { setSearchType(e.target.value as any); setQuery(''); setMatches([]); setSelected(null); }}
              style={{ minWidth: 160 }}>
              <option value="dni">DNI</option>
              <option value="nombre">Apellido / Nombre</option>
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="rd-query" className="muted" style={{ fontSize: '0.75rem', marginBottom: 4, display: 'block' }}>
              {searchType === 'dni' ? 'Numero de DNI' : 'Apellido o nombre'}
            </label>
            <input id="rd-query" name="query" className="input" value={query}
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
                  {selected.fecha_ingreso ? ` - Ingreso: ${formatDateDMY(selected.fecha_ingreso)}` : ''}
                  {selected.estado_empleo ? ` - ${selected.estado_empleo}` : ''}
                  {selected.sector_id ? ` - Sector: ${selected.sector_id}` : ''}
                </div>
              </div>
              <button className="btn" onClick={() => { setSelected(null); if (matches.length <= 1) setMatches([]); }}
                style={{ fontSize: '0.78rem' }}>Cambiar</button>
            </div>
          </div>

          <AlertaBannerAgenteConMensaje dni={selected?.dni ?? null} />

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

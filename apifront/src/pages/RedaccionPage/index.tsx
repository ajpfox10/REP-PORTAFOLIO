// src/pages/RedaccionPage/index.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';
import { exportToPdf } from '../../utils/export';

// ─── Documentos ───────────────────────────────────────────────────────────────
// implementado: true = tiene generación real de DOCX/PDF
const DOCS = [
  { id: 1, label: 'Certificado de Trabajo',     implementado: false,
    frase: 'Se certifica que el/la agente presta servicios en esta repartición con el cargo y antigüedad que se detalla a continuación.' },
  { id: 2, label: 'IOMA',                        implementado: true,
    frase: 'Se certifica para presentar ante IOMA que el/la agente se encuentra en actividad en la fecha indicada.' },
  { id: 3, label: 'Constancia de Empleo',        implementado: false,
    frase: 'La presente constancia acredita la relación de empleo público vigente entre el agente y esta repartición.' },
  { id: 4, label: 'Certificado de Haberes',      implementado: false,
    frase: 'Se certifica la remuneración mensual percibida por el/la agente de acuerdo a su categoría y adicionales correspondientes.' },
  { id: 5, label: 'Licencia / Francos',          implementado: false,
    frase: 'Se informa el estado de licencias y francos compensatorios correspondientes al agente en el período indicado.' },
  { id: 6, label: 'Alta Médica',                 implementado: false,
    frase: 'Se certifica que el/la agente se encuentra en condiciones de retomar sus funciones a partir de la fecha indicada.' },
  { id: 7, label: 'Préstamo Bancario',           implementado: false,
    frase: 'Se certifica la situación de revista del agente a los efectos de tramitar créditos ante entidades bancarias.' },
  { id: 8, label: 'Jubilación / Retiro',         implementado: false,
    frase: 'Se certifica la antigüedad y condiciones de revista a los efectos previsionales correspondientes.' },
  { id: 9, label: 'Resolución Interna',          implementado: false,
    frase: 'Se confecciona la presente resolución interna según los antecedentes obrantes en el legajo del agente.' },
  { id: 10, label: 'Nota a Dirección',           implementado: false,
    frase: 'Por medio de la presente nota se eleva a la Dirección el pedido correspondiente según lo actuado en autos.' },
];

// ─── Modal de documento ───────────────────────────────────────────────────────
function DocModal({ agente, doc, onClose }: {
  agente: any;
  doc: typeof DOCS[0];
  onClose: () => void;
}) {
  const toast = useToast();
  const [descargando, setDescargando] = useState(false);
  const [iomaDatos, setIomaDatos] = useState<any>(null);
  const [loadingDatos, setLoadingDatos] = useState(false);

  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const nombre = `${agente.apellido ?? ''} ${agente.nombre ?? ''}`.trim();
  const LUGAR = 'González Catán';
  const ingreso = agente.fecha_ingreso ? new Date(agente.fecha_ingreso).toLocaleDateString('es-AR') : '';

  useEffect(() => {
    if (doc.id !== 2) return;
    setLoadingDatos(true);
    apiFetch<any>(`/certificados/certificado-trabajo/datos?dni=${agente.dni}`)
      .then(r => setIomaDatos(r?.data ?? null))
      .catch(() => setIomaDatos(null))
      .finally(() => setLoadingDatos(false));
  }, [doc.id, agente.dni]);

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

  // Genera HTML del documento para imprimir/PDF (solo doc 2 por ahora)
  const buildDocHtml = (forPrint = false) => {
    if (doc.id === 2 && iomaDatos) {
      return `<html><head><title>IOMA — ${iomaDatos.apellidoNombre}</title>
      <style>
        body{font-family:Georgia,serif;padding:48px 56px;color:#111;font-size:13px;line-height:1.8;}
        h1{font-size:14px;text-align:center;font-weight:bold;margin:0 0 2px 0;}
        .sub{text-align:center;font-size:11px;color:#555;margin-bottom:36px;}
        .titulo{font-weight:bold;text-decoration:underline;margin-bottom:20px;font-size:13px;}
        p{margin:0 0 14px 0;}
        .firma{margin-top:72px;text-align:center;border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#666;}
      </style></head><body>
      <h1>MUNICIPALIDAD</h1>
      <div class="sub">Dirección de Recursos Humanos</div>
      <div class="titulo">IOMA</div>
      <p>La que suscribe hace constar que el/la agente <strong>${iomaDatos.apellidoNombre}</strong>,
      DNI N° <strong>${iomaDatos.dni}</strong>${agente.cuil ? `, CUIL ${agente.cuil}` : ''}${iomaDatos.dependencia ? `, dependencia <strong>${iomaDatos.dependencia}</strong>` : ''}${iomaDatos.legajo ? `, legajo <strong>${iomaDatos.legajo}</strong>` : ''}${iomaDatos.decreto ? `, decreto <strong>${iomaDatos.decreto}</strong>` : ''},
      con ingreso el <strong>${iomaDatos.fechaIngreso}</strong>, desempeñando funciones hasta el <strong>${iomaDatos.hasta}</strong>.
      ${doc.frase}</p>
      <p>La presente se expide a pedido de la parte interesada para ser presentada donde corresponda.</p>
      <p>${iomaDatos.lugarFecha}.</p>
      <div class="firma">Firma y Sello Autoridad Competente</div>
      </body></html>`;
    }
    return '';
  };

  const imprimirDoc = () => {
    const html = buildDocHtml(true);
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const exportarPdf = () => {
    const html = buildDocHtml(false);
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html.replace('</style>', `@media print { @page { margin: 0; } }</style>`));
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  // ── Preview del documento (hoja blanca) ──
  const renderPreview = () => {
    // Doc 2 IOMA — implementado
    if (doc.id === 2) {
      if (loadingDatos) return <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>⏳ Cargando datos del agente…</p>;
      if (!iomaDatos)   return <p style={{ color: '#c00', textAlign: 'center', padding: 24 }}>No se encontraron datos del agente.</p>;
      return (
        <>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.02em' }}>MUNICIPALIDAD</div>
            <div style={{ fontSize: '0.77rem', color: '#666' }}>Dirección de Recursos Humanos</div>
          </div>
          <div style={{ fontWeight: 700, textDecoration: 'underline', marginBottom: 16, fontSize: '0.9rem' }}>IOMA</div>
          <p style={{ margin: '0 0 14px 0', textAlign: 'justify' }}>
            La que suscribe hace constar que el/la agente{' '}
            <strong>{iomaDatos.apellidoNombre}</strong>,{' '}
            DNI N° <strong>{iomaDatos.dni}</strong>
            {agente.cuil ? `, CUIL ${agente.cuil}` : ''}
            {iomaDatos.dependencia ? `, dependencia ${iomaDatos.dependencia}` : ''}
            {iomaDatos.legajo ? `, legajo ${iomaDatos.legajo}` : ''}
            {iomaDatos.decreto ? `, decreto ${iomaDatos.decreto}` : ''},
            {' '}con ingreso el <strong>{iomaDatos.fechaIngreso}</strong>,
            {' '}desempeñando funciones hasta el <strong>{iomaDatos.hasta}</strong>.{' '}
            {doc.frase}
          </p>
          <p style={{ margin: '0 0 28px 0', color: '#333', textAlign: 'justify' }}>
            La presente se expide a pedido de la parte interesada para ser presentada donde corresponda.
          </p>
          <p style={{ fontSize: '0.83rem', color: '#444' }}>{iomaDatos.lugarFecha}.</p>
          <div style={{ marginTop: 52, borderTop: '1px solid #ccc', paddingTop: 8, textAlign: 'center', fontSize: '0.74rem', color: '#999' }}>
            Firma y Sello Autoridad Competente
          </div>
        </>
      );
    }

    // Docs no implementados — "En proceso"
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🔧</div>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#92400e', marginBottom: 6 }}>En proceso</div>
        <div style={{ fontSize: '0.82rem', color: '#78350f' }}>
          El documento <strong>{doc.label}</strong> está en desarrollo.<br />
          Próximamente disponible con generación automática.
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
        borderRadius: 16, padding: 24, maxWidth: 600, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{doc.label}</div>
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{nombre} — DNI {agente.dni}</div>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: '2px 10px', flexShrink: 0 }}>✕</button>
        </div>

        {/* Preview — hoja blanca */}
        <div style={{
          background: '#fff', color: '#111', borderRadius: 8,
          padding: '28px 32px', fontFamily: 'Georgia, serif',
          lineHeight: 1.8, fontSize: '0.87rem', overflowY: 'auto', flex: 1,
          boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          ...(doc.implementado ? {} : { background: '#fffbeb', border: '1px solid #fcd34d' }),
        }}>
          {renderPreview()}
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {doc.id === 2 && (
            <>
              <button className="btn" onClick={descargarDocxIoma} disabled={descargando || !iomaDatos}
                style={{ background: '#7c3aed', color: '#fff' }}>
                {descargando ? '⏳ Generando…' : '☁ Descargar DOCX'}
              </button>
              <button className="btn" onClick={imprimirDoc} disabled={!iomaDatos}
                style={{ background: '#0369a1', color: '#fff' }}>
                🖨️ Imprimir
              </button>
              <button className="btn" onClick={exportarPdf} disabled={!iomaDatos}
                style={{ background: '#dc2626', color: '#fff' }}>
                📕 PDF
              </button>
            </>
          )}
          <button className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>Cerrar</button>
        </div>
        {doc.implementado && (
          <div className="muted" style={{ fontSize: '0.72rem', marginTop: 8 }}>
            Modelo orientativo. Completar según requerimiento antes de imprimir.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function RedaccionPage() {
  const toast = useToast();
  const [searchType, setSearchType] = useState<'dni' | 'nombre'>('dni');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [activeDoc, setActiveDoc] = useState<typeof DOCS[0] | null>(null);

  const buscar = useCallback(async () => {
    if (!query.trim()) { toast.error('Ingresá un valor'); return; }
    setLoading(true);
    setMatches([]);
    setSelected(null);
    try {
      let data: any[] = [];
      if (searchType === 'dni') {
        const r = await apiFetch<any>(`/personal/${query.trim()}`);
        if (r?.data) data = [r.data];
        if (!data.length) {
          // fallback agentexdni1
          const r2 = await apiFetch<any>(`/agentexdni1?dni=${query.trim()}&limit=5&page=1`);
          data = r2?.data || [];
        }
      } else {
        // Usar cache local — /personal/search tiene bug SQL en el backend
        data = await searchPersonal(query.trim(), 20);
      }

      if (!data.length) { toast.error('Sin resultados'); return; }

      // Enriquecer con datos laborales si es posible
      const enriched = await Promise.all(data.slice(0, 5).map(async (p: any) => {
        try {
          const ra = await apiFetch<any>(`/agentes?dni=${p.dni}&limit=1&page=1`);
          return { ...p, ...(ra?.data?.[0] || {}) };
        } catch { return p; }
      }));
      const rest = data.slice(5);

      setMatches([...enriched, ...rest]);
      if (data.length === 1) setSelected(enriched[0]);
      else toast.ok(`${data.length} resultado(s) — seleccioná uno`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  }, [query, searchType, toast]);

  return (
    <Layout title="Redacción" showBack>
      {/* ── Búsqueda ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}><strong>✍️ Redacción de documentos</strong></div>
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
              {searchType === 'dni' ? 'Número de DNI' : 'Apellido o nombre'}
            </div>
            <input className="input" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder={searchType === 'dni' ? 'Ej: 25123456' : 'Ej: García'}
            />
          </div>
          <button className="btn" style={{ background: '#2563eb', color: '#fff', height: 38 }}
            disabled={loading} onClick={buscar}>
            {loading ? '⏳' : '🔍 Buscar'}
          </button>
        </div>
      </div>

      {/* ── Lista de coincidencias ── */}
      {matches.length > 1 && !selected && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>{matches.length} resultados — seleccioná un agente</div>
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

      {/* ── Agente seleccionado ── */}
      {selected && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selected.apellido}, {selected.nombre}</div>
                <div className="muted" style={{ fontSize: '0.8rem', marginTop: 3 }}>
                  DNI {selected.dni}
                  {selected.cuil ? ` · CUIL ${selected.cuil}` : ''}
                  {selected.email ? ` · ${selected.email}` : ''}
                  {selected.telefono ? ` · Tel: ${selected.telefono}` : ''}
                  {selected.fecha_ingreso ? ` · Ingreso: ${new Date(selected.fecha_ingreso).toLocaleDateString('es-AR')}` : ''}
                  {selected.estado_empleo ? ` · ${selected.estado_empleo}` : ''}
                  {selected.sector_id ? ` · Sector: ${selected.sector_id}` : ''}
                </div>
              </div>
              <button className="btn" onClick={() => { setSelected(null); if (matches.length <= 1) setMatches([]); }}
                style={{ fontSize: '0.78rem' }}>✕ Cambiar</button>
            </div>
          </div>

          {/* ── Grid de documentos ── */}
          <div className="card">
            <div style={{ marginBottom: 14 }}>
              <strong>Seleccioná el documento</strong>
              <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>
                Hacé clic para abrir el modelo con los datos del agente
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
                      ? <span style={{ fontSize: '0.62rem', background: '#7c3aed', color: '#fff', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>✓ Listo</span>
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

      {/* ── Estado vacío ── */}
      {!selected && matches.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: 10 }}>✍️</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>Buscá un agente para comenzar</div>
          <div className="muted" style={{ fontSize: '0.84rem', marginTop: 6 }}>
            Buscá por DNI o apellido. Una vez seleccionado el agente, elegís el número de documento para generar el modelo.
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {activeDoc && selected && (
        <DocModal agente={selected} doc={activeDoc} onClose={() => setActiveDoc(null)} />
      )}
    </Layout>
  );
}

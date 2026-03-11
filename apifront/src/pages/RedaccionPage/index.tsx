// src/pages/RedaccionPage/index.tsx
import React, { useState, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';
import { exportToPdf } from '../../utils/export';

// ─── Documentos ───────────────────────────────────────────────────────────────
// Los botones muestran SOLO el número. El nombre y la frase se usan en el modal.
const DOCS = [
  { id: 1, label: 'Certificado de Trabajo',
    frase: 'Se certifica que el/la agente presta servicios en esta repartición con el cargo y antigüedad que se detalla a continuación.' },
  { id: 2, label: 'IOMA',
    frase: 'Se certifica para presentar ante IOMA que el/la agente se encuentra en actividad en la fecha indicada.' },
  { id: 3, label: 'Constancia de Empleo',
    frase: 'La presente constancia acredita la relación de empleo público vigente entre el agente y esta repartición.' },
  { id: 4, label: 'Certificado de Haberes',
    frase: 'Se certifica la remuneración mensual percibida por el/la agente de acuerdo a su categoría y adicionales correspondientes.' },
  { id: 5, label: 'Licencia / Francos',
    frase: 'Se informa el estado de licencias y francos compensatorios correspondientes al agente en el período indicado.' },
  { id: 6, label: 'Alta Médica',
    frase: 'Se certifica que el/la agente se encuentra en condiciones de retomar sus funciones a partir de la fecha indicada.' },
  { id: 7, label: 'Préstamo Bancario',
    frase: 'Se certifica la situación de revista del agente a los efectos de tramitar créditos ante entidades bancarias.' },
  { id: 8, label: 'Jubilación / Retiro',
    frase: 'Se certifica la antigüedad y condiciones de revista a los efectos previsionales correspondientes.' },
  { id: 9, label: 'Resolución Interna',
    frase: 'Se confecciona la presente resolución interna según los antecedentes obrantes en el legajo del agente.' },
  { id: 10, label: 'Nota a Dirección',
    frase: 'Por medio de la presente nota se eleva a la Dirección el pedido correspondiente según lo actuado en autos.' },
];

// ─── Modal de documento ───────────────────────────────────────────────────────
function DocModal({ agente, doc, onClose }: {
  agente: any;
  doc: typeof DOCS[0];
  onClose: () => void;
}) {
  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const nombre = `${agente.apellido ?? ''}, ${agente.nombre ?? ''}`.trim();
  const antig = agente.fecha_ingreso
    ? `${new Date().getFullYear() - new Date(agente.fecha_ingreso).getFullYear()} años`
    : '';

  const imprimirDoc = () => {
    const html = `<html><head><title>${doc.label}</title>
    <style>
      body{font-family:Georgia,serif;padding:48px;color:#111;font-size:13px;line-height:1.7;}
      h1{font-size:15px;text-align:center;margin-bottom:4px;}
      .sub{text-align:center;font-size:11px;color:#666;margin-bottom:32px;}
      .titulo{font-weight:bold;text-decoration:underline;margin-bottom:16px;}
      .firma{margin-top:64px;text-align:center;border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#666;}
    </style></head><body>
    <h1>MUNICIPALIDAD</h1>
    <div class="sub">Dirección de Recursos Humanos</div>
    <div class="titulo">${doc.label.toUpperCase()}</div>
    <p>La que suscribe, en su carácter de autoridad competente, hace constar que el/la agente <strong>${nombre}</strong>, DNI N° <strong>${agente.dni}</strong>${agente.cuil ? `, CUIL ${agente.cuil}` : ''}${agente.fecha_ingreso ? `, con ingreso el <strong>${new Date(agente.fecha_ingreso).toLocaleDateString('es-AR')}</strong>` : ''}${antig ? ` (${antig} de servicio)` : ''}, ${doc.frase}</p>
    <p>La presente se expide a pedido de la parte interesada para ser presentada donde corresponda.</p>
    <p>[Localidad], ${fecha}.</p>
    <div class="firma">Firma y Sello Autoridad Competente</div>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 16, padding: 28, maxWidth: 580, width: '95%',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Documento {doc.id}</div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>{doc.label} — {nombre}</div>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: '2px 10px' }}>✕</button>
        </div>

        {/* Preview en papel */}
        <div style={{
          background: '#fff', color: '#111', borderRadius: 10, padding: '24px 28px',
          fontFamily: 'Georgia, serif', lineHeight: 1.75, fontSize: '0.88rem',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>MUNICIPALIDAD</div>
            <div style={{ fontSize: '0.78rem', color: '#555' }}>Dirección de Recursos Humanos</div>
          </div>
          <div style={{ fontWeight: 700, textDecoration: 'underline', marginBottom: 14 }}>
            {doc.label.toUpperCase()}
          </div>
          <p style={{ margin: '0 0 12px 0' }}>
            La que suscribe hace constar que el/la agente <strong>{nombre}</strong>,
            DNI N° <strong>{agente.dni}</strong>
            {agente.cuil ? `, CUIL ${agente.cuil}` : ''}
            {agente.fecha_ingreso ? `, con ingreso el ${new Date(agente.fecha_ingreso).toLocaleDateString('es-AR')}` : ''}
            {antig ? ` (${antig} de servicio)` : ''},{' '}
            {doc.frase}
          </p>
          <p style={{ margin: '0 0 24px 0', color: '#444' }}>
            La presente se expide a pedido de la parte interesada para ser presentada donde corresponda.
          </p>
          <p style={{ color: '#555', fontSize: '0.82rem' }}>[Localidad], {fecha}.</p>
          <div style={{ marginTop: 48, borderTop: '1px solid #ccc', paddingTop: 6, textAlign: 'center', fontSize: '0.75rem', color: '#888' }}>
            Firma y Sello Autoridad Competente
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={imprimirDoc} style={{ background: '#2563eb', color: '#fff' }}>🖨️ Imprimir</button>
          <button className="btn" onClick={() => exportToPdf(`doc_${doc.id}_${agente.dni}`, [{ documento: doc.label, agente: nombre, dni: agente.dni, fecha }])}
            style={{ background: '#dc2626', color: '#fff' }}>📕 PDF</button>
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
        <div className="muted" style={{ fontSize: '0.72rem', marginTop: 8 }}>
          Modelo orientativo. Completar según requerimiento antes de imprimir.
        </div>
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

          {/* ── Grid de botones numerados ── */}
          <div className="card">
            <div style={{ marginBottom: 14 }}>
              <strong>Seleccioná el documento</strong>
              <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>
                Hacé clic en el número para abrir el modelo con los datos del agente
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 10 }}>
              {DOCS.map(doc => (
                <button key={doc.id} onClick={() => setActiveDoc(doc)} title={doc.label}
                  style={{
                    aspectRatio: '1', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)',
                    background: 'rgba(255,255,255,0.05)', cursor: 'pointer',
                    fontSize: '1.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.85)',
                    transition: 'all 0.15s',
                    padding: 0,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(124,58,237,0.3)';
                    e.currentTarget.style.borderColor = '#7c3aed';
                    e.currentTarget.style.transform = 'scale(1.06)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {doc.id}
                </button>
              ))}
            </div>

            {/* Leyenda de referencia */}
            <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
              <div className="muted" style={{ fontSize: '0.7rem', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Referencia</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '3px 16px' }}>
                {DOCS.map(d => (
                  <div key={d.id} style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.55)', display: 'flex', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.75)', minWidth: 18 }}>{d.id}.</span>
                    <span>{d.label}</span>
                  </div>
                ))}
              </div>
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

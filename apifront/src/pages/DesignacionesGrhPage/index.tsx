// src/pages/DesignacionesGrhPage/index.tsx
// Datos para Designaciones del Ministerio (sistema GRH): lo que el agente completó en el
// formulario de Google (estudios, cursos, DDJJ, experiencia, otra repartición, chofer, salud).
// Lista de importados + detalle por agente + importador de la planilla de respuestas.
import React, { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { ImportarFormularioDesignacion } from './ImportarFormularioDesignacion';

type Fila = {
  dni: number; apellido: string; nombre: string; fecha_formulario: string | null;
  revista_otra_reparticion: string | null; es_chofer: number | null; f2p3: number | null;
  nromatricula: string | null; CUD: number | null; CUDtramite: number | null; tiene_salud: number;
  cursos: number; experiencias: number; updated_at: string;
};

const OTRA: Record<string, string> = { no: 'No', mismo_ministerio: 'Mismo ministerio', otro_ministerio: 'Otro organismo' };
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const fecha = (v: any) => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—';
const sn = (v: any) => v === 1 || v === true ? 'Sí' : v === 0 || v === false ? 'No' : '—';

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.5)',
  fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };

function Detalle({ dni, onClose }: { dni: number; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiFetch<{ ok: boolean; data: any }>(`/designaciones-form/${dni}`)
      .then(r => setD(r.data)).catch(e => setError(e?.message ?? 'Error'));
  }, [dni]);

  const x = d?.datos ?? {};
  const salud = d?.salud ?? null;
  const marcadas = salud ? Object.entries(salud)
    .filter(([k, v]) => v === 1 && /^(AV|AA|V|Am|Ac|Aca|Ar|Aal|AN|An|AG|AAN|CUD)/.test(k)).map(([k]) => k) : [];
  const otras = salud ? Object.entries(salud).filter(([k, v]) => /Otras$/.test(k) && v).map(([k, v]) => `${k}: ${v}`) : [];
  const sec: React.CSSProperties = { fontSize: '0.72rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', margin: '14px 0 6px' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 24, width: '100%', maxWidth: 900,
        maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.82rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{x.apellido ? `${x.apellido}, ${x.nombre}` : dni} — DNI {dni}</strong>
          <button onClick={onClose} aria-label="Cerrar"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ color: '#f87171', marginTop: 10 }}>{error}</div>}
        {!d && !error && <div className="muted" style={{ marginTop: 10 }}>⏳ Cargando…</div>}
        {d && (
          <>
            <div className="muted" style={{ fontSize: '0.75rem' }}>Formulario del {fecha(x.fecha_formulario)}</div>

            <div style={sec}>Contacto y estudios</div>
            <div>Mail: {x.email ?? '—'} · Teléfono: {x.telefono ?? '—'}{x.fechaingresoarg ? ` · Ingreso al país: ${fecha(x.fechaingresoarg)}` : ''}</div>
            <div>Secundario: {x.secundario_estado ?? '—'} {x.titulo_secundario ? `(${x.titulo_secundario})` : ''} ·
              Universitario: {x.universitario_estado ?? '—'} {x.titulo_universitario ? `(${x.titulo_universitario})` : ''}</div>

            <div style={sec}>Cursos ({d.cursos.length})</div>
            {d.cursos.map((c: any) => (
              <div key={c.id}>{c.nombrecurso} — {c.institucion ?? '—'} · {fecha(c.fechadesde)} a {fecha(c.fechahasta)}{c.canthoras ? ` · ${c.canthoras} hs` : ''}</div>
            ))}

            <div style={sec}>Declaración jurada</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {Array.from({ length: 17 }, (_, i) => i + 1).map(n => (
                <span key={n} style={{ color: x[`f2p${n}`] === 1 ? '#fbbf24' : undefined }}>{n}: {sn(x[`f2p${n}`])}</span>
              ))}
            </div>
            {x.descripcioncargo && <div>Modalidad de revista: {x.descripcioncargo}</div>}
            {x.f2p3 === 1 && <div>Matrícula: {x.nromatricula ?? '—'} (entidad {x.refEntidadCertificante ?? '—'})</div>}
            {x.cargodesempena && <div>Cargo que desempeña: {x.cargodesempena}</div>}
            {x.expedienterespaldo && <div>Expediente de reserva: {x.expedienterespaldo}</div>}
            {x.fretirovoluntario && <div>Retiro voluntario: {fecha(x.fretirovoluntario)}</div>}

            <div style={sec}>Experiencia laboral ({d.experiencias.length})</div>
            {d.experiencias.map((e: any) => (
              <div key={e.id}>{e.empresa} — {e.cargo ?? '—'} · {fecha(e.fechadesde)} a {e.trabajo_actualmente ? 'actualidad' : fecha(e.fechahasta)}
                {' · '}{e.reftipoactividad === 1 ? 'Pública' : e.reftipoactividad === 2 ? 'Privada' : '—'}</div>
            ))}

            <div style={sec}>Otra repartición</div>
            <div>{OTRA[x.revista_otra_reparticion] ?? '—'}
              {x.nombre_reparticion_otra ? ` · ${x.nombre_reparticion_otra}` : ''}{x.cargo_otra ? ` · ${x.cargo_otra}` : ''}
              {x.regimen_horario_otra ? ` · ${x.regimen_horario_otra} hs` : ''}</div>
            {d.banda.map((b: any) => (
              <div key={b.dia} className="muted">{DIAS[b.dia]}: {String(b.desde).slice(0, 5)}–{String(b.hasta).slice(0, 5)}{b.guardia ? ' (guardia)' : ''}</div>
            ))}

            <div style={sec}>Chofer</div>
            <div>{x.es_chofer === 1 ? `Licencia ${x.nro_licencia ?? '—'} · Inhabilitado: ${sn(x.inhabilitado_conducir)}` : sn(x.es_chofer)}</div>

            <div style={sec}>Salud</div>
            {!salud ? <div className="muted">Sin datos de salud</div> : (
              <>
                <div>Peso {salud.DCpeso ?? '—'} kg · Altura {salud.DCaltura ?? '—'} m · Fuma: {sn(salud.HFumo)} · Alcohol: {sn(salud.HBebeSi)} · Tranquilizantes: {sn(salud.HConsumeSi)}</div>
                <div>Marcado: {marcadas.length ? marcadas.join(', ') : 'nada'}</div>
                {otras.length > 0 && <div>Otras: {otras.join(' · ')}</div>}
                {salud.AQCirugias && <div>Cirugías: {salud.AQCirugias}</div>}
                {salud.CUDPatologia && <div>CUD: {salud.CUDPatologia}</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function DesignacionesGrhPage() {
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [buscar, setBuscar] = useState('');
  const [importando, setImportando] = useState(false);
  const [detalle, setDetalle] = useState<number | null>(null);

  const cargar = () => {
    apiFetch<{ ok: boolean; data: Fila[] }>('/designaciones-form')
      .then(r => setFilas(r.data))
      .catch(e => { setFilas([]); toast.error('No se pudo cargar la lista', e?.message); });
  };
  useEffect(cargar, []);

  const q = buscar.trim().toLowerCase();
  const visibles = (filas ?? []).filter(f => !q || String(f.dni).includes(q) ||
    `${f.apellido} ${f.nombre}`.toLowerCase().includes(q));

  return (
    <Layout title="Datos para Designaciones (Ministerio)">
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input placeholder="Buscar DNI o apellido…" value={buscar} onChange={e => setBuscar(e.target.value)}
            aria-label="Buscar" style={{ flex: '1 1 220px', maxWidth: 320 }} />
          <button onClick={() => setImportando(true)}
            style={{ background: 'rgba(37,99,235,0.8)', color: '#fff', border: 'none', borderRadius: 6,
              padding: '8px 16px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            📥 Importar formulario (Google)
          </button>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {filas === null ? '⏳ Cargando…' : `${visibles.length} agente(s)`}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th style={th}>DNI</th><th style={th}>Agente</th><th style={th}>Formulario</th>
                <th style={th}>Cursos</th><th style={th}>Experiencias</th><th style={th}>Matrícula</th>
                <th style={th}>Otra repartición</th><th style={th}>Chofer</th><th style={th}>Salud</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(f => (
                <tr key={f.dni} onClick={() => setDetalle(f.dni)}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                  <td style={td}>{f.dni}</td>
                  <td style={td}>{f.apellido}, {f.nombre}</td>
                  <td style={td}>{fecha(f.fecha_formulario)}</td>
                  <td style={td}>{f.cursos}</td>
                  <td style={td}>{f.experiencias}</td>
                  <td style={td}>{f.f2p3 === 1 ? (f.nromatricula ?? 'falta el número') : '—'}</td>
                  <td style={td}>{OTRA[f.revista_otra_reparticion ?? ''] ?? '—'}</td>
                  <td style={td}>{sn(f.es_chofer)}</td>
                  <td style={td}>{f.tiene_salud ? (f.CUD ? 'Con CUD' : f.CUDtramite ? 'CUD en trámite' : 'Cargada') : '—'}</td>
                </tr>
              ))}
              {filas !== null && !visibles.length && (
                <tr><td style={td} colSpan={9} className="muted">Todavía no hay respuestas importadas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {importando && <ImportarFormularioDesignacion onClose={() => setImportando(false)} onImportado={cargar} />}
      {detalle !== null && <Detalle dni={detalle} onClose={() => setDetalle(null)} />}
    </Layout>
  );
}

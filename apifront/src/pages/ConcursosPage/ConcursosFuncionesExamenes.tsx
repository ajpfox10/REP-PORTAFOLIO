import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiFetchBlob, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { searchPersonal } from '../../api/searchPersonal';

export type TipoConcurso = 'ingreso' | 'funciones';
export type CargoConcurso = 'sala' | 'servicio' | 'guardia' | 'unidad';

interface Examen {
  id: number; tipo?: TipoConcurso; cargo?: CargoConcurso | null; modalidad?: string | null;
  nombre_cargo?: string | null; tipo_unidad?: string | null; disposicion_llamado?: string | null;
  servicio_id?: number | null; servicio_nombre?: string | null; reparticion_nombre?: string | null;
  ocupacion_id?: number | null; ocupacion_nombre?: string | null; regimen_horario_id?: number | null;
  regimen_horario?: string | null; regimen_horario_nombre?: string | null; dependencia_texto?: string | null;
  resolucion_llamado?: string | null;
  titulo: string; fecha: string; fecha_hasta?: string | null; hora: string | null; lugar: string | null;
  ciudad?: string | null; hospital?: string | null; domicilio?: string | null; hora_cierre?: string | null;
  estado?: string | null; acta_observaciones?: string | null; observaciones: string | null;
  inscriptos_count: number;
}

interface ServicioCat { id: number; nombre: string; reparticion_nombre?: string | null; dependencia_nombre?: string | null; }
interface DependenciaCat { id: number; nombre: string; nombre_formal?: string | null; }
interface OcupacionCat { id: number; nombre: string; regimen_horario_id?: number | null; regimen_horario_nombre?: string | number | null; }
interface RegimenCat { id: number; nombre: string | number; }

interface Inscripto {
  id: number; dni: number; apellido: string | null; nombre: string | null; externo?: number | boolean;
  legajo: number | null; servicio_nombre: string | null; puntaje?: number | string | null;
  orden_prelacion?: number | string | null; estado?: string | null; observaciones?: string | null;
}

interface Jurado {
  id: number; representacion: string; dni?: number | null; apellido_nombre: string;
  profesion?: string | null; especialidad?: string | null; condicion: string;
  asistio: number | boolean; orden: number; observaciones?: string | null;
}

const emptyForm = {
  titulo: '', resolucion_llamado: '', disposicion_llamado: '', fecha: '', fecha_hasta: '', hora: '', lugar: '',
  modalidad: 'CERRADO', cargo: 'sala' as CargoConcurso, nombre_cargo: '', tipo_unidad: '',
  servicio_id: '', dependencia_id: '', ocupacion_id: '', regimen_horario_id: '', regimen_horario: '', dependencia_texto: '',
  ciudad: 'GONZALEZ CATAN', hospital: '', domicilio: '', hora_cierre: '', estado: 'BORRADOR',
  acta_observaciones: '', observaciones: '',
};

function modalidadFor(tipo: TipoConcurso, cargo?: CargoConcurso | null): 'ABIERTO' | 'CERRADO' {
  if (tipo === 'ingreso') return 'ABIERTO';
  return cargo === 'servicio' ? 'ABIERTO' : 'CERRADO';
}

function emptyFormFor(tipo: TipoConcurso) {
  return { ...emptyForm, modalidad: modalidadFor(tipo, emptyForm.cargo) };
}

function withModalidadRegla<T extends typeof emptyForm>(tipo: TipoConcurso, next: T): T {
  return { ...next, modalidad: modalidadFor(tipo, next.cargo) };
}
const emptyJurado = {
  representacion: 'MINISTERIO', dni: '', apellido_nombre: '', profesion: '', especialidad: '',
  condicion: 'TITULAR', asistio: true, orden: '1', observaciones: '',
};
const REPRESENTACIONES = [
  ['MINISTERIO', 'Ministerio de Salud (Presidente)'],
  ['ESCALAFONADO_1', 'Escalafonado 1º'],
  ['ESCALAFONADO_2', 'Escalafonado 2º'],
  ['COLEGIO', 'Colegio profesional'],
  ['GREMIO', 'Entidad gremial'],
];
const ESTADOS_INSCRIPTO = ['INSCRIPTO', 'PRESENTE', 'AUSENTE', 'APROBADO', 'DESAPROBADO', 'IMPUGNADO'];
type FormMode = 'llamado' | 'acta';
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 14, marginBottom: 16 };
const grid = (cols: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(150px, 1fr))`, gap: 8 });

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtFecha(v?: string | null) {
  if (!v) return '—';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function dependenciaDesdeServicio(s?: ServicioCat | null) {
  const base = `${s?.reparticion_nombre ?? ''} ${s?.nombre ?? ''} ${s?.dependencia_nombre ?? ''}`.toUpperCase();
  if (base.includes('UPA 4') || base.includes('UPA4')) return 'UNIDAD DE PRONTA ATENCION 4 N°(1699)';
  if (base.includes('UPA 18') || base.includes('UPA18')) return 'UNIDAD DE PRONTA ATENCION N°18(1826)';
  if (base.includes('HIGA') || base.includes('HTAL') || base.includes('HOSPITAL')) return 'HIGA SIMPLEMENTE EVITA';
  return s?.reparticion_nombre || s?.dependencia_nombre || '';
}

function dependenciaFormal(d?: DependenciaCat | null) {
  return d?.nombre_formal || d?.nombre || '';
}

function diasHasta(v: string) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - hoy.getTime()) / 86400000);
}

export function ConcursosFuncionesBanner() {
  const [rows, setRows] = useState<Examen[]>([]);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    apiFetch<any>('/herramientas/concurso-funciones/alertas').then(r => setRows(Array.isArray(r?.data) ? r.data : [])).catch(() => {});
  }, []);
  if (dismissed || !rows.length) return null;
  return (
    <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(99,102,241,0.12)', border: '2px solid rgba(99,102,241,0.55)', borderRadius: 12, display: 'flex', gap: 12 }}>
      <span style={{ fontSize: '1.4rem' }}>🏆</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: 5 }}>Concursos: {rows.length} examen{rows.length !== 1 ? 'es' : ''} en los próximos 6 días</div>
        {rows.map(r => {
          const dias = diasHasta(r.fecha);
          return <div key={r.id} style={{ fontSize: '0.84rem', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
            <strong>{r.titulo}</strong><span>{fmtFecha(r.fecha)}{r.hora ? ` · ${r.hora} hs` : ''}</span>
            <span style={{ color: '#a5b4fc', fontWeight: 700 }}>{dias === 0 ? 'hoy' : `en ${dias} día${dias !== 1 ? 's' : ''}`}</span>
            <span className="muted">· {Number(r.inscriptos_count)} inscripto{Number(r.inscriptos_count) !== 1 ? 's' : ''}</span>
          </div>;
        })}
      </div>
      <button type="button" onClick={() => setDismissed(true)} style={{ background: 'none', border: 0, color: '#94a3b8', cursor: 'pointer' }}>×</button>
    </div>
  );
}

export function ConcursosFuncionesExamenes({ tipo = 'funciones' }: { tipo?: TipoConcurso }) {
  const toast = useToast();
  const [examenes, setExamenes] = useState<Examen[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inscriptos, setInscriptos] = useState<Inscripto[]>([]);
  const [jurados, setJurados] = useState<Jurado[]>([]);
  const [form, setForm] = useState(() => emptyFormFor(tipo));
  const [formMode, setFormMode] = useState<FormMode>('llamado');
  const [juradoForm, setJuradoForm] = useState(emptyJurado);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [externoOpen, setExternoOpen] = useState(false);
  const [extDni, setExtDni] = useState(''); const [extApellido, setExtApellido] = useState(''); const [extNombre, setExtNombre] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actaLoading, setActaLoading] = useState(false);
  const [dependencias, setDependencias] = useState<DependenciaCat[]>([]);
  const [servicios, setServicios] = useState<ServicioCat[]>([]);
  const [ocupaciones, setOcupaciones] = useState<OcupacionCat[]>([]);
  const [regimenes, setRegimenes] = useState<RegimenCat[]>([]);

  const cargarExamenes = useCallback(async () => {
    const r = await apiFetch<any>(`/herramientas/concurso-funciones/examenes?tipo=${tipo}`);
    const data = Array.isArray(r?.data) ? r.data : [];
    setExamenes(data);
    setSelectedId(prev => prev && data.some((e: Examen) => e.id === prev) ? prev : (data[0]?.id ?? null));
  }, [tipo]);
  const cargarDetalle = useCallback(async (id: number | null) => {
    if (!id) { setInscriptos([]); setJurados([]); return; }
    const [i, j] = await Promise.all([
      apiFetch<any>(`/herramientas/concurso-funciones/examenes/${id}/inscriptos`),
      apiFetch<any>(`/herramientas/concurso-funciones/examenes/${id}/jurados`),
    ]);
    setInscriptos(Array.isArray(i?.data) ? i.data : []);
    setJurados(Array.isArray(j?.data) ? j.data : []);
  }, []);
  useEffect(() => { cargarExamenes().catch(e => toast.error('Error', e?.message)); }, [cargarExamenes, toast]);
  useEffect(() => { cargarDetalle(selectedId).catch(e => toast.error('Error', e?.message)); }, [selectedId, cargarDetalle, toast]);
  useEffect(() => {
    apiFetch<any>('/herramientas/concurso-funciones/catalogos')
      .then(r => {
        setDependencias(Array.isArray(r?.data?.dependencias) ? r.data.dependencias : []);
        setServicios(Array.isArray(r?.data?.servicios) ? r.data.servicios : []);
        setOcupaciones(Array.isArray(r?.data?.ocupaciones) ? r.data.ocupaciones : []);
        setRegimenes(Array.isArray(r?.data?.regimenes) ? r.data.regimenes : []);
      })
      .catch(e => toast.error('Error cargando catálogos', e?.message));
  }, [toast]);

  const setField = (key: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));
  const setCargo = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cargo = e.target.value as CargoConcurso;
    setForm(prev => withModalidadRegla(tipo, { ...prev, cargo }));
  };
  const setServicio = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const srv = servicios.find(s => String(s.id) === id);
    setForm(prev => ({ ...prev, servicio_id: id, dependencia_texto: dependenciaDesdeServicio(srv) || prev.dependencia_texto }));
  };
  const setDependencia = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const dep = dependencias.find(d => String(d.id) === id);
    setForm(prev => ({
      ...prev,
      dependencia_id: id,
      servicio_id: '',
      dependencia_texto: dependenciaFormal(dep) || prev.dependencia_texto,
      ciudad: 'GONZALEZ CATAN',
    }));
  };
  const setOcupacion = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const oc = ocupaciones.find(o => String(o.id) === id);
    const regimenId = oc?.regimen_horario_id ? String(oc.regimen_horario_id) : '';
    const regimen = oc?.regimen_horario_nombre != null ? String(oc.regimen_horario_nombre) : '';
    setForm(prev => ({
      ...prev,
      ocupacion_id: id,
      nombre_cargo: oc?.nombre || prev.nombre_cargo,
      regimen_horario_id: regimenId || prev.regimen_horario_id,
      regimen_horario: regimen || prev.regimen_horario,
    }));
  };
  const setRegimen = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const reg = regimenes.find(r => String(r.id) === id);
    setForm(prev => ({ ...prev, regimen_horario_id: id, regimen_horario: reg ? String(reg.nombre) : prev.regimen_horario }));
  };

  const formFromExamen = (e: Examen) => {
    const cargo = e.cargo ?? 'sala';
    const dependenciaId = dependencias.find(d => {
      const saved = (e.dependencia_texto || '').toUpperCase();
      return saved && (saved === dependenciaFormal(d).toUpperCase() || saved.includes(d.nombre.toUpperCase()));
    })?.id;
    return withModalidadRegla(tipo, {
      ...emptyForm, titulo: e.titulo, disposicion_llamado: e.disposicion_llamado ?? '', fecha: e.fecha,
      resolucion_llamado: e.resolucion_llamado ?? '',
      fecha_hasta: e.fecha_hasta ?? '', hora: e.hora ?? '', lugar: e.lugar ?? '', modalidad: (e.modalidad === 'ABIERTO' || e.modalidad === 'CERRADO') ? e.modalidad : modalidadFor(tipo, cargo),
      cargo, nombre_cargo: e.nombre_cargo ?? '', tipo_unidad: e.tipo_unidad ?? '',
      servicio_id: e.servicio_id ? String(e.servicio_id) : '', dependencia_id: dependenciaId ? String(dependenciaId) : '', ocupacion_id: e.ocupacion_id ? String(e.ocupacion_id) : '',
      regimen_horario_id: e.regimen_horario_id ? String(e.regimen_horario_id) : '',
      regimen_horario: e.regimen_horario ?? (e.regimen_horario_nombre != null ? String(e.regimen_horario_nombre) : ''),
      dependencia_texto: e.dependencia_texto ?? '',
      ciudad: e.ciudad ?? 'GONZALEZ CATAN', hospital: e.hospital ?? '', domicilio: e.domicilio ?? '', hora_cierre: e.hora_cierre ?? '',
      estado: e.estado ?? 'BORRADOR', acta_observaciones: e.acta_observaciones ?? '', observaciones: e.observaciones ?? '',
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormMode('llamado');
    setForm(emptyFormFor(tipo));
  };

  const guardar = async () => {
    if (!form.titulo.trim() || !form.disposicion_llamado.trim() || !form.fecha) return toast.error('Faltan datos', 'Título, disposición y fecha desde son obligatorios.');
    const payload = {
      ...withModalidadRegla(tipo, form),
      tipo,
      servicio_id: tipo === 'ingreso' ? '' : form.servicio_id,
      ciudad: 'GONZALEZ CATAN',
    };
    setSaving(true);
    try {
      await apiFetch(`/herramientas/concurso-funciones/examenes${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      toast.ok(formMode === 'acta' ? 'Acta actualizada' : editingId ? 'Llamado actualizado' : 'Llamado creado');
      resetForm(); await cargarExamenes();
    } catch (e: any) { toast.error('Error guardando llamado', e?.message); } finally { setSaving(false); }
  };
  const editar = (e: Examen) => {
    setEditingId(e.id);
    setFormMode('llamado');
    setForm(formFromExamen(e));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cargarActa = (e?: Examen | null) => {
    const row = e ?? selected;
    if (!row) return;
    setSelectedId(row.id);
    setEditingId(row.id);
    setFormMode('acta');
    setForm(formFromExamen(row));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const eliminar = async (e: Examen) => {
    if (!window.confirm(`¿Eliminar el llamado "${e.titulo}"?`)) return;
    await apiFetch(`/herramientas/concurso-funciones/examenes/${e.id}`, { method: 'DELETE' });
    await cargarExamenes();
  };

  const inscribir = async (dniValue: string, ext?: { apellido: string; nombre: string }) => {
    const clean = dniValue.replace(/\D/g, '');
    if (!selectedId || !clean) return toast.error('Ingresá un DNI');
    try {
      await apiFetch(`/herramientas/concurso-funciones/examenes/${selectedId}/inscriptos`, { method: 'POST', body: JSON.stringify({ dni: clean, ...(ext ?? {}) }) });
      setBusca(''); setMatches([]); setExtDni(''); setExtApellido(''); setExtNombre(''); setExternoOpen(false);
      await Promise.all([cargarDetalle(selectedId), cargarExamenes()]);
    } catch (e: any) { toast.error('No se pudo inscribir', e?.message); }
  };
  const buscarOInscribir = async () => {
    const q = busca.trim(); if (!q) return;
    if (/^[\d.\s]+$/.test(q)) return inscribir(q);
    try { setMatches((await searchPersonal(q)).slice(0, 8)); } catch (e: any) { toast.error('No se pudo buscar', e?.message); }
  };
  const guardarResultado = async (r: Inscripto) => {
    if (!selectedId) return;
    await apiFetch(`/herramientas/concurso-funciones/examenes/${selectedId}/inscriptos/${r.dni}`, { method: 'PUT', body: JSON.stringify(r) });
    toast.ok('Resultado guardado'); await cargarDetalle(selectedId);
  };
  const cambiarInscripto = (id: number, key: keyof Inscripto, value: any) =>
    setInscriptos(prev => prev.map(r => r.id === id ? { ...r, [key]: value } : r));

  const agregarJurado = async () => {
    if (!selectedId) return;
    try {
      await apiFetch(`/herramientas/concurso-funciones/examenes/${selectedId}/jurados`, { method: 'POST', body: JSON.stringify(juradoForm) });
      setJuradoForm(emptyJurado); await cargarDetalle(selectedId);
    } catch (e: any) { toast.error('No se pudo agregar jurado', e?.message); }
  };
  const quitarJurado = async (id: number) => {
    if (!selectedId || !window.confirm('¿Quitar este jurado?')) return;
    await apiFetch(`/herramientas/concurso-funciones/examenes/${selectedId}/jurados/${id}`, { method: 'DELETE' });
    await cargarDetalle(selectedId);
  };
  const verActa = async () => {
    if (!selectedId) return;
    setActaLoading(true);
    try {
      const blob = await apiFetchBlob(`/herramientas/concurso-funciones/examenes/${selectedId}/acta/preview`);
      setPreviewHtml(await blob.text()); setPreviewOpen(true);
    } catch (e: any) { toast.error('No se pudo generar la vista previa', e?.message); }
    finally { setActaLoading(false); }
  };
  const descargarActa = async () => {
    if (!selectedId) return;
    setActaLoading(true);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta(`/herramientas/concurso-funciones/examenes/${selectedId}/acta/docx`);
      triggerDownload(blob, filename || `acta_concurso_${selectedId}.docx`);
    } catch (e: any) { toast.error('No se pudo descargar el acta', e?.message); }
    finally { setActaLoading(false); }
  };
  const imprimirActa = () => {
    if (!previewHtml) return;
    const w = window.open('', '_blank');
    if (!w) return toast.error('El navegador bloqueó la ventana de impresión');
    w.document.write(previewHtml); w.document.close(); w.focus(); w.print();
  };
  const selected = examenes.find(e => e.id === selectedId);

  return (
    <>
      <div style={{ ...card, background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(129,140,248,0.35)' }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>{formMode === 'acta' ? 'Cargar acta' : 'Datos del llamado'}</div>
        {formMode === 'llamado' ? <>
        <div style={grid(3)}>
          <input className="input" value={form.resolucion_llamado} onChange={setField('resolucion_llamado')} placeholder="Nº resolución del llamado (#R#)" />
          <input className="input" value={form.disposicion_llamado} onChange={setField('disposicion_llamado')} placeholder="Nº disposición del llamado *" />
          <input className="input" value={form.titulo} onChange={setField('titulo')} placeholder="Título del concurso *" />
          <input className="input" value={form.nombre_cargo} onChange={setField('nombre_cargo')} placeholder="Nombre completo del cargo / función" />
          {tipo === 'ingreso' ? <select className="input" value={form.dependencia_id} onChange={setDependencia} title="Dependencia del llamado">
            <option value="">Dependencia</option>
            {dependencias.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select> : <select className="input" value={form.servicio_id} onChange={setServicio} title="Servicio / dependencia del llamado">
            <option value="">Servicio / dependencia</option>
            {servicios.map(s => <option key={s.id} value={s.id}>{s.reparticion_nombre ? `${s.reparticion_nombre} - ` : ''}{s.nombre}</option>)}
          </select>}
          <select className="input" value={form.ocupacion_id} onChange={setOcupacion} title="Ocupacion / cargo de base">
            <option value="">Ocupacion / cargo de base</option>
            {ocupaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <select className="input" value={form.regimen_horario_id} onChange={setRegimen} title="Regimen horario">
            <option value="">Regimen horario</option>
            {regimenes.map(r => <option key={r.id} value={r.id}>{String(r.nombre)}</option>)}
          </select>
          <input className="input" value={form.regimen_horario} onChange={setField('regimen_horario')} placeholder="Regimen horario editable (#REGIMENHORARIO#)" />
          <input className="input" value={form.dependencia_texto} onChange={setField('dependencia_texto')} placeholder="Dependencia editable (#DEPENDENCIA#)" />
          <label className="muted">Fecha desde *<input className="input" type="date" value={form.fecha} onChange={setField('fecha')} /></label>
          <label className="muted">Fecha hasta<input className="input" type="date" value={form.fecha_hasta} onChange={setField('fecha_hasta')} /></label>
          <input
            className="input"
            value={form.modalidad === 'ABIERTO' ? 'Concurso abierto' : 'Concurso cerrado'}
            readOnly
            title="Modalidad definida automaticamente por tipo de concurso"
          />
          {tipo === 'funciones' && <>
            <select className="input" value={form.cargo} onChange={setCargo}>
              <option value="servicio">Jefatura de Servicio</option><option value="sala">Jefatura de Sala</option>
              <option value="guardia">Jefatura de Guardia</option><option value="unidad">Jefatura de Unidad</option>
            </select>
            {form.cargo === 'unidad' && <select className="input" value={form.tipo_unidad} onChange={setField('tipo_unidad')}><option value="">Tipo de unidad</option><option value="INTERNACION">Internación</option><option value="CONSULTA">Consulta</option></select>}
          </>}
          <select className="input" value={form.estado} onChange={setField('estado')}><option>BORRADOR</option><option>EN_CURSO</option><option>CERRADO</option><option>ACTA_DEFINITIVA</option></select>
        </div>
        <textarea className="input" value={form.observaciones} onChange={setField('observaciones')} placeholder="Observaciones del llamado" style={{ width: '100%', marginTop: 8 }} />
        </> : <>
        <div style={{ ...card, marginBottom: 10, background: 'rgba(15,23,42,.35)' }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{form.titulo || 'Llamado seleccionado'}</div>
          <div style={grid(3)}>
            <span className="muted">Disp. {form.disposicion_llamado || 'sin cargar'}</span>
            <span className="muted">Resol. {form.resolucion_llamado || 'sin cargar'}</span>
            <span className="muted">Fecha {fmtFecha(form.fecha)}</span>
            <span className="muted">Cargo {form.nombre_cargo || form.cargo || 'sin cargar'}</span>
            <span className="muted">Dependencia {form.dependencia_texto || 'sin cargar'}</span>
            <span className="muted">Regimen {form.regimen_horario || 'sin cargar'}</span>
            <span className="muted">Localidad GONZALEZ CATAN</span>
          </div>
        </div>
        <div style={grid(3)}>
          <label className="muted">Hora de finalizacion<input className="input" type="time" value={form.hora_cierre} onChange={setField('hora_cierre')} /></label>
          <select className="input" value={form.estado} onChange={setField('estado')}><option>BORRADOR</option><option>EN_CURSO</option><option>CERRADO</option><option>ACTA_DEFINITIVA</option></select>
        </div>
        <textarea className="input" value={form.acta_observaciones} onChange={setField('acta_observaciones')} placeholder="Observaciones para el acta definitiva" style={{ width: '100%', marginTop: 8 }} />
        </>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : formMode === 'acta' ? 'Guardar acta' : editingId ? 'Guardar llamado' : 'Agregar llamado'}</button>
          {(editingId || formMode === 'acta') && <button className="btn" onClick={resetForm}>Cancelar</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, .7fr) minmax(600px, 1.8fr)', gap: 16 }}>
        <div style={card}>
          <strong>Llamados cargados</strong>
          {examenes.map(e => <div key={e.id} onClick={() => setSelectedId(e.id)} style={{ marginTop: 8, padding: 10, borderRadius: 8, cursor: 'pointer', border: selectedId === e.id ? '1px solid #818cf8' : '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontWeight: 700 }}>{e.titulo}</div>
            <div className="muted" style={{ fontSize: '.75rem' }}>Disp. {e.disposicion_llamado || 'sin cargar'} · {fmtFecha(e.fecha)} a {fmtFecha(e.fecha_hasta)}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}><button className="btn" onClick={ev => { ev.stopPropagation(); editar(e); }}>Editar llamado</button><button className="btn primary" onClick={ev => { ev.stopPropagation(); cargarActa(e); }}>Cargar acta</button><button className="btn" onClick={ev => { ev.stopPropagation(); eliminar(e); }}>Eliminar</button></div>
          </div>)}
        </div>

        <div>
          {selected && <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: 'rgba(16,185,129,.45)' }}>
            <strong style={{ marginRight: 'auto' }}>Acta · Disposición {selected.disposicion_llamado || 'sin completar'}</strong>
            <button className="btn primary" onClick={() => cargarActa(selected)}>Cargar acta</button>
            <button className="btn primary" onClick={verActa} disabled={actaLoading}>{actaLoading ? 'Generando...' : 'Vista previa del acta'}</button>
            <button className="btn" onClick={descargarActa} disabled={actaLoading}>Descargar Word</button>
          </div>}
          <div style={card}>
            <strong>Inscriptos y orden de prelación{selected ? ` · ${selected.titulo}` : ''}</strong>
            {selected && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="input" value={busca} onChange={e => { setBusca(e.target.value); setMatches([]); }} onKeyDown={e => e.key === 'Enter' && buscarOInscribir()} placeholder="DNI o apellido" style={{ flex: 1 }} />
              <button className="btn primary" onClick={buscarOInscribir}>Inscribir</button>
              <button className="btn" onClick={() => setExternoOpen(v => !v)}>Cargar externo</button>
            </div>}
            {matches.map(m => <button key={m.dni} className="btn" onClick={() => inscribir(String(m.dni))} style={{ margin: '5px 5px 0 0' }}>{m.apellido}, {m.nombre}</button>)}
            {externoOpen && <div style={{ ...grid(4), marginTop: 8 }}><input className="input" value={extDni} onChange={e => setExtDni(e.target.value)} placeholder="DNI" /><input className="input" value={extApellido} onChange={e => setExtApellido(e.target.value)} placeholder="Apellido" /><input className="input" value={extNombre} onChange={e => setExtNombre(e.target.value)} placeholder="Nombre" /><button className="btn primary" onClick={() => inscribir(extDni, { apellido: extApellido, nombre: extNombre })}>Agregar</button></div>}
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.76rem' }}>
                <thead><tr>{['DNI / Nombre', 'Puntaje', 'Orden', 'Estado', 'Observaciones', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: 6 }}>{h}</th>)}</tr></thead>
                <tbody>{inscriptos.map(r => <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
                  <td style={{ padding: 6 }}><strong>{r.apellido}, {r.nombre}</strong><br /><span className="muted">{r.dni}</span></td>
                  <td><input className="input" type="number" step="0.001" value={r.puntaje ?? ''} onChange={e => cambiarInscripto(r.id, 'puntaje', e.target.value)} style={{ width: 85 }} /></td>
                  <td><input className="input" type="number" value={r.orden_prelacion ?? ''} onChange={e => cambiarInscripto(r.id, 'orden_prelacion', e.target.value)} style={{ width: 65 }} /></td>
                  <td><select className="input" value={r.estado ?? 'INSCRIPTO'} onChange={e => cambiarInscripto(r.id, 'estado', e.target.value)}>{ESTADOS_INSCRIPTO.map(x => <option key={x}>{x}</option>)}</select></td>
                  <td><input className="input" value={r.observaciones ?? ''} onChange={e => cambiarInscripto(r.id, 'observaciones', e.target.value)} /></td>
                  <td><button className="btn primary" onClick={() => guardarResultado(r)}>Guardar</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <strong>Jurados asociados a la disposición</strong>
            {selected && <div style={{ ...grid(4), marginTop: 10 }}>
              <select className="input" value={juradoForm.representacion} onChange={e => setJuradoForm(p => ({ ...p, representacion: e.target.value }))}>{REPRESENTACIONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input className="input" value={juradoForm.apellido_nombre} onChange={e => setJuradoForm(p => ({ ...p, apellido_nombre: e.target.value }))} placeholder="Apellido y nombre *" />
              <input className="input" value={juradoForm.profesion} onChange={e => setJuradoForm(p => ({ ...p, profesion: e.target.value }))} placeholder="Profesión" />
              <input className="input" value={juradoForm.especialidad} onChange={e => setJuradoForm(p => ({ ...p, especialidad: e.target.value }))} placeholder="Especialidad" />
              <input className="input" value={juradoForm.dni} onChange={e => setJuradoForm(p => ({ ...p, dni: e.target.value }))} placeholder="DNI opcional" />
              <select className="input" value={juradoForm.condicion} onChange={e => setJuradoForm(p => ({ ...p, condicion: e.target.value }))}><option>TITULAR</option><option>SUPLENTE</option></select>
              <input className="input" type="number" value={juradoForm.orden} onChange={e => setJuradoForm(p => ({ ...p, orden: e.target.value }))} placeholder="Orden" />
              <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><input type="checkbox" checked={juradoForm.asistio} onChange={e => setJuradoForm(p => ({ ...p, asistio: e.target.checked }))} /> Asistió</label>
              <input className="input" value={juradoForm.observaciones} onChange={e => setJuradoForm(p => ({ ...p, observaciones: e.target.value }))} placeholder="Observaciones del jurado" />
              <button className="btn primary" onClick={agregarJurado}>Agregar jurado</button>
            </div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem', marginTop: 10 }}>
              <thead><tr>{['Representación', 'Apellido y nombre', 'Profesión', 'Especialidad', 'Condición', 'Asistencia', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: 6 }}>{h}</th>)}</tr></thead>
              <tbody>{jurados.map(j => <tr key={j.id} style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}><td style={{ padding: 6 }}>{j.representacion}</td><td>{j.apellido_nombre}</td><td>{j.profesion || '—'}</td><td>{j.especialidad || '—'}</td><td>{j.condicion}</td><td>{j.asistio ? 'PRESENTE' : 'AUSENTE'}</td><td><button className="btn" onClick={() => quitarJurado(j.id)}>Quitar</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      {previewOpen && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 9999, padding: 24, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={imprimirActa}>Imprimir</button>
          <button className="btn" onClick={descargarActa}>Descargar Word</button>
          <button className="btn" onClick={() => setPreviewOpen(false)}>Cerrar</button>
        </div>
        <iframe title="Vista previa del acta" srcDoc={previewHtml} style={{ flex: 1, width: '100%', border: 0, borderRadius: 8, background: '#fff' }} />
      </div>}
    </>
  );
}

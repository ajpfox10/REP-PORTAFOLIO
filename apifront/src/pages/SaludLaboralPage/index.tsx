// src/pages/SaludLaboralPage/index.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../ui/toast';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel, exportToPdf } from '../../utils/export';
import { ReclamosLicenciasMedicasTab } from './ReclamosLicenciasMedicasTab';

// ─── Leyes becados/residentes ─────────────────────────────────────────────────
const LEYES_BECADOS = [6, 7, 8, 9, 10, 11, 12, 13];

// ─── Turnos para tareas livianas ──────────────────────────────────────────────
const TURNOS = ['Mañana', 'Tarde', 'Noche', 'Rotativo'];

// ─── TIPOS ───────────────────────────────────────────────────────────────────

interface Persona {
  dni: number | string;
  apellido: string;
  nombre: string;
  cuil?: string;
  ley?: string;
  dependencia_nombre?: string;
  servicio_nombre?: string;
  estado_empleo?: string;
}

interface ReconocimientoMedico {
  id: number;
  dni: string;
  fecha: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  cantidad_dias: number | null;
  tipo: string | null;
  resultado: string | null;
  observaciones: string | null;
  procesado: boolean | number | null;
  created_at: string;
  updated_at: string;
  created_by_nombre: string | null;
  created_by_email: string | null;
  updated_by_nombre: string | null;
  updated_by_email: string | null;
}

interface ExamenAnual {
  id: number;
  dni: string;
  anio: number;
  fecha_examen: string;
  resultado: string | null;
  observaciones: string | null;
  realizado: boolean | number | null;
  created_at: string;
  updated_at: string;
  created_by_nombre: string | null;
  created_by_email: string | null;
  updated_by_nombre: string | null;
  updated_by_email: string | null;
}

type Tab = 'reconocimientos' | 'examenes' | 'reclamos' | 'tareas';

interface TareaLiviana {
  id: number;
  agente_dni: string;
  agente_nombre: string | null;
  servicio: string | null;
  turno: string | null;
  fecha_desde: string;
  fecha_hasta: string | null;
  cantidad_dias: number | null;
  junta_medica_doc_id: number | null;
  observaciones: string | null;
  creado_por_email: string | null;
  creado_at: string;
  horas_desde_carga?: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isWithin24h(createdAt: string): boolean {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

function fmt(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); }
}

function calcDias(desde: string, hasta: string): number | null {
  if (!desde || !hasta) return null;
  try {
    const d1 = new Date(desde).getTime();
    const d2 = new Date(hasta).getTime();
    if (isNaN(d1) || isNaN(d2) || d2 < d1) return null;
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
  } catch { return null; }
}

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── HOOK: lista de becados (carga una sola vez) ──────────────────────────────

function useAllBecados() {
  const toast = useToast();
  const [allBecados, setAllBecados] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setLoading(true);
    (async () => {
      try {
        let agentes: any[] = [];
         let agPage = 1;
         let agTotal = Infinity;
          while (agentes.length < agTotal) {
            const agRes = await apiFetch<any>(`/agentes?limit=200&page=${agPage}`);
        const rows: any[] = agRes?.data || [];
         if (!rows.length) break;
         agentes = [...agentes, ...rows];
        if (agRes?.meta?.total) agTotal = Number(agRes.meta.total);
        else agTotal = agentes.length;
      if (rows.length < 200) break;
       agPage++;
       }
        const dnisBecados = new Set(
          agentes
            .filter(a => LEYES_BECADOS.includes(Number(a.ley_id)) && a.estado_empleo === 'ACTIVO')
            .map(a => String(a.dni))
        );
        if (!dnisBecados.size) return;

        let all: any[] = [];
        let page = 1;
        let total = Infinity;
        while (all.length < total) {
          const res = await apiFetch<any>(`/personal?limit=200&page=${page}`);
          const rows: any[] = res?.data || [];
          if (!rows.length) break;
          all = [...all, ...rows];
          if (res?.meta?.total) total = Number(res.meta.total);
          else total = all.length;
          if (rows.length < 200) break;
          page++;
        }

        const leyMap = new Map(agentes.map(a => [String(a.dni), a]));
        const becados: Persona[] = all
          .filter(p => dnisBecados.has(String(p.dni)))
          .map(p => {
            const ag = leyMap.get(String(p.dni));
            return {
              dni: p.dni,
              apellido: p.apellido || '',
              nombre: p.nombre || '',
              cuil: p.cuil,
              ley: ag?.ley_nombre,
              dependencia_nombre: ag?.dependencia_nombre,
              estado_empleo: ag?.estado_empleo,
            };
          });
        becados.sort((a, b) => a.apellido.localeCompare(b.apellido));
        setAllBecados(becados);
      } catch (e: any) {
        toast.error('Error cargando becados', e?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { allBecados, loading };
}

// ─── HOOK: buscador DNI + Apellido/Nombre (igual a GestionPage) ──────────────
// mode='becados' filtra sobre lista local; mode='todos' usa API/searchPersonal

function useLiveSearch(mode: 'becados' | 'todos', allBecados: Persona[]) {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [fullName, setFullName] = useState('');
  const [matches, setMatches] = useState<Persona[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selected, setSelected] = useState<Persona | null>(null);

  // Limpiar al cambiar de tab
  useEffect(() => {
    setDni(''); setFullName(''); setMatches([]); setSelected(null);
  }, [mode]);

  // ── Buscar por DNI ──
  async function onSearchDni(override?: string) {
    const clean = (override ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido', 'Ingresá un DNI válido'); return; }
    setMatches([]); setSelected(null);

    if (mode === 'becados') {
      const found = allBecados.find(b => String(b.dni).replace(/\D/g, '') === clean);
      if (found) { setSelected(found); }
      else { toast.error('No encontrado', `Sin becado con DNI ${clean}`); }
    } else {
      setLoadingSearch(true);
      try {
        const res = await apiFetch<any>(`/personal/${clean}`);
        if (res?.ok && res?.data) {
          const r = { ...res.data }; if (!r.dni) r.dni = clean;
          setSelected({ dni: r.dni, apellido: r.apellido || '', nombre: r.nombre || '', cuil: r.cuil, estado_empleo: r.estado_empleo, dependencia_nombre: r.dependencia, servicio_nombre: r.servicio_nombre });
          toast.ok('Agente cargado', `${r.apellido ?? ''}, ${r.nombre ?? ''}`);
        } else { toast.error('No encontrado', `Sin agente con DNI ${clean}`); }
      } catch (e: any) { toast.error('Error', e?.message); }
      finally { setLoadingSearch(false); }
    }
  }

  // ── Buscar por Apellido/Nombre ──
  async function onSearchName() {
    const q = fullName.trim();
    if (!q) { toast.error('Búsqueda inválida', 'Ingresá apellido y/o nombre'); return; }
    setMatches([]); setSelected(null);

    if (mode === 'becados') {
      const nq = normalize(q);
      const filtered = allBecados.filter(b => {
        const ape = normalize(b.apellido);
        const nom = normalize(b.nombre);
        return ape.includes(nq) || nom.includes(nq) || `${ape} ${nom}`.includes(nq);
      });
      setMatches(filtered.slice(0, 30));
      if (!filtered.length) toast.error('Sin resultados', `No se encontró "${q}" en becados`);
      else toast.ok(`${filtered.length} resultado(s)`);
    } else {
      setLoadingSearch(true);
      try {
        const results = await searchPersonal(q);
        setMatches((results as Persona[]).slice(0, 30));
        if (!results.length) toast.error('Sin resultados', `No se encontró "${q}"`);
        else toast.ok(`${results.length} resultado(s)`);
      } catch (e: any) { toast.error('Error al buscar', e?.message); }
      finally { setLoadingSearch(false); }
    }
  }

  const select = (p: Persona) => { setSelected(p); setMatches([]); setDni(''); setFullName(''); };
  const clear  = () => { setSelected(null); setMatches([]); setDni(''); setFullName(''); };

  return { dni, setDni, fullName, setFullName, matches, loadingSearch, selected, onSearchDni, onSearchName, select, clear };
}

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────────────────────

export function SaludLaboralPage() {
  const { canCrud, hasPerm, session } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const isAdmin = hasPerm('crud:*:*');
  // Visible a admin y user (cualquier permiso de tabla comodín), NO a salud_laboral (permisos tabla-específicos)
  const canSeeProcesado = hasPerm('crud:*:read');
  // Tareas livianas: visible a admin + user (mismo criterio que canSeeProcesado)
  const canTareas = hasPerm('crud:*:read');

  const [tab, setTab] = useState<Tab>('reconocimientos');

  // Lista de becados cargada una vez
  const { allBecados, loading: loadingBecados } = useAllBecados();

  // Buscador para reconocimientos (solo becados)
  const recSearch = useLiveSearch('becados', allBecados);
  // Buscador para examen anual (todos los agentes)
  const examSearch = useLiveSearch('todos', allBecados);

  // ── Reconocimientos ──
  const [allRecs, setAllRecs] = useState<ReconocimientoMedico[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [editingRec, setEditingRec] = useState<ReconocimientoMedico | null>(null);
  const [formRec, setFormRec] = useState({ fecha: '', fecha_desde: '', fecha_hasta: '', cantidad_dias: '', tipo: '', resultado: '', observaciones: '', ausentismo: false });
  const [savingRec, setSavingRec] = useState(false);
  const [procesadoLoading, setProcesadoLoading] = useState<number | null>(null);

  // ── Exámenes ──
  const [allExams, setAllExams] = useState<ExamenAnual[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamenAnual | null>(null);
  const [formExam, setFormExam] = useState({ anio: String(new Date().getFullYear()), fecha_examen: '', resultado: '', observaciones: '', realizado: false });
  const [markingRealizado, setMarkingRealizado] = useState<number | null>(null);
  const [savingExam, setSavingExam] = useState(false);

  const auditInfo = {
    id: (session?.user as any)?.id ?? null,
    email: session?.user?.email ?? null,
    nombre: (session?.user as any)?.nombre ?? null,
  };

  const loadAllRecs = useCallback(async () => {
    if (!canCrud('reconocimientos_medicos', 'read')) return;
    setLoadingRecs(true);
      try {
          let allData: any[] = [];
          let pg = 1, tot = Infinity;
          while (allData.length < tot) {
              const r = await apiFetch<any>(`/reconocimientos_medicos?limit=200&page=${pg}&sort=-created_at`);
              const rows = r?.data || [];
              if (!rows.length) break;
              allData = [...allData, ...rows];
              if (r?.meta?.total) tot = Number(r.meta.total);
              else tot = allData.length;
              if (rows.length < 200) break;
              pg++;
          }
          setAllRecs(allData);
      }
	
    catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingRecs(false); }
  }, []);

  const loadAllExams = useCallback(async () => {
    if (!canCrud('examen_anual', 'read')) return;
    setLoadingExams(true);
    try { const r = await apiFetch<any>('/examen_anual?limit=500&sort=-created_at'); setAllExams(r?.data || []); }
    catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingExams(false); }
  }, []);

  useEffect(() => { loadAllRecs(); }, [loadAllRecs]);
  useEffect(() => { loadAllExams(); }, [loadAllExams]);

  // Filtrado por persona seleccionada
  const recDni  = recSearch.selected  ? String(recSearch.selected.dni).replace(/\D/g, '')  : '';
  const examDni = examSearch.selected ? String(examSearch.selected.dni).replace(/\D/g, '') : '';
  const recs  = recDni  ? allRecs.filter(r  => String(r.dni).replace(/\D/g,'')  === recDni)  : allRecs;
  const exams = examDni ? allExams.filter(e => String(e.dni).replace(/\D/g,'') === examDni) : allExams;

  // Reset forms al cambiar selección
  useEffect(() => {
    setEditingRec(null);
    setFormRec({ fecha: '', fecha_desde: '', fecha_hasta: '', cantidad_dias: '', tipo: '', resultado: '', observaciones: '', ausentismo: false });
  }, [recSearch.selected]);

  useEffect(() => {
    setEditingExam(null);
    setFormExam({ anio: String(new Date().getFullYear()), fecha_examen: '', resultado: '', observaciones: '', realizado: false });
  }, [examSearch.selected]);

  // Auto-calcular días
  useEffect(() => {
    if (formRec.fecha_desde && formRec.fecha_hasta) {
      const dias = calcDias(formRec.fecha_desde, formRec.fecha_hasta);
      if (dias !== null) setFormRec(f => ({ ...f, cantidad_dias: String(dias) }));
    }
  }, [formRec.fecha_desde, formRec.fecha_hasta]);

  // ── Guardar reconocimiento ──
  const handleSaveRec = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recSearch.selected) { toast.error('Sin becado', 'Seleccioná un becado primero.'); return; }
    // fecha_desde es opcional — solo requerida para el rol salud_laboral (no admin)
    const isSaludLaboral = canCrud('reconocimientos_medicos', 'create') && !isAdmin;
    if (isSaludLaboral && !formRec.ausentismo && !formRec.fecha_desde) { toast.error('Requerido', 'La fecha desde es obligatoria.'); return; }
    setSavingRec(true);
    try {
      const dni = String(recSearch.selected.dni).replace(/\D/g, '');
      const body: any = {
        dni, fecha: formRec.fecha || formRec.fecha_desde,
        fecha_desde: formRec.fecha_desde || null, fecha_hasta: formRec.fecha_hasta || null,
        cantidad_dias: formRec.cantidad_dias ? Number(formRec.cantidad_dias) : null,
        tipo: formRec.tipo || null, resultado: formRec.resultado || null, observaciones: formRec.observaciones || null,
        ausentismo: formRec.ausentismo ? 1 : 0,
      };
      if (editingRec) {
        await apiFetch(`/reconocimientos_medicos/${editingRec.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, updated_by: auditInfo.id, updated_by_email: auditInfo.email, updated_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Actualizado', 'Reconocimiento actualizado.');
      } else {
        await apiFetch('/reconocimientos_medicos', {
          method: 'POST',
          body: JSON.stringify({ ...body, created_by: auditInfo.id, created_by_email: auditInfo.email, created_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Guardado', 'Reconocimiento cargado.');
      }
      setEditingRec(null);
      setFormRec({ fecha: '', fecha_desde: '', fecha_hasta: '', cantidad_dias: '', tipo: '', resultado: '', observaciones: '', ausentismo: false });
      loadAllRecs();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingRec(false); }
  };

  const handleToggleProcesado = async (r: ReconocimientoMedico) => {
    setProcesadoLoading(r.id);
    try {
      const nuevoValor = r.procesado ? 0 : 1;
      await apiFetch(`/reconocimientos_medicos/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          procesado: nuevoValor,
          updated_by: auditInfo.id,
          updated_by_email: auditInfo.email,
          updated_by_nombre: auditInfo.nombre,
        }),
      });
      toast.ok(nuevoValor ? '✓ Marcado como procesado' : 'Desmarcado', '');
      loadAllRecs();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setProcesadoLoading(null); }
  };

  const startEditRec = (r: ReconocimientoMedico) => {
    if (!isAdmin && !isWithin24h(r.created_at)) { toast.error('Sin permiso', 'Solo podés editar dentro de las 24hs de carga.'); return; }
    setEditingRec(r);
    setFormRec({ fecha: r.fecha?.slice(0,10)||'', fecha_desde: r.fecha_desde?.slice(0,10)||'', fecha_hasta: r.fecha_hasta?.slice(0,10)||'', cantidad_dias: r.cantidad_dias!=null?String(r.cantidad_dias):'', tipo: r.tipo||'', resultado: r.resultado||'', observaciones: r.observaciones||'', ausentismo: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Guardar examen ──
  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examSearch.selected) { toast.error('Sin agente', 'Seleccioná un agente primero.'); return; }
    if (!formExam.fecha_examen) { toast.error('Requerido', 'La fecha del examen es obligatoria.'); return; }
    setSavingExam(true);
    try {
      const dni = String(examSearch.selected.dni).replace(/\D/g, '');
      const anioActual = new Date().getFullYear();
      const anioForm = Number(formExam.anio);

      // Bloquear nuevo registro si ya existe examen en el año en curso para ese agente
      if (!editingExam && anioForm === anioActual) {
        const existe = allExams.find(ex =>
          String(ex.dni).replace(/\D/g,'') === dni && Number(ex.anio) === anioActual
        );
        if (existe) {
          toast.error('Ya existe', `Este agente ya tiene un examen registrado para ${anioActual}.`);
          setSavingExam(false);
          return;
        }
      }

      const body: any = {
        dni, anio: anioForm, fecha_examen: formExam.fecha_examen,
        resultado: formExam.resultado || null, observaciones: formExam.observaciones || null,
        realizado: formExam.realizado ? 1 : 0,
      };
      if (editingExam) {
        await apiFetch(`/examen_anual/${editingExam.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, updated_by: auditInfo.id, updated_by_email: auditInfo.email, updated_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Actualizado', 'Examen actualizado.');
      } else {
        await apiFetch('/examen_anual', {
          method: 'POST',
          body: JSON.stringify({ ...body, created_by: auditInfo.id, created_by_email: auditInfo.email, created_by_nombre: auditInfo.nombre }),
        });
        toast.ok('Guardado', 'Examen cargado.');
      }
      setEditingExam(null);
      setFormExam({ anio: String(new Date().getFullYear()), fecha_examen: '', resultado: '', observaciones: '', realizado: false });
      loadAllExams();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingExam(false); }
  };

  // Marcar/desmarcar realizado desde la tabla (solo rol salud_laboral)
  const handleToggleRealizado = async (ex: ExamenAnual) => {
    setMarkingRealizado(ex.id);
    try {
      const nuevoValor = ex.realizado ? 0 : 1;
      await apiFetch(`/examen_anual/${ex.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          realizado: nuevoValor,
          updated_by: auditInfo.id,
          updated_by_email: auditInfo.email,
          updated_by_nombre: auditInfo.nombre,
        }),
      });
      toast.ok(nuevoValor ? '✓ Marcado como realizado' : 'Desmarcado', '');
      loadAllExams();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setMarkingRealizado(null); }
  };

  const startEditExam = (ex: ExamenAnual) => {
    if (!isAdmin && !isWithin24h(ex.created_at)) { toast.error('Sin permiso', 'Solo podés editar dentro de las 24hs de carga.'); return; }
    setEditingExam(ex);
    setFormExam({ anio: String(ex.anio), fecha_examen: ex.fecha_examen?.slice(0,10)||'', resultado: ex.resultado||'', observaciones: ex.observaciones||'', realizado: !!ex.realizado });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Helper nombre en tabla ──
  const getNombreRec = (dni: string) => {
    if (recSearch.selected && String(recSearch.selected.dni).replace(/\D/g,'') === String(dni).replace(/\D/g,''))
      return `${recSearch.selected.apellido}, ${recSearch.selected.nombre}`;
    const b = allBecados.find(x => String(x.dni).replace(/\D/g,'') === String(dni).replace(/\D/g,''));
    return b ? `${b.apellido}, ${b.nombre}` : dni;
  };

  // ══════════════ TAREAS LIVIANAS ══════════════
  const tareaSearch = useLiveSearch('todos', allBecados);
  const [allTareas, setAllTareas] = useState<TareaLiviana[]>([]);
  const [loadingTareas, setLoadingTareas] = useState(false);
  const [editingTarea, setEditingTarea] = useState<TareaLiviana | null>(null);
  const [formTarea, setFormTarea] = useState({ fecha_desde: '', fecha_hasta: '', turno: '', servicio: '', observaciones: '', junta_medica_doc_id: '' });
  const [savingTarea, setSavingTarea] = useState(false);
  const [juntas, setJuntas] = useState<any[]>([]);
  const [loadingJuntas, setLoadingJuntas] = useState(false);
  const [verInforme, setVerInforme] = useState(false);
  const [servicios, setServicios] = useState<any[]>([]);

  // Maestro de servicios (para el desplegable) — sale de la base
  useEffect(() => {
    if (!canTareas) return;
    apiFetch<any>('/servicios?limit=500')
      .then(r => setServicios(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setServicios([]));
  }, [canTareas]);

  const loadAllTareas = useCallback(async () => {
    if (!canTareas) return;
    setLoadingTareas(true);
    try { const r = await apiFetch<any>('/tareas-livianas'); setAllTareas(r?.data || []); }
    catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingTareas(false); }
  }, [canTareas]);

  useEffect(() => { loadAllTareas(); }, [loadAllTareas]);

  // Al seleccionar agente: precargar servicio y traer sus juntas médicas ya cargadas
  useEffect(() => {
    setEditingTarea(null);
    const sel = tareaSearch.selected;
    if (!sel) {
      setJuntas([]);
      setFormTarea({ fecha_desde: '', fecha_hasta: '', turno: '', servicio: '', observaciones: '', junta_medica_doc_id: '' });
      return;
    }
    setFormTarea(f => ({ ...f, servicio: sel.servicio_nombre || sel.dependencia_nombre || '' }));
    const dni = String(sel.dni).replace(/\D/g, '');
    setLoadingJuntas(true);
    apiFetch<any>(`/tareas-livianas/junta-medica/${dni}`)
      .then(r => setJuntas(r?.data || []))
      .catch(() => setJuntas([]))
      .finally(() => setLoadingJuntas(false));
  }, [tareaSearch.selected]);

  // Auto-calcular días
  useEffect(() => {
    if (formTarea.fecha_desde && formTarea.fecha_hasta) {
      const d = calcDias(formTarea.fecha_desde, formTarea.fecha_hasta);
      // solo visual — el backend recalcula
      void d;
    }
  }, [formTarea.fecha_desde, formTarea.fecha_hasta]);

  const tareaDni = tareaSearch.selected ? String(tareaSearch.selected.dni).replace(/\D/g, '') : '';
  const tareas = tareaDni ? allTareas.filter(t => String(t.agente_dni).replace(/\D/g, '') === tareaDni) : allTareas;

  const abrirDocumento = async (id: number) => {
    try {
      const { blob } = await apiFetchBlobWithMeta(`/documents/${id}/file`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast.error('No se pudo abrir el documento', e?.message); }
  };

  const handleSaveTarea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tareaSearch.selected) { toast.error('Sin agente', 'Seleccioná un agente primero.'); return; }
    if (!formTarea.fecha_desde) { toast.error('Requerido', 'La fecha desde es obligatoria.'); return; }
    setSavingTarea(true);
    try {
      const dni = String(tareaSearch.selected.dni).replace(/\D/g, '');
      const body = {
        agente_dni: dni,
        agente_nombre: `${tareaSearch.selected.apellido}, ${tareaSearch.selected.nombre}`,
        servicio: formTarea.servicio || null,
        turno: formTarea.turno || null,
        fecha_desde: formTarea.fecha_desde,
        fecha_hasta: formTarea.fecha_hasta || null,
        junta_medica_doc_id: formTarea.junta_medica_doc_id ? Number(formTarea.junta_medica_doc_id) : null,
        observaciones: formTarea.observaciones || null,
      };
      if (editingTarea) {
        await apiFetch(`/tareas-livianas/${editingTarea.id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Tarea liviana actualizada.');
      } else {
        await apiFetch('/tareas-livianas', { method: 'POST', body: JSON.stringify(body) });
        toast.ok('Guardado', 'Tarea liviana cargada.');
      }
      setEditingTarea(null);
      setFormTarea({ fecha_desde: '', fecha_hasta: '', turno: '', servicio: tareaSearch.selected.servicio_nombre || tareaSearch.selected.dependencia_nombre || '', observaciones: '', junta_medica_doc_id: '' });
      loadAllTareas();
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingTarea(false); }
  };

  const startEditTarea = (t: TareaLiviana) => {
    if (!isAdmin && !isWithin24h(t.creado_at)) { toast.error('Sin permiso', 'Solo podés editar dentro de las 24hs de carga.'); return; }
    setEditingTarea(t);
    setFormTarea({
      fecha_desde: t.fecha_desde?.slice(0, 10) || '',
      fecha_hasta: t.fecha_hasta?.slice(0, 10) || '',
      turno: t.turno || '',
      servicio: t.servicio || '',
      observaciones: t.observaciones || '',
      junta_medica_doc_id: t.junta_medica_doc_id != null ? String(t.junta_medica_doc_id) : '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteTarea = async (t: TareaLiviana) => {
    if (!isAdmin) return;
    if (!window.confirm(`¿Eliminar la tarea liviana de ${t.agente_nombre || t.agente_dni}?`)) return;
    try {
      await apiFetch(`/tareas-livianas/${t.id}`, { method: 'DELETE' });
      toast.ok('Eliminado', '');
      loadAllTareas();
    } catch (e: any) { toast.error('Error', e?.message); }
  };

  // Informe: agrupar las tareas visibles por servicio → turno → agentes
  const informe = (() => {
    const grupos: Record<string, Record<string, TareaLiviana[]>> = {};
    for (const t of tareas) {
      const s = t.servicio || '(sin servicio)';
      const tu = t.turno || '(sin turno)';
      (grupos[s] ??= {});
      (grupos[s][tu] ??= []).push(t);
    }
    return Object.entries(grupos)
      .map(([servicio, turnos]) => ({
        servicio,
        total: Object.values(turnos).reduce((a, arr) => a + arr.length, 0),
        turnos: Object.entries(turnos).map(([turno, ags]) => ({ turno, agentes: ags })),
      }))
      .sort((a, b) => a.servicio.localeCompare(b.servicio));
  })();

  const tareaFormDias = calcDias(formTarea.fecha_desde, formTarea.fecha_hasta);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <Layout title="🏥 Salud Laboral" showBack>

      {/* ── TABS ── */}
      <div className="card" style={{ padding: '6px 8px', marginBottom: 16 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className={`btn${tab === 'reconocimientos' ? ' active' : ''}`} type="button" onClick={() => setTab('reconocimientos')}>
            🩺 Reconocimientos Médicos
            <span className="badge" style={{ marginLeft: 6, fontSize: '0.7rem' }}>{tab === 'reconocimientos' ? recs.length : allRecs.length}</span>
          </button>
          <button className={`btn${tab === 'examenes' ? ' active' : ''}`} type="button" onClick={() => setTab('examenes')}>
            📋 Examen Anual
            <span className="badge" style={{ marginLeft: 6, fontSize: '0.7rem' }}>{tab === 'examenes' ? exams.length : allExams.length}</span>
          </button>
          {canTareas && (
            <button className={`btn${tab === 'tareas' ? ' active' : ''}`} type="button" onClick={() => setTab('tareas')}>
              🪶 Tareas Livianas
              <span className="badge" style={{ marginLeft: 6, fontSize: '0.7rem' }}>{tab === 'tareas' ? tareas.length : allTareas.length}</span>
            </button>
          )}
          {isAdmin && (
            <button className={`btn${tab === 'reclamos' ? ' active' : ''}`} type="button" onClick={() => setTab('reclamos')}>
              Reclamos de licencias médicas
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ TAB RECONOCIMIENTOS ══════════════ */}
      {tab === 'reconocimientos' && (
        <>
          {/* Buscador: SOLO BECADOS */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="h2">Buscar becado</div>
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {loadingBecados ? 'Cargando becados...' : `${allBecados.length} becados activos`}
              </span>
            </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="sl-rec-dni" style={lbl}>DNI</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="sl-rec-dni" name="recDni" className="input" style={{ flex: 1 }}
                  value={recSearch.dni}
                  onChange={e => recSearch.setDni(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && recSearch.onSearchDni()}
                  placeholder="Enter para buscar"
                  disabled={loadingBecados} />
                <button className="btn" type="button" onClick={() => recSearch.onSearchDni()} disabled={loadingBecados}>
                  {recSearch.loadingSearch ? '...' : 'Buscar'}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="sl-rec-nombre" style={lbl}>Apellido / Nombre</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="sl-rec-nombre" name="recFullName" className="input" style={{ flex: 1 }}
                  value={recSearch.fullName}
                  onChange={e => recSearch.setFullName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && recSearch.onSearchName()}
                  placeholder="Apellido Nombre (Enter)"
                  disabled={loadingBecados} />
                <button className="btn" type="button" onClick={recSearch.onSearchName} disabled={loadingBecados}>
                  {recSearch.loadingSearch ? '...' : 'Buscar'}
                </button>
              </div>
            </div>
          </div>

            {/* Lista de coincidencias live */}
            {recSearch.matches.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {recSearch.matches.map(b => (
                  <button key={b.dni} className="btn" type="button"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => recSearch.select(b)}>
                    <strong>{b.apellido}, {b.nombre}</strong>
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
                      DNI {b.dni}{b.ley ? ` · ${b.ley}` : ''}{b.dependencia_nombre ? ` · ${b.dependencia_nombre}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Becado seleccionado */}
            {recSearch.selected && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{recSearch.selected.apellido}, {recSearch.selected.nombre}</div>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    DNI {recSearch.selected.dni}
                    {recSearch.selected.cuil ? ` · CUIL ${recSearch.selected.cuil}` : ''}
                    {recSearch.selected.ley ? ` · ${recSearch.selected.ley}` : ''}
                    {recSearch.selected.dependencia_nombre ? ` · ${recSearch.selected.dependencia_nombre}` : ''}
                  </div>
                </div>
                <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={recSearch.clear}>✕ Limpiar</button>
              </div>
            )}

            {!recSearch.selected && !recSearch.dni && !recSearch.fullName && !loadingBecados && (
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
                Sin becado seleccionado — mostrando todos los reconocimientos.
              </div>
            )}
          </div>

          {/* Formulario reconocimientos */}
                  {/* Formulario reconocimientos */}
                  {canCrud('reconocimientos_medicos', 'create') && (
                      <div className="card" style={{ marginBottom: 16 }}>
                          <div className="h2" style={{ marginBottom: 10 }}>
                              {editingRec ? '✏️ Editar reconocimiento' : '➕ Nuevo reconocimiento médico'}
                              {recSearch.selected && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {recSearch.selected.apellido}, {recSearch.selected.nombre}</span>}
                          </div>
                          {!recSearch.selected && <div style={alertStyle}>⚠️ Buscá y seleccioná un becado antes de cargar.</div>}
                          <form onSubmit={handleSaveRec}>

                              {/* Checkbox ausentismo */}
                              <div style={{ marginBottom: 12 }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.88rem' }}>
                                      <input
                                          type="checkbox"
                                          checked={formRec.ausentismo}
                                          onChange={e => setFormRec(f => ({
                                              ...f,
                                              ausentismo: e.target.checked,
                                              fecha_desde: e.target.checked ? '' : f.fecha_desde,
                                              fecha_hasta: e.target.checked ? '' : f.fecha_hasta,
                                              cantidad_dias: e.target.checked ? '' : f.cantidad_dias,
                                          }))}
                                      />
                                      Ausentismo (sin fechas)
                                  </label>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

                                  {/* Fechas y días — solo si NO es ausentismo */}
                                  {!formRec.ausentismo && (
                                      <>
                                          <div style={fg}>
                                              <label htmlFor="sl-rec-fecha-desde" style={lbl}>Fecha desde</label>
                                              <input id="sl-rec-fecha-desde" name="fecha_desde" className="input" type="date" value={formRec.fecha_desde}
                                                  onChange={e => setFormRec(f => ({ ...f, fecha_desde: e.target.value, fecha: e.target.value }))} />
                                          </div>
                                          <div style={fg}>
                                              <label htmlFor="sl-rec-fecha-hasta" style={lbl}>Fecha hasta</label>
                                              <input id="sl-rec-fecha-hasta" name="fecha_hasta" className="input" type="date" value={formRec.fecha_hasta}
                                                  min={formRec.fecha_desde || undefined}
                                                  onChange={e => setFormRec(f => ({ ...f, fecha_hasta: e.target.value }))} />
                                          </div>
                                          <div style={fg}>
                                              <label htmlFor="sl-rec-cant-dias" style={lbl}>
                                                  Cantidad de días
                                                  {formRec.cantidad_dias && <span style={{ marginLeft: 6, color: '#10b981', fontWeight: 700 }}>{formRec.cantidad_dias}d</span>}
                                              </label>
                                              <input id="sl-rec-cant-dias" name="cantidad_dias" className="input" type="number" min={1} value={formRec.cantidad_dias}
                                                  onChange={e => setFormRec(f => ({ ...f, cantidad_dias: e.target.value }))}
                                                  placeholder="Se calcula automático" />
                                          </div>
                                      </>
                                  )}

                                  <div style={fg}>
                                      <label htmlFor="sl-rec-tipo" style={lbl}>Tipo</label>
                                      <input id="sl-rec-tipo" name="tipo" className="input" type="text" placeholder="Ej: Preocupacional" value={formRec.tipo}
                                          onChange={e => setFormRec(f => ({ ...f, tipo: e.target.value }))} />
                                  </div>
                                  <div style={fg}>
                                      <label htmlFor="sl-rec-resultado" style={lbl}>Resultado</label>
                                      <input id="sl-rec-resultado" name="resultado" className="input" type="text" placeholder="Ej: Apto" value={formRec.resultado}
                                          onChange={e => setFormRec(f => ({ ...f, resultado: e.target.value }))} />
                                  </div>
                                  <div style={fg}>
                                      <label htmlFor="sl-rec-obs" style={lbl}>Observaciones</label>
                                      <input id="sl-rec-obs" name="observaciones" className="input" type="text" placeholder="Observaciones" value={formRec.observaciones}
                                          onChange={e => setFormRec(f => ({ ...f, observaciones: e.target.value }))} />
                                  </div>
                              </div>

                              {!formRec.ausentismo && formRec.fecha_desde && formRec.fecha_hasta && (
                                  <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, fontSize: '0.82rem' }}>
                                      📅 Del <strong>{fmt(formRec.fecha_desde)}</strong> al <strong>{fmt(formRec.fecha_hasta)}</strong>
                                      {formRec.cantidad_dias && <> — <strong style={{ color: '#10b981' }}>{formRec.cantidad_dias} días</strong></>}
                                  </div>
                              )}

                              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                                  <button className="btn ok" type="submit" disabled={savingRec || !recSearch.selected}>
                                      {savingRec ? 'Guardando...' : editingRec ? 'Actualizar' : 'Guardar'}
                                  </button>
                                  {editingRec && (
                                      <button className="btn" type="button" onClick={() => { setEditingRec(null); setFormRec({ fecha: '', fecha_desde: '', fecha_hasta: '', cantidad_dias: '', tipo: '', resultado: '', observaciones: '', ausentismo: false }); }}>
                                          Cancelar
                                      </button>
                                  )}
                              </div>
                          </form>
                      </div>
                  )}

          {/* Tabla reconocimientos */}
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="h2">
                {recSearch.selected ? `Reconocimientos de ${recSearch.selected.apellido} (${recs.length})` : `Todos los reconocimientos (${allRecs.length})`}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" type="button" disabled={!recs.length} onClick={() => exportToExcel('reconocimientos_medicos', recs)}>📊 Excel</button>
                <button className="btn" type="button" disabled={!recs.length} onClick={() => exportToPdf('reconocimientos_medicos', recs)}>📄 PDF</button>
              </div>
            </div>
            {loadingRecs ? <div className="muted">Cargando...</div> : recs.length === 0 ? (
              <div className="muted">{recSearch.selected ? 'Este becado no tiene reconocimientos.' : 'No hay reconocimientos cargados.'}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      {['DNI','Apellido y Nombre','Desde','Hasta','Días','Tipo','Resultado','Observaciones','Cargado por','Mod. por'].map(h => <th key={h} style={th}>{h}</th>)}
                      {canSeeProcesado && <th style={{ ...th, textAlign: 'center' }}>Procesado</th>}
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.map(r => {
                      const editable = isAdmin || isWithin24h(r.created_at);
                      return (
                        <tr key={r.id}>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{r.dni}</strong></td>
                          <td style={{ ...td, minWidth: 160 }}>{getNombreRec(r.dni)}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(r.fecha_desde)}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(r.fecha_hasta)}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'center' }}>{r.cantidad_dias != null ? <span style={{ fontWeight: 700, color: '#10b981' }}>{r.cantidad_dias}d</span> : <span className="muted">—</span>}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.tipo || <span className="muted">—</span>}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.resultado || <span className="muted">—</span>}</td>
                          <td style={{ ...td, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.observaciones || <span className="muted">—</span>}</td>
                          <td style={{ ...td, minWidth: 110 }}><div style={{ fontSize: '0.72rem' }}><div>{r.created_by_nombre || r.created_by_email || '—'}</div><div className="muted">{fmt(r.created_at)}</div></div></td>
                          <td style={{ ...td, minWidth: 110 }}><div style={{ fontSize: '0.72rem' }}>{r.updated_by_nombre || r.updated_by_email ? <><div>{r.updated_by_nombre || r.updated_by_email}</div><div className="muted">{fmt(r.updated_at)}</div></> : <span className="muted">—</span>}</div></td>
                          {canSeeProcesado && (
                            <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button
                                className="btn"
                                type="button"
                                title={r.procesado ? 'Marcar como no procesado' : 'Marcar como procesado'}
                                disabled={procesadoLoading === r.id}
                                onClick={() => handleToggleProcesado(r)}
                                style={{
                                  fontSize: '0.85rem',
                                  padding: '3px 10px',
                                  background: r.procesado ? 'rgba(16,185,129,0.2)' : 'transparent',
                                  border: r.procesado ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.15)',
                                  color: r.procesado ? '#10b981' : 'rgba(255,255,255,0.4)',
                                  borderRadius: 6,
                                  cursor: 'pointer',
                                  minWidth: 36,
                                }}
                              >
                                {procesadoLoading === r.id ? '…' : r.procesado ? '✓' : '○'}
                              </button>
                            </td>
                          )}
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{canCrud('reconocimientos_medicos','update') && <button className="btn" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px', opacity: editable ? 1 : 0.35 }} onClick={() => startEditRec(r)} title={editable ? 'Editar' : 'Solo editable dentro de las 24hs'}>✏️</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════ TAB EXAMEN ANUAL ══════════════ */}
      {tab === 'examenes' && (
        <>
          {/* Buscador: TODOS LOS AGENTES */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="h2" style={{ marginBottom: 8 }}>Buscar agente</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="sl-exam-dni" style={lbl}>DNI</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="sl-exam-dni" name="examDni" className="input" style={{ flex: 1 }}
                  value={examSearch.dni}
                  onChange={e => examSearch.setDni(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && examSearch.onSearchDni()}
                  placeholder="Enter para buscar" />
                <button className="btn" type="button" onClick={() => examSearch.onSearchDni()}>
                  {examSearch.loadingSearch ? '...' : 'Buscar'}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="sl-exam-nombre" style={lbl}>Apellido / Nombre</label>
              <div className="row" style={{ gap: 6 }}>
                <input id="sl-exam-nombre" name="examFullName" className="input" style={{ flex: 1 }}
                  value={examSearch.fullName}
                  onChange={e => examSearch.setFullName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && examSearch.onSearchName()}
                  placeholder="Apellido Nombre (Enter)" />
                <button className="btn" type="button" onClick={examSearch.onSearchName}>
                  {examSearch.loadingSearch ? '...' : 'Buscar'}
                </button>
              </div>
            </div>
          </div>

            {/* Lista de coincidencias live */}
            {examSearch.matches.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {examSearch.matches.map(m => (
                  <button key={m.dni} className="btn" type="button"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => examSearch.select(m)}>
                    <strong>{m.apellido}, {m.nombre}</strong>
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
                      DNI {m.dni}{m.estado_empleo ? ` · ${m.estado_empleo}` : ''}{m.dependencia_nombre ? ` · ${m.dependencia_nombre}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Agente seleccionado */}
            {examSearch.selected && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{examSearch.selected.apellido}, {examSearch.selected.nombre}</div>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>
                    DNI {examSearch.selected.dni}
                    {examSearch.selected.cuil ? ` · CUIL ${examSearch.selected.cuil}` : ''}
                    {examSearch.selected.estado_empleo ? ` · ${examSearch.selected.estado_empleo}` : ''}
                    {examSearch.selected.dependencia_nombre ? ` · ${examSearch.selected.dependencia_nombre}` : ''}
                  </div>
                </div>
                <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={examSearch.clear}>✕ Limpiar</button>
              </div>
            )}

            {!examSearch.selected && !examSearch.dni && !examSearch.fullName && (
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
                Sin agente seleccionado — mostrando todos los exámenes.
              </div>
            )}
          </div>

          {/* Formulario examen */}
          {canCrud('examen_anual', 'create') && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="h2" style={{ marginBottom: 10 }}>
                {editingExam ? '✏️ Editar examen anual' : '➕ Nuevo examen anual'}
                {examSearch.selected && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {examSearch.selected.apellido}, {examSearch.selected.nombre}</span>}
              </div>
              {!examSearch.selected && <div style={alertStyle}>⚠️ Buscá y seleccioná un agente antes de cargar.</div>}
              <form onSubmit={handleSaveExam}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                  <div style={fg}><label htmlFor="sl-exam-anio" style={lbl}>Año *</label><input id="sl-exam-anio" name="anio" className="input" type="number" min={2000} max={2100} value={formExam.anio} onChange={e => setFormExam(f => ({ ...f, anio: e.target.value }))} required /></div>
                  <div style={fg}><label htmlFor="sl-exam-fecha" style={lbl}>Fecha del examen *</label><input id="sl-exam-fecha" name="fecha_examen" className="input" type="date" value={formExam.fecha_examen} onChange={e => setFormExam(f => ({ ...f, fecha_examen: e.target.value }))} required /></div>
                  <div style={fg}><label htmlFor="sl-exam-resultado" style={lbl}>Resultado</label><input id="sl-exam-resultado" name="resultado" className="input" type="text" placeholder="Ej: Aprobado" value={formExam.resultado} onChange={e => setFormExam(f => ({ ...f, resultado: e.target.value }))} /></div>
                  <div style={fg}><label htmlFor="sl-exam-obs" style={lbl}>Observaciones</label><input id="sl-exam-obs" name="observaciones" className="input" type="text" placeholder="Observaciones" value={formExam.observaciones} onChange={e => setFormExam(f => ({ ...f, observaciones: e.target.value }))} /></div>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 12 }}>
                  <button className="btn ok" type="submit" disabled={savingExam || !examSearch.selected}>
                    {savingExam ? 'Guardando...' : editingExam ? 'Actualizar' : 'Guardar'}
                  </button>
                  {editingExam && (
                    <button className="btn" type="button" onClick={() => { setEditingExam(null); setFormExam({ anio: String(new Date().getFullYear()), fecha_examen:'', resultado:'', observaciones:'', realizado: false }); }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* Tabla exámenes */}
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="h2">
                {examSearch.selected ? `Exámenes de ${examSearch.selected.apellido} (${exams.length})` : `Todos los exámenes (${allExams.length})`}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" type="button" disabled={!exams.length} onClick={() => exportToExcel('examen_anual', exams)}>📊 Excel</button>
                <button className="btn" type="button" disabled={!exams.length} onClick={() => exportToPdf('examen_anual', exams)}>📄 PDF</button>
              </div>
            </div>
            {loadingExams ? <div className="muted">Cargando...</div> : exams.length === 0 ? (
              <div className="muted">{examSearch.selected ? 'Este agente no tiene exámenes.' : 'No hay exámenes cargados.'}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tbl}>
                  <thead><tr>{['DNI','Apellido y Nombre','Año','Fecha examen','Resultado','Observaciones','Cargado por','Modificado por',''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {exams.map(ex => {
                      const editable = isAdmin || isWithin24h(ex.created_at);
                      const nombre = examSearch.selected && String(examSearch.selected.dni).replace(/\D/g,'') === String(ex.dni).replace(/\D/g,'')
                        ? `${examSearch.selected.apellido}, ${examSearch.selected.nombre}` : ex.dni;
                      return (
                        <tr key={ex.id}>
                          <td style={td}><strong>{ex.dni}</strong></td>
                          <td style={td}>{nombre}</td>
                          <td style={td}>{ex.anio}</td>
                          <td style={td}>{fmt(ex.fecha_examen)}</td>
                          <td style={td}>{ex.resultado || <span className="muted">—</span>}</td>
                          <td style={{ ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.observaciones || <span className="muted">—</span>}</td>
                          <td style={td}><div style={{ fontSize: '0.75rem' }}><div>{ex.created_by_nombre || ex.created_by_email || '—'}</div><div className="muted">{fmt(ex.created_at)}</div></div></td>
                          <td style={td}><div style={{ fontSize: '0.75rem' }}>{ex.updated_by_nombre || ex.updated_by_email ? <><div>{ex.updated_by_nombre || ex.updated_by_email}</div><div className="muted">{fmt(ex.updated_at)}</div></> : <span className="muted">—</span>}</div></td>
                          <td style={td}>{canCrud('examen_anual','update') && <button className="btn" type="button" style={{ fontSize: '0.75rem', padding: '4px 10px', opacity: editable ? 1 : 0.35 }} onClick={() => startEditExam(ex)} title={editable ? 'Editar' : 'Solo editable dentro de las 24hs'}>✏️</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════ TAB TAREAS LIVIANAS ══════════════ */}
      {tab === 'tareas' && (
        <>
          {/* Buscador de agente */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="h2" style={{ marginBottom: 8 }}>Buscar agente</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="sl-tar-dni" style={lbl}>DNI</label>
                <div className="row" style={{ gap: 6 }}>
                  <input id="sl-tar-dni" name="tarDni" className="input" style={{ flex: 1 }}
                    value={tareaSearch.dni}
                    onChange={e => tareaSearch.setDni(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && tareaSearch.onSearchDni()}
                    placeholder="Enter para buscar" />
                  <button className="btn" type="button" onClick={() => tareaSearch.onSearchDni()}>
                    {tareaSearch.loadingSearch ? '...' : 'Buscar'}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="sl-tar-nombre" style={lbl}>Apellido / Nombre</label>
                <div className="row" style={{ gap: 6 }}>
                  <input id="sl-tar-nombre" name="tarFullName" className="input" style={{ flex: 1 }}
                    value={tareaSearch.fullName}
                    onChange={e => tareaSearch.setFullName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && tareaSearch.onSearchName()}
                    placeholder="Apellido Nombre (Enter)" />
                  <button className="btn" type="button" onClick={tareaSearch.onSearchName}>
                    {tareaSearch.loadingSearch ? '...' : 'Buscar'}
                  </button>
                </div>
              </div>
            </div>

            {tareaSearch.matches.length > 0 && (
              <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {tareaSearch.matches.map(m => (
                  <button key={m.dni} className="btn" type="button"
                    style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => tareaSearch.select(m)}>
                    <strong>{m.apellido}, {m.nombre}</strong>
                    <span className="muted" style={{ marginLeft: 8, fontSize: '0.8rem' }}>
                      DNI {m.dni}{m.dependencia_nombre ? ` · ${m.dependencia_nombre}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {tareaSearch.selected && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{tareaSearch.selected.apellido}, {tareaSearch.selected.nombre}</div>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      DNI {tareaSearch.selected.dni}
                      {tareaSearch.selected.dependencia_nombre ? ` · ${tareaSearch.selected.dependencia_nombre}` : ''}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn" type="button" style={{ fontSize: '0.78rem' }}
                      onClick={() => navigate(`/app/escaneo-agente/${String(tareaSearch.selected!.dni).replace(/\D/g,'')}`)}>
                      📷 Escanear documentación
                    </button>
                    <button className="btn" type="button" style={{ fontSize: '0.78rem' }} onClick={tareaSearch.clear}>✕ Limpiar</button>
                  </div>
                </div>

                {/* Juntas médicas ya cargadas (de Resoluciones → G:\varios) */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>⚖️ Juntas médicas cargadas</div>
                  {loadingJuntas ? (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>Buscando…</div>
                  ) : juntas.length === 0 ? (
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      Sin junta médica cargada en Resoluciones para este agente. Usá 📷 Escanear o cargala en Resoluciones.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {juntas.map(j => (
                        <div key={j.id} className="row" style={{ gap: 8, alignItems: 'center', fontSize: '0.8rem' }}>
                          <button type="button" className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => abrirDocumento(j.id)}>📄 Ver</button>
                          <span>{j.nombre || `Documento #${j.id}`}</span>
                          <span className="muted">{fmt(j.fecha || j.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!tareaSearch.selected && !tareaSearch.dni && !tareaSearch.fullName && (
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
                Sin agente seleccionado — mostrando todas las tareas livianas.
              </div>
            )}
          </div>

          {/* Formulario tarea liviana */}
          {canCrud('tareas_livianas', 'create') && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="h2" style={{ marginBottom: 10 }}>
                {editingTarea ? '✏️ Editar tarea liviana' : '➕ Nueva tarea liviana'}
                {tareaSearch.selected && <span style={{ fontWeight: 400, fontSize: '0.85rem', marginLeft: 8, color: 'rgba(255,255,255,0.5)' }}>— {tareaSearch.selected.apellido}, {tareaSearch.selected.nombre}</span>}
              </div>
              {!tareaSearch.selected && <div style={alertStyle}>⚠️ Buscá y seleccioná un agente antes de cargar.</div>}
              <form onSubmit={handleSaveTarea}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div style={fg}>
                    <label htmlFor="sl-tar-desde" style={lbl}>Fecha desde *</label>
                    <input id="sl-tar-desde" name="fecha_desde" className="input" type="date" value={formTarea.fecha_desde}
                      onChange={e => setFormTarea(f => ({ ...f, fecha_desde: e.target.value }))} required />
                  </div>
                  <div style={fg}>
                    <label htmlFor="sl-tar-hasta" style={lbl}>
                      Fecha hasta
                      {tareaFormDias != null && <span style={{ marginLeft: 6, color: '#10b981', fontWeight: 700 }}>{tareaFormDias}d</span>}
                    </label>
                    <input id="sl-tar-hasta" name="fecha_hasta" className="input" type="date" value={formTarea.fecha_hasta}
                      min={formTarea.fecha_desde || undefined}
                      onChange={e => setFormTarea(f => ({ ...f, fecha_hasta: e.target.value }))} />
                  </div>
                  <div style={fg}>
                    <label htmlFor="sl-tar-turno" style={lbl}>Turno</label>
                    <select id="sl-tar-turno" name="turno" className="input" value={formTarea.turno}
                      onChange={e => setFormTarea(f => ({ ...f, turno: e.target.value }))}>
                      <option value="">— Turno —</option>
                      {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={fg}>
                    <label htmlFor="sl-tar-servicio" style={lbl}>Servicio</label>
                    <select id="sl-tar-servicio" name="servicio" className="input" value={formTarea.servicio}
                      onChange={e => setFormTarea(f => ({ ...f, servicio: e.target.value }))}>
                      <option value="">— Servicio —</option>
                      {/* Servicio actual del agente aunque no esté en el maestro */}
                      {formTarea.servicio && !servicios.some((s: any) => s.nombre === formTarea.servicio) && (
                        <option value={formTarea.servicio}>{formTarea.servicio}</option>
                      )}
                      {servicios.map((s: any) => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                    </select>
                  </div>
                  <div style={fg}>
                    <label htmlFor="sl-tar-junta" style={lbl}>Junta médica</label>
                    <select id="sl-tar-junta" name="junta_medica_doc_id" className="input" value={formTarea.junta_medica_doc_id}
                      onChange={e => setFormTarea(f => ({ ...f, junta_medica_doc_id: e.target.value }))}>
                      <option value="">— Sin vincular —</option>
                      {juntas.map(j => <option key={j.id} value={j.id}>{j.nombre || `Documento #${j.id}`}</option>)}
                    </select>
                  </div>
                  <div style={fg}>
                    <label htmlFor="sl-tar-obs" style={lbl}>Observaciones</label>
                    <input id="sl-tar-obs" name="observaciones" className="input" type="text" placeholder="Observaciones" value={formTarea.observaciones}
                      onChange={e => setFormTarea(f => ({ ...f, observaciones: e.target.value }))} />
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 12 }}>
                  <button className="btn ok" type="submit" disabled={savingTarea || !tareaSearch.selected}>
                    {savingTarea ? 'Guardando...' : editingTarea ? 'Actualizar' : 'Guardar'}
                  </button>
                  {editingTarea && (
                    <button className="btn" type="button" onClick={() => { setEditingTarea(null); setFormTarea({ fecha_desde: '', fecha_hasta: '', turno: '', servicio: tareaSearch.selected?.servicio_nombre || tareaSearch.selected?.dependencia_nombre || '', observaciones: '', junta_medica_doc_id: '' }); }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* Tabla / Informe */}
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="h2">
                {tareaSearch.selected ? `Tareas de ${tareaSearch.selected.apellido} (${tareas.length})` : `Todas las tareas livianas (${allTareas.length})`}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className={`btn${verInforme ? ' active' : ''}`} type="button" onClick={() => setVerInforme(v => !v)}>
                  {verInforme ? '📋 Ver listado' : '📊 Ver informe por servicio/turno'}
                </button>
                <button className="btn" type="button" disabled={!tareas.length} onClick={() => exportToExcel('tareas_livianas', tareas)}>📊 Excel</button>
                <button className="btn" type="button" disabled={!tareas.length} onClick={() => exportToPdf('tareas_livianas', tareas)}>📄 PDF</button>
              </div>
            </div>

            {loadingTareas ? <div className="muted">Cargando...</div> : tareas.length === 0 ? (
              <div className="muted">{tareaSearch.selected ? 'Este agente no tiene tareas livianas.' : 'No hay tareas livianas cargadas.'}</div>
            ) : verInforme ? (
              /* ── INFORME agrupado ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {informe.map(g => (
                  <div key={g.servicio} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>🏢 {g.servicio} <span className="muted" style={{ fontWeight: 400 }}>· {g.total} agente(s)</span></div>
                    {g.turnos.map(tt => (
                      <div key={tt.turno} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: '0.82rem', color: '#14b8a6', fontWeight: 600 }}>🕐 {tt.turno} ({tt.agentes.length})</div>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.82rem' }}>
                          {tt.agentes.map(a => (
                            <li key={a.id}>
                              {a.agente_nombre || a.agente_dni} — {fmt(a.fecha_desde)} → {a.fecha_hasta ? fmt(a.fecha_hasta) : 'sin fin'}
                              {a.cantidad_dias != null && <span style={{ color: '#10b981' }}> ({a.cantidad_dias}d)</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              /* ── LISTADO ── */
              <div style={{ overflowX: 'auto' }}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      {['DNI','Apellido y Nombre','Servicio','Turno','Desde','Hasta','Días','Junta','Observaciones','Cargado por',''].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {tareas.map(t => {
                      const editable = isAdmin || isWithin24h(t.creado_at);
                      return (
                        <tr key={t.id}>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{t.agente_dni}</strong></td>
                          <td style={{ ...td, minWidth: 160 }}>{t.agente_nombre || '—'}</td>
                          <td style={td}>{t.servicio || <span className="muted">—</span>}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.turno || <span className="muted">—</span>}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(t.fecha_desde)}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.fecha_hasta ? fmt(t.fecha_hasta) : <span className="muted">—</span>}</td>
                          <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>{t.cantidad_dias != null ? <span style={{ fontWeight: 700, color: '#10b981' }}>{t.cantidad_dias}d</span> : <span className="muted">—</span>}</td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            {t.junta_medica_doc_id
                              ? <button className="btn" type="button" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => abrirDocumento(t.junta_medica_doc_id!)}>📄</button>
                              : <span className="muted">—</span>}
                          </td>
                          <td style={{ ...td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.observaciones || <span className="muted">—</span>}</td>
                          <td style={{ ...td, minWidth: 110 }}><div style={{ fontSize: '0.72rem' }}><div>{t.creado_por_email || '—'}</div><div className="muted">{fmt(t.creado_at)}</div></div></td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            {canCrud('tareas_livianas','update') && <button className="btn" type="button" style={{ fontSize: '0.75rem', padding: '4px 8px', opacity: editable ? 1 : 0.35 }} onClick={() => startEditTarea(t)} title={editable ? 'Editar' : 'Solo editable dentro de las 24hs'}>✏️</button>}
                            {isAdmin && <button className="btn" type="button" style={{ fontSize: '0.75rem', padding: '4px 8px', marginLeft: 4 }} onClick={() => handleDeleteTarea(t)} title="Eliminar">🗑️</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {isAdmin && tab === 'reclamos' && <ReclamosLicenciasMedicasTab />}

      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 12 }}>
        🩺 Reconocimientos: solo becados activos · 📋 Examen anual: todos los agentes ·
        <span style={{ color: '#10b981' }}> ●</span> Editable (menos de 24hs)
      </div>
    </Layout>
  );
}

// ─── ESTILOS ─────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = { fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', fontWeight: 500, marginBottom: 4, display: 'block' };
const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'middle' };
const alertStyle: React.CSSProperties = { padding: '10px 12px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, marginBottom: 12, fontSize: '0.82rem', color: 'rgba(245,158,11,0.9)' };

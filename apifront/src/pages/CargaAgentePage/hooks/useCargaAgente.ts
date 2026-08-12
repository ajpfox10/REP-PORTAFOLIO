// src/pages/CargaAgentePage/hooks/useCargaAgente.ts
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';
import type { CapturedPhoto } from './useCamera';

export type CatalogItem = { id: number | string; nombre: string };

// Localidad enriquecida: conserva provincia y municipio para la cascada del form.
export type LocalidadItem = CatalogItem & {
  provincia_id?: string;
  provincia_nombre?: string;
  municipio_id?: string;
  municipio_nombre?: string;
};

export type PersonalForm = {
  // Personal (tabla: personal)
  dni: string;
  apellido: string;
  nombre: string;
  cuil: string;
  fecha_nacimiento: string;
  sexo_id: string;
  email: string;
  telefono: string;
  domicilio: string;
  numerodomicilio: string;
  piso: string;
  depto: string;
  cp: string;
  observaciones_direccion: string;
  provincia_id: string;
  municipio_id: string; // solo UI (cascada) — no se guarda en personal
  localidad_id: string;
  nacionalidad: string;
  observaciones: string;
  // Agente (tabla: agentes)
  fecha_ingreso: string;
  fecha_egreso: string;
  fecha_baja: string;
  estado_empleo: string;
  legajo: string;
  ley_id: string;
  planta_id: string;
  categoria_id: string;
  ocupacion_id: string;
  regimen_horario_id: string;
  jefatura_id: string;
  dependencia_id: string;
  reparticion_id: string;
  servicio_id: string;
  sector_id: string;
  decreto_designacion: string;
  funcion_id: string;
  salario_mensual: string;
};

export const EMPTY_FORM: PersonalForm = {
  dni: '', apellido: '', nombre: '', cuil: '', fecha_nacimiento: '',
  sexo_id: '', email: '', telefono: '', domicilio: '',
  numerodomicilio: '', piso: '', depto: '', cp: '', observaciones_direccion: '',
  provincia_id: '', municipio_id: '',
  localidad_id: '', nacionalidad: '', observaciones: '',
  fecha_ingreso: '', fecha_egreso: '', fecha_baja: '', estado_empleo: 'ACTIVO', legajo: '',
  ley_id: '', planta_id: '', categoria_id: '', ocupacion_id: '',
  regimen_horario_id: '', jefatura_id: '', funcion_id: '',
  dependencia_id: '', reparticion_id: '', servicio_id: '', sector_id: '',
  decreto_designacion: '',
  salario_mensual: '',
};

export const ESTADO_EMPLEO_OPTS = ['ACTIVO', 'INACTIVO', 'BAJA', 'COMISION', 'TRAMITE'];

export type Step = 1 | 2 | 3 | 4;

export type CatalogSet = {
  sexo: CatalogItem[];
  planta: CatalogItem[];
  funcion: CatalogItem[];
  categoria: CatalogItem[];
  dependencia: CatalogItem[];
  localidad: LocalidadItem[];
  ley: CatalogItem[];
  ocupacion: CatalogItem[];
  regimenHorario: CatalogItem[];
};

function extractNombre(row: any): string {
  if (!row || typeof row !== 'object') return '';
  // Check common name fields
  for (const k of ['nombre','nombre_ocupacion','ley_nombre','planta_nombre','reparticion_nombre',
    'funcion','regimen_horario','sector','descripcion','name','label']) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]);
  }
  const nameSuffix = Object.keys(row).find(k => k.endsWith('_nombre'));
  if (nameSuffix) return String(row[nameSuffix]);
  return String(row.id ?? '');
}

export type SavedMode = 'create' | 'edit' | 'reentry';

export function useCargaAgente() {
  const toast = useToast();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<PersonalForm>(EMPTY_FORM);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedDni, setSavedDni] = useState<number | null>(null);
  const [savedMode, setSavedMode] = useState<SavedMode>('create');
  const [errors, setErrors] = useState<Partial<Record<keyof PersonalForm, string>>>({});

  // ── Modo edición ──────────────────────────────────────────────────────────────
  const [editMode,    setEditMode]    = useState(false);
  const [reentryMode, setReentryMode] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const [cats, setCats] = useState<CatalogSet>({
    sexo: [], planta: [], funcion: [], categoria: [], dependencia: [],
    localidad: [], ley: [], ocupacion: [], regimenHorario: [],
  });

  const loadCatalog = useCallback(async (table: string): Promise<CatalogItem[]> => {
    try {
      // localidades: son ~4142 y su nombre está en localidad_nombre (no en un genérico *_nombre,
      // que agarraría provincia_nombre). Traemos todas y etiquetamos "LOCALIDAD — Municipio".
      const limit = table === 'localidades' ? 5000 : 500;
      const res = await apiFetch<any>(`/${table}?limit=${limit}&page=1`);
      return (res?.data || []).map((r: any) => ({
        id: r.id ?? r.ID,   // categorias usa PK "ID" en mayúscula
        nombre: table === 'localidades'
          ? [r.localidad_nombre, r.municipio_nombre].filter(Boolean).join(' — ')
          : extractNombre(r),
        ...(table === 'localidades' ? {
          provincia_id:     r.provincia_id != null ? String(r.provincia_id) : '',
          provincia_nombre: r.provincia_nombre || '',
          municipio_id:     r.municipio_id != null ? String(r.municipio_id) : '',
          municipio_nombre: r.municipio_nombre || '',
        } : {}),
      }));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    Promise.all([
      loadCatalog('sexos'),
      loadCatalog('plantas'),
      loadCatalog('funciones'),
      loadCatalog('categorias'),
      loadCatalog('dependencias'),
      loadCatalog('localidades'),
      loadCatalog('ley'),
      loadCatalog('ocupaciones'),
      loadCatalog('regimenes_horarios'),
    ]).then(([sexo, planta, funcion, categoria, dependencia, localidad, ley, ocupacion, regimenHorario]) => {
      setCats({ sexo, planta, funcion, categoria, dependencia, localidad, ley, ocupacion, regimenHorario });
    });
  }, [loadCatalog]);

  /**
   * Dado un DNI (6-8 dígitos), consulta el backend.
   * Si el agente ya existe → carga sus datos en el formulario y activa editMode.
   * Si no existe → desactiva editMode (modo alta normal).
   */
  const checkDni = useCallback(async (dniValue?: string) => {
    const clean = (dniValue ?? form.dni).replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(clean)) { setEditMode(false); setReentryMode(false); return; }

    setEditLoading(true);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (res?.ok && res?.data) {
        const d = res.data;
        const toStr = (v: any) => (v != null ? String(v) : '');
        const toDate = (v: any) => (v ? String(v).substring(0, 10) : '');
        const hasActive = d.has_active_agente === true;

        setForm(f => ({
          ...f,
          dni:                toStr(d.dni || clean),
          apellido:           d.apellido  || '',
          nombre:             d.nombre    || '',
          cuil:               d.cuil      || '',
          fecha_nacimiento:   toDate(d.fecha_nacimiento),
          sexo_id:            toStr(d.sexo_id),
          email:              d.email     || '',
          telefono:           d.telefono  || '',
          domicilio:          d.domicilio || '',
          numerodomicilio:    toStr(d.numerodomicilio),
          piso:               toStr(d.piso),
          depto:              d.depto || '',
          cp:                 d.cp || '',
          observaciones_direccion: d.observacionesdireccion || '',
          provincia_id:       toStr(d.provincia_id),
          municipio_id:       '', // se autocompleta desde la localidad (efecto en el form)
          localidad_id:       toStr(d.localidad_id),
          nacionalidad:       d.nacionalidad || '',
          observaciones:      d.observaciones || '',
          estado_empleo:      hasActive ? (d.estado_empleo || 'ACTIVO') : 'ACTIVO',
          legajo:             hasActive ? toStr(d.legajo) : '',
          ley_id:             hasActive ? toStr(d.ley_id) : '',
          planta_id:          hasActive ? toStr(d.planta_id) : '',
          categoria_id:       hasActive ? toStr(d.categoria_id) : '',
          ocupacion_id:       hasActive ? toStr(d.ocupacion_id) : '',
          regimen_horario_id: hasActive ? toStr(d.regimen_horario_id) : '',
          dependencia_id:     hasActive ? toStr(d.dependencia_id) : '',
          reparticion_id:     hasActive ? toStr(d.reparticion_id) : '',
          servicio_id:        hasActive ? toStr(d.servicio_id) : '',
          sector_id:          hasActive ? toStr(d.sector_id) : '',
          funcion_id:         hasActive ? toStr(d.funcion_id) : '',
          fecha_ingreso:      hasActive ? toDate(d.fecha_ingreso_laboral ?? d.fecha_ingreso) : '',
          fecha_egreso:       hasActive ? toDate(d.fecha_egreso) : '',
          fecha_baja:         '',
          salario_mensual:    hasActive && d.salario_mensual != null ? String(d.salario_mensual) : '',
        }));
        setEditMode(hasActive);
        setReentryMode(!hasActive);
        toast.ok(
          hasActive ? 'Agente activo encontrado' : 'Persona encontrada sin vinculo activo',
          hasActive ? 'Modo edicion' : 'Se creara un reingreso sin modificar el historial'
        );
      } else {
        setEditMode(false);
        setReentryMode(false);
      }
    } catch {
      setEditMode(false);
      setReentryMode(false);
    } finally {
      setEditLoading(false);
    }
  }, [form.dni, toast]);

  const setField = useCallback(<K extends keyof PersonalForm>(key: K, value: PersonalForm[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }, []);

  const validateStep = useCallback((s: Step): boolean => {
    const errs: Partial<Record<keyof PersonalForm, string>> = {};
    if (s === 1) {
      if (!form.dni.trim()) errs.dni = 'DNI requerido';
      else if (!/^\d{6,8}$/.test(form.dni.replace(/\D/g, ''))) errs.dni = 'DNI: 6-8 dígitos';
      if (!form.apellido.trim()) errs.apellido = 'Apellido requerido';
      if (!form.nombre.trim()) errs.nombre = 'Nombre requerido';
    }
    if (s === 2) {
      if (!form.estado_empleo) errs.estado_empleo = 'Estado requerido';
      if (form.fecha_egreso && form.estado_empleo === 'ACTIVO') {
        errs.estado_empleo = 'Con fecha de egreso debe seleccionar INACTIVO, BAJA, COMISION o TRAMITE';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  const nextStep = useCallback(() => {
    if (!validateStep(step)) return;
    setStep(s => Math.min(s + 1, 4) as Step);
  }, [step, validateStep]);

  const prevStep = useCallback(() => setStep(s => Math.max(s - 1, 1) as Step), []);
  const goToStep = useCallback((s: Step) => setStep(s), []);

  const save = useCallback(async () => {
    if (!validateStep(1) || !validateStep(2)) {
      toast.error('Completá los datos requeridos');
      setStep(1);
      return;
    }
    setSaving(true);
    const dniNum = Number(form.dni.replace(/\D/g, ''));

    try {
      if (editMode) {
        // ── MODO EDICIÓN: PATCH /personal/:dni ──────────────────────────────────
        const payload: Record<string, any> = {
          apellido: form.apellido.trim().toUpperCase(),
          nombre:   form.nombre.trim().toUpperCase(),
          ...(form.cuil              ? { cuil:               form.cuil }                         : {}),
          ...(form.fecha_nacimiento  ? { fecha_nacimiento:   form.fecha_nacimiento }              : {}),
          ...(form.sexo_id           ? { sexo_id:            Number(form.sexo_id) }               : {}),
          ...(form.email             ? { email:              form.email }                         : {}),
          ...(form.telefono          ? { telefono:           form.telefono }                      : {}),
          ...(form.domicilio         ? { domicilio:          form.domicilio }                     : {}),
          ...(form.numerodomicilio   ? { numerodomicilio:    Number(form.numerodomicilio) }       : {}),
          ...(form.piso              ? { piso:               Number(form.piso) }                  : {}),
          ...(form.depto             ? { depto:              form.depto }                         : {}),
          ...(form.cp                ? { cp:                 form.cp }                            : {}),
          ...(form.observaciones_direccion ? { observacionesdireccion: form.observaciones_direccion } : {}),
          ...(form.localidad_id      ? { localidad_id:       Number(form.localidad_id) }          : {}),
          ...(form.provincia_id      ? { provincia_id:       form.provincia_id }                  : {}),
          ...(form.nacionalidad      ? { nacionalidad:       form.nacionalidad }                  : {}),
          ...(form.observaciones     ? { observaciones:      form.observaciones }                 : {}),
          // campos agente
          estado_empleo: form.estado_empleo || 'ACTIVO',
          ...(form.legajo            ? { legajo:             Number(form.legajo) }                : {}),
          ...(form.ley_id            ? { ley_id:             Number(form.ley_id) }                : {}),
          ...(form.planta_id         ? { planta_id:          Number(form.planta_id) }             : {}),
          ...(form.categoria_id      ? { categoria_id:       Number(form.categoria_id) }          : {}),
          ...(form.ocupacion_id      ? { ocupacion_id:       Number(form.ocupacion_id) }          : {}),
          ...(form.regimen_horario_id? { regimen_horario_id: Number(form.regimen_horario_id) }    : {}),
          ...(form.dependencia_id    ? { dependencia_id:     Number(form.dependencia_id) }        : {}),
          ...(form.reparticion_id    ? { reparticion_id:     Number(form.reparticion_id) }        : {}),
          ...(form.servicio_id       ? { servicio_id:        Number(form.servicio_id) }           : {}),
          ...(form.sector_id         ? { sector_id:           Number(form.sector_id) }             : {}),
          ...(form.funcion_id        ? { funcion_id:         Number(form.funcion_id) }            : {}),
          ...(form.fecha_ingreso     ? { fecha_ingreso:      form.fecha_ingreso }                 : {}),
          ...(form.fecha_egreso      ? { fecha_egreso:       form.fecha_egreso }                  : {}),
          ...(form.fecha_baja        ? { fecha_baja:         form.fecha_baja }                    : {}),
          ...(form.salario_mensual   ? { salario_mensual:    parseFloat(form.salario_mensual) }   : {}),
          ...(form.decreto_designacion ? { decreto_designacion: form.decreto_designacion }        : {}),
        };

        const pRes = await apiFetch<any>(`/personal/${dniNum}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (!pRes?.ok) throw new Error(pRes?.error || 'Error al actualizar');

        setSavedDni(dniNum);
        setSavedMode('edit');

      } else {
        if (reentryMode) {
          const altaPayload: Record<string, any> = {
            dni: dniNum,
            apellido: form.apellido.trim().toUpperCase(),
            nombre: form.nombre.trim().toUpperCase(),
            estado_empleo: form.estado_empleo || 'ACTIVO',
            ...(form.cuil ? { cuil: form.cuil } : {}),
            ...(form.fecha_nacimiento ? { fecha_nacimiento: form.fecha_nacimiento } : {}),
            ...(form.sexo_id ? { sexo_id: Number(form.sexo_id) } : {}),
            ...(form.email ? { email: form.email } : {}),
            ...(form.telefono ? { telefono: form.telefono } : {}),
            ...(form.domicilio ? { domicilio: form.domicilio } : {}),
            ...(form.numerodomicilio ? { numerodomicilio: Number(form.numerodomicilio) } : {}),
            ...(form.piso ? { piso: Number(form.piso) } : {}),
            ...(form.depto ? { depto: form.depto } : {}),
            ...(form.cp ? { cp: form.cp } : {}),
            ...(form.observaciones_direccion ? { observacionesdireccion: form.observaciones_direccion } : {}),
            ...(form.localidad_id ? { localidad_id: Number(form.localidad_id) } : {}),
            ...(form.provincia_id ? { provincia_id: form.provincia_id } : {}),
            ...(form.nacionalidad ? { nacionalidad: form.nacionalidad } : {}),
            ...(form.observaciones ? { observaciones: form.observaciones } : {}),
            ...(form.fecha_ingreso ? { fecha_ingreso: form.fecha_ingreso } : {}),
            ...(form.fecha_egreso ? { fecha_egreso: form.fecha_egreso } : {}),
            ...(form.legajo ? { legajo: Number(form.legajo) } : {}),
            ...(form.ley_id ? { ley_id: Number(form.ley_id) } : {}),
            ...(form.planta_id ? { planta_id: Number(form.planta_id) } : {}),
            ...(form.categoria_id ? { categoria_id: Number(form.categoria_id) } : {}),
            ...(form.funcion_id ? { funcion_id: Number(form.funcion_id) } : {}),
            ...(form.ocupacion_id ? { ocupacion_id: Number(form.ocupacion_id) } : {}),
            ...(form.regimen_horario_id ? { regimen_horario_id: Number(form.regimen_horario_id) } : {}),
            ...(form.dependencia_id ? { dependencia_id: Number(form.dependencia_id) } : {}),
            ...(form.reparticion_id ? { reparticion_id: Number(form.reparticion_id) } : {}),
            ...(form.decreto_designacion ? { decreto_designacion: form.decreto_designacion } : {}),
            ...(form.salario_mensual ? { salario_mensual: Number(form.salario_mensual) } : {}),
            ...(form.servicio_id ? {
              servicios: [{
                servicio_id: Number(form.servicio_id),
                ...(form.sector_id ? { sector_id: Number(form.sector_id) } : {}),
                ...(form.dependencia_id ? { dependencia_id: Number(form.dependencia_id) } : {}),
                ...(form.fecha_ingreso ? { fecha_desde: form.fecha_ingreso } : {}),
              }],
            } : {}),
          };
          const altaRes = await apiFetch<any>('/agentes-v2/alta', {
            method: 'POST',
            body: JSON.stringify(altaPayload),
          });
          if (!altaRes?.ok) throw new Error(altaRes?.error || 'Error al registrar reingreso');
          setSavedDni(dniNum);
          setSavedMode('reentry');
        } else {
        // ── MODO ALTA: POST /personal + POST /agentes ──────────────────────────
        // Consulta opcional: la validacion real de activo/reingreso la hace /agentes-v2/alta.
        try {
          const existing = await apiFetch<any>(`/personal?dni=${dniNum}&limit=1&page=1`);
          if (false && (existing?.data?.length ?? 0) > 0) {
            toast.error('Ya existe un agente con ese DNI', `DNI ${dniNum} — buscalo para editarlo`);
            setSaving(false); setStep(1); return;
          }
        } catch {}

        // 1) Crear registro en personal
        const personalPayload: Record<string, any> = {
          dni: dniNum,
          apellido: form.apellido.trim().toUpperCase(),
          nombre:   form.nombre.trim().toUpperCase(),
          ...(form.cuil             ? { cuil:             form.cuil }                 : {}),
          ...(form.fecha_nacimiento ? { fecha_nacimiento: form.fecha_nacimiento }      : {}),
          ...(form.sexo_id          ? { sexo_id:          Number(form.sexo_id) }       : {}),
          ...(form.email            ? { email:            form.email }                 : {}),
          ...(form.telefono         ? { telefono:         form.telefono }              : {}),
          ...(form.domicilio        ? { domicilio:        form.domicilio }             : {}),
          ...(form.numerodomicilio  ? { numerodomicilio:  Number(form.numerodomicilio) } : {}),
          ...(form.piso             ? { piso:             Number(form.piso) }          : {}),
          ...(form.depto            ? { depto:            form.depto }                 : {}),
          ...(form.cp               ? { cp:               form.cp }                    : {}),
          ...(form.observaciones_direccion ? { observacionesdireccion: form.observaciones_direccion } : {}),
          ...(form.localidad_id     ? { localidad_id:     Number(form.localidad_id) }  : {}),
          ...(form.provincia_id     ? { provincia_id:     form.provincia_id }          : {}),
          ...(form.nacionalidad     ? { nacionalidad:     form.nacionalidad }          : {}),
          ...(form.observaciones    ? { observaciones:    form.observaciones }         : {}),
          estado_empleo: form.estado_empleo || 'ACTIVO',
          ...(form.fecha_ingreso      ? { fecha_ingreso:      form.fecha_ingreso }                : {}),
          ...(form.fecha_egreso       ? { fecha_egreso:       form.fecha_egreso }                 : {}),
          ...(form.fecha_baja         ? { fecha_baja:         form.fecha_baja }                   : {}),
          ...(form.legajo             ? { legajo:             Number(form.legajo) }               : {}),
          ...(form.ley_id             ? { ley_id:             Number(form.ley_id) }               : {}),
          ...(form.planta_id          ? { planta_id:          Number(form.planta_id) }            : {}),
          ...(form.categoria_id       ? { categoria_id:       Number(form.categoria_id) }         : {}),
          ...(form.funcion_id         ? { funcion_id:         Number(form.funcion_id) }           : {}),
          ...(form.ocupacion_id       ? { ocupacion_id:       Number(form.ocupacion_id) }         : {}),
          ...(form.regimen_horario_id ? { regimen_horario_id: Number(form.regimen_horario_id) }   : {}),
          ...(form.dependencia_id     ? { dependencia_id:     Number(form.dependencia_id) }       : {}),
          ...(form.reparticion_id     ? { reparticion_id:     Number(form.reparticion_id) }       : {}),
          ...(form.decreto_designacion? { decreto_designacion: form.decreto_designacion }         : {}),
          ...(form.salario_mensual    ? { salario_mensual:    parseFloat(form.salario_mensual) }  : {}),
          ...(form.servicio_id ? {
            servicios: [{
              servicio_id: Number(form.servicio_id),
              ...(form.sector_id ? { sector_id: Number(form.sector_id) } : {}),
              ...(form.dependencia_id ? { dependencia_id: Number(form.dependencia_id) } : {}),
              ...(form.fecha_ingreso ? { fecha_desde: form.fecha_ingreso } : {}),
            }],
          } : {}),
        };
        const pRes = await apiFetch<any>('/agentes-v2/alta', { method: 'POST', body: JSON.stringify(personalPayload) });
        if (!pRes?.ok) throw new Error(pRes?.error || 'Error al crear agente');

        // 2) Crear registro en agentes
        setSavedDni(dniNum);
        setSavedMode('create');
        }
      }

      // Upload foto (aplica en ambos modos)
      if (photo) {
        try {
          const fd = new FormData();
          fd.append('file', photo.blob, `foto_${dniNum}.jpg`);
          fd.append('dni', String(dniNum));
          fd.append('nombre', `Foto carnet ${form.apellido} ${form.nombre}`);
          fd.append('tipo', 'foto_carnet');
          fd.append('descripcion', editMode ? 'Foto carnet actualizada' : 'Foto carnet capturada en alta');
          const base = (window as any).__API_BASE__ || 'http://localhost:3000/api/v1';
          const token = JSON.parse(sessionStorage.getItem('session') || localStorage.getItem('session') || '{}')?.accessToken || '';
          await fetch(`${base}/documents/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
        } catch {
          toast.error(`La foto no se pudo subir. El agente se ${editMode ? 'actualizó' : 'creó'} igual.`);
        }
      }

      setSaved(true);
      toast.ok(
        editMode ? 'Agente actualizado correctamente' : reentryMode ? 'Reingreso registrado correctamente' : 'Agente creado correctamente',
        `DNI ${dniNum}`
      );
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [form, photo, toast, validateStep, editMode, reentryMode]);

  const reset = useCallback(() => {
    setForm(EMPTY_FORM);
    setPhoto(null);
    setSaved(false);
    setSavedDni(null);
    setSavedMode('create');
    setEditMode(false);
    setReentryMode(false);
    setStep(1);
    setErrors({});
  }, []);

  return {
    step, form, photo, saving, saved, savedDni, savedMode, errors, cats,
    editMode, reentryMode, editLoading, checkDni,
    setField, setPhoto, nextStep, prevStep, goToStep, save, reset,
  };
}

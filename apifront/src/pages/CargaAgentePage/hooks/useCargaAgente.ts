// src/pages/CargaAgentePage/hooks/useCargaAgente.ts
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../api/http';
import { useToast } from '../../../ui/toast';
import type { CapturedPhoto } from './useCamera';
import type { ScanResult } from './useScanner';

export type CatalogItem = { id: number | string; nombre: string };

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
  sexo_id: '', email: '', telefono: '', domicilio: '', localidad_id: '',
  nacionalidad: '', observaciones: '',
  fecha_ingreso: '', fecha_egreso: '', fecha_baja: '', estado_empleo: 'ACTIVO', legajo: '',
  ley_id: '', planta_id: '', categoria_id: '', ocupacion_id: '',
  regimen_horario_id: '', jefatura_id: '', funcion_id: '',
  dependencia_id: '', reparticion_id: '', servicio_id: '', sector_id: '',
  decreto_designacion: '',
  salario_mensual: '',
};

export const ESTADO_EMPLEO_OPTS = ['ACTIVO', 'INACTIVO', 'BAJA'];

export type Step = 1 | 2 | 3 | 4;

export type CatalogSet = {
  sexo: CatalogItem[];
  planta: CatalogItem[];
  funcion: CatalogItem[];
  categoria: CatalogItem[];
  dependencia: CatalogItem[];
  localidad: CatalogItem[];
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

export function useCargaAgente() {
  const toast = useToast();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<PersonalForm>(EMPTY_FORM);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [documents, setDocuments] = useState<ScanResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedDni, setSavedDni] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof PersonalForm, string>>>({});

  const [cats, setCats] = useState<CatalogSet>({
    sexo: [], planta: [], funcion: [], categoria: [], dependencia: [],
    localidad: [], ley: [], ocupacion: [], regimenHorario: [],
  });

  const loadCatalog = useCallback(async (table: string): Promise<CatalogItem[]> => {
    try {
      const res = await apiFetch<any>(`/${table}?limit=500&page=1`);
      return (res?.data || []).map((r: any) => ({
        id: r.id,
        nombre: extractNombre(r),
      }));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    Promise.all([
      loadCatalog('sexo'),
      loadCatalog('planta'),
      loadCatalog('funciones'),
      loadCatalog('categoria'),
      loadCatalog('dependencias'),
      loadCatalog('localidades'),
      loadCatalog('ley'),
      loadCatalog('ocupacion'),
      loadCatalog('regimenhorario'),
    ]).then(([sexo, planta, funcion, categoria, dependencia, localidad, ley, ocupacion, regimenHorario]) => {
      setCats({ sexo, planta, funcion, categoria, dependencia, localidad, ley, ocupacion, regimenHorario });
    });
  }, [loadCatalog]);

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
    try {
      const dniNum = Number(form.dni.replace(/\D/g, ''));

      // Verificar duplicado
      try {
        const existing = await apiFetch<any>(`/personal?dni=${dniNum}&limit=1&page=1`);
        if ((existing?.data?.length ?? 0) > 0) {
          toast.error('Ya existe un agente con ese DNI', `DNI ${dniNum}`);
          setSaving(false); setStep(1); return;
        }
      } catch {}

      // 1) Crear registro en personal
      const personalPayload: Record<string, any> = {
        dni: dniNum,
        apellido: form.apellido.trim().toUpperCase(),
        nombre: form.nombre.trim().toUpperCase(),
        ...(form.cuil ? { cuil: form.cuil } : {}),
        ...(form.fecha_nacimiento ? { fecha_nacimiento: form.fecha_nacimiento } : {}),
        ...(form.sexo_id ? { sexo_id: Number(form.sexo_id) } : {}),
        ...(form.email ? { email: form.email } : {}),
        ...(form.telefono ? { telefono: form.telefono } : {}),
        ...(form.domicilio ? { domicilio: form.domicilio } : {}),
        ...(form.localidad_id ? { localidad_id: Number(form.localidad_id) } : {}),
        ...(form.nacionalidad ? { nacionalidad: form.nacionalidad } : {}),
        ...(form.observaciones ? { observaciones: form.observaciones } : {}),
      };
      const pRes = await apiFetch<any>('/personal', { method: 'POST', body: JSON.stringify(personalPayload) });
      if (!pRes?.ok) throw new Error(pRes?.error || 'Error al crear en personal');

      // 2) Crear registro en agentes
      const agentePayload: Record<string, any> = {
        dni: dniNum,
        estado_empleo: form.estado_empleo || 'ACTIVO',
        ...(form.fecha_ingreso ? { fecha_ingreso: form.fecha_ingreso } : {}),
        ...(form.fecha_egreso ? { fecha_egreso: form.fecha_egreso } : {}),
        ...(form.fecha_baja ? { fecha_baja: form.fecha_baja } : {}),
        ...(form.ley_id ? { ley_id: Number(form.ley_id) } : {}),
        ...(form.planta_id ? { planta_id: Number(form.planta_id) } : {}),
        ...(form.categoria_id ? { categoria_id: Number(form.categoria_id) } : {}),
        ...(form.ocupacion_id ? { ocupacion_id: Number(form.ocupacion_id) } : {}),
        ...(form.regimen_horario_id ? { regimen_horario_id: Number(form.regimen_horario_id) } : {}),
        ...(form.dependencia_id ? { dependencia_id: Number(form.dependencia_id) } : {}),
        ...(form.reparticion_id ? { reparticion_id: Number(form.reparticion_id) } : {}),
        ...(form.servicio_id ? { servicio_id: Number(form.servicio_id) } : {}),
        ...(form.sector_id ? { sector_id: Number(form.sector_id) } : {}),
        ...(form.decreto_designacion ? { decreto_designacion: form.decreto_designacion } : {}),
        ...(form.salario_mensual ? { salario_mensual: parseFloat(form.salario_mensual) } : {}),
      };
      const aRes = await apiFetch<any>('/agentes', { method: 'POST', body: JSON.stringify(agentePayload) });

      setSavedDni(dniNum);

      // Upload foto
      if (photo) {
        try {
          const fd = new FormData();
          fd.append('file', photo.blob, `foto_${dniNum}.jpg`);
          fd.append('dni', String(dniNum));
          fd.append('nombre', `Foto carnet ${form.apellido} ${form.nombre}`);
          fd.append('tipo', 'foto_carnet');
          fd.append('descripcion', 'Foto carnet capturada en alta');
          const base = (window as any).__API_BASE__ || 'http://localhost:3000/api/v1';
          const token = JSON.parse(sessionStorage.getItem('session') || localStorage.getItem('session') || '{}')?.accessToken || '';
          await fetch(`${base}/documents/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
        } catch {
          toast.error('La foto no se pudo subir. El agente se creó igual.');
        }
      }

      setSaved(true);
      toast.ok('Agente creado correctamente', `DNI ${dniNum}`);
    } catch (e: any) {
      toast.error('Error al guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }, [form, photo, documents, toast, validateStep]);

  const reset = useCallback(() => {
    setForm(EMPTY_FORM);
    setPhoto(null);
    setDocuments([]);
    setSaved(false);
    setSavedDni(null);
    setStep(1);
    setErrors({});
  }, []);

  return {
    step, form, photo, documents, saving, saved, savedDni, errors, cats,
    setField, setPhoto, nextStep, prevStep, goToStep, save, reset,
    setDocuments,
  };
}


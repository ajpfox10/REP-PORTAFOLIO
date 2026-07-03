import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdmsComandos, getAdmsCruces, getAdmsDispositivos, getAdmsFichadas, getAdmsPersonas, getAdmsStatus } from '../services/admsApi';
import type {
  AdmsComando,
  AdmsComandosFilters,
  AdmsCruces,
  AdmsDispositivo,
  AdmsFichada,
  AdmsFichadasFilters,
  AdmsPersona,
  AdmsStatus,
} from '../types';

const FICHADAS_PAGE = 100;
const PERSONAS_PAGE = 50;
const COMANDOS_PAGE = 50;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useAdmsConsole(active: boolean) {
  const hoy = todayIsoDate();
  const [status, setStatus] = useState<AdmsStatus | null>(null);
  const [cruces, setCruces] = useState<AdmsCruces | null>(null);
  const [dispositivos, setDispositivos] = useState<AdmsDispositivo[]>([]);
  const [fichadas, setFichadas] = useState<AdmsFichada[]>([]);
  const [personas, setPersonas] = useState<AdmsPersona[]>([]);
  const [comandos, setComandos] = useState<AdmsComando[]>([]);
  const [totalFichadas, setTotalFichadas] = useState(0);
  const [totalPersonas, setTotalPersonas] = useState(0);
  const [totalComandos, setTotalComandos] = useState(0);
  const [filters, setFiltersRaw] = useState<AdmsFichadasFilters>({ desde: hoy, hasta: hoy, dni: '', sn: '', tipo: '' });
  const [personasQ, setPersonasQ] = useState('');
  const [comandosFilters, setComandosFiltersRaw] = useState<AdmsComandosFilters>({ sn: '', estado: 'pendientes' });
  const [fichadasOffset, setFichadasOffset] = useState(0);
  const [personasOffset, setPersonasOffset] = useState(0);
  const [comandosOffset, setComandosOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Refs to always have the latest values available in imperative calls
  const filtersRef = useRef(filters);
  const personasQRef = useRef(personasQ);
  const comandosFiltersRef = useRef(comandosFilters);
  const fichadasOffsetRef = useRef(fichadasOffset);
  const personasOffsetRef = useRef(personasOffset);
  const comandosOffsetRef = useRef(comandosOffset);

  filtersRef.current = filters;
  personasQRef.current = personasQ;
  comandosFiltersRef.current = comandosFilters;
  fichadasOffsetRef.current = fichadasOffset;
  personasOffsetRef.current = personasOffset;
  comandosOffsetRef.current = comandosOffset;

  // Wrappers that reset pagination on filter changes
  function setFilters(f: AdmsFichadasFilters) {
    const prev = filtersRef.current;
    const filterChanged = f.desde !== prev.desde || f.hasta !== prev.hasta || f.dni !== prev.dni || f.sn !== prev.sn || f.tipo !== prev.tipo;
    if (filterChanged) {
      setFichadasOffset(0);
      fichadasOffsetRef.current = 0;
    }
    setFiltersRaw(f);
  }

  function setComandosFilters(f: AdmsComandosFilters) {
    const prev = comandosFiltersRef.current;
    if (f.sn !== prev.sn || f.estado !== prev.estado) {
      setComandosOffset(0);
      comandosOffsetRef.current = 0;
    }
    setComandosFiltersRaw(f);
  }

  const loadImmediate = useCallback(async (overrides?: {
    fichadasOffset?: number;
    personasOffset?: number;
    comandosOffset?: number;
    silent?: boolean;
  }) => {
    const fOff = overrides?.fichadasOffset ?? fichadasOffsetRef.current;
    const pOff = overrides?.personasOffset ?? personasOffsetRef.current;
    const cOff = overrides?.comandosOffset ?? comandosOffsetRef.current;
    const f = filtersRef.current;
    const pq = personasQRef.current;
    const cf = comandosFiltersRef.current;

    if (!overrides?.silent) setLoading(true);
    setError(null);
    try {
      const [statusRes, dispositivosRes, fichadasRes, personasRes, comandosRes, crucesRes] = await Promise.all([
        getAdmsStatus(),
        getAdmsDispositivos(),
        getAdmsFichadas(f, fOff),
        getAdmsPersonas(pq, pOff),
        getAdmsComandos(cf, cOff),
        getAdmsCruces(),
      ]);
      setStatus(statusRes);
      setCruces(crucesRes);
      setDispositivos(dispositivosRes);
      setFichadas(fichadasRes.data);
      setTotalFichadas(fichadasRes.total);
      setPersonas(personasRes.data);
      setTotalPersonas(personasRes.total);
      setComandos(comandosRes.data);
      setTotalComandos(comandosRes.total);
    } catch (e: any) {
      setError(e?.message ?? 'Error consultando ADMS');
    } finally {
      if (!overrides?.silent) setLoading(false);
    }
  }, []);

  const load = useCallback(() => loadImmediate(), [loadImmediate]);

  // Pagination helpers — update offset state AND immediately load with that offset
  function goToFichadasPage(offset: number) {
    setFichadasOffset(offset);
    fichadasOffsetRef.current = offset;
    loadImmediate({ fichadasOffset: offset });
  }

  function goToPersonasPage(offset: number) {
    setPersonasOffset(offset);
    personasOffsetRef.current = offset;
    loadImmediate({ personasOffset: offset });
  }

  function goToComandosPage(offset: number) {
    setComandosOffset(offset);
    comandosOffsetRef.current = offset;
    loadImmediate({ comandosOffset: offset });
  }

  // Initial load when tab becomes active
  useEffect(() => {
    if (active && !status && !error) loadImmediate();
  }, [active, status, error, loadImmediate]);

  // Re-load when filters change (but only after initial load)
  useEffect(() => {
    if (!status) return;
    loadImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, personasQ, comandosFilters]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      loadImmediate({ silent: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadImmediate]);

  return {
    status,
    cruces,
    dispositivos,
    fichadas,
    personas,
    comandos,
    totalFichadas,
    totalPersonas,
    totalComandos,
    fichadasOffset,
    personasOffset,
    comandosOffset,
    fichadasPageSize: FICHADAS_PAGE,
    personasPageSize: PERSONAS_PAGE,
    comandosPageSize: COMANDOS_PAGE,
    filters,
    setFilters,
    personasQ,
    setPersonasQ: (q: string) => { setPersonasOffset(0); personasOffsetRef.current = 0; setPersonasQ(q); },
    comandosFilters,
    setComandosFilters,
    goToFichadasPage,
    goToPersonasPage,
    goToComandosPage,
    autoRefresh,
    setAutoRefresh,
    error,
    loading,
    load,
  };
}

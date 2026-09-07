// src/pages/AdminPage/components/CatalogosTab.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../../../api/http';

// La pestaña habla contra /catalogos (mismo CRUD, pero detrás del permiso
// 'admin:catalogos'). /tables y el CRUD pelado los comparten otros módulos.
const API = '/catalogos';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'select' | 'date' | 'datetime' | 'enum';
  required?: boolean;
  // solo para type === 'select'
  sourceTable?: string;
  sourceLabel?: string;
  sourcePk?: string;
  // solo para type === 'enum'
  options?: string[];
}

interface CatalogDef {
  table: string;
  label: string;
  pk: string;           // nombre del campo primary key
  displayKey: string;   // campo principal a mostrar/buscar
  fields: FieldDef[];
}

interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isAutoIncrement: boolean;
  maxLength: number | null;
  enumValues: string[] | null;
  references: { table: string; column: string } | null;
}

interface TableSchema {
  table: string;
  primaryKey: string[];
  columns: ColumnMeta[];
}

// ─── Definiciones curadas ─────────────────────────────────────────────────────
// Solo para las tablas donde queremos etiquetas lindas, combos por FK o un
// subconjunto de columnas. El resto se arma solo desde el schema de la base.
const CATALOGOS: CatalogDef[] = [
  { table: 'dependencias',        label: 'Dependencias',            pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'reparticiones',       label: 'Reparticiones',           pk: 'id',  displayKey: 'reparticion_nombre', fields: [{ key: 'reparticion_nombre', label: 'Nombre',          type: 'text',   required: true }, { key: 'dependencia_id', label: 'Dependencia', type: 'select', sourceTable: 'dependencias', sourceLabel: 'nombre', sourcePk: 'id' }] },
  { table: 'servicios',           label: 'Servicios',               pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'reparticion_id', label: 'Repartición', type: 'select', sourceTable: 'reparticiones', sourceLabel: 'reparticion_nombre', sourcePk: 'id' }] },
  { table: 'sectores',            label: 'Sectores',                pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'servicio_id',    label: 'Servicio',    type: 'select', sourceTable: 'servicios', sourceLabel: 'nombre', sourcePk: 'id' }] },
  { table: 'plantas',             label: 'Plantas',                 pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'categorias',          label: 'Categorías',              pk: 'ID',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Número/Nombre',   type: 'number', required: true }] },
  { table: 'regimenes_horarios',  label: 'Regímenes Horarios',      pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'number', required: true }, { key: 'estado_planta', label: 'Estado Planta', type: 'text' }] },
  { table: 'ley',                 label: 'Leyes',                   pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'codigoexp', label: 'Código Exp', type: 'number' }, { key: 'leyactiva', label: 'Activa', type: 'checkbox' }, { key: 'descuentosprevisionales', label: 'Desc. Prev.', type: 'number' }] },
  { table: 'funciones',           label: 'Funciones',               pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'descripcion', label: 'Descripción', type: 'text' }] },
  { table: 'jefaturas',           label: 'Jefaturas',               pk: 'id',  displayKey: 'servicio_nombre',  fields: [{ key: 'jefe', label: 'Jefe actual', type: 'text' }, { key: 'servicio_id', label: 'Servicio vinculado', type: 'select', sourceTable: 'servicios', sourceLabel: 'nombre', sourcePk: 'id', required: true }] },
  { table: 'sexos',               label: 'Sexos',                   pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'ocupaciones',         label: 'Ocupaciones',             pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'codigo', label: 'Código', type: 'number' }, { key: 'agrupamiento', label: 'Agrupamiento', type: 'text' }, { key: 'grado', label: 'Grado', type: 'text' }, { key: 'asignacion', label: 'Asignación', type: 'text' }] },
  { table: 'especialidaddesmedicas', label: 'Especialidades Médicas', pk: 'id', displayKey: 'especialidad',    fields: [{ key: 'especialidad',      label: 'Especialidad',    type: 'text',   required: true }] },
  { table: 'tipoderesolucion',    label: 'Tipos de Resolución',     pk: 'id',  displayKey: 'resolucion_nombre', fields: [{ key: 'resolucion_nombre', label: 'Nombre',         type: 'text',   required: true }] },
  { table: 'tipodedocumento',     label: 'Tipos de Documento',      pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'tipodecuidado',       label: 'Tipos de Cuidado',        pk: 'id',  displayKey: 'cuidado_nombre',   fields: [{ key: 'cuidado_nombre',    label: 'Nombre',          type: 'text',   required: true }] },
  { table: 'ministerios',         label: 'Ministerios',             pk: 'id',  displayKey: 'ministerio',       fields: [{ key: 'ministerio',        label: 'Ministerio',      type: 'text',   required: true }] },
  { table: 'nomenclador',         label: 'Nomenclador',             pk: 'id',  displayKey: 'cargo',            fields: [{ key: 'cargo',             label: 'Cargo',           type: 'text',   required: true }, { key: 'tareas', label: 'Tareas ID', type: 'number' }] },
  { table: 'codigoa',             label: 'Códigos A',               pk: 'nu',  displayKey: 'codigo',           fields: [{ key: 'codigo',            label: 'Código',          type: 'text',   required: true }, { key: 'observacion', label: 'Observación', type: 'text' }] },
  { table: 'disiplina',           label: 'Disciplinas',             pk: 'id',  displayKey: 'disciplina',       fields: [{ key: 'disciplina',        label: 'Disciplina',      type: 'text',   required: true }] },
  { table: 'jefedeptos',          label: 'Jefes de Departamento',   pk: 'id',  displayKey: 'jefedepto',        fields: [{ key: 'jefedepto',         label: 'Jefe',            type: 'text',   required: true }, { key: 'depto', label: 'Departamento', type: 'text' }, { key: 'oficinacentral', label: 'Oficina Central', type: 'text' }] },
  { table: 'feriados',            label: 'Feriados',                pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'fecha',             label: 'Fecha',           type: 'date',   required: true }, { key: 'nombre', label: 'Nombre', type: 'text', required: true }, { key: 'tipo', label: 'Tipo', type: 'enum', options: ['nacional', 'provincial', 'puente', 'trasladable'] }] },
  { table: 'localidades',         label: 'Localidades',             pk: 'id',  displayKey: 'localidad_nombre', fields: [{ key: 'localidad_nombre',  label: 'Localidad',       type: 'text',   required: true }, { key: 'municipio_nombre', label: 'Municipio', type: 'text' }, { key: 'provincia_nombre', label: 'Provincia', type: 'text' }, { key: 'localidad_codigo', label: 'Código', type: 'text' }] },
  { table: 'dominios',            label: 'Dominios',                pk: 'id',  displayKey: 'nombre',           fields: [{ key: 'nombre',            label: 'Nombre',          type: 'text',   required: true }, { key: 'descripcion', label: 'Descripción', type: 'text' }] },
  { table: 'tareasadquiridias',   label: 'Tareas Adquiridas',       pk: 'id',  displayKey: 'tarea',            fields: [{ key: 'tarea',             label: 'Tarea',           type: 'text',   required: true }, { key: 'descripcion_tarea', label: 'Descripción', type: 'text' }, { key: 'estado', label: 'Estado', type: 'text' }, { key: 'fecha', label: 'Fecha', type: 'date' }] },
];

const CURADOS: Record<string, CatalogDef> = Object.fromEntries(CATALOGOS.map(c => [c.table, c]));

// Columnas de auditoría: se muestran en la grilla pero no se editan a mano.
const COLUMNAS_AUDITORIA = new Set([
  'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'deleted_by',
  'created_by_api_key_id',
]);

// Tablas internas: infraestructura, auditorías, backups y las que ya tienen su
// propia pestaña (usuarios / roles / permisos). No son catálogos editables.
const TABLAS_SISTEMA = new Set([
  'migrations', 'schema_migrations', 'sequelizemeta', 'refresh_tokens', 'idempotency_keys',
  'api_keys', 'api_logs', 'audit_log', 'auth_login_guard', 'security_bans',
  'webhooks', 'webhook_queue', 'webhook_deliveries', 'tenants', 'app_runtime_config',
  'users', 'usuarios', 'usuarios_roles', 'usuarios_dominios', 'roles', 'roles_permisos', 'permisos',
  'personal_integration', 'scan_jobs', 'scan_profiles', 'user_scan_music',
  'documents', 'document_pages', 'documentos_versiones',
  'devices', 'device_capabilities', 'adms_device_structures',
]);

const esSistema = (t: string) =>
  TABLAS_SISTEMA.has(t) || /(_auditoria|_errores|_queue|_vistas|_logs?)$|_bkp|_bak/.test(t);

// Máximo de columnas que mostramos en la grilla de una tabla auto-generada.
const MAX_COLS_GRILLA = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Los DATE de MySQL pueden llegar como '2024-01-01' o ISO completo; el
// <input type="date"> solo acepta YYYY-MM-DD.
const toDateInput = (v: any): string => {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const prettyLabel = (s: string) =>
  String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

const esTexto = (dataType: string) =>
  ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'].includes(dataType);

const tipoDeColumna = (c: ColumnMeta): FieldDef['type'] => {
  const dt = String(c.dataType || '').toLowerCase();
  if (c.enumValues?.length) return 'enum';
  if (dt === 'tinyint') return 'checkbox';
  if (['int', 'bigint', 'smallint', 'mediumint', 'decimal', 'float', 'double', 'year'].includes(dt)) return 'number';
  if (dt === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(dt)) return 'datetime';
  return 'text';
};

// Arma la definición de una tabla que no tiene definición curada.
const defDesdeSchema = (s: TableSchema): CatalogDef => {
  const pk = s.primaryKey?.[0] || s.columns[0]?.name || 'id';
  const pkCol = s.columns.find(c => c.name === pk);

  const editables = s.columns.filter(c => {
    if (COLUMNAS_AUDITORIA.has(c.name)) return false;
    if (c.name === pk && (pkCol?.isAutoIncrement ?? true)) return false;
    return true;
  });

  const fields: FieldDef[] = editables.map(c => ({
    key: c.name,
    label: prettyLabel(c.name),
    type: tipoDeColumna(c),
    required: !c.isNullable && c.columnDefault === null && !c.isAutoIncrement,
    options: c.enumValues || undefined,
  }));

  const display =
    editables.find(c => esTexto(c.dataType) && /nombre|titulo|descripcion|nombre_/.test(c.name))?.name ||
    editables.find(c => esTexto(c.dataType))?.name ||
    pk;

  return { table: s.table, label: prettyLabel(s.table), pk, displayKey: display, fields };
};

// ─── CatalogosTab ─────────────────────────────────────────────────────────────
export function CatalogosTab() {
  const [tablas,        setTablas]        = useState<string[]>([]);
  const [filtroTabla,   setFiltroTabla]   = useState('');
  const [tablaSel,      setTablaSel]      = useState<string>(CATALOGOS[0].table);
  const [def,           setDef]           = useState<CatalogDef | null>(CATALOGOS[0]);
  const [defLoading,    setDefLoading]    = useState(false);

  const [rows,      setRows]      = useState<any[]>([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [limit,     setLimit]     = useState(100);
  const [loading,   setLoading]   = useState(false);
  const [nuevo,     setNuevo]     = useState(false);   // solo alta: no se editan ni se borran filas
  const [form,      setForm]      = useState<Record<string, any>>({});
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [busqueda,      setBusqueda]      = useState('');
  const [busquedaAplic, setBusquedaAplic] = useState('');
  const [selectOpts,    setSelectOpts]    = useState<Record<string, any[]>>({});
  const [verSistema,    setVerSistema]    = useState(false);
  const [grupoAbierto,  setGrupoAbierto]  = useState<Record<string, boolean>>({ catalogos: true, otras: false, sistema: false });

  const schemaCache = useRef<Record<string, CatalogDef>>({ ...CURADOS });

  // ── Lista de tablas de la base ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>(`${API}/tables`);
        const list: string[] = res?.data || res || [];
        setTablas(list);
      } catch {
        // sin /tables mostramos al menos los catálogos curados
        setTablas(CATALOGOS.map(c => c.table).sort());
      }
    })();
  }, []);

  // ── Definición (curada o derivada del schema) de la tabla elegida ───────────
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const cached = schemaCache.current[tablaSel];
      if (cached) { setDef(cached); return; }
      setDefLoading(true);
      setDef(null);
      try {
        const res = await apiFetch<any>(`${API}/tables/${tablaSel}/schema`);
        const s: TableSchema = res?.data || res;
        const d = defDesdeSchema(s);
        schemaCache.current[tablaSel] = d;
        if (!cancelado) setDef(d);
      } catch (e: any) {
        if (!cancelado) setError(e?.message || 'No se pudo leer la estructura de la tabla');
      } finally {
        if (!cancelado) setDefLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [tablaSel]);

  // ── Carga de filas ──────────────────────────────────────────────────────────
  const cargar = useCallback(async (cat: CatalogDef, pg: number, lim: number, q: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(lim) });
      if (q) params.set(`${cat.displayKey}_contains`, q);
      const res = await apiFetch<any>(`${API}/${cat.table}?${params.toString()}`);
      setRows(res?.data || res || []);
      setTotal(Number(res?.meta?.total ?? (res?.data || res || []).length));
    } catch (e: any) {
      setError(e?.message || 'Error al cargar');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Al cambiar de tabla: reset de paginado, búsqueda y formulario.
  useEffect(() => {
    setRows([]);
    setTotal(0);
    setPage(1);
    setBusqueda('');
    setBusquedaAplic('');
    setNuevo(false);
  }, [tablaSel]);

  useEffect(() => {
    if (!def) return;
    cargar(def, page, limit, busquedaAplic);
  }, [def, page, limit, busquedaAplic, cargar]);

  // Búsqueda contra el servidor (debounce) para no traer la tabla entera.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaAplic(busqueda.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargarSelectOpts = useCallback(async (fields: FieldDef[]) => {
    const selects = fields.filter(f => f.type === 'select' && f.sourceTable);
    for (const f of selects) {
      if (selectOpts[f.sourceTable!]) continue;
      try {
        const res = await apiFetch<any>(`${API}/${f.sourceTable}?limit=500&page=1`);
        const items = res?.data || res || [];
        setSelectOpts(prev => ({ ...prev, [f.sourceTable!]: items }));
      } catch {
        // silencioso: el select quedará vacío
      }
    }
  }, [selectOpts]);

  const abrirNuevo = () => {
    if (!def) return;
    const empty: Record<string, any> = {};
    for (const f of def.fields) empty[f.key] = f.type === 'checkbox' ? false : '';
    setForm(empty);
    setNuevo(true);
    cargarSelectOpts(def.fields);
  };

  const guardar = async () => {
    if (!def) return;
    const req = def.fields.find(f => f.required && !form[f.key] && form[f.key] !== 0);
    if (req) { setError(`El campo "${req.label}" es obligatorio`); return; }
    setSaving(true);
    setError('');
    try {
      // '' rompe en columnas numéricas y de fecha: lo mandamos como null.
      const payload: Record<string, any> = {};
      for (const f of def.fields) payload[f.key] = form[f.key] === '' ? null : form[f.key];

      await apiFetch<any>(`${API}/${def.table}`, { method: 'POST', body: JSON.stringify(payload) });
      setNuevo(false);
      cargar(def, page, limit, busquedaAplic);
    } catch (e: any) {
      setError(e?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // ── Derivados de render ─────────────────────────────────────────────────────
  const grupos = useMemo(() => {
    const q = filtroTabla.trim().toLowerCase();
    const etiqueta = (t: string) => CURADOS[t]?.label || prettyLabel(t);
    const list = tablas.length ? tablas : CATALOGOS.map(c => c.table);
    const coincide = (t: string) => !q || t.toLowerCase().includes(q) || etiqueta(t).toLowerCase().includes(q);
    const orden = (a: string, b: string) => etiqueta(a).localeCompare(etiqueta(b), 'es');
    const vis = list.filter(coincide);
    return {
      catalogos: vis.filter(t => CURADOS[t]).sort(orden),
      otras:     vis.filter(t => !CURADOS[t] && !esSistema(t)).sort(orden),
      sistema:   vis.filter(t => !CURADOS[t] && esSistema(t)).sort(orden),
    };
  }, [tablas, filtroTabla]);

  // En tablas auto-generadas puede haber 20 columnas: recortamos la grilla.
  const colsGrilla = useMemo(
    () => (def ? (CURADOS[def.table] ? def.fields : def.fields.slice(0, MAX_COLS_GRILLA)) : []),
    [def]
  );

  const itemTabla = (t: string) => (
    <button
      key={t}
      title={t}
      onClick={() => setTablaSel(t)}
      style={{
        textAlign: 'left', padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
        fontSize: '0.8rem', fontWeight: tablaSel === t ? 700 : 400,
        background: tablaSel === t ? 'rgba(124,58,237,0.25)' : 'transparent',
        color: tablaSel === t ? '#c4b5fd' : 'rgba(255,255,255,0.7)',
      }}
    >
      {CURADOS[t]?.label || prettyLabel(t)}
    </button>
  );

  // Grupo colapsable del sidebar. Con filtro escrito se abre solo, para no
  // esconder resultados detrás de una flechita.
  const grupo = (key: string, titulo: string, items: string[]) => {
    if (!items.length) return null;
    const abierto = grupoAbierto[key] || !!filtroTabla.trim();
    return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <button
          onClick={() => setGrupoAbierto(prev => ({ ...prev, [key]: !prev[key] }))}
          style={{
            textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#94a3b8', fontSize: '0.7rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          {abierto ? '▾' : '▸'} {titulo} ({items.length})
        </button>
        {abierto && items.map(itemTabla)}
      </div>
    );
  };

  const totalPaginas = Math.max(1, Math.ceil(total / limit));
  const labelSel = def?.label || prettyLabel(tablaSel);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, minHeight: 500 }}>

      {/* ── Lista de tablas ── */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, paddingLeft: 4 }}>
          Tablas de la base ({grupos.catalogos.length + grupos.otras.length + (verSistema ? grupos.sistema.length : 0)})
        </div>
        <input
          id="catalogo-filtro-tabla"
          name="filtroTabla"
          aria-label="Filtrar tablas"
          className="input"
          style={{ width: '100%', marginBottom: 6, fontSize: '0.78rem' }}
          placeholder="Filtrar tabla…"
          value={filtroTabla}
          onChange={e => setFiltroTabla(e.target.value)}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 560, overflowY: 'auto' }}>
          {grupo('catalogos', 'Catálogos', grupos.catalogos)}
          {grupo('otras', 'Otras tablas', grupos.otras)}
          {verSistema && grupo('sistema', 'Sistema', grupos.sistema)}
        </div>
        <label
          htmlFor="catalogo-ver-sistema"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, paddingLeft: 4, fontSize: '0.7rem', color: '#64748b', cursor: 'pointer' }}
        >
          <input
            id="catalogo-ver-sistema"
            name="verSistema"
            type="checkbox"
            checked={verSistema}
            onChange={e => { setVerSistema(e.target.checked); if (e.target.checked) setGrupoAbierto(prev => ({ ...prev, sistema: true })); }}
          />
          Ver tablas del sistema
        </label>
      </div>

      {/* ── Panel de datos ── */}
      {/* minWidth:0 => la tabla ancha no estira la columna del grid y el header (con "+ Nuevo") queda siempre a la vista */}
      <div style={{ minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: '0.95rem' }}>{labelSel}</strong>
            <span className="muted" style={{ fontSize: '0.72rem', marginLeft: 8 }}>
              {total} registros · <code style={{ fontSize: '0.7rem' }}>{tablaSel}</code>
            </span>
          </div>
          <button className="btn" style={{ background: '#7c3aed', color: '#fff', fontSize: '0.78rem' }}
            onClick={abrirNuevo} disabled={!def}>+ Nuevo</button>
        </div>

        {/* Buscador */}
        <input
          id="catalogo-busqueda"
          name="busqueda"
          aria-label={`Buscar en ${labelSel}`}
          className="input"
          style={{ width: '100%', marginBottom: 10, fontSize: '0.82rem' }}
          placeholder={`Buscar por ${def ? prettyLabel(def.displayKey) : '…'}…`}
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />

        {error && <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>}

        {/* Formulario inline */}
        {nuevo && def && (
          <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 10 }}>➕ Nuevo registro</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
              {def.fields.map(f => (
                <div key={f.key}>
                  <label htmlFor={`cat-field-${f.key}`} style={{ display: 'block', fontSize: '0.68rem', color: '#94a3b8', marginBottom: 3 }}>{f.label}{f.required ? ' *' : ''}</label>
                  {f.type === 'checkbox' ? (
                    <label htmlFor={`cat-field-${f.key}`} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input id={`cat-field-${f.key}`} type="checkbox" name={f.key} checked={!!form[f.key]}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                      <span style={{ fontSize: '0.8rem' }}>{form[f.key] ? 'Sí' : 'No'}</span>
                    </label>
                  ) : f.type === 'select' ? (
                    <select
                      id={`cat-field-${f.key}`}
                      name={f.key}
                      className="input"
                      style={{ width: '100%', fontSize: '0.82rem' }}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    >
                      <option value="">— Seleccionar {f.label} —</option>
                      {(selectOpts[f.sourceTable!] || []).map(opt => (
                        <option key={opt[f.sourcePk!]} value={opt[f.sourcePk!]}>
                          {opt[f.sourceLabel!]}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'enum' ? (
                    <select
                      id={`cat-field-${f.key}`}
                      name={f.key}
                      className="input"
                      style={{ width: '100%', fontSize: '0.82rem' }}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      <option value="">— Seleccionar {f.label} —</option>
                      {(f.options || []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`cat-field-${f.key}`}
                      name={f.key}
                      className="input"
                      style={{ width: '100%', fontSize: '0.82rem' }}
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ background: '#10b981', color: '#fff', fontSize: '0.78rem' }}
                onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : '💾 Guardar'}</button>
              <button className="btn" style={{ fontSize: '0.78rem' }}
                onClick={() => { setNuevo(false); setError(''); }}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Tabla: solo lectura — desde acá se agregan filas, no se editan ni se borran */}
        {loading || defLoading ? (
          <div className="muted" style={{ fontSize: '0.82rem', padding: 20, textAlign: 'center' }}>Cargando…</div>
        ) : !def || rows.length === 0 ? (
          <div className="muted" style={{ fontSize: '0.82rem', padding: 20, textAlign: 'center' }}>Sin registros</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                    <th style={th}>#</th>
                    {colsGrilla.map(f => <th key={f.key} style={th}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row[def.pk] ?? i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={td}>{row[def.pk]}</td>
                      {colsGrilla.map(f => (
                        <td key={f.key} style={td}>
                          {f.type === 'checkbox'
                            ? (row[f.key] ? '✅' : '—')
                            : f.type === 'date'
                              ? (toDateInput(row[f.key]) || '—')
                              : (row[f.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginado (hay tablas de cientos de miles de filas) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: '0.76rem' }}>
              <button className="btn btn-sm" style={{ fontSize: '0.72rem' }}
                onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>← Anterior</button>
              <span className="muted">Página {page} de {totalPaginas}</span>
              <button className="btn btn-sm" style={{ fontSize: '0.72rem' }}
                onClick={() => setPage(p => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas}>Siguiente →</button>
              <select
                id="catalogo-limit"
                name="limit"
                aria-label="Filas por página"
                className="input"
                style={{ fontSize: '0.76rem', width: 'auto', marginLeft: 'auto' }}
                value={limit}
                onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
              >
                {[50, 100, 250, 500].map(n => <option key={n} value={n}>{n} por página</option>)}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 10px', color: 'rgba(255,255,255,0.85)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

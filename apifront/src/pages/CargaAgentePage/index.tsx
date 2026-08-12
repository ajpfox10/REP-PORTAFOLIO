// src/pages/CargaAgentePage/index.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api/http';
import { useNavigate } from 'react-router-dom';
import { useCargaAgente, ESTADO_EMPLEO_OPTS } from './hooks/useCargaAgente';
import { useCamera } from './hooks/useCamera';
import { EscaneoAgentePage } from '../EscaneoAgentePage';
import './styles/CargaAgente.css';
import { SearchableSelect } from './components/SearchableSelect';

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = [
  { n: 1, label: 'Datos Personales', desc: 'DNI · nombre · nacimiento' },
  { n: 2, label: 'Datos Laborales',  desc: 'Legajo · ley · dependencia' },
  { n: 3, label: 'Foto Carnet',      desc: 'Cámara USB o archivo' },
  { n: 4, label: 'Documentos',       desc: 'Escáner · PDF · JPG' },
] as const;

function StepIndicator({ current, done, onGo }: { current: number; done: Set<number>; onGo: (n: any) => void }) {
  return (
    <div className="ca-steps">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.n}>
          <div
            className={`ca-step${current === s.n ? ' active' : ''}${done.has(s.n) ? ' done' : ''}`}
            onClick={() => done.has(s.n) && onGo(s.n as any)}
          >
            <div className="ca-step-num">{done.has(s.n) ? '✓' : s.n}</div>
            <div className="ca-step-info">
              <div className="ca-step-label">{s.label}</div>
              <div className="ca-step-desc">{s.desc}</div>
            </div>
          </div>
          {i < STEPS.length - 1 && <div className="ca-step-sep" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Step 1: Datos Personales ─────────────────────────────────────────────────
function StepPersonal({ form, setField, errors, cats, editMode, reentryMode, editLoading, onDniBlur }: any) {
  const localidades: any[] = cats.localidad || [];

  // Provincias únicas derivadas de las localidades ya cargadas.
  const provincias = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of localidades) {
      if (l.provincia_id) m.set(String(l.provincia_id), l.provincia_nombre || String(l.provincia_id));
    }
    return [...m.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [localidades]);

  // Municipios de la provincia elegida.
  const municipios = useMemo(() => {
    if (!form.provincia_id) return [];
    const m = new Map<string, string>();
    for (const l of localidades) {
      if (String(l.provincia_id) === String(form.provincia_id) && l.municipio_id) {
        m.set(String(l.municipio_id), l.municipio_nombre || String(l.municipio_id));
      }
    }
    return [...m.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [localidades, form.provincia_id]);

  // Localidades filtradas por provincia (+ municipio si está elegido).
  const localidadesFiltradas = useMemo(() => {
    if (!form.provincia_id) return [];
    return localidades
      .filter((l) => String(l.provincia_id) === String(form.provincia_id))
      .filter((l) => !form.municipio_id || String(l.municipio_id) === String(form.municipio_id))
      .map((l) => ({ id: l.id, nombre: l.nombre }));
  }, [localidades, form.provincia_id, form.municipio_id]);

  // Autocompletar provincia/municipio a partir de la localidad (registros viejos con provincia NULL).
  useEffect(() => {
    if (!form.localidad_id || localidades.length === 0) return;
    const loc = localidades.find((l) => String(l.id) === String(form.localidad_id));
    if (!loc) return;
    if (!form.provincia_id && loc.provincia_id) setField('provincia_id', String(loc.provincia_id));
    if (!form.municipio_id && loc.municipio_id) setField('municipio_id', String(loc.municipio_id));
  }, [form.localidad_id, localidades]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ca-card">
      <div className="ca-section-title">
        👤 Datos Personales
        {editMode && (
          <span style={{
            marginLeft: '0.75rem', fontSize: '0.75rem', fontWeight: 600,
            background: 'rgba(234,179,8,0.15)', color: '#facc15',
            border: '1px solid rgba(234,179,8,0.35)',
            borderRadius: 20, padding: '2px 10px', letterSpacing: '0.03em',
          }}>
            ✏️ MODO EDICIÓN
          </span>
        )}
        {reentryMode && (
          <span style={{
            marginLeft: '0.75rem', fontSize: '0.75rem', fontWeight: 600,
            background: 'rgba(34,197,94,0.15)', color: '#86efac',
            border: '1px solid rgba(34,197,94,0.35)',
            borderRadius: 20, padding: '2px 10px', letterSpacing: '0.03em',
          }}>
            REINGRESO - EL HISTORIAL NO SE MODIFICA
          </span>
        )}
      </div>
      <div className="ca-form-grid">
        <div className="ca-field">
          <label htmlFor="ca-dni" className="ca-label required">DNI</label>
          <div style={{ position: 'relative' }}>
            <input id="ca-dni" name="dni" className={`ca-input${errors.dni ? ' error' : ''}`}
              value={form.dni} onChange={e => setField('dni', e.target.value.replace(/\D/g, ''))}
              onBlur={() => onDniBlur(form.dni)}
              placeholder="12345678" maxLength={8}
              style={{ paddingRight: editLoading ? '2.2rem' : undefined }} />
            {editLoading && (
              <span style={{
                position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)',
                fontSize: '0.8rem', color: 'var(--ca-text2)',
              }}>⏳</span>
            )}
          </div>
          {errors.dni && <span className="ca-field-error">⚠ {errors.dni}</span>}
          {editMode && !editLoading && (
            <span style={{ fontSize: '0.72rem', color: '#facc15', marginTop: 2 }}>
              Agente encontrado — editá los campos y guardá
            </span>
          )}
        </div>

        <div className="ca-field">
          <label htmlFor="ca-cuil" className="ca-label">CUIL</label>
          <input id="ca-cuil" name="cuil" className="ca-input" value={form.cuil}
            onChange={e => setField('cuil', e.target.value)} placeholder="20-12345678-9" maxLength={14} />
          {errors.cuil && <span className="ca-field-error">⚠ {errors.cuil}</span>}
        </div>

        <div className="ca-field">
          <label htmlFor="ca-apellido" className="ca-label required">Apellido</label>
          <input id="ca-apellido" name="apellido" className={`ca-input${errors.apellido ? ' error' : ''}`}
            value={form.apellido} onChange={e => setField('apellido', e.target.value.toUpperCase())}
            placeholder="APELLIDO" />
          {errors.apellido && <span className="ca-field-error">⚠ {errors.apellido}</span>}
        </div>

        <div className="ca-field">
          <label htmlFor="ca-nombre" className="ca-label required">Nombre</label>
          <input id="ca-nombre" name="nombre" className={`ca-input${errors.nombre ? ' error' : ''}`}
            value={form.nombre} onChange={e => setField('nombre', e.target.value.toUpperCase())}
            placeholder="NOMBRE" />
          {errors.nombre && <span className="ca-field-error">⚠ {errors.nombre}</span>}
        </div>

        <div className="ca-field">
          <label htmlFor="ca-fnac" className="ca-label">Fecha de Nacimiento</label>
          <input id="ca-fnac" name="fecha_nacimiento" className="ca-input" type="date" value={form.fecha_nacimiento}
            onChange={e => setField('fecha_nacimiento', e.target.value)} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-sexo" className="ca-label">Sexo</label>
          <SearchableSelect id="ca-sexo" value={form.sexo_id} onChange={v => setField('sexo_id', v)} options={cats.sexo} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-email" className="ca-label">Email</label>
          <input id="ca-email" name="email" className="ca-input" type="email" value={form.email}
            onChange={e => setField('email', e.target.value)} placeholder="agente@dominio.com" />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-tel" className="ca-label">Teléfono</label>
          <input id="ca-tel" name="telefono" className="ca-input" value={form.telefono}
            onChange={e => setField('telefono', e.target.value)} placeholder="221-1234567" />
        </div>

        <div className="ca-field full">
          <label htmlFor="ca-dom" className="ca-label">Calle</label>
          <input id="ca-dom" name="domicilio" className="ca-input" value={form.domicilio}
            onChange={e => setField('domicilio', e.target.value)} placeholder="Calle / Av." maxLength={200} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-nrodom" className="ca-label">Número</label>
          <input id="ca-nrodom" name="numerodomicilio" className="ca-input" inputMode="numeric" value={form.numerodomicilio}
            onChange={e => setField('numerodomicilio', e.target.value.replace(/\D/g, ''))} placeholder="1234" maxLength={6} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-piso" className="ca-label">Piso</label>
          <input id="ca-piso" name="piso" className="ca-input" inputMode="numeric" value={form.piso}
            onChange={e => setField('piso', e.target.value.replace(/\D/g, ''))} placeholder="0" maxLength={3} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-depto" className="ca-label">Depto</label>
          <input id="ca-depto" name="depto" className="ca-input" value={form.depto}
            onChange={e => setField('depto', e.target.value)} placeholder="A" maxLength={50} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-cp" className="ca-label">Código Postal</label>
          <input id="ca-cp" name="cp" className="ca-input" value={form.cp}
            onChange={e => setField('cp', e.target.value)} placeholder="1900" maxLength={50} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-provincia" className="ca-label">Provincia</label>
          <SearchableSelect id="ca-provincia" value={form.provincia_id} options={provincias}
            onChange={v => { setField('provincia_id', v); setField('municipio_id', ''); setField('localidad_id', ''); }} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-municipio" className="ca-label">Municipio</label>
          <SearchableSelect id="ca-municipio" value={form.municipio_id} options={municipios} disabled={!form.provincia_id}
            onChange={v => { setField('municipio_id', v); setField('localidad_id', ''); }} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-localidad" className="ca-label">Localidad</label>
          <SearchableSelect id="ca-localidad" value={form.localidad_id} options={localidadesFiltradas} disabled={!form.provincia_id}
            onChange={v => {
              setField('localidad_id', v);
              const loc = localidades.find((l: any) => String(l.id) === String(v));
              if (loc?.provincia_id) setField('provincia_id', String(loc.provincia_id));
              if (loc?.municipio_id) setField('municipio_id', String(loc.municipio_id));
            }} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-nacionalidad" className="ca-label">Nacionalidad</label>
          <input id="ca-nacionalidad" name="nacionalidad" className="ca-input" value={form.nacionalidad}
            onChange={e => setField('nacionalidad', e.target.value)} placeholder="Argentina" maxLength={50} />
        </div>

        <div className="ca-field full">
          <label htmlFor="ca-obsdir" className="ca-label">Observaciones de dirección</label>
          <input id="ca-obsdir" name="observaciones_direccion" className="ca-input" value={form.observaciones_direccion}
            onChange={e => setField('observaciones_direccion', e.target.value)} placeholder="Entre calles, referencia…" maxLength={50} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Datos Laborales ──────────────────────────────────────────────────
function StepLaboral({ form, setField, errors, cats }: any) {
  const [reparticiones, setReparticiones] = useState<any[]>([]);
  const [servicios,     setServicios]     = useState<any[]>([]);
  const [sectores,      setSectores]      = useState<any[]>([]);

  // Cascade: dependencia → reparticion
  useEffect(() => {
    setReparticiones([]); setServicios([]); setSectores([]);
    if (!form.dependencia_id) return;
    apiFetch<any>(`/reparticiones?dependencia_id=${form.dependencia_id}&limit=500`)
      .then(res => {
        const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setReparticiones(raw.map((o: any) => ({ id: o.id, nombre: o.reparticion_nombre || o.nombre || String(o.id) })));
      }).catch(() => {});
  }, [form.dependencia_id]);

  // Cascade: reparticion → servicio
  useEffect(() => {
    setServicios([]); setSectores([]);
    if (!form.reparticion_id) return;
    apiFetch<any>(`/servicios?reparticion_id=${form.reparticion_id}&limit=500`)
      .then(res => {
        const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setServicios(raw.map((o: any) => ({ id: o.id, nombre: o.nombre || String(o.id) })));
      }).catch(() => {});
  }, [form.reparticion_id]);

  // Cascade: servicio → sector
  useEffect(() => {
    setSectores([]);
    if (!form.servicio_id) return;
    apiFetch<any>(`/sectores?servicio_id=${form.servicio_id}&limit=500`)
      .then(res => {
        const raw: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setSectores(raw.map((o: any) => ({ id: o.id, nombre: o.nombre || String(o.id) })));
      }).catch(() => {});
  }, [form.servicio_id]);

  const sel = (label: string, field: string, items: any[], disabled = false) => (
    <div className="ca-field">
      <label htmlFor={`ca-${field}`} className="ca-label">{label}</label>
      <SearchableSelect
        id={`ca-${field}`}
        value={form[field] ?? ''}
        disabled={disabled}
        options={items}
        onChange={v => {
          setField(field, v);
          if (field === 'dependencia_id') { setField('reparticion_id', ''); setField('servicio_id', ''); setField('sector_id', ''); }
          if (field === 'reparticion_id') { setField('servicio_id', ''); setField('sector_id', ''); }
          if (field === 'servicio_id')    { setField('sector_id', ''); }
        }}
      />
    </div>
  );

  return (
    <div className="ca-card">
      <div className="ca-section-title">💼 Datos Laborales</div>
      <div className="ca-form-grid">

        <div className="ca-field">
          <label htmlFor="ca-fing" className="ca-label">Fecha de Ingreso</label>
          <input id="ca-fing" name="fecha_ingreso" className="ca-input" type="date" value={form.fecha_ingreso}
            onChange={e => setField('fecha_ingreso', e.target.value)} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-feg" className="ca-label">Fecha de Egreso <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>(temporarios)</span></label>
          <input id="ca-feg" name="fecha_egreso" className="ca-input" type="date" value={form.fecha_egreso}
            onChange={e => setField('fecha_egreso', e.target.value)} />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-estado" className="ca-label required">Estado Empleo</label>
          <select id="ca-estado" name="estado_empleo" className="ca-select" value={form.estado_empleo}
            onChange={e => setField('estado_empleo', e.target.value)}>
            {ESTADO_EMPLEO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {errors.estado_empleo && <span className="ca-field-error">⚠ {errors.estado_empleo}</span>}
        </div>

        <div className="ca-field">
          <label htmlFor="ca-legajo" className="ca-label">Legajo</label>
          <input id="ca-legajo" name="legajo" className="ca-input" value={form.legajo}
            onChange={e => setField('legajo', e.target.value)} placeholder="Nº de legajo" />
        </div>

        <div className="ca-field">
          <label htmlFor="ca-decreto" className="ca-label">Decreto de Designación</label>
          <input id="ca-decreto" name="decreto_designacion" className="ca-input" value={form.decreto_designacion}
            onChange={e => setField('decreto_designacion', e.target.value)} placeholder="Ej: 1234/2024" />
        </div>

        {sel('Ley', 'ley_id', cats.ley)}
        {sel('Planta', 'planta_id', cats.planta)}
        {sel('Categoría', 'categoria_id', cats.categoria)}
        {sel('Función', 'funcion_id', cats.funcion)}
        {sel('Ocupación', 'ocupacion_id', cats.ocupacion)}
        {sel('Régimen Horario', 'regimen_horario_id', cats.regimenHorario)}

        {/* ── Cascade org ── */}
        <div className="ca-field-separator full">
          <span className="ca-section-subtitle">🏥 Dependencia / Repartición / Servicio / Sector</span>
        </div>

        {sel('Dependencia', 'dependencia_id', cats.dependencia)}
        {sel('Repartición', 'reparticion_id', reparticiones, !form.dependencia_id)}
        {sel('Servicio',    'servicio_id',    servicios,     !form.reparticion_id)}
        {sel('Sector',      'sector_id',      sectores,      !form.servicio_id)}

        <div className="ca-field full">
          <label htmlFor="ca-obs" className="ca-label">Observaciones</label>
          <textarea id="ca-obs" name="observaciones" className="ca-textarea" value={form.observaciones}
            onChange={e => setField('observaciones', e.target.value)} placeholder="Notas adicionales…" />
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Foto Carnet ──────────────────────────────────────────────────────
function StepFoto({ cam, photo, setPhoto }: any) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCapture = useCallback(async () => {
    const p = await cam.captureAsync();
    if (p) setPhoto(p);
  }, [cam, setPhoto]);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const p = await cam.loadFromFile(f);
    if (p) setPhoto(p);
    e.target.value = '';
  }, [cam, setPhoto]);

  return (
    <div className="ca-card">
      <div className="ca-section-title">📷 Foto Carnet</div>
      <div className="ca-camera-layout">

        {/* Left: video + controls */}
        <div>
          <div className="ca-device-select">
            <select aria-label="Seleccionar cámara USB" className="ca-select" style={{ flex: 1, fontSize: '0.82rem' }}
              value={cam.selectedDevice}
              onChange={e => { cam.setSelectedDevice(e.target.value); cam.startCamera(e.target.value); }}>
              <option value="">— Seleccionar cámara USB —</option>
              {cam.devices.map((d: any) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
            <button className="ca-btn ca-btn-secondary ca-btn-sm" title="Buscar cámaras"
              onClick={() => cam.enumerateDevices()}>🔍</button>
            {cam.active
              ? <button className="ca-btn ca-btn-danger ca-btn-sm" onClick={cam.stopCamera}>⏹</button>
              : <button className="ca-btn ca-btn-primary ca-btn-sm"
                  onClick={() => cam.startCamera(cam.selectedDevice || undefined)}>▶ Iniciar</button>
            }
          </div>

          <div className="ca-video-wrap">
            {cam.active ? (
              <>
                <video ref={cam.videoRef}
                  className={`ca-video${cam.mirrored ? ' mirrored' : ''}`}
                  autoPlay playsInline muted />
                <div className="ca-carnet-guide" />
                <button
                  className="ca-btn ca-btn-ghost ca-btn-sm"
                  style={{ position: 'absolute', bottom: 8, right: 8 }}
                  onClick={() => cam.setMirrored((m: boolean) => !m)}>⟺</button>
              </>
            ) : (
              <div className="ca-video-overlay">
                <div style={{ fontSize: '3rem', opacity: 0.25 }}>📷</div>
                <div style={{ color: 'rgba(148,163,184,0.7)', fontSize: '0.88rem', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
                  {cam.error || 'Iniciá la cámara o cargá una foto desde archivo'}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button className="ca-btn ca-btn-primary" style={{ flex: 1 }}
              onClick={handleCapture} disabled={!cam.active}>
              📸 Capturar foto
            </button>
            <button className="ca-btn ca-btn-secondary" onClick={() => fileRef.current?.click()}>
              📁 Subir archivo
            </button>
            <input ref={fileRef} type="file" accept="image/*"
              style={{ display: 'none' }} onChange={handleFile} />
          </div>
        </div>

        {/* Right: preview */}
        <div>
          <div className="ca-opt-label" style={{ marginBottom: '0.5rem' }}>FOTO CAPTURADA</div>
          {photo ? (
            <>
              <div className="ca-photo-preview">
                <img src={photo.dataUrl} alt="Foto carnet" style={{ width: '100%', maxHeight: 320, objectFit: 'cover' }} />
              </div>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--ca-text2)' }}>
                  {photo.width}×{photo.height}px
                </span>
                <button className="ca-btn ca-btn-danger ca-btn-sm"
                  onClick={() => { cam.clearPhoto(); setPhoto(null); }}>🗑 Borrar</button>
              </div>
            </>
          ) : (
            <div style={{
              border: '2px dashed rgba(255,255,255,0.1)', borderRadius: 8,
              padding: '2.5rem', textAlign: 'center',
              color: 'rgba(148,163,184,0.4)', fontSize: '0.85rem'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🪪</div>
              Sin foto aún
            </div>
          )}
          <div style={{
            marginTop: '1rem', padding: '0.75rem',
            background: 'rgba(245,158,11,0.07)', borderRadius: 8,
            border: '1px solid rgba(245,158,11,0.15)',
            fontSize: '0.74rem', color: 'var(--ca-text2)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--ca-amber)' }}>💡 Tip:</strong> Usá el guía punteado para
            centrar la cara. Las cámaras USB externas aparecen al final de la lista.
            La foto se sube al servidor junto con el alta.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Documentos / Scanner ─────────────────────────────────────────────
function StepScannerReady({ dni }: { dni: string }) {
  return (
    <div className="ca-card">
      <div className="ca-section-title">Documentacion y scanner1</div>
      <div style={{ padding: '1.25rem', border: '1px solid var(--ca-border)', borderRadius: 10, lineHeight: 1.7 }}>
        <strong>Primero se guardara el agente.</strong>
        <p style={{ color: 'var(--ca-text2)', margin: '0.5rem 0 0' }}>
          Luego podras abrir el scanner instalado. Los documentos se vinculan al DNI {dni || 'indicado'},
          se registran en el legajo y se guardan en la carpeta documental configurada.
        </p>
      </div>
    </div>
  );
}

function Resumen({ form, photo, cats }: any) {
  const fn = (list: any[], id: string) => list.find((x: any) => String(x.id) === String(id))?.nombre || id || '—';
  const rows = [
    ['DNI', form.dni || '—'],           ['CUIL', form.cuil || '—'],
    ['Apellido', form.apellido || '—'],  ['Nombre', form.nombre || '—'],
    ['Nacimiento', form.fecha_nacimiento || '—'],
    ['Sexo', fn(cats.sexo, form.sexo_id)],
    ['Ingreso', form.fecha_ingreso || '—'],
    ['Estado', form.estado_empleo || '—'],
    ['Legajo', form.legajo || '—'],
    ['Ley', fn(cats.ley, form.ley_id)],
    ['Planta', fn(cats.planta, form.planta_id)],
    ['Categoría', fn(cats.categoria, form.categoria_id)],
    ['Función', fn(cats.funcion, form.funcion_id)],
    ['Ocupación', fn(cats.ocupacion, form.ocupacion_id)],
    ['Dependencia', fn(cats.dependencia, form.dependencia_id)],
    ['Decreto', form.decreto_designacion || '—'],
    ['Email', form.email || '—'],
    ['Teléfono', form.telefono || '—'],
  ];

  return (
    <div className="ca-card" style={{ marginTop: '1.5rem' }}>
      <div className="ca-section-title">📋 Resumen</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2rem' }}>
        <div>
          {rows.map(([k, v]) => (
            <div key={k} className="ca-summary-row">
              <span className="ca-summary-key">{k}</span>
              <span className="ca-summary-val">{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 160 }}>
          <div>
            <div className="ca-opt-label" style={{ marginBottom: 6 }}>FOTO</div>
            {photo
              ? <img src={photo.dataUrl} alt="" style={{ width: 150, borderRadius: 8, border: '2px solid var(--ca-border)' }} />
              : <span style={{ color: 'var(--ca-text2)', fontSize: '0.82rem' }}>Sin foto</span>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────
export function CargaAgentePage() {
  const navigate = useNavigate();
  const carga = useCargaAgente();
  const cam   = useCamera();
  const [showScanner, setShowScanner] = useState(false);

  // Apagar cámara al salir del paso 3
  useEffect(() => {
    if (carga.step === 3) cam.enumerateDevices();
    else cam.stopCamera();
  }, [carga.step]);

  const doneSteps = new Set<number>();
  if (carga.form.dni && carga.form.apellido && carga.form.nombre) doneSteps.add(1);
  if (carga.form.estado_empleo) doneSteps.add(2);
  if (carga.photo) doneSteps.add(3);

  // ── Pantalla de éxito ──
  if (carga.saved) {
    const isEdit = carga.savedMode === 'edit';
    if (showScanner && carga.savedDni) {
      return (
        <div className="ca-root">
          <div className="ca-wrap">
            <EscaneoAgentePage
              dni={String(carga.savedDni)}
              embedded
              onExit={() => setShowScanner(false)}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="ca-root">
        <div className="ca-wrap">
          <div className="ca-card">
            <div className="ca-success">
              <div className="ca-success-icon">{isEdit ? '✅' : '🎉'}</div>
              <div className="ca-success-title">
                {isEdit ? 'Agente actualizado' : 'Agente registrado'}
              </div>
              <div className="ca-success-dni">DNI {carga.savedDni}</div>
              <div style={{ color: 'var(--ca-text2)', fontSize: '0.95rem', textAlign: 'center', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--ca-text)' }}>{carga.form.apellido}, {carga.form.nombre}</strong>
                <br />
                {carga.photo && '📷 Foto cargada · '}
                La documentacion puede escanearse ahora con scanner1.
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="ca-btn ca-btn-primary ca-btn-lg"
                  onClick={() => setShowScanner(true)}>
                  Escanear documentacion
                </button>
                <button className="ca-btn ca-btn-secondary ca-btn-lg" onClick={() => carga.reset()}>
                  ➕ Cargar otro agente
                </button>
                {isEdit && (
                  <button className="ca-btn ca-btn-secondary ca-btn-lg"
                    onClick={() => {
                      const dni = String(carga.savedDni ?? '');
                      carga.reset();
                      carga.setField('dni', dni);
                      carga.checkDni(dni);
                    }}>
                    ✏️ Editar de nuevo
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ca-root">
      <div className="ca-wrap">

        {/* Header */}
        <div className="ca-header">
          <div className="ca-header-left">
            <div className="ca-logo">{carga.editMode ? '✏️' : '🏛'}</div>
            <div>
              <div className="ca-title">{carga.editMode ? 'EDICIÓN DE AGENTE' : carga.reentryMode ? 'REINGRESO DE AGENTE' : 'ALTA DE AGENTE'}</div>
              <div className="ca-subtitle">
                PersonalV5 · {carga.editMode
                  ? `DNI ${carga.form.dni} — ${carga.form.apellido} ${carga.form.nombre}`
                  : 'Módulo de registro con escáner'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="ca-btn ca-btn-secondary"
              type="button"
              onClick={() => navigate('/app')}
              style={{ fontSize: '0.82rem' }}
            >
              ← Salir
            </button>
            <span className="ca-status-pill ok">scanner1 vinculado</span>
            <span className={`ca-status-pill ${cam.active ? 'ok' : 'err'}`}>
              {cam.active ? '📷 Cámara activa' : '📷 Sin cámara'}
            </span>
          </div>
        </div>

        <StepIndicator current={carga.step} done={doneSteps} onGo={carga.goToStep} />

        {/* Contenido del paso activo */}
        {carga.step === 1 && (
          <StepPersonal
            form={carga.form} setField={carga.setField} errors={carga.errors} cats={carga.cats}
            editMode={carga.editMode} reentryMode={carga.reentryMode} editLoading={carga.editLoading}
            onDniBlur={carga.checkDni}
          />
        )}
        {carga.step === 2 && <StepLaboral  form={carga.form} setField={carga.setField} errors={carga.errors} cats={carga.cats} />}
        {carga.step === 3 && <StepFoto cam={cam} photo={carga.photo} setPhoto={carga.setPhoto} />}
        {carga.step === 4 && <StepScannerReady dni={carga.form.dni} />}

        {/* Resumen visible desde paso 2 en adelante */}
        {carga.step >= 2 && (
          <Resumen form={carga.form} photo={carga.photo} cats={carga.cats} />
        )}

        {/* Navegación inferior */}
        <div className="ca-nav-footer">
          <div>
            {carga.step > 1 && (
              <button className="ca-btn ca-btn-secondary" onClick={carga.prevStep}>← Anterior</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--ca-text2)', fontFamily: 'IBM Plex Mono, monospace' }}>
              Paso {carga.step} de 4
            </span>
            {carga.step < 4 && (
              <button className="ca-btn ca-btn-primary" onClick={carga.nextStep}>Siguiente →</button>
            )}
            {carga.step >= 2 && (
              <button
                className="ca-btn ca-btn-primary ca-btn-lg"
                onClick={carga.save}
                disabled={carga.saving || !carga.form.dni || !carga.form.apellido}
                style={carga.editMode ? { background: 'rgba(234,179,8,0.85)', color: '#1e1b10' } : undefined}
              >
                {carga.saving
                  ? '⏳ Guardando…'
                  : carga.editMode
                    ? '💾 Actualizar Agente'
                    : '💾 Guardar Agente'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default CargaAgentePage;

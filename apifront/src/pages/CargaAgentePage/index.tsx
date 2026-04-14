// src/pages/CargaAgentePage/index.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../api/http';
import { useNavigate } from 'react-router-dom';
import { useCargaAgente, ESTADO_EMPLEO_OPTS } from './hooks/useCargaAgente';
import { useCamera } from './hooks/useCamera';
import { useScanner } from './hooks/useScanner';
import type { ScanResult } from './hooks/useScanner';
import './styles/CargaAgente.css';

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
function StepPersonal({ form, setField, errors, cats }: any) {
  return (
    <div className="ca-card">
      <div className="ca-section-title">👤 Datos Personales</div>
      <div className="ca-form-grid">
        <div className="ca-field">
          <label className="ca-label required">DNI</label>
          <input className={`ca-input${errors.dni ? ' error' : ''}`}
            value={form.dni} onChange={e => setField('dni', e.target.value.replace(/\D/g, ''))}
            placeholder="12345678" maxLength={8} />
          {errors.dni && <span className="ca-field-error">⚠ {errors.dni}</span>}
        </div>

        <div className="ca-field">
          <label className="ca-label">CUIL</label>
          <input className="ca-input" value={form.cuil}
            onChange={e => setField('cuil', e.target.value)} placeholder="20-12345678-9" maxLength={14} />
          {errors.cuil && <span className="ca-field-error">⚠ {errors.cuil}</span>}
        </div>

        <div className="ca-field">
          <label className="ca-label required">Apellido</label>
          <input className={`ca-input${errors.apellido ? ' error' : ''}`}
            value={form.apellido} onChange={e => setField('apellido', e.target.value.toUpperCase())}
            placeholder="APELLIDO" />
          {errors.apellido && <span className="ca-field-error">⚠ {errors.apellido}</span>}
        </div>

        <div className="ca-field">
          <label className="ca-label required">Nombre</label>
          <input className={`ca-input${errors.nombre ? ' error' : ''}`}
            value={form.nombre} onChange={e => setField('nombre', e.target.value.toUpperCase())}
            placeholder="NOMBRE" />
          {errors.nombre && <span className="ca-field-error">⚠ {errors.nombre}</span>}
        </div>

        <div className="ca-field">
          <label className="ca-label">Fecha de Nacimiento</label>
          <input className="ca-input" type="date" value={form.fecha_nacimiento}
            onChange={e => setField('fecha_nacimiento', e.target.value)} />
        </div>

        <div className="ca-field">
          <label className="ca-label">Sexo</label>
          <select className="ca-select" value={form.sexo_id} onChange={e => setField('sexo_id', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {cats.sexo.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        <div className="ca-field">
          <label className="ca-label">Email</label>
          <input className="ca-input" type="email" value={form.email}
            onChange={e => setField('email', e.target.value)} placeholder="agente@dominio.com" />
        </div>

        <div className="ca-field">
          <label className="ca-label">Teléfono</label>
          <input className="ca-input" value={form.telefono}
            onChange={e => setField('telefono', e.target.value)} placeholder="221-1234567" />
        </div>

        <div className="ca-field full">
          <label className="ca-label">Domicilio</label>
          <input className="ca-input" value={form.domicilio}
            onChange={e => setField('domicilio', e.target.value)} placeholder="Calle 123, Piso 2" />
        </div>

        <div className="ca-field">
          <label className="ca-label">Localidad</label>
          <select className="ca-select" value={form.localidad_id}
            onChange={e => setField('localidad_id', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {cats.localidad.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
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
      <label className="ca-label">{label}</label>
      <select className="ca-select" value={form[field] ?? ''} disabled={disabled}
        onChange={e => {
          setField(field, e.target.value);
          // limpiar hijos al cambiar padre
          if (field === 'dependencia_id') { setField('reparticion_id', ''); setField('servicio_id', ''); setField('sector_id', ''); }
          if (field === 'reparticion_id') { setField('servicio_id', ''); setField('sector_id', ''); }
          if (field === 'servicio_id')    { setField('sector_id', ''); }
        }}>
        <option value="">— Seleccionar —</option>
        {items.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
    </div>
  );

  return (
    <div className="ca-card">
      <div className="ca-section-title">💼 Datos Laborales</div>
      <div className="ca-form-grid">

        <div className="ca-field">
          <label className="ca-label">Fecha de Ingreso</label>
          <input className="ca-input" type="date" value={form.fecha_ingreso}
            onChange={e => setField('fecha_ingreso', e.target.value)} />
        </div>

        <div className="ca-field">
          <label className="ca-label required">Estado Empleo</label>
          <select className="ca-select" value={form.estado_empleo}
            onChange={e => setField('estado_empleo', e.target.value)}>
            {ESTADO_EMPLEO_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {errors.estado_empleo && <span className="ca-field-error">⚠ {errors.estado_empleo}</span>}
        </div>

        <div className="ca-field">
          <label className="ca-label">Legajo</label>
          <input className="ca-input" value={form.legajo}
            onChange={e => setField('legajo', e.target.value)} placeholder="Nº de legajo" />
        </div>

        <div className="ca-field">
          <label className="ca-label">Decreto de Designación</label>
          <input className="ca-input" value={form.decreto_designacion}
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
          <label className="ca-label">Observaciones</label>
          <textarea className="ca-textarea" value={form.observaciones}
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
            <select className="ca-select" style={{ flex: 1, fontSize: '0.82rem' }}
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
function ScanItem({ doc, index, onRemove, onRename }: {
  doc: ScanResult; index: number; onRemove: () => void; onRename: (l: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(doc.label || '');
  const thumb = doc.mime !== 'application/pdf' ? `data:${doc.mime};base64,${doc.data}` : null;

  return (
    <div className="ca-scan-item">
      {thumb
        ? <img className="ca-scan-thumb" src={thumb} alt="" />
        : <div className="ca-scan-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>📄</div>
      }
      <div className="ca-scan-info">
        {editing ? (
          <input className="ca-input" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
            value={val} onChange={e => setVal(e.target.value)} autoFocus
            onBlur={() => { onRename(val); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onRename(val); setEditing(false); } }} />
        ) : (
          <div className="ca-scan-name" onClick={() => setEditing(true)}
            style={{ cursor: 'pointer' }} title="Click para renombrar">
            {doc.label || `Doc ${index + 1}`}
          </div>
        )}
        <div className="ca-scan-meta">
          {doc.dpi} DPI · {(doc.format || 'doc').toUpperCase()}{doc.demo ? ' · DEMO' : ''}
        </div>
      </div>
      <span className={`ca-scan-badge${doc.format === 'pdf' ? ' pdf' : ''}${doc.demo ? ' demo' : ''}`}>
        {(doc.format || 'doc').toUpperCase()}
      </span>
      <button className="ca-btn ca-btn-ghost ca-btn-sm" onClick={onRemove} title="Eliminar">✕</button>
    </div>
  );
}

function StepDocumentos({ scanner, form }: { scanner: ReturnType<typeof useScanner>; form: any }) {
  const [scanLabel, setScanLabel] = useState('');
  const [isDrag, setIsDrag] = useState(false);
  const [agentInput, setAgentInput] = useState(scanner.agentUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setIsDrag(false);
    for (const f of Array.from(e.dataTransfer.files)) {
      if (f.type.startsWith('image/') || f.type === 'application/pdf') {
        await scanner.processFile(f, 'pdf', f.name);
      }
    }
  }, [scanner]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const f of Array.from(e.target.files || [])) {
      await scanner.processFile(f, 'pdf', f.name);
    }
    e.target.value = '';
  }, [scanner]);

  const handleScan = useCallback(async () => {
    const label = scanLabel.trim() || `Doc ${scanner.scanResults.length + 1} — DNI ${form.dni || '?'}`;
    await scanner.scan(label);
    setScanLabel('');
  }, [scanner, scanLabel, form.dni]);

  const statusColor = { connected: 'green', disconnected: 'red', connecting: 'amber', scanning: 'amber', error: 'red' }[scanner.status] || 'red';
  const statusLabel = {
    connected: 'Agente conectado',
    disconnected: 'Agente desconectado',
    connecting: 'Conectando…',
    scanning: 'Escaneando…',
    error: 'Error de conexión',
  }[scanner.status] || '?';

  const docs = scanner.scanResults;

  return (
    <div className="ca-card">
      <div className="ca-section-title">🖨 Documentos y Escáner</div>
      <div className="ca-scanner-layout">

        {/* Panel escáner */}
        <div className="ca-scanner-panel">

          <div className={`ca-scanner-status ${scanner.status}`}>
            <div className={`ca-dot ${statusColor}`} />
            <span style={{ fontWeight: 600 }}>{statusLabel}</span>
          </div>

          {scanner.status === 'scanning' && (
            <div className="ca-scan-progress"><div className="ca-scan-progress-bar" /></div>
          )}

          <div>
            <div className="ca-opt-label" style={{ marginBottom: 4 }}>URL DEL AGENTE LOCAL</div>
            <div className="ca-agent-url">
              <input value={agentInput} onChange={e => setAgentInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && scanner.connect(agentInput)}
                placeholder="http://127.0.0.1:9100" />
              <button className="ca-btn ca-btn-secondary ca-btn-sm"
                onClick={() => scanner.connect(agentInput)} title="Conectar">↻</button>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--ca-text2)', marginTop: 4, fontFamily: 'IBM Plex Mono, monospace' }}>
              Iniciá: <span style={{ color: 'var(--ca-amber)' }}>cd scanner-agent &amp;&amp; npm start</span>
            </div>
          </div>

          {scanner.scanners.length > 0 && (
            <div>
              <div className="ca-opt-label" style={{ marginBottom: 4 }}>ESCÁNER DETECTADO</div>
              <select className="ca-select" style={{ fontSize: '0.82rem' }}
                value={scanner.selectedScanner}
                onChange={e => scanner.setSelectedScanner(e.target.value)}>
                {scanner.scanners.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}{s.demo ? ' (DEMO)' : ''}</option>
                ))}
              </select>
              <button className="ca-btn ca-btn-ghost ca-btn-sm" style={{ marginTop: 4, width: '100%' }}
                onClick={scanner.refreshScanners}>🔄 Actualizar lista</button>
            </div>
          )}

          {/* Opciones */}
          <div>
            <div className="ca-opt-label" style={{ marginBottom: 6 }}>OPCIONES DE ESCANEO</div>
            <div className="ca-scan-opts">
              <div className="ca-opt-group">
                <div className="ca-opt-label">DPI</div>
                <select className="ca-select" style={{ fontSize: '0.8rem' }}
                  value={scanner.opts.dpi}
                  onChange={e => scanner.setOpts((o: any) => ({ ...o, dpi: Number(e.target.value) }))}>
                  {[75, 100, 150, 200, 300, 600].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="ca-opt-group">
                <div className="ca-opt-label">COLOR</div>
                <select className="ca-select" style={{ fontSize: '0.8rem' }}
                  value={scanner.opts.color}
                  onChange={e => scanner.setOpts((o: any) => ({ ...o, color: e.target.value }))}>
                  <option value="gray">Grises</option>
                  <option value="color">Color</option>
                  <option value="bw">B/N</option>
                </select>
              </div>
              <div className="ca-opt-group">
                <div className="ca-opt-label">FORMATO</div>
                <select className="ca-select" style={{ fontSize: '0.8rem' }}
                  value={scanner.opts.format}
                  onChange={e => scanner.setOpts((o: any) => ({ ...o, format: e.target.value }))}>
                  <option value="pdf">PDF</option>
                  <option value="jpeg">JPG</option>
                </select>
              </div>
              <div className="ca-opt-group">
                <div className="ca-opt-label">CALIDAD</div>
                <select className="ca-select" style={{ fontSize: '0.8rem' }}
                  value={scanner.opts.quality}
                  onChange={e => scanner.setOpts((o: any) => ({ ...o, quality: Number(e.target.value) }))}>
                  <option value={60}>60% — pequeño</option>
                  <option value={75}>75% — normal</option>
                  <option value={85}>85% — buena</option>
                  <option value={95}>95% — alta</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <div className="ca-opt-label" style={{ marginBottom: 4 }}>ETIQUETA DEL DOCUMENTO</div>
            <input className="ca-input" style={{ fontSize: '0.85rem' }}
              value={scanLabel} onChange={e => setScanLabel(e.target.value)}
              placeholder={`Doc ${docs.length + 1} — DNI ${form.dni || '...'}`} />
          </div>

          <button className="ca-scan-big-btn" onClick={handleScan}
            disabled={scanner.status !== 'connected' || !scanner.selectedScanner}>
            {scanner.status === 'scanning' ? '⏳ Escaneando…' : '🖨 ESCANEAR AHORA'}
          </button>

          {scanner.error && (
            <div style={{ fontSize: '0.78rem', color: 'var(--ca-red)', lineHeight: 1.4, padding: '0.6rem', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
              {scanner.error}
            </div>
          )}
        </div>

        {/* Panel documentos */}
        <div>
          <div
            className={`ca-drop-zone${isDrag ? ' drag-over' : ''}`}
            style={{ marginBottom: '1rem' }}
            onDragOver={e => { e.preventDefault(); setIsDrag(true); }}
            onDragLeave={() => setIsDrag(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>📄</div>
            <strong>Arrastrar archivos aquí o hacer click</strong>
            <div style={{ fontSize: '0.78rem', marginTop: 4 }}>PDF · JPG · PNG — se convierten automáticamente</div>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf"
              style={{ display: 'none' }} onChange={handleFileInput} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div className="ca-opt-label">DOCUMENTOS CARGADOS ({docs.length})</div>
            {docs.length > 0 && (
              <button className="ca-btn ca-btn-danger ca-btn-sm" onClick={scanner.clearAll}>
                🗑 Limpiar todo
              </button>
            )}
          </div>

          {docs.length === 0 ? (
            <div className="ca-scan-empty">
              <div className="ca-scan-empty-icon">🗂</div>
              Ningún documento.<br />
              <span style={{ fontSize: '0.78rem' }}>Escaneá o arrastrá archivos.</span>
            </div>
          ) : (
            <div className="ca-scan-queue">
              {docs.map((doc, i) => (
                <ScanItem
                  key={doc.id} doc={doc} index={i}
                  onRemove={() => scanner.removeScanResult(doc.id)}
                  onRename={label => {
                    // Mutar el label localmente (los scanResults son objetos)
                    doc.label = label;
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resumen ──────────────────────────────────────────────────────────────────
function Resumen({ form, photo, docs, cats }: any) {
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
          <div>
            <div className="ca-opt-label" style={{ marginBottom: 6 }}>DOCS ({docs.length})</div>
            {docs.length === 0
              ? <span style={{ color: 'var(--ca-text2)', fontSize: '0.82rem' }}>Ninguno</span>
              : docs.map((d: ScanResult, i: number) => (
                <div key={d.id} style={{ fontSize: '0.78rem', color: 'var(--ca-text2)', marginBottom: 3 }}>
                  {i + 1}. {d.label || `Doc ${i + 1}`} ({(d.format || '').toUpperCase()})
                </div>
              ))
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
  const scanner = useScanner();

  // Sincronizar docs del scanner hacia el hook de carga
  useEffect(() => {
    carga.setDocuments(scanner.scanResults);
  }, [scanner.scanResults]);

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
    return (
      <div className="ca-root">
        <div className="ca-wrap">
          <div className="ca-card">
            <div className="ca-success">
              <div className="ca-success-icon">🎉</div>
              <div className="ca-success-title">Agente registrado</div>
              <div className="ca-success-dni">DNI {carga.savedDni}</div>
              <div style={{ color: 'var(--ca-text2)', fontSize: '0.95rem', textAlign: 'center', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--ca-text)' }}>{carga.form.apellido}, {carga.form.nombre}</strong>
                <br />
                {carga.photo && '📷 Foto cargada · '}
                {scanner.scanResults.length > 0 && `📄 ${scanner.scanResults.length} documento(s) subidos`}
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="ca-btn ca-btn-primary ca-btn-lg" onClick={() => { carga.reset(); scanner.clearAll(); }}>
                  ➕ Cargar otro agente
                </button>
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
            <div className="ca-logo">🏛</div>
            <div>
              <div className="ca-title">ALTA DE AGENTE</div>
              <div className="ca-subtitle">PersonalV5 · Módulo de registro con escáner</div>
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
            <span className={`ca-status-pill ${scanner.status === 'connected' ? 'ok' : 'err'}`}>
              {scanner.status === 'connected' ? '🖨 Scanner OK' : '🖨 Sin scanner'}
            </span>
            <span className={`ca-status-pill ${cam.active ? 'ok' : 'err'}`}>
              {cam.active ? '📷 Cámara activa' : '📷 Sin cámara'}
            </span>
          </div>
        </div>

        <StepIndicator current={carga.step} done={doneSteps} onGo={carga.goToStep} />

        {/* Contenido del paso activo */}
        {carga.step === 1 && <StepPersonal form={carga.form} setField={carga.setField} errors={carga.errors} cats={carga.cats} />}
        {carga.step === 2 && <StepLaboral  form={carga.form} setField={carga.setField} errors={carga.errors} cats={carga.cats} />}
        {carga.step === 3 && <StepFoto cam={cam} photo={carga.photo} setPhoto={carga.setPhoto} />}
        {carga.step === 4 && <StepDocumentos scanner={scanner} form={carga.form} />}

        {/* Resumen visible desde paso 2 en adelante */}
        {carga.step >= 2 && (
          <Resumen form={carga.form} photo={carga.photo} docs={scanner.scanResults} cats={carga.cats} />
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
              >
                {carga.saving ? '⏳ Guardando…' : '💾 Guardar Agente'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default CargaAgentePage;

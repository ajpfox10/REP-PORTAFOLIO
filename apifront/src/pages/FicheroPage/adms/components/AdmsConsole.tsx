import React from 'react';
import { useAdmsConsole } from '../hooks/useAdmsConsole';
import {
  applyAdmsDeleteAttlog, applyAdmsReread, applyAdmsSync, cleanFinishedAdmsCommands, deleteAdmsAudioRule, exportAdmsBiometricStatus,
  expireOldAdmsCommands, fetchAdmsAudioBlob, getAdmsAudioConfig, getAdmsAudioEvents,
  getAdmsBiometricStatus, getAdmsClockCross, getAdmsComunicacion, getAdmsHuellas, getAdmsRereadPreview,
  getAdmsDeleteAttlogPreview, getAdmsSyncPreview, getAdmsSyncReglas, getAdmsCruces, getAdmsDeviceHistory, getAdmsStructureConfig, saveAdmsDeviceStructure, pingAdmsDispositivo, pullFichadasDispositivo,
  getAdmsBiotemplates, previewAdmsMessage, queueAdmsAction,
  queueAdmsCheck, queueAdmsDeleteFinger, queueAdmsDeleteUser, queueAdmsReboot, queueAdmsSendUser,
  retryOldAdmsCommands, saveAdmsAudioRule, searchAdmsMessageAgents, sendAdmsMessage,
  updateAdmsDispositivo, uploadAdmsAudio, borrarCrucesUserinfo, downloadAdmsBackup,
} from '../services/admsApi';
import type {
  AdmsAudioEvent, AdmsAudioFile, AdmsAudioRule, AdmsBiometricState, AdmsBiometricStatusResult, AdmsBiotemplate, AdmsClockCross, AdmsClockCrossRow,
  AdmsComando, AdmsCruces, AdmsDispositivo, AdmsFingerprintRow, AdmsMessageAgent,
  AdmsDeleteAttlogPreview, AdmsMessagePreview, AdmsPersona, AdmsPingResult, AdmsRereadPreview, AdmsRuntimeEvent,
  AdmsDeviceHistory, AdmsSyncPreview, AdmsSyncReglas,
} from '../types';

interface AdmsConsoleProps {
  active: boolean;
}

type Section = 'fichadas' | 'personas' | 'comandos' | 'cruces' | 'estadoBiometrico' | 'estructura' | 'huellas' | 'biotemplates' | 'relectura' | 'borrarFichajes' | 'cruceRelojes' | 'mensajes' | 'audio' | 'comunicacion' | 'backup';

const SECTION_LABELS: Record<Section, string> = {
  fichadas: 'Fichadas',
  personas: 'Personas ADMS',
  comandos: 'Comandos',
  cruces: 'Cruces',
  estadoBiometrico: 'Estado biometrico',
  estructura: 'Estructura / historial',
  huellas: 'Huellas',
  biotemplates: 'Palma / Bio',
  relectura: 'Relectura',
  borrarFichajes: 'Borrar fichajes',
  cruceRelojes: 'Cruce relojes',
  mensajes: 'Mensajes',
  audio: 'Audio eventos',
  comunicacion: 'Comunicacion',
  backup: 'Backup',
};

export function AdmsConsole({ active }: AdmsConsoleProps) {
  const ad = useAdmsConsole(active);
  const [section, setSection] = React.useState<Section>('fichadas');
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);

  async function runAction(action: () => Promise<number[]>, label: string) {
    setActionMessage(null);
    try {
      const ids = await action();
      setActionMessage(`${label}: ${ids.length} comando(s) en cola.`);
      await ad.load();
    } catch (e: any) {
      setActionMessage(e?.message ?? `No se pudo ejecutar ${label}`);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={S.sectionTitle}>ADMS moderno</div>
            <div style={{ fontSize: '0.82rem', color: '#6b7280' }}>
              Consola nueva sobre la base ADMS configurada: lectura, sync controlado y comandos en cola.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={S.checkLabel}>
              <input
                type="checkbox"
                checked={ad.autoRefresh}
                onChange={(e) => ad.setAutoRefresh(e.target.checked)}
              />
              Auto-refresh 30s
            </label>
            <button className="btn" onClick={ad.load} disabled={ad.loading}>
              {ad.loading ? 'Consultando...' : 'Actualizar ADMS'}
            </button>
          </div>
        </div>
      </div>

      {ad.error && <div style={S.errorBox}>{ad.error}</div>}
      {actionMessage && <div style={S.infoBox}>{actionMessage}</div>}

      {/* Summary cards */}
      {ad.status && (
        <div style={S.cards}>
          <InfoCard label="Base ADMS" value={`${ad.status.host}:${ad.status.port}/${ad.status.database}`} />
          <NumCard label="Relojes" value={Number(ad.status.summary?.dispositivos ?? 0)} color="#2563eb" />
          <NumCard label="Personas ADMS" value={Number(ad.status.summary?.personas ?? 0)} color="#0f766e" />
          <NumCard label="Fichadas" value={Number(ad.status.summary?.fichadas ?? 0)} color="#7c3aed" />
          <NumCard label="Cmds pendientes" value={Number(ad.status.summary?.comandosPendientes ?? 0)} color="#f59e0b" />
          <InfoCard label="Primera fichada" value={ad.status.summary?.primeraFichada?.slice(0, 16) ?? '-'} />
          <InfoCard label="Ultima fichada" value={ad.status.summary?.ultimaFichada?.slice(0, 16) ?? '-'} />
        </div>
      )}

      {/* Tables status */}
      {ad.status && (
        <div style={{ marginBottom: 18 }}>
          <div style={S.kicker}>Tablas ADMS detectadas</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(ad.status.tables ?? []).map((t) => (
              <span key={t.name} style={{ ...S.badge, background: t.exists ? '#dcfce7' : '#fee2e2', color: t.exists ? '#15803d' : '#b91c1c' }}>
                {t.name}{t.exists && t.approxRows != null ? ` ~${t.approxRows}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Devices */}
      <div style={{ marginBottom: 18 }}>
        <div style={S.kicker}>Relojes ADMS</div>
        {ad.dispositivos.length ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ad.dispositivos.map((d) => (
              <DeviceCard
                key={d.sn}
                device={d}
                onSelect={() => ad.setFilters({ ...ad.filters, sn: d.sn })}
                onCheck={() => runAction(() => queueAdmsCheck(d.sn), `CHECK ${d.alias}`)}
                onReboot={() => runAction(() => queueAdmsReboot(d.sn), `REBOOT ${d.alias}`)}
                onRefresh={ad.load}
              />
            ))}
          </div>
        ) : (
          <p className="muted">Sin relojes para mostrar.</p>
        )}
      </div>

      {/* Section tabs */}
      <div style={S.segmented}>
        {(Object.keys(SECTION_LABELS) as Section[]).map((x) => (
          <button key={x} type="button" onClick={() => setSection(x)}
            style={{ ...S.segmentButton, ...(section === x ? S.segmentButtonActive : {}) }}>
            {SECTION_LABELS[x]}
          </button>
        ))}
      </div>

      {section === 'fichadas' && <FichadasSection ad={ad} />}
      {section === 'personas' && (
        <PersonasSection
          personas={ad.personas}
          total={ad.totalPersonas}
          offset={ad.personasOffset}
          pageSize={ad.personasPageSize}
          q={ad.personasQ}
          setQ={ad.setPersonasQ}
          loading={ad.loading}
          onLoad={ad.load}
          onPageChange={ad.goToPersonasPage}
          dispositivos={ad.dispositivos}
          onSendUser={(sn, dni) => runAction(() => queueAdmsSendUser(sn, dni, true), `Enviar usuario ${dni}`)}
          onDeleteUser={(sn, dni) => runAction(() => queueAdmsDeleteUser(sn, dni), `Borrar usuario ${dni}`)}
          onDeleteUsers={(sn, dnis) => runAction(
            async () => (await Promise.all(dnis.map((dni) => queueAdmsDeleteUser(sn, dni, true)))).flat(),
            `Borrar ${dnis.length} usuario(s) del reloj`
          )}
        />
      )}
      {section === 'comandos' && (
        <ComandosSection
          comandos={ad.comandos}
          total={ad.totalComandos}
          offset={ad.comandosOffset}
          pageSize={ad.comandosPageSize}
          filters={ad.comandosFilters}
          setFilters={ad.setComandosFilters}
          loading={ad.loading}
          onLoad={ad.load}
          onPageChange={ad.goToComandosPage}
          dispositivos={ad.dispositivos}
          onAction={(payload) => runAction(() => queueAdmsAction(payload), `Accion ${payload.action}`)}
          onDeleteUser={(sn, dni) => runAction(() => queueAdmsDeleteUser(sn, dni, true), `Borrar usuario ${dni} del reloj`)}
          onDeleteFinger={(sn, dni, fid) => runAction(() => queueAdmsDeleteFinger(sn, dni, fid), `Borrar huella FID ${fid} de ${dni} del reloj`)}
          onRetry={(sn) => runAction(async () => [await retryOldAdmsCommands({ sn: sn || undefined, minutos: 15 })], 'Reintentar enviados viejos')}
          onExpire={(sn) => runAction(async () => [await expireOldAdmsCommands({ sn: sn || undefined, minutos: 60 })], 'Marcar vencidos')}
          onClean={() => runAction(async () => [await cleanFinishedAdmsCommands(30)], 'Limpiar finalizados')}
        />
      )}
      {section === 'cruces' && (
        <CrucesSection cruces={ad.cruces} loading={ad.loading} onLoad={ad.load} dispositivos={ad.dispositivos} />
      )}
      {section === 'huellas' && <HuellasSection dispositivos={ad.dispositivos} />}
      {section === 'estadoBiometrico' && <EstadoBiometricoSection dispositivos={ad.dispositivos} />}
      {section === 'estructura' && <EstructuraHistorialSection />}
      {section === 'biotemplates' && <BiotemplatesSection dispositivos={ad.dispositivos} />}
      {section === 'relectura' && <RelecturaSection dispositivos={ad.dispositivos} onApplied={ad.load} />}
      {section === 'borrarFichajes' && <DeleteAttlogSection dispositivos={ad.dispositivos} onApplied={ad.load} />}
      {section === 'cruceRelojes' && <CruceRelojesSection dispositivos={ad.dispositivos} />}
      {section === 'mensajes' && <MensajesSection dispositivos={ad.dispositivos} />}
      {section === 'audio' && <AudioEventosSection dispositivos={ad.dispositivos} />}
      {section === 'comunicacion' && <ComunicacionSection />}
      {section === 'backup' && <BackupSection dispositivos={ad.dispositivos} />}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DeviceCard con panel de configuraciÃ³n inline
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DeviceCard(props: {
  device: AdmsDispositivo;
  onSelect: () => void;
  onCheck: () => void;
  onReboot: () => void;
  onRefresh: () => void;
}) {
  const { device, onSelect, onCheck, onReboot, onRefresh } = props;
  const [tab, setTab] = React.useState<'none' | 'config' | 'pull'>('none');
  const [alias, setAlias] = React.useState(device.alias);
  const [transTimes, setTransTimes] = React.useState('');
  const [transInterval, setTransInterval] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [ping, setPing] = React.useState<AdmsPingResult | null>(null);
  const [pinging, setPinging] = React.useState(false);
  const [pullDesde, setPullDesde] = React.useState(new Date().toISOString().slice(0, 10));
  const [pullHasta, setPullHasta] = React.useState(new Date().toISOString().slice(0, 10));
  const [pulling, setPulling] = React.useState(false);

  const effectiveTcpOnline = ping?.protocolOnline ?? ping?.tcpOnline ?? device.protocolOnline ?? device.tcpOnline ?? null;
  const effectiveLatency = ping?.protocolLatencyMs ?? ping?.latencyMs ?? device.protocolLatencyMs ?? device.tcpLatencyMs ?? null;
  // Estado visual: si tenemos protocolo ZK real, lo usamos; si no, el de LastActivity ADMS.
  const tcpState = effectiveTcpOnline === true ? 'online' : effectiveTcpOnline === false ? 'offline_tcp' : null;
  const displayEstado = tcpState ?? device.estado;
  const bg     = displayEstado === 'online'   ? '#f0fdf4' : displayEstado === 'pausado' ? '#f8fafc' : '#fef2f2';
  const border  = displayEstado === 'online'   ? '#86efac' : displayEstado === 'pausado' ? '#e2e8f0' : '#fca5a5';
  const color   = displayEstado === 'online'   ? '#15803d' : displayEstado === 'pausado' ? '#64748b' : '#b91c1c';

  // Discordancia: ADMS/PUSH no llama, pero el reloj responde por protocolo ZK.
  const admsEstado = device.admsEstado ?? device.estado;
  const discordante = admsEstado !== 'online' && effectiveTcpOnline === true;

  async function doPing() {
    setPinging(true); setMsg(null);
    try {
      const r = await pingAdmsDispositivo(device.sn);
      setPing(r);
    } catch (e: any) { setMsg(e?.message ?? 'Ping error'); }
    finally { setPinging(false); }
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const data: Parameters<typeof updateAdmsDispositivo>[1] = {};
      if (alias.trim() && alias.trim() !== device.alias) data.alias = alias.trim();
      if (transTimes.trim()) data.transTimes = transTimes.trim();
      if (transInterval.trim()) data.transInterval = Number(transInterval);
      if (!Object.keys(data).length) { setMsg('Sin cambios.'); setSaving(false); return; }
      await updateAdmsDispositivo(device.sn, data);
      setMsg('Guardado.'); await onRefresh();
    } catch (e: any) { setMsg(e?.message ?? 'No se pudo guardar'); }
    finally { setSaving(false); }
  }

  async function toggleState() {
    setSaving(true); setMsg(null);
    try { await updateAdmsDispositivo(device.sn, { state: device.estado === 'pausado' }); await onRefresh(); }
    catch (e: any) { setMsg(e?.message ?? 'No se pudo cambiar estado'); }
    finally { setSaving(false); }
  }

  async function doPull() {
    setPulling(true); setMsg(null);
    try {
      const r = await pullFichadasDispositivo(device.sn, pullDesde, pullHasta);
      setMsg(`Pull OK: ${r.enRango} en rango, ${r.insertadas} insertadas, ${r.duplicadas} ya existían.`);
      await onRefresh();
    } catch (e: any) { setMsg(e?.message ?? 'No se pudo hacer pull'); }
    finally { setPulling(false); }
  }

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px', minWidth: 220 }}>
      <button type="button" onClick={onSelect}
        style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
        <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.84rem' }}>{device.alias}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ color, fontWeight: 700, fontSize: '0.8rem' }}>{displayEstado === 'offline_tcp' ? 'offline tcp' : displayEstado}</span>
          {discordante && (
            <span style={{ ...S.badge, background: '#dcfce7', color: '#15803d', fontSize: '0.68rem' }}>
              ZK online{effectiveLatency != null ? ` ${effectiveLatency}ms` : ''}
            </span>
          )}
          {!discordante && effectiveTcpOnline !== null && (
            <span style={{ ...S.badge, background: effectiveTcpOnline ? '#dcfce7' : '#fee2e2', color: effectiveTcpOnline ? '#15803d' : '#b91c1c', fontSize: '0.68rem' }}>
              ZK {effectiveTcpOnline ? `${effectiveLatency ?? '?'}ms` : 'sin respuesta'}
            </span>
          )}
          {discordante && (
            <span style={{ ...S.badge, background: '#ffedd5', color: '#c2410c', fontSize: '0.68rem' }}>
              ADMS sin push
            </span>
          )}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.72rem', marginTop: 4 }}>
          {device.sn}{device.ip ? ` · ${device.ip}` : ''}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
          {device.firmware ? `FW: ${device.firmware} · ` : ''}{device.lastActivity?.slice(0, 16) ?? 'sin actividad'}
        </div>
        {device.usuarios != null && (
          <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            {device.usuarios} us · {device.huellas ?? 0} fp · {device.fichadas ?? 0} trans.
          </div>
        )}
      </button>

      <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn secondary" type="button" onClick={onCheck}>CHECK</button>
        <button className="btn danger" type="button" onClick={onReboot}>REBOOT</button>
        <button className="btn secondary" type="button" disabled={pinging} onClick={doPing}>
          {pinging ? '...' : 'Ping'}
        </button>
        <button className="btn secondary" type="button" onClick={() => { setTab(tab === 'pull' ? 'none' : 'pull'); setMsg(null); }}>
          {tab === 'pull' ? 'Cerrar' : 'Pull'}
        </button>
        <button className="btn secondary" type="button" onClick={() => { setTab(tab === 'config' ? 'none' : 'config'); setMsg(null); }}>
          {tab === 'config' ? 'Cerrar' : 'Config'}
        </button>
      </div>

      {/* Panel Pull fichadas */}
      {tab === 'pull' && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${border}`, paddingTop: 10 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: 8 }}>
            Traer fichadas perdidas (TCP directo)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Field label="Desde" id={`pull-desde-${device.sn}`}>
              <input id={`pull-desde-${device.sn}`} type="date" style={S.input}
                value={pullDesde} onChange={(e) => setPullDesde(e.target.value)} />
            </Field>
            <Field label="Hasta" id={`pull-hasta-${device.sn}`}>
              <input id={`pull-hasta-${device.sn}`} type="date" style={S.input}
                value={pullHasta} onChange={(e) => setPullHasta(e.target.value)} />
            </Field>
          </div>
          <button className="btn" type="button" disabled={pulling} style={{ marginTop: 8 }} onClick={doPull}>
            {pulling ? 'Trayendo...' : 'Traer e insertar faltantes'}
          </button>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
            Conecta por TCP al reloj y trae fichadas del rango. No borra datos existentes.
          </div>
        </div>
      )}

      {/* Panel Config */}
      {tab === 'config' && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${border}`, paddingTop: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Field label="Alias" id={`dev-alias-${device.sn}`}>
              <input id={`dev-alias-${device.sn}`} style={S.input} value={alias}
                onChange={(e) => setAlias(e.target.value)} placeholder={device.alias} />
            </Field>
            <Field label="TransTimes (ej: 00:00;14:05)" id={`dev-tt-${device.sn}`}>
              <input id={`dev-tt-${device.sn}`} style={S.input} value={transTimes}
                onChange={(e) => setTransTimes(e.target.value)} placeholder="00:00;14:05" />
            </Field>
            <Field label="TransInterval (min)" id={`dev-ti-${device.sn}`}>
              <input id={`dev-ti-${device.sn}`} style={S.input} type="number" min={1} max={1440}
                value={transInterval} onChange={(e) => setTransInterval(e.target.value)} placeholder="1" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" disabled={saving} onClick={save}>Guardar</button>
            <button className={device.estado === 'pausado' ? 'btn' : 'btn danger'}
              type="button" disabled={saving} onClick={toggleState}>
              {device.estado === 'pausado' ? 'Reanudar' : 'Pausar'}
            </button>
          </div>
        </div>
      )}

      {msg && <div style={{ ...S.infoBox, marginTop: 8, marginBottom: 0, fontSize: '0.78rem' }}>{msg}</div>}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pagination helper
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Pagination({ offset, total, pageSize, loading, onPage }: {
  offset: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onPage: (offset: number) => void;
}) {
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
      <button className="btn secondary" disabled={offset === 0 || loading} onClick={() => onPage(0)}>«</button>
      <button className="btn secondary" disabled={offset === 0 || loading} onClick={() => onPage(Math.max(0, offset - pageSize))}>‹</button>
      <span style={{ fontSize: '0.82rem', color: '#374151' }}>Pág {page} / {pages} ({total} registros)</span>
      <button className="btn secondary" disabled={offset + pageSize >= total || loading} onClick={() => onPage(offset + pageSize)}>›</button>
      <button className="btn secondary" disabled={offset + pageSize >= total || loading} onClick={() => onPage((pages - 1) * pageSize)}>»</button>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FichadasSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FichadasSection({ ad }: { ad: ReturnType<typeof useAdmsConsole> }) {
  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Ultimas fichadas</div>
        <div style={S.filterGrid}>
          <Field label="Desde" id="adms-desde">
            <input id="adms-desde" type="date" style={S.input} value={ad.filters.desde}
              onChange={(e) => ad.setFilters({ ...ad.filters, desde: e.target.value })} />
          </Field>
          <Field label="Hasta" id="adms-hasta">
            <input id="adms-hasta" type="date" style={S.input} value={ad.filters.hasta}
              onChange={(e) => ad.setFilters({ ...ad.filters, hasta: e.target.value })} />
          </Field>
          <Field label="DNI/PIN" id="adms-dni">
            <input id="adms-dni" style={S.input} value={ad.filters.dni}
              onChange={(e) => ad.setFilters({ ...ad.filters, dni: e.target.value })} placeholder="opcional" />
          </Field>
          <Field label="Reloj SN" id="adms-sn">
            <input id="adms-sn" style={S.input} value={ad.filters.sn}
              onChange={(e) => ad.setFilters({ ...ad.filters, sn: e.target.value })} placeholder="opcional" />
          </Field>
          <Field label="Tipo" id="adms-tipo">
            <select id="adms-tipo" style={S.input} value={ad.filters.tipo}
              onChange={(e) => ad.setFilters({ ...ad.filters, tipo: e.target.value })}>
              <option value="">Todos</option>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
            </select>
          </Field>
          <button className="btn" onClick={ad.load} disabled={ad.loading} style={{ minHeight: 35 }}>Filtrar</button>
        </div>
        <div style={S.mutedLine}>
          Mostrando {ad.fichadas.length} de {ad.totalFichadas} registros.
        </div>
        <Pagination offset={ad.fichadasOffset} total={ad.totalFichadas} pageSize={ad.fichadasPageSize}
          loading={ad.loading} onPage={ad.goToFichadasPage} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.headRow}>
              <Th>Fecha</Th><Th>Tipo</Th><Th>DNI</Th><Th>Nombre</Th><Th>Reloj</Th><Th>Verif.</Th>
            </tr>
          </thead>
          <tbody>
            {ad.fichadas.map((f) => (
              <tr key={f.id} style={S.bodyRow}>
                <Td style={{ fontFamily: 'monospace', color: '#2563eb' }}>{f.fechaHora?.slice(0, 19)}</Td>
                <Td>
                  <span style={{ ...S.badge, background: f.tipo === 'entrada' ? '#dcfce7' : '#dbeafe', color: f.tipo === 'entrada' ? '#15803d' : '#1d4ed8' }}>
                    {f.tipo}
                  </span>
                </Td>
                <Td>{f.dni}</Td>
                <Td>{f.nombre || '-'}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{f.sn || '-'}</Td>
                <Td>{f.verifycode ?? '-'}</Td>
              </tr>
            ))}
            {!ad.fichadas.length && <EmptyRow text="Sin fichadas para el filtro." cols={6} />}
          </tbody>
        </table>
      </div>
      {ad.totalFichadas > ad.fichadasPageSize && (
        <Pagination offset={ad.fichadasOffset} total={ad.totalFichadas} pageSize={ad.fichadasPageSize}
          loading={ad.loading} onPage={ad.goToFichadasPage} />
      )}
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PersonasSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PersonasSection(props: {
  personas: AdmsPersona[];
  total: number;
  offset: number;
  pageSize: number;
  q: string;
  setQ: (q: string) => void;
  loading: boolean;
  onLoad: () => void;
  onPageChange: (offset: number) => void;
  dispositivos: AdmsDispositivo[];
  onSendUser: (sn: string, dni: string) => void;
  onDeleteUser: (sn: string, dni: string) => void;
  onDeleteUsers: (sn: string, dnis: string[]) => void;
}) {
  const [selectedSn, setSelectedSn] = React.useState('');
  const [selectedDnis, setSelectedDnis] = React.useState<string[]>([]);
  const targetSn = selectedSn || props.dispositivos[0]?.sn || '';
  const visibleDnis = React.useMemo(
    () => [...new Set(props.personas.map((p) => p.dni).filter(Boolean))],
    [props.personas]
  );
  const allVisibleSelected = visibleDnis.length > 0 && visibleDnis.every((dni) => selectedDnis.includes(dni));

  React.useEffect(() => {
    setSelectedDnis([]);
  }, [props.offset, props.q, props.personas]);

  function toggleDni(dni: string, checked: boolean) {
    setSelectedDnis((prev) => {
      if (checked) return prev.includes(dni) ? prev : [...prev, dni];
      return prev.filter((x) => x !== dni);
    });
  }

  function toggleVisible(checked: boolean) {
    setSelectedDnis(checked ? visibleDnis : []);
  }

  function deleteSelected() {
    if (!targetSn || !selectedDnis.length) return;
    if (window.confirm(`Borrar ${selectedDnis.length} usuario(s) del reloj ${targetSn}? No se borra nada de la base ADMS.`)) {
      props.onDeleteUsers(targetSn, selectedDnis);
      setSelectedDnis([]);
    }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Personas ADMS</div>
        <div style={S.simpleFilter}>
          <Field label="Buscar por DNI/PIN o nombre" id="adms-personas-q">
            <input id="adms-personas-q" style={S.input} value={props.q}
              onChange={(e) => props.setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && props.onLoad()}
              placeholder="Ej: 30111222 o Perez" />
          </Field>
          <button className="btn" onClick={props.onLoad} disabled={props.loading} style={{ minHeight: 35 }}>Buscar</button>
          <Field label="Reloj destino" id="adms-personas-target">
            <select id="adms-personas-target" style={S.input} value={targetSn} onChange={(e) => setSelectedSn(e.target.value)}>
              {props.dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <button className="btn danger" type="button" disabled={!targetSn || !selectedDnis.length}
            onClick={deleteSelected}>Borrar seleccionados del reloj</button>
        </div>
        <div style={S.mutedLine}>Mostrando {props.personas.length} de {props.total} personas. Seleccionados: {selectedDnis.length}.</div>
        <Pagination offset={props.offset} total={props.total} pageSize={props.pageSize}
          loading={props.loading} onPage={props.onPageChange} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.headRow}>
              <Th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={!visibleDnis.length}
                  onChange={(e) => toggleVisible(e.target.checked)}
                  aria-label="Seleccionar visibles"
                />
              </Th>
              <Th>UserID</Th><Th>DNI/PIN</Th><Th>Nombre</Th><Th>Tarjeta</Th><Th>Grupo</Th>
              <Th>Reloj</Th><Th>Actualizado</Th><Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {props.personas.map((p) => (
              <tr key={p.userid} style={S.bodyRow}>
                <Td>
                  <input
                    type="checkbox"
                    checked={selectedDnis.includes(p.dni)}
                    onChange={(e) => toggleDni(p.dni, e.target.checked)}
                    aria-label={`Seleccionar ${p.dni}`}
                  />
                </Td>
                <Td>{p.userid}</Td>
                <Td>{p.dni}</Td>
                <Td>{p.nombre || '-'}</Td>
                <Td>{p.tarjeta || '-'}</Td>
                <Td>{p.grupo ?? '-'}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.sn || '-'}</Td>
                <Td>{p.actualizado?.slice(0, 16) ?? '-'}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn secondary" type="button" disabled={!targetSn}
                      onClick={() => props.onSendUser(targetSn, p.dni)}>Enviar</button>
                    <button className="btn danger" type="button" disabled={!targetSn}
                      onClick={() => props.onDeleteUser(targetSn, p.dni)}>Borrar del reloj</button>
                  </div>
                </Td>
              </tr>
            ))}
            {!props.personas.length && <EmptyRow text="Sin personas para el filtro." cols={9} />}
          </tbody>
        </table>
      </div>
      {props.total > props.pageSize && (
        <Pagination offset={props.offset} total={props.total} pageSize={props.pageSize}
          loading={props.loading} onPage={props.onPageChange} />
      )}
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ComandosSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ComandosSection(props: {
  comandos: AdmsComando[];
  total: number;
  offset: number;
  pageSize: number;
  filters: { sn: string; estado: 'todos' | 'pendientes' | 'enviados' | 'finalizados' | 'errores' | 'vencidos' };
  setFilters: (f: { sn: string; estado: 'todos' | 'pendientes' | 'enviados' | 'finalizados' | 'errores' | 'vencidos' }) => void;
  loading: boolean;
  onLoad: () => void;
  onPageChange: (offset: number) => void;
  dispositivos: AdmsDispositivo[];
  onAction: (payload: { sn: string; action: any; dni?: string; fid?: number; retry?: number; password?: string; filename?: string; content?: string; optionKey?: string; optionValue?: string; confirmacion?: string }) => void;
  onDeleteUser: (sn: string, dni: string) => void;
  onDeleteFinger: (sn: string, dni: string, fid: number) => void;
  onRetry: (sn: string) => void;
  onExpire: (sn: string) => void;
  onClean: () => void;
}) {
  const [actionSn, setActionSn] = React.useState('');
  const [actionDni, setActionDni] = React.useState('');
  const [actionPassword, setActionPassword] = React.useState('');
  const [actionFid, setActionFid] = React.useState(0);
  const [filename, setFilename] = React.useState('');
  const [content, setContent] = React.useState('');
  const [optionKey, setOptionKey] = React.useState('');
  const [optionValue, setOptionValue] = React.useState('');
  const targetSn = actionSn || props.filters.sn || props.dispositivos[0]?.sn || '';

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Comandos ADMS</div>
        <div style={S.simpleFilter}>
          <Field label="Reloj SN" id="adms-cmd-sn">
            <input id="adms-cmd-sn" style={S.input} value={props.filters.sn}
              onChange={(e) => props.setFilters({ ...props.filters, sn: e.target.value })} placeholder="opcional" />
          </Field>
          <Field label="Estado" id="adms-cmd-estado">
            <select id="adms-cmd-estado" style={S.input} value={props.filters.estado}
              onChange={(e) => props.setFilters({ ...props.filters, estado: e.target.value as any })}>
              <option value="todos">Todos</option>
              <option value="pendientes">Pendientes</option>
              <option value="enviados">Enviados</option>
              <option value="finalizados">Finalizados</option>
              <option value="errores">Errores</option>
              <option value="vencidos">Vencidos</option>
            </select>
          </Field>
          <button className="btn" onClick={props.onLoad} disabled={props.loading} style={{ minHeight: 35 }}>Filtrar</button>
        </div>
        <div style={S.mutedLine}>Mostrando {props.comandos.length} de {props.total} comandos.</div>
        <Pagination offset={props.offset} total={props.total} pageSize={props.pageSize}
          loading={props.loading} onPage={props.onPageChange} />
      </div>

      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Acciones de reloj</div>
        <div style={S.actionGrid}>
          <Field label="Reloj" id="adms-action-sn">
            <select id="adms-action-sn" style={S.input} value={targetSn} onChange={(e) => setActionSn(e.target.value)}>
              {props.dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="DNI/PIN" id="adms-action-dni">
            <input id="adms-action-dni" style={S.input} value={actionDni}
              onChange={(e) => setActionDni(e.target.value)} placeholder="para reset/enroll" />
          </Field>
          <Field label="Clave" id="adms-action-pass">
            <input id="adms-action-pass" style={S.input} value={actionPassword}
              onChange={(e) => setActionPassword(e.target.value)} placeholder="reset pwd" />
          </Field>
          <Field label="Dedo (0-9)" id="adms-action-fid">
            <input id="adms-action-fid" type="number" min={0} max={9} style={S.input}
              value={actionFid} onChange={(e) => setActionFid(Number(e.target.value))} />
          </Field>
          <Field label="Archivo" id="adms-action-file">
            <input id="adms-action-file" style={S.input} value={filename}
              onChange={(e) => setFilename(e.target.value)} placeholder="ej: user.dat" />
          </Field>
          <Field label="Contenido/Shell" id="adms-action-content">
            <input id="adms-action-content" style={S.input} value={content}
              onChange={(e) => setContent(e.target.value)} placeholder="payload o comando" />
          </Field>
          <Field label="Opcion key" id="adms-action-option">
            <input id="adms-action-option" style={S.input} value={optionKey}
              onChange={(e) => setOptionKey(e.target.value)} placeholder="clave" />
          </Field>
          <Field label="Valor" id="adms-action-value">
            <input id="adms-action-value" style={S.input} value={optionValue}
              onChange={(e) => setOptionValue(e.target.value)} placeholder="valor" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn secondary" disabled={!targetSn} onClick={() => props.onAction({ sn: targetSn, action: 'check' })}>CHECK</button>
          <button className="btn secondary" disabled={!targetSn} onClick={() => props.onAction({ sn: targetSn, action: 'unlock' })}>UNLOCK</button>
          <button className="btn secondary" disabled={!targetSn} onClick={() => props.onAction({ sn: targetSn, action: 'noalarm' })}>NOALARM</button>
          <button className="btn secondary" disabled={!targetSn || !actionDni} onClick={() => props.onAction({ sn: targetSn, action: 'enroll-fp', dni: actionDni, fid: actionFid, retry: 3 })}>ENROLL_FP</button>
          <button className="btn secondary" disabled={!targetSn || !actionDni || !actionPassword} onClick={() => props.onAction({ sn: targetSn, action: 'reset-pwd', dni: actionDni, password: actionPassword })}>RESET PWD</button>
          <button
            className="btn danger"
            disabled={!targetSn || !actionDni}
            onClick={() => {
              if (window.confirm(`Borrar del reloj ${targetSn} el usuario ${actionDni}? No se borra de la base ADMS.`)) {
                props.onDeleteUser(targetSn, actionDni);
              }
            }}>
            BORRAR USUARIO RELOJ
          </button>
          <button
            className="btn danger"
            disabled={!targetSn || !actionDni}
            onClick={() => {
              if (window.confirm(`Borrar del reloj ${targetSn} la huella FID ${actionFid} del usuario ${actionDni}? No se borra de la base ADMS.`)) {
                props.onDeleteFinger(targetSn, actionDni, actionFid);
              }
            }}>
            BORRAR HUELLA FID
          </button>
          <button className="btn danger" disabled={!targetSn} onClick={() => {
            if (window.prompt(`CLEAR LOG borra las fichadas almacenadas en el reloj ${targetSn}. Escribi BORRAR para confirmar:`) === 'BORRAR') {
              props.onAction({ sn: targetSn, action: 'clear-log', confirmacion: 'BORRAR' });
            }
          }}>CLEAR LOG</button>
          <button className="btn danger" disabled={!targetSn} onClick={() => {
            if (window.prompt(`CLEAR DATA borra TODOS los usuarios, huellas y datos del reloj ${targetSn}. Escribi BORRAR para confirmar:`) === 'BORRAR') {
              props.onAction({ sn: targetSn, action: 'clear-data', confirmacion: 'BORRAR' });
            }
          }}>CLEAR DATA</button>
          <button className="btn danger" disabled={!targetSn} onClick={() => props.onAction({ sn: targetSn, action: 'reboot' })}>REBOOT</button>
          <button className="btn secondary" disabled={!targetSn || !filename} onClick={() => props.onAction({ sn: targetSn, action: 'get-file', filename })}>GET FILE</button>
          <button className="btn secondary" disabled={!targetSn || !filename || !content} onClick={() => props.onAction({ sn: targetSn, action: 'put-file', filename, content })}>PUT FILE</button>
          <button className="btn secondary" disabled={!targetSn || !content} onClick={() => props.onAction({ sn: targetSn, action: 'shell', content })}>SHELL</button>
          <button className="btn secondary" disabled={!targetSn || !optionKey || !optionValue} onClick={() => props.onAction({ sn: targetSn, action: 'set-option', optionKey, optionValue })}>SET OPTION</button>
          <button className="btn secondary" disabled={!targetSn} onClick={() => props.onRetry(targetSn)}>Reintentar viejos</button>
          <button className="btn secondary" disabled={!targetSn} onClick={() => props.onExpire(targetSn)}>Marcar vencidos</button>
          <button className="btn secondary" onClick={props.onClean}>Limpiar finalizados</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.headRow}>
              <Th>ID</Th><Th>Estado</Th><Th>Reloj</Th><Th>Comando</Th>
              <Th>Creado</Th><Th>Enviado</Th><Th>Finalizado</Th><Th>Retorno</Th>
            </tr>
          </thead>
          <tbody>
            {props.comandos.map((c) => (
              <tr key={c.id} style={S.bodyRow}>
                <Td>{c.id}</Td>
                <Td><span style={{ ...S.badge, ...commandStateStyle(c.estado) }}>{c.estado}</span></Td>
                <Td>{c.alias || c.sn}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 520 }}>{c.contenido}</Td>
                <Td>{c.creado?.slice(0, 16) ?? '-'}</Td>
                <Td>{c.enviado?.slice(0, 16) ?? '-'}</Td>
                <Td>{c.finalizado?.slice(0, 16) ?? '-'}</Td>
                <Td>{c.retorno ?? '-'}</Td>
              </tr>
            ))}
            {!props.comandos.length && <EmptyRow text="Sin comandos para el filtro." cols={8} />}
          </tbody>
        </table>
      </div>
      {props.total > props.pageSize && (
        <Pagination offset={props.offset} total={props.total} pageSize={props.pageSize}
          loading={props.loading} onPage={props.onPageChange} />
      )}
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CrucesSection (con opciones avanzadas de sync)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CrucesSection(props: {
  cruces: AdmsCruces | null;
  loading: boolean;
  onLoad: () => void;
  dispositivos: AdmsDispositivo[];
}) {
  const [c, setC] = React.useState<AdmsCruces | null>(props.cruces);
  const [cruceSn, setCruceSn] = React.useState('');
  React.useEffect(() => setC(props.cruces), [props.cruces]);
  const [syncSn, setSyncSn] = React.useState('');
  const [syncServicio, setSyncServicio] = React.useState('');
  const [syncSoloActivos, setSyncSoloActivos] = React.useState(true);
  const [syncBajas, setSyncBajas] = React.useState(false);
  const [bajaConfirm, setBajaConfirm] = React.useState('');
  const [syncHuellas, setSyncHuellas] = React.useState(false);
  const [syncCardSource, setSyncCardSource] = React.useState<'none' | 'dni' | 'legajo'>('none');
  const [syncPrivilege, setSyncPrivilege] = React.useState(0);
  const [syncGroup, setSyncGroup] = React.useState(1);
  const [syncTimezone, setSyncTimezone] = React.useState('');
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [preview, setPreview] = React.useState<AdmsSyncPreview | null>(null);
  const [syncLoading, setSyncLoading] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);
  const [reglas, setReglas] = React.useState<AdmsSyncReglas | null>(null);
  const [reglasCargadas, setReglasCargadas] = React.useState(false);
  const [selectedDnis, setSelectedDnis] = React.useState<Set<string>>(new Set());
  const [borrarSn, setBorrarSn] = React.useState('');
  const [borrarHuellas, setBorrarHuellas] = React.useState(false);
  const [borrarLoading, setBorrarLoading] = React.useState(false);
  const [borrarMsg, setBorrarMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    getAdmsSyncReglas().then(r => { setReglas(r); setReglasCargadas(true); }).catch(() => setReglasCargadas(true));
  }, []);

  function syncParams() {
    return {
      sn: syncSn || undefined,
      servicioId: syncServicio || undefined,
      soloActivos: syncSoloActivos,
      cardSource: syncCardSource,
      privilege: syncPrivilege,
      group: syncGroup,
      timezone: syncTimezone || undefined,
    };
  }

  async function loadPreview() {
    setSyncLoading(true);
    setSyncMsg(null);
    try {
      setPreview(await getAdmsSyncPreview(syncParams()));
    } catch (e: any) {
      setSyncMsg(e?.message ?? 'No se pudo calcular preview');
    } finally {
      setSyncLoading(false);
    }
  }

  async function applyPreview() {
    if (syncBajas && bajaConfirm.trim().toUpperCase() !== 'BORRAR') {
      setSyncMsg('Para aplicar bajas escribi BORRAR en la confirmacion.');
      return;
    }
    setSyncLoading(true);
    setSyncMsg(null);
    try {
      const r = await applyAdmsSync({
        ...syncParams(),
        servicio_id: syncServicio || undefined,
        solo_activos: syncSoloActivos,
        limit: 100, crear: true, actualizar: true,
        bajas: syncBajas, huellas: syncHuellas,
      });
      setSyncMsg(`Aplicado: ${r.creados} creados, ${r.actualizados} actualizados, ${r.bajas} bajas, ${r.huellas} huellas (${r.huellasOmitidas} omitidas), ${r.total} cmds en cola.`);
      setPreview(await getAdmsSyncPreview(syncParams()));
      await props.onLoad();
    } catch (e: any) {
      setSyncMsg(e?.message ?? 'No se pudo aplicar sync');
    } finally {
      setSyncLoading(false);
    }
  }

  async function borrarSeleccionados() {
    if (!borrarSn) { setBorrarMsg('Selecciona un reloj.'); return; }
    if (selectedDnis.size === 0) { setBorrarMsg('No hay registros seleccionados.'); return; }
    setBorrarLoading(true);
    setBorrarMsg(null);
    try {
      let total = 0;
      for (const dni of selectedDnis) {
        const ids = await queueAdmsDeleteUser(borrarSn, dni, borrarHuellas);
        total += ids.length;
      }
      setBorrarMsg(`${selectedDnis.size} usuario(s) encolados para borrar del reloj (${total} cmd(s)).`);
      setSelectedDnis(new Set());
      await props.onLoad();
    } catch (e: any) {
      setBorrarMsg(e?.message ?? 'Error al borrar');
    } finally {
      setBorrarLoading(false);
    }
  }

  const serviciosConReglas = reglas ? Object.entries(reglas.servicios).filter(([, sns]) => sns.length > 0) : [];

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={S.sectionTitle}>Cruce ADMS vs Personal</div>
            <div style={S.mutedLine}>Diagnostico de diferencias por DNI.</div>
          </div>
          <button className="btn" onClick={props.onLoad} disabled={props.loading} style={{ minHeight: 35 }}>
            {props.loading ? 'Cruzando...' : 'Actualizar cruce'}
          </button>
        </div>
      </div>

      {/* Reglas de sync activas */}
      {reglasCargadas && serviciosConReglas.length > 0 && (
        <div style={{ ...S.infoBox, marginBottom: 16 }}>
          <strong style={{ fontSize: '0.8rem' }}>Reglas de destino activas:</strong>
          {serviciosConReglas.map(([svcId, sns]) => (
            <span key={svcId} style={{ marginLeft: 8, fontSize: '0.8rem' }}>
              Servicio {svcId} → {sns.join(', ')}
            </span>
          ))}
        </div>
      )}

      {c ? (
        <>
          <div style={S.cards}>
            <NumCard label="Personal" value={c.totalPersonal} color="#0f766e" />
            <NumCard label="ADMS" value={c.totalAdms} color="#2563eb" />
            <NumCard label="Coinciden" value={c.coincidencias} color="#16a34a" />
            <NumCard label="Solo ADMS" value={c.soloAdmsTotal} color="#f59e0b" />
            <NumCard label="Solo Personal" value={c.soloPersonalTotal} color="#dc2626" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={S.kicker}>En ADMS y no en Personal</div>
              <table style={S.table}>
                <thead>
                  <tr style={S.headRow}>
                    <Th>
                      <input type="checkbox"
                        title="Seleccionar todos"
                        checked={c.soloAdms.length > 0 && c.soloAdms.every(r => selectedDnis.has(r.dni))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedDnis(new Set(c.soloAdms.map(r => r.dni)));
                          else setSelectedDnis(new Set());
                        }}
                      />
                    </Th>
                    <Th>DNI</Th><Th>Nombre</Th><Th>ID ADMS</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.soloAdms.map((row) => (
                    <tr key={`soloAdms-${row.dni}`} style={S.bodyRow}>
                      <Td>
                        <input type="checkbox"
                          checked={selectedDnis.has(row.dni)}
                          onChange={(e) => {
                            const next = new Set(selectedDnis);
                            if (e.target.checked) next.add(row.dni); else next.delete(row.dni);
                            setSelectedDnis(next);
                          }}
                        />
                      </Td>
                      <Td>{row.dni}</Td><Td>{row.nombre || '-'}</Td><Td>{String(row.userid ?? '-')}</Td>
                    </tr>
                  ))}
                  {!c.soloAdms.length && <EmptyRow text="Sin diferencias de este lado." cols={4} />}
                </tbody>
              </table>
            </div>
            <DiffTable title="En Personal y no en ADMS" rows={c.soloPersonal} empty="Sin diferencias de este lado."
              extra={() => '-'} />
          </div>
          <div style={S.mutedLine}>Listas muestran hasta {c.limit} registros por lado.</div>

          <div style={{ ...S.section, paddingBottom: 14, marginTop: 14 }}>
            <div style={S.sectionTitle}>Borrar seleccionados del reloj ADMS</div>
            <div style={{ ...S.simpleFilter, marginBottom: 10 }}>
              <Field label="Reloj destino" id="adms-borrar-sn">
                <select id="adms-borrar-sn" style={S.input} value={borrarSn} onChange={(e) => setBorrarSn(e.target.value)}>
                  <option value="">-- Seleccionar reloj --</option>
                  {props.dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={S.checkLabel}>
                <input type="checkbox" checked={borrarHuellas} onChange={(e) => setBorrarHuellas(e.target.checked)} />
                {' '}Incluir huellas
              </label>
            </div>
            <button className="btn danger" type="button"
              disabled={borrarLoading || !borrarSn || selectedDnis.size === 0}
              onClick={borrarSeleccionados}>
              {borrarLoading ? 'Borrando...' : `Borrar ${selectedDnis.size > 0 ? `${selectedDnis.size} seleccionado(s)` : 'seleccionados'} del reloj`}
            </button>
            {borrarMsg && <div style={{ ...S.infoBox, marginTop: 10 }}>{borrarMsg}</div>}
          </div>
        </>
      ) : (
        <p className="muted">Todavia no hay cruce cargado.</p>
      )}

      {/* Sync */}
      <div style={{ ...S.section, paddingBottom: 14, marginTop: 18 }}>
        <div style={S.sectionTitle}>Sync Personal hacia ADMS</div>
        <div style={S.simpleFilter}>
          <Field label="Reloj destino" id="adms-sync-sn">
            <select id="adms-sync-sn" style={S.input} value={syncSn} onChange={(e) => setSyncSn(e.target.value)}>
              <option value="">Todos los relojes</option>
              {props.dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Servicio ID" id="adms-sync-servicio">
            <input id="adms-sync-servicio" style={S.input} value={syncServicio}
              onChange={(e) => setSyncServicio(e.target.value)} placeholder="opcional" />
          </Field>
          <Field label="Tarjeta" id="adms-sync-card">
            <select id="adms-sync-card" style={S.input} value={syncCardSource}
              onChange={(e) => setSyncCardSource(e.target.value as any)}>
              <option value="none">Sin tarjeta</option>
              <option value="dni">DNI</option>
              <option value="legajo">Legajo</option>
            </select>
          </Field>
          <Field label="Confirmar bajas" id="adms-sync-baja-confirm">
            <input id="adms-sync-baja-confirm" style={S.input} value={bajaConfirm}
              onChange={(e) => setBajaConfirm(e.target.value)} placeholder="BORRAR" />
          </Field>
        </div>

        <div style={{ marginTop: 10, marginBottom: 8 }}>
          <button type="button" className="btn secondary" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas (privilegio, grupo, timezone)'}
          </button>
          {showAdvanced && (
            <div style={{ ...S.simpleFilter, marginTop: 8 }}>
              <Field label="Privilegio (0-14)" id="adms-sync-priv">
                <input id="adms-sync-priv" type="number" min={0} max={14} style={S.input}
                  value={syncPrivilege} onChange={(e) => setSyncPrivilege(Number(e.target.value))} />
              </Field>
              <Field label="Grupo (1-99)" id="adms-sync-group">
                <input id="adms-sync-group" type="number" min={1} max={99} style={S.input}
                  value={syncGroup} onChange={(e) => setSyncGroup(Number(e.target.value))} />
              </Field>
              <Field label="Timezone (vacío = default)" id="adms-sync-tz">
                <input id="adms-sync-tz" style={S.input} value={syncTimezone}
                  onChange={(e) => setSyncTimezone(e.target.value)} placeholder="ej: 1" />
              </Field>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={S.checkLabel}><input type="checkbox" checked={syncSoloActivos}
            onChange={(e) => setSyncSoloActivos(e.target.checked)} /> Solo activos</label>
          <label style={S.checkLabel}><input type="checkbox" checked={syncHuellas}
            onChange={(e) => setSyncHuellas(e.target.checked)} /> Incluir huellas compatibles</label>
          <label style={S.checkLabel}><input type="checkbox" checked={syncBajas}
            onChange={(e) => setSyncBajas(e.target.checked)} /> Aplicar bajas solo ADMS</label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button" disabled={syncLoading} onClick={loadPreview}>
            {syncLoading ? 'Calculando...' : 'Preview sync'}
          </button>
          <button className="btn danger" type="button"
            disabled={syncLoading || !preview || (preview.resumen.comandosEstimados + (syncBajas ? preview.resumen.comandosBajaEstimados : 0)) === 0 || (syncBajas && bajaConfirm.trim().toUpperCase() !== 'BORRAR')}
            onClick={applyPreview}>
            Aplicar lote 100
          </button>
        </div>

        {syncMsg && <div style={{ ...S.infoBox, marginTop: 10 }}>{syncMsg}</div>}
        {preview && (
          <>
            <div style={{ ...S.cards, marginTop: 14 }}>
              <NumCard label="Crear ADMS" value={preview.resumen.crear} color="#0f766e" />
              <NumCard label="Actualizar" value={preview.resumen.actualizar} color="#2563eb" />
              <NumCard label="Cmds estimados" value={preview.resumen.comandosEstimados} color="#7c3aed" />
              <NumCard label="Bajas posibles" value={preview.resumen.bajas} color="#dc2626" />
            </div>
            {!!preview.filtros.reglasDestino?.length && (
              <div style={S.infoBox}>
                Regla activa para servicio {preview.filtros.servicioId}: {preview.filtros.reglasDestino.join(', ')}
              </div>
            )}
            {showAdvanced && (
              <div style={S.mutedLine}>
                Opciones: priv={preview.filtros.options.privilege} grupo={preview.filtros.options.group}
                {preview.filtros.options.timezone ? ` tz=${preview.filtros.options.timezone}` : ''} tarjeta={preview.filtros.options.cardSource}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <SyncCreateTable rows={preview.crear} />
              <SyncUpdateTable rows={preview.actualizar} />
            </div>
            <div style={S.mutedLine}>
              Aplicar lote procesa hasta 100 personas y encola para {preview.resumen.dispositivos} reloj(es).
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SyncCreateTable({ rows }: { rows: AdmsSyncPreview['crear'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={S.kicker}>Se crearían en ADMS</div>
      <table style={S.table}>
        <thead><tr style={S.headRow}><Th>DNI</Th><Th>Nombre</Th><Th>Cmds</Th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={`crear-${r.dni}`} style={S.bodyRow}><Td>{r.dni}</Td><Td>{r.nombre || '-'}</Td><Td>{r.comandos}</Td></tr>)}
          {!rows.length && <EmptyRow text="Sin altas pendientes." cols={3} />}
        </tbody>
      </table>
    </div>
  );
}

function SyncUpdateTable({ rows }: { rows: AdmsSyncPreview['actualizar'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={S.kicker}>Se actualizarían nombres</div>
      <table style={S.table}>
        <thead><tr style={S.headRow}><Th>DNI</Th><Th>Actual</Th><Th>Esperado</Th><Th>Cmds</Th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={`upd-${r.dni}`} style={S.bodyRow}><Td>{r.dni}</Td><Td>{r.actual || '-'}</Td><Td>{r.esperado || '-'}</Td><Td>{r.comandos}</Td></tr>)}
          {!rows.length && <EmptyRow text="Sin actualizaciones pendientes." cols={4} />}
        </tbody>
      </table>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HuellasSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function HuellasSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const [rows, setRows] = React.useState<AdmsFingerprintRow[]>([]);
  const [q, setQ] = React.useState('');
  const [sn, setSn] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const targetSn = sn || dispositivos[0]?.sn || '';

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await getAdmsHuellas({ q, sn: sn || undefined });
      setRows(res.data);
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudieron cargar huellas');
    } finally {
      setLoading(false);
    }
  }

  async function send(row: AdmsFingerprintRow) {
    if (!targetSn) return;
    setLoading(true);
    setMessage(null);
    try {
      const ids = await queueAdmsSendUser(targetSn, row.dni, true);
      setMessage(`Usuario ${row.dni}: ${ids.length} comando(s) con huellas en cola.`);
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo encolar huella');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Huellas ADMS</div>
        <div style={S.simpleFilter}>
          <Field label="Buscar" id="adms-fp-q">
            <input id="adms-fp-q" style={S.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="dni o nombre" />
          </Field>
          <Field label="Reloj destino" id="adms-fp-sn">
            <select id="adms-fp-sn" style={S.input} value={sn} onChange={(e) => setSn(e.target.value)}>
              <option value="">Primer reloj</option>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <button className="btn" onClick={load} disabled={loading} style={{ minHeight: 35 }}>
            {loading ? 'Leyendo...' : 'Buscar huellas'}
          </button>
        </div>
        <div style={S.mutedLine}>Muestra hasta 200 templates. Para copia masiva usa el sync con huellas.</div>
      </div>
      {message && <div style={message.startsWith('Usuario') ? S.infoBox : S.errorBox}>{message}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.headRow}>
              <Th>DNI</Th><Th>Nombre</Th><Th>Dedo</Th><Th>Version</Th><Th>Size</Th><Th>Compatibilidad</Th><Th>Accion</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.userid}-${r.fingerId}`} style={S.bodyRow}>
                <Td>{r.dni}</Td><Td>{r.nombre || '-'}</Td><Td>{r.fingerId}</Td><Td>{r.version || '-'}</Td>
                <Td>{r.size}</Td>
                <Td>{r.compatible.map(cc => `${cc.alias}:${cc.ok ? 'OK' : 'NO'}`).join(' | ') || '-'}</Td>
                <Td><button className="btn secondary" disabled={!targetSn || loading} onClick={() => send(r)}>Enviar</button></Td>
              </tr>
            ))}
            {!rows.length && <EmptyRow text="Sin huellas para mostrar." cols={7} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EstructuraHistorialSection() {
  const [rows, setRows] = React.useState<AdmsDeviceHistory[]>([]);
  const [reparticiones, setReparticiones] = React.useState<{ id: number; nombre: string }[]>([]);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    try {
      const [history, config] = await Promise.all([getAdmsDeviceHistory(), getAdmsStructureConfig()]);
      setRows(history);
      setReparticiones(config.reparticiones);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo cargar la estructura');
    }
  }

  React.useEffect(() => { load(); }, []);

  async function assign(sn: string, value: string) {
    setSaving(sn);
    try {
      await saveAdmsDeviceStructure(sn, value ? Number(value) : null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Estructura e historial de relojes</div>
        <div style={S.mutedLine}>Incluye dispositivos desactivados. La dependencia asignada se usa automáticamente en cruces, estado biométrico y sincronización.</div>
      </div>
      {error && <div style={S.errorBox}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr style={S.headRow}><Th>SN</Th><Th>Alias / IP</Th><Th>Estado</Th><Th>Última actividad</Th><Th>Dependencia PersonalV5</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sn} style={S.bodyRow}>
                <Td>{r.sn}</Td>
                <Td>{r.alias}<div style={S.mutedLine}>{r.ip || '-'}</div></Td>
                <Td><span style={{ ...S.badge, background: r.deleted ? '#fee2e2' : '#dcfce7', color: r.deleted ? '#b91c1c' : '#15803d' }}>{r.deleted ? 'Desactivado' : r.state ? 'Activo' : 'Pausado'}</span></Td>
                <Td>{r.lastActivity?.slice(0, 16) || '-'}</Td>
                <Td>
                  <select style={S.input} value={String(r.estructura?.reparticion_id ?? '')} disabled={saving === r.sn} onChange={e => assign(r.sn, e.target.value)}>
                    <option value="">Sin estructura</option>
                    {reparticiones.map(rep => <option key={rep.id} value={rep.id}>{rep.nombre}</option>)}
                  </select>
                </Td>
              </tr>
            ))}
            {!rows.length && <EmptyRow text="Sin relojes para mostrar." cols={5} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EstadoBiometricoSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const [result, setResult] = React.useState<AdmsBiometricStatusResult | null>(null);
  const [q, setQ] = React.useState('');
  const [sn, setSn] = React.useState('');
  const [estado, setEstado] = React.useState<AdmsBiometricState>('incompleto');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cruceSn, setCruceSn] = React.useState('');
  const [c, setC] = React.useState<AdmsCruces | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setResult(await getAdmsBiometricStatus({ q, sn: sn || undefined, estado }));
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo cargar el estado biometrico');
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setLoading(true);
    setError(null);
    try {
      await exportAdmsBiometricStatus({ q, sn: sn || undefined, estado });
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo exportar el estado biometrico');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Personas por estado biometrico</div>
        <div style={S.simpleFilter}>
          <Field label="Alcance" id="bio-status-sn">
            <select id="bio-status-sn" style={S.input} value={sn} onChange={(e) => setSn(e.target.value)}>
              <option value="">General - todos los ficheros</option>
              {dispositivos.map(d => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Estado" id="bio-status-state">
            <select id="bio-status-state" style={S.input} value={estado} onChange={(e) => setEstado(e.target.value as AdmsBiometricState)}>
              <option value="incompleto">Falta huella o palma</option>
              <option value="sin_biometria">Sin huella ni palma</option>
              <option value="no_existe">No existe en fichero</option>
              <option value="ambas">Con huella y palma</option>
              <option value="solo_huella">Solo huella</option>
              <option value="solo_palma">Solo palma</option>
              <option value="todos">Todos</option>
            </select>
          </Field>
          <Field label="Buscar DNI/nombre" id="bio-status-q">
            <input id="bio-status-q" style={S.input} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="opcional" />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={load} disabled={loading} style={{ minHeight: 35 }}>
              {loading ? 'Procesando...' : 'Consultar'}
            </button>
            <button className="btn secondary" onClick={exportCsv} disabled={loading} style={{ minHeight: 35 }}>
              Exportar CSV
            </button>
          </div>
        </div>
        <div style={S.mutedLine}>
          Por fichero se consideran las personas asignadas a ese reloj en ADMS. General incluye todas las personas.
        </div>
      </div>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.simpleFilter}>
          <Field label="Comparar contra estructura del fichero" id="adms-cruce-sn">
            <select id="adms-cruce-sn" style={S.input} value={cruceSn} onChange={e => setCruceSn(e.target.value)}>
              <option value="">General - todo PersonalV5</option>
              {dispositivos.map(d => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <button className="btn" onClick={async () => setC(await getAdmsCruces(cruceSn || undefined))}>Comparar</button>
        </div>
        {c?.estructura && <div style={S.mutedLine}>Estructura aplicada: {c.estructura.reparticion_nombre || c.estructura.servicio_nombre || c.estructura.sector_nombre}</div>}
      </div>

      {error && <div style={S.errorBox}>{error}</div>}
      {result && (
        <div style={S.cards}>
          <NumCard label="Personas" value={result.resumen.total} color="#334155" />
          <NumCard label="No existe en fichero" value={result.resumen.noExiste} color="#b91c1c" />
          <NumCard label="Sin huella ni palma" value={result.resumen.sinBiometria} color="#dc2626" />
          <NumCard label="Huella + palma" value={result.resumen.ambas} color="#059669" />
          <NumCard label="Solo huella" value={result.resumen.soloHuella} color="#2563eb" />
          <NumCard label="Solo palma" value={result.resumen.soloPalma} color="#7c3aed" />
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr style={S.headRow}><Th>DNI</Th><Th>Nombre</Th><Th>Existe en fichero</Th><Th>Fichero / reloj</Th><Th>Huellas</Th><Th>Palmas</Th><Th>Estado</Th></tr></thead>
          <tbody>
            {result?.data.map(row => {
              const device = dispositivos.find(d => d.sn === row.sn);
              const label = !row.existe ? 'No existe en fichero'
                : row.huellas > 0 && row.palmas > 0 ? 'Huella + palma'
                : row.huellas > 0 ? 'Solo huella'
                : row.palmas > 0 ? 'Solo palma'
                : 'Sin huella ni palma';
              const color = !row.existe ? { background: '#fecaca', color: '#991b1b' }
                : row.huellas > 0 && row.palmas > 0 ? { background: '#dcfce7', color: '#15803d' }
                : row.huellas === 0 && row.palmas === 0 ? { background: '#fee2e2', color: '#b91c1c' }
                : { background: '#fef3c7', color: '#92400e' };
              return (
                <tr key={row.dni} style={S.bodyRow}>
                  <Td>{row.dni}</Td><Td>{row.nombre || '-'}</Td>
                  <Td><span style={{ ...S.badge, background: row.existe ? '#dcfce7' : '#fee2e2', color: row.existe ? '#15803d' : '#b91c1c' }}>{row.existe ? 'Sí' : 'No'}</span></Td>
                  <Td>{device?.alias || row.sn || 'Sin asignar'}</Td>
                  <Td>{row.huellas}</Td><Td>{row.palmas}</Td><Td><span style={{ ...S.badge, ...color }}>{label}</span></Td>
                </tr>
              );
            })}
            {!result?.data.length && <EmptyRow text={loading ? 'Calculando...' : 'Sin personas para este filtro.'} cols={7} />}
          </tbody>
        </table>
        {result && <div style={S.mutedLine}>Mostrando {result.data.length} de {result.total} personas para el filtro elegido.</div>}
      </div>
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BiotemplatesSection â€” palma, cara, etc.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BIOTYPE_COLORS: Record<string, { bg: string; color: string }> = {
  huella: { bg: '#dbeafe', color: '#1d4ed8' },
  palma:  { bg: '#d1fae5', color: '#065f46' },
  cara:   { bg: '#fef3c7', color: '#92400e' },
};

function BiotemplatesSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const [rows, setRows] = React.useState<AdmsBiotemplate[]>([]);
  const [total, setTotal] = React.useState(0);
  const [q, setQ] = React.useState('');
  const [bioType, setBioType] = React.useState<string>('');
  const [sn, setSn] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function load() {
    setLoading(true); setMessage(null);
    try {
      const res = await getAdmsBiotemplates({
        q: q || undefined,
        bioType: bioType ? Number(bioType) : undefined,
        sn: sn || undefined,
      });
      setRows(res.data);
      setTotal(res.total);
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudieron cargar biotemplates');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  const byType = React.useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach(r => { m[r.bioTypeName] = (m[r.bioTypeName] ?? 0) + 1; });
    return m;
  }, [rows]);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Palma / Biotemplates</div>
        <div style={{ ...S.infoBox, marginBottom: 14 }}>
          Los dispositivos envían palmas y caras vía PUSH usando la tabla <code>BIODATA</code>.
          El backend las guarda en <code>biotemplate</code> (BioType 10=palma, 9=cara, 1-8=huella).
        </div>
        <div style={S.simpleFilter}>
          <Field label="Buscar DNI/nombre" id="bio-q">
            <input id="bio-q" style={S.input} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="opcional" />
          </Field>
          <Field label="Tipo biométrico" id="bio-type">
            <select id="bio-type" style={S.input} value={bioType} onChange={(e) => setBioType(e.target.value)}>
              <option value="">Todos</option>
              <option value="10">10 - Palma visible</option>
              <option value="9">9 - Cara visible</option>
              <option value="1">1-8 - Huella</option>
            </select>
          </Field>
          <Field label="Reloj" id="bio-sn">
            <select id="bio-sn" style={S.input} value={sn} onChange={(e) => setSn(e.target.value)}>
              <option value="">Todos</option>
              {dispositivos.map(d => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <button className="btn" onClick={load} disabled={loading} style={{ minHeight: 35 }}>
            {loading ? 'Leyendo...' : 'Buscar'}
          </button>
        </div>

        {/* Resumen por tipo */}
        {Object.keys(byType).length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {Object.entries(byType).map(([tipo, cnt]) => {
              const c = BIOTYPE_COLORS[tipo] ?? { bg: '#f1f5f9', color: '#334155' };
              return (
                <span key={tipo} style={{ ...S.badge, ...c, fontSize: '0.8rem' }}>
                  {tipo}: {cnt}
                </span>
              );
            })}
          </div>
        )}
        <div style={S.mutedLine}>Mostrando {rows.length} de {total} plantillas. Muestra hasta 200.</div>
      </div>

      {message && <div style={S.errorBox}>{message}</div>}

      {total === 0 && !loading && (
        <div style={{ ...S.infoBox }}>
          No hay biotemplates en la DB todavía. El reloj los enviará vía PUSH la próxima vez que sincronice,
          ahora que el servidor anuncia <code>MultiBioDataSupport</code>. Podés forzar un CHECK desde la tarjeta del reloj.
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.headRow}>
              <Th>DNI</Th><Th>Nombre</Th><Th>Tipo</Th><Th>Slot</Th>
              <Th>Ver</Th><Th>Size</Th><Th>Reloj</Th><Th>Actualizado</Th><Th>Válido</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = BIOTYPE_COLORS[r.bioTypeName] ?? { bg: '#f1f5f9', color: '#334155' };
              return (
                <tr key={r.id} style={S.bodyRow}>
                  <Td>{r.dni}</Td>
                  <Td>{r.nombre || '-'}</Td>
                  <Td>
                    <span style={{ ...S.badge, ...c }}>
                      {r.bioTypeName} ({r.bioType})
                    </span>
                  </Td>
                  <Td>{r.index}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.majorVer}.{r.minorVer}</Td>
                  <Td>{r.size} bytes</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.sn || '-'}</Td>
                  <Td>{r.utime?.slice(0, 16) ?? '-'}</Td>
                  <Td>
                    <span style={{ ...S.badge, background: r.valid ? '#dcfce7' : '#fee2e2', color: r.valid ? '#15803d' : '#b91c1c' }}>
                      {r.valid ? 'Si' : 'No'}
                    </span>
                  </Td>
                </tr>
              );
            })}
            {!rows.length && <EmptyRow text="Sin biotemplates para el filtro." cols={9} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RelecturaSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RelecturaSection({ dispositivos, onApplied }: { dispositivos: AdmsDispositivo[]; onApplied: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [sn, setSn] = React.useState('');
  const [desde, setDesde] = React.useState(`${today}T00:00`);
  const [hasta, setHasta] = React.useState(`${today}T23:59`);
  const [confirmacion, setConfirmacion] = React.useState('');
  const [preview, setPreview] = React.useState<AdmsRereadPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const targetSn = sn || dispositivos[0]?.sn || '';

  async function loadPreview() {
    if (!targetSn) { setMessage('Selecciona un reloj.'); return; }
    setLoading(true); setMessage(null);
    try {
      setPreview(await getAdmsRereadPreview({ sn: targetSn, desde, hasta }));
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo calcular la relectura');
    } finally { setLoading(false); }
  }

  async function apply() {
    if (!targetSn || !preview) return;
    if (confirmacion.trim().toUpperCase() !== 'RELEER') {
      setMessage('Para aplicar escribi RELEER en la confirmacion.'); return;
    }
    setLoading(true); setMessage(null);
    try {
      const r = await applyAdmsReread({ sn: targetSn, desde, hasta, confirmacion });
      setMessage(`Relectura en cola: ${r.total} comando(s). No se borro nada de la DB; el reloj reenviara el rango y solo entraran fichadas nuevas.`);
      setPreview(await getAdmsRereadPreview({ sn: targetSn, desde, hasta }));
      await onApplied();
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo aplicar la relectura');
    } finally { setLoading(false); }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Relectura desde reloj</div>
        <div style={S.simpleFilter}>
          <Field label="Reloj" id="adms-reread-sn">
            <select id="adms-reread-sn" style={S.input} value={targetSn} onChange={(e) => setSn(e.target.value)}>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Desde" id="adms-reread-desde">
            <input id="adms-reread-desde" type="datetime-local" style={S.input} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta" id="adms-reread-hasta">
            <input id="adms-reread-hasta" type="datetime-local" style={S.input} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <button className="btn secondary" disabled={loading || !targetSn} onClick={loadPreview}>
            {loading ? 'Calculando...' : 'Preview'}
          </button>
        </div>
        <div style={S.mutedLine}>No borra registros de la DB. Pide al reloj el rango y solo inserta fichadas nuevas; las existentes se ignoran.</div>
      </div>
      {message && <div style={message.startsWith('Relectura') ? S.infoBox : S.errorBox}>{message}</div>}
      {preview && (
        <div style={{ ...S.section, paddingBottom: 14 }}>
          <div style={S.cards}>
            <InfoCard label="Reloj" value={preview.target.alias} />
            <NumCard label="DB en rango" value={preview.db.totalEnRango} color="#2563eb" />
            <NumCard label="Stamp actual" value={preview.stamp.actual} color="#0f766e" />
            <NumCard label="Stamp nuevo" value={preview.stamp.actual} color="#0f766e" />
          </div>
          <div style={S.infoBox}>{preview.advertencia}</div>
          <div style={S.simpleFilter}>
            <Field label="Confirmar" id="adms-reread-confirm">
              <input id="adms-reread-confirm" style={S.input} value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)} placeholder="RELEER" />
            </Field>
            <button className="btn danger" disabled={loading || confirmacion.trim().toUpperCase() !== 'RELEER'} onClick={apply}>
              Aplicar relectura
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <div style={S.kicker}>Muestras actuales en DB</div>
            <table style={S.table}>
              <thead><tr style={S.headRow}><Th>Fecha</Th><Th>Tipo</Th><Th>DNI</Th><Th>Nombre</Th><Th>Verif.</Th></tr></thead>
              <tbody>
                {preview.db.muestras.map((r, i) => (
                  <tr key={`${r.dni}-${r.fechaHora}-${i}`} style={S.bodyRow}>
                    <Td>{r.fechaHora?.slice(0, 19)}</Td><Td>{r.tipo}</Td><Td>{r.dni}</Td>
                    <Td>{r.nombre || '-'}</Td><Td>{r.verifycode ?? '-'}</Td>
                  </tr>
                ))}
                {!preview.db.muestras.length && <EmptyRow text="Sin fichadas en DB para ese rango." cols={5} />}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function DeleteAttlogSection({ dispositivos, onApplied }: { dispositivos: AdmsDispositivo[]; onApplied: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [sn, setSn] = React.useState('');
  const [desde, setDesde] = React.useState(`${today}T00:00`);
  const [hasta, setHasta] = React.useState(`${today}T23:59`);
  const [dni, setDni] = React.useState('');
  const [tipo, setTipo] = React.useState('');
  const [confirmacion, setConfirmacion] = React.useState('');
  const [preview, setPreview] = React.useState<AdmsDeleteAttlogPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const targetSn = sn || dispositivos[0]?.sn || '';

  async function loadPreview() {
    if (!targetSn) { setMessage('Selecciona un reloj.'); return; }
    setLoading(true); setMessage(null);
    try {
      setPreview(await getAdmsDeleteAttlogPreview({ sn: targetSn, desde, hasta, dni, tipo }));
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo calcular el borrado');
    } finally { setLoading(false); }
  }

  async function apply() {
    if (!targetSn || !preview) return;
    if (confirmacion.trim().toUpperCase() !== 'BORRAR FICHAJES') {
      setMessage('Para aplicar escribi BORRAR FICHAJES en la confirmacion.'); return;
    }
    setLoading(true); setMessage(null);
    try {
      const r = await applyAdmsDeleteAttlog({ sn: targetSn, desde, hasta, dni, tipo, confirmacion });
      setMessage(`Borrado en cola: ${r.total} comando(s). Estimadas por DB: ${r.estimadas}. Comando: ${r.comando}`);
      setPreview(await getAdmsDeleteAttlogPreview({ sn: targetSn, desde, hasta, dni, tipo }));
      await onApplied();
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo encolar el borrado');
    } finally { setLoading(false); }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Borrar fichajes del reloj</div>
        <div style={S.errorBox}>
          Esto borra en el fichero fisico, no en la DB. El comando queda en cola ADMS y depende del firmware del reloj.
        </div>
        <div style={S.simpleFilter}>
          <Field label="Reloj" id="adms-delatt-sn">
            <select id="adms-delatt-sn" style={S.input} value={targetSn} onChange={(e) => setSn(e.target.value)}>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Desde" id="adms-delatt-desde">
            <input id="adms-delatt-desde" type="datetime-local" style={S.input} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta" id="adms-delatt-hasta">
            <input id="adms-delatt-hasta" type="datetime-local" style={S.input} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="DNI / agente" id="adms-delatt-dni">
            <input id="adms-delatt-dni" style={S.input} value={dni} onChange={(e) => setDni(e.target.value)} placeholder="opcional" />
          </Field>
          <Field label="Tipo" id="adms-delatt-tipo">
            <select id="adms-delatt-tipo" style={S.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
            </select>
          </Field>
          <button className="btn secondary" disabled={loading || !targetSn} onClick={loadPreview}>
            {loading ? 'Calculando...' : 'Preview'}
          </button>
        </div>
        <div style={S.mutedLine}>El preview mira la DB para estimar cuantas fichadas coinciden. El borrado real se ejecuta en el reloj cuando toma el comando.</div>
      </div>
      {message && <div style={message.startsWith('Borrado') ? S.infoBox : S.errorBox}>{message}</div>}
      {preview && (
        <div style={{ ...S.section, paddingBottom: 14 }}>
          <div style={S.cards}>
            <InfoCard label="Reloj" value={preview.target.alias} />
            <NumCard label="Estimadas DB" value={preview.db.totalEnRango} color="#dc2626" />
            <InfoCard label="Primera" value={preview.db.primera?.slice(0, 19) ?? '-'} />
            <InfoCard label="Ultima" value={preview.db.ultima?.slice(0, 19) ?? '-'} />
          </div>
          <div style={S.errorBox}>{preview.advertencia}</div>
          <div style={S.simpleFilter}>
            <Field label="Confirmar" id="adms-delatt-confirm">
              <input id="adms-delatt-confirm" style={S.input} value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)} placeholder="BORRAR FICHAJES" />
            </Field>
            <button className="btn danger" disabled={loading || confirmacion.trim().toUpperCase() !== 'BORRAR FICHAJES'} onClick={apply}>
              Encolar borrado en reloj
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <div style={S.kicker}>Muestras actuales en DB</div>
            <table style={S.table}>
              <thead><tr style={S.headRow}><Th>Fecha</Th><Th>Tipo</Th><Th>DNI</Th><Th>Nombre</Th><Th>Verif.</Th></tr></thead>
              <tbody>
                {preview.db.muestras.map((r, i) => (
                  <tr key={`${r.dni}-${r.fechaHora}-${i}`} style={S.bodyRow}>
                    <Td>{r.fechaHora?.slice(0, 19)}</Td><Td>{r.tipo}</Td><Td>{r.dni}</Td>
                    <Td>{r.nombre || '-'}</Td><Td>{r.verifycode ?? '-'}</Td>
                  </tr>
                ))}
                {!preview.db.muestras.length && <EmptyRow text="Sin fichadas en DB para ese filtro." cols={5} />}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CruceRelojesSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CruceRelojesSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [snA, setSnA] = React.useState('');
  const [snB, setSnB] = React.useState('');
  const [desde, setDesde] = React.useState(today);
  const [hasta, setHasta] = React.useState(today);
  const [servicioId, setServicioId] = React.useState('');
  const [data, setData] = React.useState<AdmsClockCross | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const targetA = snA || dispositivos[0]?.sn || '';
  const targetB = snB || dispositivos.find(d => d.sn !== targetA)?.sn || '';

  async function load() {
    if (!targetA || !targetB || targetA === targetB) { setMessage('Elegí dos relojes distintos.'); return; }
    setLoading(true); setMessage(null);
    try {
      setData(await getAdmsClockCross({ snA: targetA, snB: targetB, desde, hasta, servicioId: servicioId || undefined }));
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo cruzar relojes');
    } finally { setLoading(false); }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Cruce entre relojes</div>
        <div style={S.simpleFilter}>
          <Field label="Reloj A" id="adms-cross-a">
            <select id="adms-cross-a" style={S.input} value={targetA} onChange={(e) => setSnA(e.target.value)}>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Reloj B" id="adms-cross-b">
            <select id="adms-cross-b" style={S.input} value={targetB} onChange={(e) => setSnB(e.target.value)}>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Desde" id="adms-cross-desde">
            <input id="adms-cross-desde" type="date" style={S.input} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta" id="adms-cross-hasta">
            <input id="adms-cross-hasta" type="date" style={S.input} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="Servicio ID" id="adms-cross-servicio">
            <input id="adms-cross-servicio" style={S.input} value={servicioId}
              onChange={(e) => setServicioId(e.target.value)} placeholder="opcional" />
          </Field>
          <button className="btn" disabled={loading} onClick={load}>{loading ? 'Cruzando...' : 'Cruzar activos'}</button>
        </div>
        <div style={S.mutedLine}>Cruza personal activo contra fichadas en DB por SN y rango.</div>
      </div>
      {message && <div style={S.errorBox}>{message}</div>}
      {data && (
        <>
          <div style={S.cards}>
            <NumCard label="Activos" value={data.resumen.activos} color="#0f766e" />
            <NumCard label={`Solo ${data.relojes.a.alias}`} value={data.resumen.soloA} color="#f59e0b" />
            <NumCard label={`Solo ${data.relojes.b.alias}`} value={data.resumen.soloB} color="#dc2626" />
            <NumCard label="En ambos" value={data.resumen.ambos} color="#16a34a" />
            <NumCard label="En ninguno" value={data.resumen.ninguno} color="#64748b" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
            <ClockCrossTable title={`En ${data.relojes.a.alias} y no en ${data.relojes.b.alias}`} rows={data.soloA} mode="a" />
            <ClockCrossTable title={`En ${data.relojes.b.alias} y no en ${data.relojes.a.alias}`} rows={data.soloB} mode="b" />
          </div>
          <div style={{ marginTop: 14 }}>
            <ClockCrossTable title="En ambos relojes" rows={data.ambos} mode="both" />
          </div>
        </>
      )}
    </>
  );
}

function ClockCrossTable({ title, rows, mode }: { title: string; rows: AdmsClockCrossRow[]; mode: 'a' | 'b' | 'both' }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={S.kicker}>{title}</div>
      <table style={S.table}>
        <thead>
          <tr style={S.headRow}>
            <Th>DNI</Th><Th>Nombre</Th><Th>Servicio</Th><Th>Marcas A</Th><Th>Ultima A</Th><Th>Marcas B</Th><Th>Ultima B</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${title}-${r.dni}`} style={S.bodyRow}>
              <Td>{r.dni}</Td><Td>{r.nombre || '-'}</Td><Td>{r.servicioNombre || r.servicioId || '-'}</Td>
              <Td>{mode === 'b' ? 0 : r.marcasA}</Td><Td>{r.ultimaA?.slice(0, 19) ?? '-'}</Td>
              <Td>{mode === 'a' ? 0 : r.marcasB}</Td><Td>{r.ultimaB?.slice(0, 19) ?? '-'}</Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow text="Sin diferencias para mostrar." cols={7} />}
        </tbody>
      </table>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MensajesSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MESSAGE_TEMPLATES = [
  'MIRA DUNE',
  'Hola {nombre}, fichada registrada {fecha} {hora}',
  '{nombre}: {tipo} registrada en {reloj} a las {hora}',
  'Recordatorio {nombre}: verificar salida del dia {fecha}',
  '{nombre} - presentarse en Personal. Servicio: {servicio}',
];

function MensajesSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const [sn, setSn] = React.useState('');
  const [q, setQ] = React.useState('');
  const [agents, setAgents] = React.useState<AdmsMessageAgent[]>([]);
  const [selectedDni, setSelectedDni] = React.useState('');
  const [formato, setFormato] = React.useState<'privado' | 'idle' | 'legacy'>('privado');
  const [tipo, setTipo] = React.useState('entrada');
  const [minutos, setMinutos] = React.useState(60);
  const [plantilla, setPlantilla] = React.useState(MESSAGE_TEMPLATES[0]);
  const [preview, setPreview] = React.useState<AdmsMessagePreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const targetSn = sn || dispositivos[0]?.sn || '';
  const agent = agents.find(a => String(a.dni) === selectedDni) || null;

  async function search() {
    setLoading(true); setMessage(null);
    try {
      const rows = (await searchAdmsMessageAgents(q)).map(a => ({ ...a, dni: String(a.dni) }));
      setAgents(rows);
      setSelectedDni(prev => rows.some(a => String(a.dni) === prev) ? prev : String(rows[0]?.dni || ''));
      setPreview(null);
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudieron buscar agentes');
    } finally { setLoading(false); }
  }

  function payload() {
    if (!targetSn || !agent) return null;
    return { sn: targetSn, dni: agent.dni, plantilla, formato, tipo, minutos };
  }

  async function makePreview() {
    const p = payload();
    if (!p) { setMessage('Elegi reloj y agente activo.'); return; }
    setLoading(true); setMessage(null);
    try { setPreview(await previewAdmsMessage(p)); }
    catch (e: any) { setMessage(e?.message ?? 'No se pudo previsualizar'); }
    finally { setLoading(false); }
  }

  async function send() {
    const p = payload();
    if (!p) return;
    setLoading(true); setMessage(null);
    try {
      const res = await sendAdmsMessage(p);
      setPreview(res);
      setMessage(`Mensaje en cola: ${res.ids.length} comando(s).`);
    } catch (e: any) {
      setMessage(e?.message ?? 'No se pudo enviar mensaje');
    } finally { setLoading(false); }
  }

  React.useEffect(() => { search(); }, []);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Mensajes al reloj</div>
        <div style={S.simpleFilter}>
          <Field label="Reloj" id="adms-msg-sn">
            <select id="adms-msg-sn" style={S.input} value={targetSn} onChange={(e) => setSn(e.target.value)}>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Buscar activo" id="adms-msg-q">
            <input id="adms-msg-q" style={S.input} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="dni o nombre" />
          </Field>
          <button className="btn secondary" disabled={loading} onClick={search}>{loading ? 'Buscando...' : 'Buscar'}</button>
          <Field label="Agente" id="adms-msg-agent">
            <select id="adms-msg-agent" style={S.input} value={selectedDni}
              onChange={(e) => { setSelectedDni(e.target.value); setPreview(null); }}>
              {agents.map((a) => <option key={a.dni} value={a.dni}>{a.dni} - {a.nombre}</option>)}
            </select>
          </Field>
          <Field label="Formato" id="adms-msg-format">
            <select id="adms-msg-format" style={S.input} value={formato} onChange={(e) => setFormato(e.target.value as any)}>
              <option value="privado">SMS privado moderno</option>
              <option value="idle">SMS publico moderno</option>
              <option value="legacy">Legacy TAG</option>
            </select>
          </Field>
          <Field label="Minutos" id="adms-msg-min">
            <input id="adms-msg-min" type="number" min={1} max={1440} style={S.input}
              value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
          </Field>
        </div>
        <div style={{ ...S.simpleFilter, marginTop: 10 }}>
          <Field label="Tipo" id="adms-msg-tipo">
            <select id="adms-msg-tipo" style={S.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="aviso">Aviso</option>
            </select>
          </Field>
          <Field label="Plantilla" id="adms-msg-template">
            <select id="adms-msg-template" style={S.input} value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              {MESSAGE_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Mensaje" id="adms-msg-custom">
            <input id="adms-msg-custom" style={S.input} value={plantilla} onChange={(e) => setPlantilla(e.target.value)} />
          </Field>
          <button className="btn secondary" disabled={loading || !agent} onClick={makePreview}>Preview</button>
          <button className="btn danger" disabled={loading || !agent} onClick={send}>Enviar prueba</button>
        </div>
        <div style={S.mutedLine}>Variables: {'{nombre}'} {'{dni}'} {'{fecha}'} {'{hora}'} {'{reloj}'} {'{tipo}'} {'{servicio}'} {'{legajo}'}</div>
      </div>
      {message && <div style={message.startsWith('Mensaje') ? S.infoBox : S.errorBox}>{message}</div>}
      {preview && (
        <div style={{ ...S.section, paddingBottom: 14 }}>
          <div style={S.cards}>
            <InfoCard label="Agente" value={`${preview.agente.dni} - ${preview.agente.nombre}`} />
            <InfoCard label="Reloj" value={preview.reloj.alias} />
            <InfoCard label="Registrado ADMS" value={preview.agente.registradoAdms ? 'si' : 'no'} />
            <InfoCard label="Formato" value={preview.formato} />
          </div>
          <div style={S.infoBox}>{preview.mensaje}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr style={S.headRow}><Th>#</Th><Th>Comando</Th></tr></thead>
              <tbody>
                {(preview.comandos?.length ? preview.comandos : [preview.comando]).map((cmd, idx) => (
                  <tr style={S.bodyRow} key={`${idx}-${cmd}`}>
                    <Td>{idx + 1}</Td>
                    <Td style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>{cmd}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AudioEventosSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AudioEventosSection({ dispositivos }: { dispositivos: AdmsDispositivo[] }) {
  const [archivos, setArchivos] = React.useState<AdmsAudioFile[]>([]);
  const [reglas, setReglas] = React.useState<AdmsAudioRule[]>([]);
  const [eventos, setEventos] = React.useState<AdmsAudioEvent[]>([]);
  const [audioEnabled, setAudioEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [audioName, setAudioName] = React.useState('');
  const [agentQ, setAgentQ] = React.useState('');
  const [agents, setAgents] = React.useState<AdmsMessageAgent[]>([]);
  const [rule, setRule] = React.useState({
    nombre: 'Aviso de fichada',
    evento: 'entrada' as 'entrada' | 'salida' | 'fichada',
    sn: '', dni: '', audioId: '', activo: true, volumen: 0.8,
  });
  const playedRef = React.useRef<Set<string>>(new Set());
  const selectedAudio = archivos.find(a => a.id === rule.audioId) || archivos[0] || null;

  async function searchAgents() {
    setLoading(true); setMessage(null);
    try {
      const rows = await searchAdmsMessageAgents(agentQ);
      setAgents(rows);
      if (rows[0]) setRule(prev => ({ ...prev, dni: prev.dni || rows[0].dni }));
    } catch (e: any) { setMessage(e?.message ?? 'No se pudieron buscar agentes'); }
    finally { setLoading(false); }
  }

  async function loadConfig() {
    const config = await getAdmsAudioConfig();
    setArchivos(config.archivos);
    setReglas(config.reglas);
    if (!rule.audioId && config.archivos[0]) setRule(prev => ({ ...prev, audioId: config.archivos[0].id }));
  }

  async function loadEvents(playNew = false) {
    const rows = await getAdmsAudioEvents();
    setEventos(rows);
    if (!playNew || !audioEnabled) return;
    for (const ev of rows.slice().reverse()) {
      if (!ev.audioId || playedRef.current.has(ev.id)) continue;
      playedRef.current.add(ev.id);
      await playAudio(ev.audioId, ev.volumen);
    }
  }

  async function loadAll() {
    setLoading(true); setMessage(null);
    try { await loadConfig(); await loadEvents(false); }
    catch (e: any) { setMessage(e?.message ?? 'No se pudo cargar audio de eventos'); }
    finally { setLoading(false); }
  }

  async function playAudio(audioId: string, volume = rule.volumen) {
    const blob = await fetchAdmsAudioBlob(audioId);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, Number(volume || 0.8)));
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  async function enableSound() {
    setLoading(true); setMessage(null);
    try {
      const rows = await getAdmsAudioEvents();
      rows.forEach(ev => playedRef.current.add(ev.id));
      setEventos(rows); setAudioEnabled(true);
      setMessage('Sonido activado. Las nuevas fichadas van a reproducir audio en esta pagina.');
    } catch (e: any) { setMessage(e?.message ?? 'No se pudo activar el sonido'); }
    finally { setLoading(false); }
  }

  async function upload() {
    if (!file) { setMessage('Selecciona un archivo de audio.'); return; }
    setLoading(true); setMessage(null);
    try {
      const saved = await uploadAdmsAudio(file, audioName);
      setFile(null); setAudioName('');
      setRule(prev => ({ ...prev, audioId: saved.id }));
      await loadConfig(); setMessage('Audio subido.');
    } catch (e: any) { setMessage(e?.message ?? 'No se pudo subir audio'); }
    finally { setLoading(false); }
  }

  async function saveRule() {
    const audioId = rule.audioId || selectedAudio?.id || '';
    if (!audioId) { setMessage('Subi o elegi un audio primero.'); return; }
    setLoading(true); setMessage(null);
    try {
      await saveAdmsAudioRule({ nombre: rule.nombre, evento: rule.evento, sn: rule.sn || null, dni: rule.dni || null, audioId, activo: rule.activo, volumen: rule.volumen });
      await loadConfig(); setMessage('Regla guardada.');
    } catch (e: any) { setMessage(e?.message ?? 'No se pudo guardar la regla'); }
    finally { setLoading(false); }
  }

  async function removeRule(id: string) {
    setLoading(true); setMessage(null);
    try { await deleteAdmsAudioRule(id); await loadConfig(); setMessage('Regla eliminada.'); }
    catch (e: any) { setMessage(e?.message ?? 'No se pudo eliminar la regla'); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { loadAll(); }, []);
  React.useEffect(() => {
    if (!audioEnabled) return;
    const timer = window.setInterval(() => {
      loadEvents(true).catch((e: any) => setMessage(e?.message ?? 'No se pudieron leer eventos'));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [audioEnabled]);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={S.sectionTitle}>Audio por fichada</div>
            <div style={S.mutedLine}>Reproduce audios en esta pagina cuando una fichada coincide con una regla.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary" type="button" onClick={loadAll} disabled={loading}>{loading ? 'Leyendo...' : 'Actualizar'}</button>
            <button className="btn" type="button" onClick={enableSound} disabled={loading || audioEnabled}>{audioEnabled ? 'Sonido activo' : 'Activar sonido'}</button>
          </div>
        </div>
      </div>
      {message && <div style={message.includes('No se') || message.includes('Selecciona') || message.includes('Subi') ? S.errorBox : S.infoBox}>{message}</div>}

      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Audios</div>
        <div style={S.simpleFilter}>
          <Field label="Nombre" id="adms-audio-name">
            <input id="adms-audio-name" style={S.input} value={audioName} onChange={(e) => setAudioName(e.target.value)} placeholder="Ej: Entrada autorizada" />
          </Field>
          <Field label="Archivo" id="adms-audio-file">
            <input id="adms-audio-file" style={S.input} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <button className="btn" type="button" disabled={loading || !file} onClick={upload}>Subir audio</button>
          <Field label="Audio actual" id="adms-audio-current">
            <select id="adms-audio-current" style={S.input} value={rule.audioId || selectedAudio?.id || ''} onChange={(e) => setRule(prev => ({ ...prev, audioId: e.target.value }))}>
              {archivos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </Field>
          <button className="btn secondary" type="button" disabled={!selectedAudio} onClick={() => selectedAudio && playAudio(selectedAudio.id, rule.volumen).catch((e: any) => setMessage(e?.message ?? 'No se pudo reproducir'))}>Probar</button>
        </div>
        <div style={S.mutedLine}>Formatos admitidos: mp3, wav, ogg y m4a. Maximo 10 MB.</div>
      </div>

      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Regla nueva</div>
        <div style={S.simpleFilter}>
          <Field label="Nombre" id="adms-rule-name">
            <input id="adms-rule-name" style={S.input} value={rule.nombre} onChange={(e) => setRule(prev => ({ ...prev, nombre: e.target.value }))} />
          </Field>
          <Field label="Evento" id="adms-rule-event">
            <select id="adms-rule-event" style={S.input} value={rule.evento} onChange={(e) => setRule(prev => ({ ...prev, evento: e.target.value as any }))}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="fichada">Cualquier fichada</option>
            </select>
          </Field>
          <Field label="Reloj" id="adms-rule-sn">
            <select id="adms-rule-sn" style={S.input} value={rule.sn} onChange={(e) => setRule(prev => ({ ...prev, sn: e.target.value }))}>
              <option value="">Todos</option>
              {dispositivos.map((d) => <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>)}
            </select>
          </Field>
          <Field label="Buscar activo" id="adms-rule-agent-q">
            <input id="adms-rule-agent-q" style={S.input} value={agentQ} onChange={(e) => setAgentQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchAgents()} placeholder="dni o nombre" />
          </Field>
          <button className="btn secondary" type="button" disabled={loading} onClick={searchAgents}>Buscar</button>
          <Field label="Agente" id="adms-rule-agent">
            <select id="adms-rule-agent" style={S.input} value={rule.dni} onChange={(e) => setRule(prev => ({ ...prev, dni: e.target.value }))}>
              <option value="">Todos</option>
              {agents.map((a) => <option key={a.dni} value={a.dni}>{a.dni} - {a.nombre}</option>)}
            </select>
          </Field>
          <Field label="DNI manual" id="adms-rule-dni">
            <input id="adms-rule-dni" style={S.input} value={rule.dni} onChange={(e) => setRule(prev => ({ ...prev, dni: e.target.value }))} placeholder="opcional" />
          </Field>
          <Field label="Volumen (0-1)" id="adms-rule-volume">
            <input id="adms-rule-volume" style={S.input} type="number" min={0} max={1} step={0.1} value={rule.volumen} onChange={(e) => setRule(prev => ({ ...prev, volumen: Number(e.target.value) }))} />
          </Field>
          <label style={{ ...S.checkLabel, minHeight: 35 }}>
            <input type="checkbox" checked={rule.activo} onChange={(e) => setRule(prev => ({ ...prev, activo: e.target.checked }))} /> Activa
          </label>
          <button className="btn" type="button" disabled={loading || !archivos.length} onClick={saveRule}>Guardar regla</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 22 }}>
        <div style={S.kicker}>Reglas activas</div>
        <table style={S.table}>
          <thead><tr style={S.headRow}><Th>Nombre</Th><Th>Evento</Th><Th>Reloj</Th><Th>DNI</Th><Th>Audio</Th><Th>Vol.</Th><Th>Estado</Th><Th>Acciones</Th></tr></thead>
          <tbody>
            {reglas.map((r) => {
              const audio = archivos.find(a => a.id === r.audioId);
              const device = dispositivos.find(d => d.sn === r.sn);
              return (
                <tr key={r.id} style={S.bodyRow}>
                  <Td>{r.nombre}</Td><Td>{r.evento}</Td>
                  <Td>{r.sn ? (device?.alias || r.sn) : 'Todos'}</Td>
                  <Td>{r.dni || 'Todos'}</Td>
                  <Td>{audio?.nombre || r.audioId}</Td>
                  <Td>{r.volumen}</Td>
                  <Td><span style={{ ...S.badge, background: r.activo ? '#dcfce7' : '#f1f5f9', color: r.activo ? '#15803d' : '#64748b' }}>{r.activo ? 'Activa' : 'Pausada'}</span></Td>
                  <Td><button className="btn danger" type="button" onClick={() => removeRule(r.id)}>Borrar</button></Td>
                </tr>
              );
            })}
            {!reglas.length && <EmptyRow text="Sin reglas de audio." cols={8} />}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={S.kicker}>Ultimos eventos</div>
        <table style={S.table}>
          <thead><tr style={S.headRow}><Th>Recibido</Th><Th>Fichada</Th><Th>Evento</Th><Th>Reloj</Th><Th>DNI</Th><Th>Nombre</Th><Th>Audio</Th></tr></thead>
          <tbody>
            {eventos.map((ev) => {
              const device = dispositivos.find(d => d.sn === ev.sn);
              const audio = archivos.find(a => a.id === ev.audioId);
              return (
                <tr key={ev.id} style={S.bodyRow}>
                  <Td>{ev.ts.slice(0, 19).replace('T', ' ')}</Td>
                  <Td>{ev.checktime?.slice(0, 19)}</Td>
                  <Td>{ev.evento}</Td>
                  <Td>{device?.alias || ev.sn}</Td>
                  <Td>{ev.dni}</Td>
                  <Td>{ev.nombre || '-'}</Td>
                  <Td>{audio?.nombre || (ev.audioId ? ev.audioId : 'Sin regla')}</Td>
                </tr>
              );
            })}
            {!eventos.length && <EmptyRow text="Sin eventos de audio registrados." cols={7} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ComunicacionSection
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ComunicacionSection() {
  const [rows, setRows] = React.useState<AdmsRuntimeEvent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await getAdmsComunicacion()); }
    catch (e: any) { setError(e?.message ?? 'No se pudo cargar comunicacion'); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={S.sectionTitle}>Comunicacion ADMS</div>
            <div style={S.mutedLine}>Ultimos requests recibidos por /iclock en esta instancia.</div>
          </div>
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Leyendo...' : 'Actualizar'}</button>
        </div>
      </div>
      {error && <div style={S.errorBox}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr style={S.headRow}><Th>Fecha</Th><Th>OK</Th><Th>Reloj</Th><Th>Endpoint</Th><Th>IP</Th><Th>Detalle</Th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.ts}-${i}`} style={S.bodyRow}>
                <Td>{r.ts.slice(0, 19).replace('T', ' ')}</Td>
                <Td><span style={{ ...S.badge, background: r.ok ? '#dcfce7' : '#fee2e2', color: r.ok ? '#15803d' : '#b91c1c' }}>{r.ok ? 'OK' : 'ERR'}</span></Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.sn}</Td>
                <Td>{r.method} {r.endpoint}</Td>
                <Td>{r.ip || '-'}</Td>
                <Td>{r.detail}</Td>
              </tr>
            ))}
            {!rows.length && <EmptyRow text="Sin comunicacion registrada en memoria." cols={6} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Shared UI primitives
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BackupSection(props: { dispositivos: AdmsDispositivo[] }) {
  const [sn, setSn] = React.useState('');
  const [loading, setLoading] = React.useState<'datos' | 'sistema' | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function descargar(tipo: 'datos' | 'sistema') {
    if (!sn) { setMsg('Seleccioná un reloj.'); return; }
    setLoading(tipo);
    setMsg(null);
    try {
      await downloadAdmsBackup(sn, tipo);
      setMsg(`Backup "${tipo}" descargado correctamente.`);
    } catch (e: any) {
      setMsg(e?.message ?? 'No se pudo descargar el backup');
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={S.sectionTitle}>Backup del aparato</div>
        <div style={S.mutedLine}>Descarga el archivo de backup directamente desde el reloj (equivalente al backup por USB).</div>
      </div>
      <div style={{ ...S.section, paddingBottom: 14 }}>
        <div style={{ ...S.simpleFilter, marginBottom: 14 }}>
          <Field label="Reloj" id="backup-sn">
            <select id="backup-sn" style={S.input} value={sn} onChange={(e) => setSn(e.target.value)}>
              <option value="">-- Seleccionar reloj --</option>
              {props.dispositivos.map((d) => (
                <option key={d.sn} value={d.sn}>{d.alias || d.sn}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" type="button" disabled={!!loading || !sn} onClick={() => descargar('datos')}>
            {loading === 'datos' ? 'Descargando...' : 'Backup usuarios y huellas (data.dat)'}
          </button>
          <button className="btn secondary" type="button" disabled={!!loading || !sn} onClick={() => descargar('sistema')}>
            {loading === 'sistema' ? 'Descargando...' : 'Backup sistema / config (device.dat)'}
          </button>
        </div>
        {msg && <div style={{ ...S.infoBox, marginTop: 12 }}>{msg}</div>}
        <div style={{ ...S.mutedLine, marginTop: 14 }}>
          <strong>data.dat</strong> — usuarios, huellas y plantillas biométricas.<br />
          <strong>device.dat</strong> — configuración del dispositivo.<br />
          Archivos gzip/tar compatibles con la restauración nativa del aparato.
        </div>
      </div>
    </>
  );
}

function DiffTable<T extends { dni: string; nombre: string }>(props: {
  title: string; rows: T[]; empty: string; extra: (row: T) => string;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={S.kicker}>{props.title}</div>
      <table style={S.table}>
        <thead><tr style={S.headRow}><Th>DNI</Th><Th>Nombre</Th><Th>ID ADMS</Th></tr></thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={`${props.title}-${row.dni}`} style={S.bodyRow}>
              <Td>{row.dni}</Td><Td>{row.nombre || '-'}</Td><Td>{props.extra(row)}</Td>
            </tr>
          ))}
          {!props.rows.length && <EmptyRow text={props.empty} cols={3} />}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ text, cols }: { text: string; cols: number }) {
  return (
    <tr>
      <Td style={{ color: '#94a3b8' }}>{text}</Td>
      {Array.from({ length: cols - 1 }).map((_, i) => <Td key={i}> </Td>)}
    </tr>
  );
}

function commandStateStyle(estado: AdmsComando['estado']): React.CSSProperties {
  if (estado === 'finalizado') return { background: '#dcfce7', color: '#15803d' };
  if (estado === 'enviado') return { background: '#dbeafe', color: '#1d4ed8' };
  if (estado === 'error') return { background: '#fee2e2', color: '#b91c1c' };
  if (estado === 'vencido') return { background: '#ffedd5', color: '#c2410c' };
  return { background: '#fef3c7', color: '#92400e' };
}

function NumCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={S.card}>
      <span style={S.cardLabel}>{label}</span>
      <span style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...S.card, minWidth: 160 }}>
      <span style={S.cardLabel}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{value}</span>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={id} style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>{label}</label>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '7px 12px', color: '#374151', verticalAlign: 'middle', ...style }}>{children}</td>;
}

const S = {
  section: { marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #e2e8f0' } as React.CSSProperties,
  sectionTitle: { fontSize: '0.9rem', fontWeight: 700, color: '#374151', margin: '0 0 14px 0' } as React.CSSProperties,
  cards: { display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 20 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 20px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  cardLabel: { fontSize: '0.72rem', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#6b7280' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 } as React.CSSProperties,
  kicker: { fontSize: '0.72rem', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#6b7280', marginBottom: 8 },
  input: { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: '0.88rem', boxSizing: 'border-box' as const },
  filterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, alignItems: 'end' } as React.CSSProperties,
  simpleFilter: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'end' } as React.CSSProperties,
  actionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' } as React.CSSProperties,
  checkLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#374151' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '0.85rem' },
  headRow: { background: '#f8fafc', borderBottom: '2px solid #e2e8f0' } as React.CSSProperties,
  bodyRow: { borderBottom: '1px solid #e2e8f0' } as React.CSSProperties,
  mutedLine: { marginTop: 8, fontSize: '0.78rem', color: '#64748b' } as React.CSSProperties,
  segmented: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' as const } as React.CSSProperties,
  segmentButton: { padding: '7px 14px', border: 'none', background: 'transparent', color: '#64748b', borderBottom: '2px solid transparent', cursor: 'pointer', marginBottom: -1 } as React.CSSProperties,
  segmentButtonActive: { color: '#2563eb', borderBottomColor: '#2563eb', fontWeight: 700 } as React.CSSProperties,
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', color: '#b91c1c', fontSize: '0.86rem', marginBottom: 16 } as React.CSSProperties,
  infoBox: { background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 6, padding: '10px 14px', color: '#1d4ed8', fontSize: '0.86rem', marginBottom: 16 } as React.CSSProperties,
};

// src/pages/ReportesPage/WhatsappAutomatico.tsx
// Pestaña WhatsApp de Reportes: conteo AUTOMÁTICO de mensajes recibidos (la extensión de Chrome lee
// el WhatsApp Web abierto) + descarga/guía de la extensión. Reusa los componentes de
// LicenciasMedicasControlPage. Lo leído se vuelca solo (API) a la carga de abajo (consultas_whatsapp):
// cantidad = personas del día, sin pisar lo cargado a mano.
import { useCallback, useEffect, useState } from 'react';
import { aExtension } from '../LicenciasMedicasControlPage/WhatsappTab';
import { RecibidosWhatsapp } from '../LicenciasMedicasControlPage/RecibidosWhatsapp';
import { ExtensionDescarga, NAV, hayVersionNueva, useVersionPublicada } from '../LicenciasMedicasControlPage/ExtensionDescarga';

const BTN = { padding: '1px 8px', fontSize: '0.75rem' } as const;
const sinExtension = async () => ({ ok: false, estado: 'ERROR', detalle: `Falta instalar la extensión de WhatsApp en este ${NAV.nombre}` });

export function WhatsappAutomatico({ onLeido }: { onLeido?: () => void } = {}) {
  const [ext, setExt] = useState<string | null | undefined>(undefined); // undefined = verificando
  const detectar = useCallback(async () => {
    const r = await aExtension('PING', undefined, 1500);
    setExt(r.ok ? (r.version || '?') : null);
  }, []);
  useEffect(() => { void detectar(); }, [detectar]);
  const publicada = useVersionPublicada();
  const vieja = hayVersionNueva(ext, publicada);
  const [verDescarga, setVerDescarga] = useState(false);

  return (
    <div>
      <div className="card" style={{
        padding: '10px 14px', marginBottom: 12,
        background: ext && !vieja ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
        border: `1px solid ${ext && !vieja ? 'rgba(34,197,94,0.35)' : 'rgba(234,179,8,0.35)'}`,
      }}>
        {ext === undefined ? 'Verificando la extensión de WhatsApp…'
          : ext ? <>✅ <b>Extensión de WhatsApp instalada</b> (v{ext}). Tené WhatsApp Web abierto en este {NAV.nombre} para leer los mensajes.{' '}
              {vieja
                ? <button type="button" className="btn" style={{ ...BTN, background: 'rgba(234,179,8,0.3)', fontWeight: 700 }} onClick={() => setVerDescarga(true)}>🔄 Hay versión nueva (v{publicada}): actualizar</button>
                : !verDescarga && <button type="button" className="btn" style={BTN} onClick={() => setVerDescarga(true)}>🧩 Descargar / instalar en otra PC</button>}</>
          : <>⚠️ <b>Extensión de WhatsApp no instalada</b> en este {NAV.nombre}: sin ella no se pueden contar los mensajes automáticamente.{' '}
              <button type="button" className="btn" style={{ ...BTN, fontWeight: 700 }} onClick={() => setVerDescarga(true)}>🧩 Descargar e instalar la extensión</button>{' '}
              y después <button type="button" className="btn" style={BTN} onClick={detectar}>Volver a verificar</button></>}
      </div>

      {verDescarga && <ExtensionDescarga instalada={ext} publicada={publicada} onCerrar={() => setVerDescarga(false)} />}

      {/* Sin extensión se puede ver lo ya guardado; "Leer WhatsApp ahora" avisa que falta la extensión */}
      {ext !== undefined && <RecibidosWhatsapp pedirExtension={ext ? aExtension : sinExtension} onLeido={onLeido} />}
    </div>
  );
}

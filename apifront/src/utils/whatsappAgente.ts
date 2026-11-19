// src/utils/whatsappAgente.ts
// Deja escrito un mensaje en el chat de WhatsApp Web de un agente (el Enviar lo toca la persona).
// Misma lógica que AgendaTurnoBlock: con la extensión ≥ 1.8.0 busca el chat por nombre (y si no por celular);
// sin extensión, o con una vieja, abre el chat por teléfono con el texto.
import { aExtension } from '../pages/LicenciasMedicasControlPage/WhatsappTab';
import { copiarTexto } from './abrirCarpeta';

const EXT_MIN = '1.8.0';
const verMayorIgual = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return true;
};
const palabrasDe = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/).filter(w => w.length > 1);

type Toast = { ok: (t: string, m?: string) => void; warning: (t: string, m?: string) => void; error: (t: string, m?: string) => void };

export async function copiarConAviso(toast: Toast, texto: string, que: string) {
  if (await copiarTexto(texto)) toast.ok('Copiado', que);
  else window.prompt('Copiá el texto:', texto);
}

export async function escribirWhatsapp(
  toast: Toast, agente: { apellido: string; nombre: string; celular: string | null }, texto: string,
): Promise<void> {
  const porTelefono = () => {
    if (!agente.celular) { toast.warning('Sin celular', 'No tiene celular en la base: copiá el mensaje y mandalo a mano.'); return; }
    window.open(`https://web.whatsapp.com/send?phone=${agente.celular}&text=${encodeURIComponent(texto)}`, 'whatsapp');
  };
  const ping = await aExtension('PING', undefined, 1500).catch(() => ({ ok: false } as any));
  if (!ping.ok || !ping.version || !verMayorIgual(ping.version, EXT_MIN)) {
    if (ping.ok) toast.warning('Extensión vieja', `Tenés la ${ping.version}: se abre por teléfono.`);
    porTelefono();
    return;
  }
  const ape = palabrasDe(agente.apellido), nom = palabrasDe(agente.nombre);
  const r = await aExtension('ENVIAR', {
    modo: 'NOMBRE_TELEFONO', buscar: ape[0] || '', palabras: [ape[0], nom[0]].filter(Boolean),
    telefono: agente.celular, texto, sinEnviar: true,
  }, 150000);
  if (r.ok) toast.ok('Mensaje escrito en WhatsApp', `Chat de ${r.destino || 'el agente'}: revisalo y tocá Enviar.`);
  else {
    toast.warning('No se pudo abrir el chat', r.detalle || r.estado);
    if (r.estado === 'NO_ENCONTRADO' || r.estado === 'SIN_WHATSAPP') void copiarConAviso(toast, texto, 'Mensaje (mandalo a mano)');
  }
}

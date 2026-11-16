// src/services/whatsappWebhook.ts
// Lo ÚNICO del bot de WhatsApp que corre en el servidor público (expuesto a internet por el túnel).
// No ve agentes, DNI, pedidos ni chats: verifica que el pedido venga de Meta y ANOTA el cuerpo crudo en
// la bandeja `whatsapp_bot_entrada`. La API interna (red del hospital) la lee cada 2 s y hace todo lo demás
// (services/whatsappBot.ts → procesarBandeja).
//
// Con el usuario de MySQL de permisos mínimos (PUBLICO_DB_USER) solo puede:
//   SELECT en la vista v_publico_wa_claves (clave secreta de la app + token de verificación)
//   INSERT (cuerpo) en whatsapp_bot_entrada — ni siquiera puede leer lo que anotó.

import crypto from 'crypto';
import { Sequelize, QueryTypes } from 'sequelize';

type Claves = { appSecret: string; verifyToken: string };
const cache = new WeakMap<Sequelize, { hasta: number; claves: Claves }>();

/** Clave secreta de la app y token de verificación (página del bot; si están vacíos, el .env). Cache 20 s. */
async function claves(sequelize: Sequelize): Promise<Claves> {
  const hit = cache.get(sequelize);
  if (hit && hit.hasta > Date.now()) return hit.claves;
  const rows = await sequelize.query<any>(`SELECT k, valor FROM v_publico_wa_claves`, { type: QueryTypes.SELECT });
  const v = (k: string) => String(rows.find((r: any) => r.k === k)?.valor ?? '').trim();
  const c: Claves = {
    appSecret: v('wa_app_secret') || process.env.WA_APP_SECRET || '',
    verifyToken: v('wa_verify_token') || process.env.WA_VERIFY_TOKEN || '',
  };
  cache.set(sequelize, { hasta: Date.now() + 20_000, claves: c });
  return c;
}

/** GET de verificación que hace Meta al configurar el webhook. Devuelve el challenge o null. */
export async function verificarSuscripcion(sequelize: Sequelize, q: any): Promise<string | null> {
  const { verifyToken } = await claves(sequelize);
  if (!verifyToken) return null;
  const dado = String(q?.['hub.verify_token'] ?? '');
  const iguales = dado.length === verifyToken.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(verifyToken));
  if (q?.['hub.mode'] === 'subscribe' && iguales) return String(q['hub.challenge'] ?? '').slice(0, 200);
  return null;
}

/** Firma X-Hub-Signature-256 = sha256=HMAC(App Secret, cuerpo crudo). Sin clave cargada rechaza todo. */
export async function firmaValida(sequelize: Sequelize, raw: Buffer, header: string | undefined): Promise<boolean> {
  const { appSecret } = await claves(sequelize);
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const esperado = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const recibido = header.slice(7);
  return recibido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

/** Anota el cuerpo (ya validado) en la bandeja. Si falla, el webhook responde 500 y Meta reintenta. */
export async function anotarEntrada(sequelize: Sequelize, raw: Buffer): Promise<void> {
  await sequelize.query(`INSERT INTO whatsapp_bot_entrada (cuerpo) VALUES (:c)`, { replacements: { c: raw.toString('utf8') } });
}

// src/webhooks/emitters.ts
import { Sequelize } from 'sequelize';
import { enqueueWebhook } from './queue';
import { WebhookEvent } from './types';

let sequelizeInstance: Sequelize | null = null;

export function initWebhookEmitter(sequelize: Sequelize) {
  sequelizeInstance = sequelize;
}

// ============================================
// EMITTERS PARA CADA MÓDULO
// ============================================

export async function emitPedidoCreated(dni: number, pedido: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'pedidos.created',
    { dni, pedido },
    actor
  );
}

export async function emitPedidoUpdated(dni: number, pedido: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'pedidos.updated',
    { dni, pedido },
    actor
  );
}

export async function emitPedidoDeleted(dni: number, pedidoId: number, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'pedidos.deleted',
    { dni, pedido_id: pedidoId },
    actor
  );
}

export async function emitDocumentoUploaded(dni: number, documento: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'documentos.uploaded',
    { dni, documento },
    actor
  );
}

export async function emitDocumentoDeleted(dni: number, documentoId: number, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'documentos.deleted',
    { dni, documento_id: documentoId },
    actor
  );
}

export async function emitEventoCreated(dni: number, evento: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'eventos.created',
    { dni, evento },
    actor
  );
}

export async function emitEventoUpdated(dni: number, evento: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'eventos.updated',
    { dni, evento },
    actor
  );
}

export async function emitEventoDeleted(dni: number, eventoId: number, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'eventos.deleted',
    { dni, evento_id: eventoId },
    actor
  );
}

export async function emitCertificadoGenerated(dni: number, certificado: any, actor?: any) {
  if (!sequelizeInstance) return;
  await enqueueWebhook(
    sequelizeInstance,
    'certificados.generated',
    { dni, certificado },
    actor
  );
}
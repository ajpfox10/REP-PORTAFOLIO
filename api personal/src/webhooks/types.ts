// src/webhooks/types.ts
export type WebhookEvent = 
  | 'pedidos.created'
  | 'pedidos.updated'
  | 'pedidos.deleted'
  | 'documentos.uploaded'
  | 'documentos.deleted'
  | 'eventos.created'
  | 'eventos.updated'
  | 'eventos.deleted'
  | 'certificados.generated';

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  created_at: string;
  data: any;
  actor?: {
    id?: number;
    type?: string;
  };
}

export interface WebhookConfig {
  id: number;
  nombre: string;
  url: string;
  secret: string;
  eventos: WebhookEvent[];
  estado: 'activo' | 'inactivo' | 'eliminado';
  timeout_ms: number;
  retry_policy: {
    max_attempts: number;
    backoff_ms: number;
  };
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  evento: WebhookEvent;
  payload: any;
  response_status?: number;
  error?: string;
  attempts: number;
  duration_ms?: number;
  created_at: Date;
}
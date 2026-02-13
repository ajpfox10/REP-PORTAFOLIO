// src/webhooks/signature.ts
import crypto from 'crypto';

/**
 * Genera firma HMAC-SHA256 para un payload
 */
export function generateSignature(payload: any, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  hmac.update(data);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verifica que la firma sea válida
 */
export function verifySignature(
  payload: any, 
  secret: string, 
  signature: string
): boolean {
  const expected = generateSignature(payload, secret);
  
  // Comparación segura contra timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Genera headers para webhook saliente
 */
export function generateWebhookHeaders(
  payload: any,
  secret: string,
  event: string,
  webhookId: number
): Record<string, string> {
  const signature = generateSignature(payload, secret);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Timestamp': timestamp,
    'X-Webhook-Event': event,
    'X-Webhook-ID': webhookId.toString(),
    'User-Agent': 'PersonalV5-Webhook/1.0'
  };
}
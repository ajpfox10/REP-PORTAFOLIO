'use strict';

/**
 * shared/ai.js
 * Adaptador unificado para proveedores de IA.
 * Soporta: openai (GPT-4o), anthropic (Claude), mock (tests/dev sin clave).
 */

const PROVIDER = process.env.AI_PROVIDER || 'openai';
const DEFAULT_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1024', 10);
const HARD_MAX_TOKENS = parseInt(process.env.AI_HARD_MAX_TOKENS || '4096', 10);

// SEC: máximo de caracteres permitidos en un prompt para evitar context stuffing
const MAX_PROMPT_CHARS = parseInt(process.env.AI_MAX_PROMPT_CHARS || '8000', 10);
const { getBreaker } = require('./circuitBreaker');
const { getSecret } = require('./secrets');
const aiBreaker = getBreaker('openai', {
  threshold: parseInt(process.env.AI_CIRCUIT_THRESHOLD || process.env.CIRCUIT_THRESHOLD || '5'),
  timeout: parseInt(process.env.AI_CIRCUIT_TIMEOUT_MS || process.env.CIRCUIT_TIMEOUT_MS || '30000'),
  successReq: parseInt(process.env.AI_CIRCUIT_SUCCESS || process.env.CIRCUIT_SUCCESS || '2'),
});

// ─── HTTP helper ──────────────────────────────────────────────────────────────
// OT-076/OT-077: replaced manual https.request implementation with global fetch +
// AbortSignal.timeout for cleaner async/await and built-in timeout support.

const AI_HTTP_TIMEOUT_MS = parseInt(process.env.AI_HTTP_TIMEOUT_MS || '30000', 10);

// SEC: lista de hostnames permitidos para analyzeImage con URL externa.
// Evita SSRF al llamar al LLM con URLs arbitrarias controladas por el usuario.
const ALLOWED_IMAGE_HOSTS = new Set(
  (process.env.AI_ALLOWED_IMAGE_HOSTS || 'storage.googleapis.com,s3.amazonaws.com')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
);

/**
 * Sanitiza un string de prompt: trunca y elimina marcadores de inyección.
 * Previene prompt-injection desde datos de BD que llegan al LLM.
 */
function sanitizePromptText(text, maxChars = MAX_PROMPT_CHARS) {
  if (text == null) return '';
  // Truncar al máximo permitido
  let safe = String(text).slice(0, maxChars);
  // SEC: eliminar caracteres de control ASCII (U+0000–U+001F y U+007F) que pueden
  // usarse para prompt injection o para inyectar instrucciones ocultas al LLM.
  // El regex anterior era incorrecto (rango mal formado eliminaba caracteres imprimibles
  // en lugar de los caracteres de control reales).
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  return safe;
}

/**
 * Valida que una URL de imagen apunte a un host permitido (anti-SSRF).
 * Solo acepta https:// con hosts en la lista blanca.
 */
function validateImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Image URL must use HTTPS'), { code: 'AI_INVALID_IMAGE_URL', httpStatus: 400 });
    }
    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_IMAGE_HOSTS.has(host)
      || [...ALLOWED_IMAGE_HOSTS].some(h => host.endsWith('.' + h));
    if (!allowed) {
      throw Object.assign(
        new Error(`Image host '${host}' is not in the allowed list`),
        { code: 'AI_SSRF_BLOCKED', httpStatus: 400 }
      );
    }
  } catch (err) {
    if (err.code === 'AI_INVALID_IMAGE_URL' || err.code === 'AI_SSRF_BLOCKED') throw err;
    throw Object.assign(new Error('Invalid image URL'), { code: 'AI_INVALID_IMAGE_URL', httpStatus: 400 });
  }
}

async function _post(hostname, path, extraHeaders, body) {
  const controller = AbortSignal.timeout(AI_HTTP_TIMEOUT_MS);
  const response = await fetch(`https://${hostname}${path}`, {
    method:  'POST',
    signal:  controller,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body:    JSON.stringify(body),
  });
  return response.json();
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

const adapters = {

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  openai: {
    async complete(messages, opts = {}) {
      const body = {
        model      : opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages,
        max_tokens : Math.min(opts.maxTokens || DEFAULT_MAX_TOKENS, HARD_MAX_TOKENS),
        temperature: opts.temperature ?? 0.3,
      };
      if (opts.json) body.response_format = { type: 'json_object' };

      const res = await _post(
        'api.openai.com', '/v1/chat/completions',
        { Authorization: `Bearer ${getSecret('OPENAI_API_KEY', { defaultValue: '' })}` },
        body
      );
      if (res.error) throw Object.assign(new Error(res.error.message), { code: 'AI_API_ERROR', provider: 'openai' });
      return res.choices[0].message.content;
    },

    async analyzeImage(base64OrUrl, prompt, opts = {}) {
      // SEC: validar URL externa para evitar SSRF — solo hosts permitidos vía HTTPS
      if (base64OrUrl.startsWith('http')) validateImageUrl(base64OrUrl);
      const imgContent = base64OrUrl.startsWith('http')
        ? { type: 'image_url', image_url: { url: base64OrUrl, detail: 'high' } }
        : { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64OrUrl}`, detail: 'high' } };

      const res = await _post(
        'api.openai.com', '/v1/chat/completions',
        { Authorization: `Bearer ${getSecret('OPENAI_API_KEY', { defaultValue: '' })}` },
        {
          model     : opts.model || process.env.OPENAI_VISION_MODEL || 'gpt-4o',
          messages  : [{ role: 'user', content: [imgContent, { type: 'text', text: prompt }] }],
          max_tokens: Math.min(opts.maxTokens || 1024, HARD_MAX_TOKENS),
        }
      );
      if (res.error) throw Object.assign(new Error(res.error.message), { code: 'AI_API_ERROR', provider: 'openai' });
      return res.choices[0].message.content;
    },

    async embedText(text) {
      const res = await _post(
        'api.openai.com', '/v1/embeddings',
        { Authorization: `Bearer ${getSecret('OPENAI_API_KEY', { defaultValue: '' })}` },
        { model: 'text-embedding-3-small', input: text.slice(0, 8192) }
      );
      if (res.error) throw Object.assign(new Error(res.error.message), { code: 'AI_API_ERROR', provider: 'openai' });
      return res.data[0].embedding;
    },
  },

  // ── Anthropic ────────────────────────────────────────────────────────────────
  anthropic: {
    async complete(messages, opts = {}) {
      const system   = messages.find(m => m.role === 'system')?.content || '';
      const filtered = messages.filter(m => m.role !== 'system');
      const body = {
        model     : opts.model || process.env.ANTHROPIC_MODEL || 'claude-haiku-20240307',
        max_tokens: Math.min(opts.maxTokens || DEFAULT_MAX_TOKENS, HARD_MAX_TOKENS),
        messages  : filtered,
      };
      if (system) body.system = system;

      const res = await _post(
        'api.anthropic.com', '/v1/messages',
        { 'x-api-key': getSecret('ANTHROPIC_API_KEY', { defaultValue: '' }), 'anthropic-version': '2023-06-01' },
        body
      );
      if (res.type === 'error') throw Object.assign(new Error(res.error?.message || 'Anthropic error'), { code: 'AI_API_ERROR', provider: 'anthropic' });
      return res.content[0].text;
    },

    async analyzeImage(base64OrUrl, prompt, opts = {}) {
      // SEC: validar URL externa para evitar SSRF — solo hosts permitidos vía HTTPS
      if (base64OrUrl.startsWith('http')) validateImageUrl(base64OrUrl);
      const imgSource = base64OrUrl.startsWith('http')
        ? { type: 'url', url: base64OrUrl }
        : { type: 'base64', media_type: opts.mimeType || 'image/jpeg', data: base64OrUrl };

      const res = await _post(
        'api.anthropic.com', '/v1/messages',
        { 'x-api-key': getSecret('ANTHROPIC_API_KEY', { defaultValue: '' }), 'anthropic-version': '2023-06-01' },
        {
          model     : opts.model || process.env.ANTHROPIC_VISION_MODEL || 'claude-opus-4-5',
          max_tokens: Math.min(opts.maxTokens || 1024, HARD_MAX_TOKENS),
          messages  : [{
            role   : 'user',
            content: [
              { type: 'image', source: imgSource },
              { type: 'text',  text: prompt },
            ],
          }],
        }
      );
      if (res.type === 'error') throw Object.assign(new Error(res.error?.message || 'Anthropic error'), { code: 'AI_API_ERROR', provider: 'anthropic' });
      return res.content[0].text;
    },

    async embedText() {
      throw Object.assign(new Error('Embeddings no soportados en Anthropic'), { code: 'NOT_SUPPORTED' });
    },
  },

  // ── Mock (tests y dev sin clave) ─────────────────────────────────────────────
  mock: {
    async complete(messages, opts = {}) {
      const last = messages[messages.length - 1]?.content || '';
      if (opts.json) return JSON.stringify({ mock: true, input: last.slice(0, 80) });
      return `[MOCK] ${last.slice(0, 80)}`;
    },
    async analyzeImage(_src, prompt) {
      return `[MOCK-VISION] ${prompt.slice(0, 80)}`;
    },
    async embedText(text) {
      const vec = new Array(1536).fill(0);
      vec[0] = (text.length % 1000) / 1000;
      return vec;
    },
  },
};

// ─── Public API ────────────────────────────────────────────────────────────────

function getAdapter() {
  const a = adapters[PROVIDER];
  if (!a) throw Object.assign(new Error(`Proveedor IA desconocido: ${PROVIDER}`), { code: 'UNKNOWN_PROVIDER' });
  return a;
}

/**
 * Genera una respuesta de chat.
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [opts] — model, maxTokens, temperature, json, skipSanitize
 * @returns {Promise<string>}
 */
async function complete(messages, opts = {}) {
  // SEC: sanitizar mensajes de usuario para prevenir prompt injection.
  // Solo se sanitizan roles 'user' y 'function'; los mensajes 'system' los controla el código
  // del servidor y no deben truncarse. Para desactivar (e.g. en tests): opts.skipSanitize=true
  if (!opts.skipSanitize) {
    messages = messages.map(m => {
      if (m.role === 'user' || m.role === 'function') {
        return { ...m, content: sanitizePromptText(m.content) };
      }
      return m;
    });
  }
  if (!aiBreaker.canRequest()) {
    throw Object.assign(new Error('AI provider temporarily unavailable'), { code: 'AI_CIRCUIT_OPEN' });
  }
  try {
    const result = await getAdapter().complete(messages, opts);
    aiBreaker.onSuccess();
    return result;
  } catch (err) {
    aiBreaker.onFailure();
    throw err;
  }
}

/**
 * Analiza una imagen médica.
 * @param {string} base64OrUrl — base64 data o URL pública
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
async function analyzeImage(base64OrUrl, prompt, opts = {}) {
  if (!aiBreaker.canRequest()) {
    throw Object.assign(new Error('AI provider temporarily unavailable'), { code: 'AI_CIRCUIT_OPEN' });
  }
  try {
    const result = await getAdapter().analyzeImage(base64OrUrl, prompt, opts);
    aiBreaker.onSuccess();
    return result;
  } catch (err) {
    aiBreaker.onFailure();
    throw err;
  }
}

/**
 * Genera un embedding de texto para búsqueda semántica / RAG.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  if (!aiBreaker.canRequest()) {
    throw Object.assign(new Error('AI provider temporarily unavailable'), { code: 'AI_CIRCUIT_OPEN' });
  }
  try {
    const result = await getAdapter().embedText(text);
    aiBreaker.onSuccess();
    return result;
  } catch (err) {
    aiBreaker.onFailure();
    throw err;
  }
}

module.exports = { complete, analyzeImage, embedText, PROVIDER, adapters, sanitizePromptText };

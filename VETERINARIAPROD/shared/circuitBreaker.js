'use strict';

/**
 * Circuit Breaker — protects downstream services from cascade failures.
 *
 * States:
 *   CLOSED    — normal operation, requests pass through
 *   OPEN      — service failing, requests rejected immediately (503)
 *   HALF_OPEN — timeout elapsed, one probe request allowed through
 *
 * Config (env or per-instance opts):
 *   CIRCUIT_THRESHOLD  — consecutive failures to open  (default 5)
 *   CIRCUIT_TIMEOUT_MS — ms to wait before half-open   (default 30000)
 *   CIRCUIT_SUCCESS    — successes to close from half-open (default 2)
 */

const CLOSED    = 'CLOSED';
const OPEN      = 'OPEN';
const HALF_OPEN = 'HALF_OPEN';

const DEFAULT_THRESHOLD = parseInt(process.env.CIRCUIT_THRESHOLD  || '5');
const DEFAULT_TIMEOUT   = parseInt(process.env.CIRCUIT_TIMEOUT_MS || '30000');
const DEFAULT_SUCCESS   = parseInt(process.env.CIRCUIT_SUCCESS    || '2');

// ── Prometheus metrics (lazy — skipped if prom-client not installed) ───────────
let _stateTransitions, _rejectedRequests, _stateGauge;
const STATE_VALUE = { [CLOSED]: 0, [OPEN]: 1, [HALF_OPEN]: 2 };

try {
  const prom = require('prom-client');
  _stateTransitions = new prom.Counter({
    name:       'circuit_breaker_state_transitions_total',
    help:       'Number of circuit breaker state transitions',
    labelNames: ['service', 'from', 'to'],
  });
  _rejectedRequests = new prom.Counter({
    name:       'circuit_breaker_rejected_requests_total',
    help:       'Requests rejected because the circuit is OPEN',
    labelNames: ['service'],
  });
  _stateGauge = new prom.Gauge({
    name:       'circuit_breaker_state',
    help:       'Current circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
    labelNames: ['service'],
  });
} catch { /* prom-client optional */ }

class CircuitBreaker {
  constructor(name, opts = {}) {
    this.name       = name;
    this.threshold  = opts.threshold  != null ? opts.threshold  : DEFAULT_THRESHOLD;
    this.timeout    = opts.timeout    != null ? opts.timeout    : DEFAULT_TIMEOUT;
    this.successReq = opts.successReq != null ? opts.successReq : DEFAULT_SUCCESS;

    this._state     = CLOSED;
    this._failures  = 0;
    this._successes = 0;
    this._openedAt  = null;
    this._probing   = false;   // limita a UNA sonda concurrente en HALF_OPEN
  }

  get state() { return this._state; }

  _transition(to) {
    const from = this._state;
    this._state = to;
    _stateTransitions?.labels(this.name, from, to).inc();
    _stateGauge?.labels(this.name).set(STATE_VALUE[to]);
  }

  /** Returns true if a request should be allowed through. */
  canRequest() {
    if (this._state === CLOSED) return true;

    if (this._state === OPEN) {
      if (Date.now() - this._openedAt >= this.timeout) {
        this._successes = 0;
        this._probing = true;   // esta request es la sonda
        this._transition(HALF_OPEN);
        return true;
      }
      _rejectedRequests?.labels(this.name).inc();
      return false;
    }

    // HALF_OPEN — permitir solo UNA sonda a la vez (el resto se rechaza hasta resolver)
    if (this._probing) {
      _rejectedRequests?.labels(this.name).inc();
      return false;
    }
    this._probing = true;
    return true;
  }

  /** Call after a successful upstream response (status < 500). */
  onSuccess() {
    this._probing = false;   // la sonda se resolvió → permitir la próxima si sigue HALF_OPEN
    if (this._state === HALF_OPEN) {
      this._successes++;
      if (this._successes >= this.successReq) {
        this._failures = 0;
        this._openedAt = null;
        this._transition(CLOSED);
      }
    } else if (this._state === CLOSED) {
      this._failures = 0;
    }
  }

  /** Call after a connection error or 5xx response. */
  onFailure() {
    this._probing = false;
    if (this._state === HALF_OPEN) {
      // Probe failed — reopen immediately
      this._openedAt = Date.now();
      this._transition(OPEN);
      return;
    }

    this._failures++;
    if (this._failures >= this.threshold) {
      this._openedAt = Date.now();
      this._transition(OPEN);
    }
  }

  getStatus() {
    return {
      name:     this.name,
      state:    this._state,
      failures: this._failures,
      openedAt: this._openedAt,
    };
  }
}

// ── Module-level registry (one breaker per downstream service) ─────────────────
const _registry = new Map();

function getBreaker(name, opts) {
  if (!_registry.has(name)) _registry.set(name, new CircuitBreaker(name, opts));
  return _registry.get(name);
}

function getAllStatus() {
  return [..._registry.values()].map(b => b.getStatus());
}

/** Reset all breakers — useful in tests. */
function _resetAll() {
  _registry.clear();
}

module.exports = { CircuitBreaker, getBreaker, getAllStatus, _resetAll, CLOSED, OPEN, HALF_OPEN };

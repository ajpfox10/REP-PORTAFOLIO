'use strict';

const targets = {
  gateway: process.env.SMOKE_GATEWAY_URL || 'http://localhost:4050/health',
  prometheus: process.env.SMOKE_PROMETHEUS_URL || 'http://localhost:9090/-/healthy',
  grafana: process.env.SMOKE_GRAFANA_URL || 'http://localhost:3000/api/health',
  tempo: process.env.SMOKE_TEMPO_URL || 'http://localhost:3200/ready',
};

async function check(name, url, options = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(parseInt(process.env.SMOKE_TIMEOUT_MS || '3000', 10)),
    ...options,
  });
  if (!res.ok) throw new Error(`${name} -> ${res.status}`);
  return { name, url, status: res.status };
}

async function main() {
  const results = [];
  for (const [name, url] of Object.entries(targets)) {
    results.push(await check(name, url));
  }

  const metricsUrl = process.env.SMOKE_METRICS_URL || 'http://localhost:4050/metrics';
  results.push(await check('gateway-metrics', metricsUrl, process.env.SMOKE_METRICS_TOKEN ? {
    headers: { Authorization: `Bearer ${process.env.SMOKE_METRICS_TOKEN}` },
  } : {}));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    error: err.message,
  }, null, 2));
  process.exit(1);
});

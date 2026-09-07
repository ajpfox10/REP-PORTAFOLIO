'use strict';

const scenario = process.argv[2];
const TOXIPROXY = process.env.TOXIPROXY_URL || 'http://localhost:8474';

async function toxiproxy(path, options = {}) {
  const res = await fetch(`${TOXIPROXY}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`Toxiproxy ${path} failed with ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function reset(proxy) {
  const toxics = await toxiproxy(`/proxies/${proxy}/toxics`, { method: 'GET' }).catch(() => []);
  for (const toxic of toxics || []) {
    await toxiproxy(`/proxies/${proxy}/toxics/${toxic.name}`, { method: 'DELETE' }).catch(() => {});
  }
}

async function main() {
  if (scenario === 'redis-latency') {
    await reset('redis');
    await toxiproxy('/proxies/redis/toxics', {
      method: 'POST',
      body: JSON.stringify({
        name: 'redis-latency',
        type: 'latency',
        stream: 'downstream',
        toxicity: 1,
        attributes: { latency: 1500, jitter: 250 },
      }),
    });
    return console.log('Applied redis-latency');
  }

  if (scenario === 'redis-down') {
    await reset('redis');
    await toxiproxy('/proxies/redis', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    }).catch(() => {});
    return console.log('Applied redis-down');
  }

  if (scenario === 'auth-timeout') {
    await reset('auth');
    await toxiproxy('/proxies/auth/toxics', {
      method: 'POST',
      body: JSON.stringify({
        name: 'auth-timeout',
        type: 'timeout',
        stream: 'downstream',
        toxicity: 1,
        attributes: { timeout: 4000 },
      }),
    });
    return console.log('Applied auth-timeout');
  }

  if (scenario === 'reset') {
    await reset('redis');
    await reset('auth');
    return console.log('Reset toxics');
  }

  throw new Error(`Unknown scenario: ${scenario}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

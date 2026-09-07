'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

const K8S_DIR = path.join(__dirname, '..', '..', 'k8s');

function loadK8sDocs() {
  const docs = [];
  for (const file of fs.readdirSync(K8S_DIR).filter((name) => name.endsWith('.yaml'))) {
    const fullPath = path.join(K8S_DIR, file);
    const text = fs.readFileSync(fullPath, 'utf8');
    for (const part of text.split(/^---\s*$/m)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      docs.push({ file, doc: YAML.parse(trimmed) });
    }
  }
  return docs;
}

describe('Kubernetes manifests', () => {
  test('gateway service targets resolve to declared Kubernetes Services', () => {
    const docs = loadK8sDocs();
    const services = new Map(
      docs
        .filter(({ doc }) => doc?.kind === 'Service')
        .map(({ doc }) => [doc.metadata.name, doc.spec.ports.map((port) => Number(port.port))]),
    );
    const gateway = docs.find(({ doc }) => doc?.kind === 'Deployment' && doc.metadata.name === 'vetmanager-gateway')?.doc;

    expect(gateway).toBeTruthy();
    const env = gateway.spec.template.spec.containers[0].env || [];
    const targets = env.filter((item) => /^SERVICE_/.test(item.name) && /^http:\/\/vetmanager-/.test(item.value));

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const url = new URL(target.value);
      expect(services.get(url.hostname)).toContain(Number(url.port));
    }
  });

  test('Services target declared workload container ports', () => {
    const docs = loadK8sDocs();
    const workloads = docs
      .filter(({ doc }) => ['Deployment', 'StatefulSet'].includes(doc?.kind))
      .map(({ doc }) => doc);

    for (const { doc: service } of docs.filter(({ doc }) => doc?.kind === 'Service')) {
      const selector = service.spec.selector || {};
      const workload = workloads.find((candidate) => {
        const labels = candidate.spec.template.metadata.labels || {};
        return Object.entries(selector).every(([key, value]) => labels[key] === value);
      });

      expect(workload).toBeTruthy();
      const containerPorts = workload.spec.template.spec.containers
        .flatMap((container) => container.ports || [])
        .map((port) => Number(port.containerPort));

      for (const port of service.spec.ports || []) {
        expect(containerPorts).toContain(Number(port.targetPort));
      }
    }
  });

  test('application deployments load shared ConfigMap and Secret', () => {
    const docs = loadK8sDocs();
    const deployments = docs.filter(({ doc }) => doc?.kind === 'Deployment');

    for (const { doc: deployment } of deployments) {
      const container = deployment.spec.template.spec.containers[0];
      const refs = container.envFrom || [];
      expect(refs).toEqual(expect.arrayContaining([
        { configMapRef: { name: 'vetmanager-config' } },
        { secretRef: { name: 'vetmanager-secrets' } },
      ]));
    }
  });

  test('secret template defines the Secret consumed by deployments', () => {
    const secret = YAML.parse(fs.readFileSync(path.join(K8S_DIR, 'secrets.example'), 'utf8'));

    expect(secret.kind).toBe('Secret');
    expect(secret.metadata.name).toBe('vetmanager-secrets');
    expect(secret.stringData).toEqual(expect.objectContaining({
      MYSQL_HOST: expect.any(String),
      MYSQL_PASSWORD: expect.any(String),
      REDIS_URL: expect.any(String),
      INTERNAL_SECRET: expect.any(String),
      CSRF_SECRET: expect.any(String),
      FIELD_ENCRYPTION_SECRET: expect.any(String),
      JWT_PRIVATE_KEY: expect.any(String),
      JWT_PUBLIC_KEY: expect.any(String),
    }));
  });
});

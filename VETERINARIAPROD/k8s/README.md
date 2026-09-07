# Kubernetes Probes

Manifiestos base con `livenessProbe` y `readinessProbe` diferenciados.

- `configmap`: defaults no sensibles y service discovery interno
- `secrets.example`: plantilla para crear `vetmanager-secrets` sin commitear secretos reales
- `redis`: Redis persistente in-cluster para revocación JWT, cache y event bus
- `gateway`: `/health/live` y `/health/ready`
- `auth`: `/health/live` y `/health/ready`
- `patients`: `/health/live` y `/health/ready`
- `medical`: `/health/live` y `/health/ready`
- `lab-imaging`: `/health/live` y `/health/ready`
- `billing`: `/health/live` y `/health/ready`
- `telemedicine`: `/health/live` y `/health/ready`
- `grooming`: `/health/live` y `/health/ready`
- `reports`: `/health/live` y `/health/ready`
- `notifications`: `/health/live` y `/health/ready`
- `ai`: `/health/live` y `/health/ready`
- `portal`: `/health/live` y `/health/ready`
- `documents`: `/health/live` y `/health/ready`

Aplicar:

```bash
cp k8s/secrets.example k8s/secrets.yaml
# editar k8s/secrets.yaml con valores reales antes de aplicar
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/
```

`k8s/secrets.yaml` está ignorado por git. Si usás Redis gestionado, cambiá `REDIS_URL` en `vetmanager-secrets` y omití `k8s/redis.yaml`.

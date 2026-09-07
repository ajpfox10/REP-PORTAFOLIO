# DR Runbook — VetManager

> **Última revisión:** 2026-05-22  
> **Owner:** Infra / SRE  
> **Objetivo RTO:** 4 h (completo) · 30 min (failover base de datos solo)  
> **Objetivo RPO:** 1 h (RDS PITR) · 24 h (MinIO — último backup S3)

---

## Índice

1. [Niveles de incidente](#1-niveles-de-incidente)
2. [Contactos de emergencia](#2-contactos-de-emergencia)
3. [Escenario A: Falla RDS (base de datos)](#3-escenario-a-falla-rds)
4. [Escenario B: Falla Redis total](#4-escenario-b-falla-redis-total)
5. [Escenario C: Pérdida de objetos MinIO/S3](#5-escenario-c-pérdida-de-objetos-minios3)
6. [Escenario D: Falla de nodo K8s / cluster completo](#6-escenario-d-falla-de-nodo-k8s)
7. [Escenario E: Compromiso de credenciales](#7-escenario-e-compromiso-de-credenciales)
8. [Restaurar desde backup (procedimiento estándar)](#8-restaurar-desde-backup)
9. [Verificación post-restore](#9-verificación-post-restore)
10. [Cierre y post-mortem](#10-cierre-y-post-mortem)

---

## 1. Niveles de incidente

| Nivel | Criterio | Respuesta inicial |
|-------|----------|-------------------|
| P1 | Plataforma completamente inaccesible | Página de guardia + Slack #incidents inmediato |
| P2 | Servicio crítico degradado (auth, billing, pacientes) | Guardia de turno + 30 min para plan |
| P3 | Servicio no crítico degradado o lentitud | Notificar en business hours |

---

## 2. Contactos de emergencia

- **Slack:** `#incidents` (alertas automáticas vía Alertmanager)  
- **AWS Support:** console.aws.amazon.com → Support → Create case  
- **On-call:** definido en PagerDuty / rotación de guardia del equipo  

---

## 3. Escenario A: Falla RDS

### A.1 Falla temporal (< 5 min)

```bash
# Ver estado de la instancia RDS
aws rds describe-db-instances --db-instance-identifier vetmanager-mysql \
  --query 'DBInstances[0].DBInstanceStatus'

# Los connection pools se reconectan automáticamente al volver el primario.
# Si los servicios siguen en error, reiniciarlos:
kubectl rollout restart deployment -l app.kubernetes.io/part-of=vetmanager
```

### A.2 Failover a réplica de lectura

```bash
# Promover réplica de lectura a primaria
aws rds promote-read-replica --db-instance-identifier vetmanager-mysql-replica

# Esperar que el estado sea "available"
aws rds wait db-instance-available --db-instance-identifier vetmanager-mysql-replica

# Actualizar MYSQL_HOST en el secreto K8s
NEW_HOST=$(aws rds describe-db-instances \
  --db-instance-identifier vetmanager-mysql-replica \
  --query 'DBInstances[0].Endpoint.Address' --output text)
kubectl create secret generic vetmanager-secrets \
  --from-literal=MYSQL_HOST="$NEW_HOST" \
  --dry-run=client -o yaml | kubectl apply -f -

# Reiniciar todos los servicios para usar el nuevo host
kubectl rollout restart deployment --selector app.kubernetes.io/part-of=vetmanager
```

### A.3 Restore PITR (corrupción / borrado accidental)

```bash
# 1. Identificar timestamp objetivo (ISO 8601, UTC)
TARGET_TIME="2026-05-21T18:00:00Z"

# 2. Restaurar a nueva instancia
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier vetmanager-mysql \
  --target-db-instance-identifier vetmanager-mysql-restored \
  --restore-time "$TARGET_TIME" \
  --db-instance-class db.t3.medium \
  --no-multi-az

# 3. Esperar disponibilidad (puede tardar 15-45 min)
aws rds wait db-instance-available --db-instance-identifier vetmanager-mysql-restored

# 4. Validar datos en la instancia restaurada ANTES de apuntar tráfico
mysql -h <restored-endpoint> -u vetmanager_app -p vetmanager \
  -e "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM patients;"

# 5. Apuntar servicios a la instancia restaurada (igual que A.2)
# 6. Programar borrado de instancia original corrupta si corresponde
```

---

## 4. Escenario B: Falla Redis total

Redis Sentinel gestiona la promoción automática. Si el cluster Sentinel falla por completo:

```bash
# Ver estado de los pods Sentinel
kubectl get pods -l app=vetmanager-redis-sentinel

# Forzar re-elección de master
kubectl exec -it vetmanager-redis-sentinel-0 -- \
  redis-cli -p 26379 SENTINEL failover mymaster

# Si el StatefulSet de Redis está completamente caído
kubectl rollout restart statefulset vetmanager-redis

# El sistema funciona en modo degradado con DEPENDENCY_MODE_AUTH_REVOCATION=strict:
# - auth revocation → 503 hasta que Redis vuelva
# Temporalmente cambiar a "lenient" si el downtime es prolongado (> 30 min):
kubectl set env deployment/vetmanager-gateway DEPENDENCY_MODE_AUTH_REVOCATION=lenient
# IMPORTANTE: revertir a "strict" al recuperar Redis:
kubectl set env deployment/vetmanager-gateway DEPENDENCY_MODE_AUTH_REVOCATION=strict
```

---

## 5. Escenario C: Pérdida de objetos MinIO/S3

```bash
# En producción, MINIO_ENDPOINT apunta a S3 directamente.
# La pérdida de objetos se recupera desde el bucket de backup (OT-130).

# 1. Listar backups disponibles
aws s3 ls s3://${MINIO_BACKUP_S3_BUCKET}/ --recursive | tail -20

# 2. Para staging/dev con MinIO K8s, restaurar desde el bucket de backup:
#    a. Reiniciar pod MinIO si solo está caído el proceso
kubectl rollout restart statefulset vetmanager-minio

#    b. Si la PVC se perdió, restaurar contenido desde S3:
kubectl exec -it vetmanager-minio-0 -- sh -c "
  mc alias set s3backup https://s3.amazonaws.com ${AWS_KEY} ${AWS_SECRET}
  mc mirror --preserve s3backup/${MINIO_BACKUP_S3_BUCKET}/ minio/
"
```

---

## 6. Escenario D: Falla de nodo K8s

```bash
# Ver estado de los nodos
kubectl get nodes

# Drenar nodo problemático (los PDBs aseguran minAvailable:1)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Cordon si no se puede drenar (forzar re-schedule)
kubectl cordon <node-name>

# Verificar que los pods se redistribuyeron
kubectl get pods -o wide | grep -v Running

# Agregar nodo de reemplazo (según el cloud provider)
# AWS EKS: el node group autoscaler lo reemplaza automáticamente si está configurado
```

---

## 7. Escenario E: Compromiso de credenciales

> ⚠️ No rotar credentials sin coordinación — ver instrucción "si arranca pero no rotes por ahora credenciales".

Pasos a seguir en orden:
1. **Contener:** revocar la credencial comprometida en la consola del provider (AWS IAM, etc.) antes de rotar.
2. **Evaluar alcance:** revisar CloudTrail / access logs para determinar qué se accedió.
3. **Rotar:** actualizar el secret en K8s y el valor en el servicio externo.
4. **Reiniciar servicios:** `kubectl rollout restart deployment --selector app.kubernetes.io/part-of=vetmanager`
5. **Documentar:** abrir post-mortem inmediatamente.

---

## 8. Restaurar desde backup

### mysqldump completo

```bash
# Descargar el backup más reciente de S3
aws s3 cp \
  "$(aws s3 ls s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX} --recursive \
     | grep '\.sql\.gz$' | sort | tail -1 | awk '{print $4}')" \
  /tmp/backup.sql.gz

# Restaurar (sin drill — producción)
MYSQL_PWD=${DB_PASSWORD} \
  gzip -dc /tmp/backup.sql.gz | \
  mysql -h ${DB_HOST} -u ${DB_USER} vetmanager
```

### Velero PVC restore

```bash
# Listar backups disponibles
velero backup get

# Restaurar PVC específico (ej. Redis data)
velero restore create --from-backup vetmanager-daily-<date> \
  --include-resources persistentvolumeclaims \
  --selector app=vetmanager-redis

# Ver estado del restore
velero restore describe <restore-name>
```

---

## 9. Verificación post-restore

Ejecutar siempre antes de dar por cerrado el incidente:

```bash
# 1. Health checks de todos los servicios
kubectl get pods | grep -v Running
curl -sf https://api.vetmanager.io/health/ready

# 2. Integridad de datos (script estándar)
DB_HOST=<host> DB_USER=vetmanager_app DB_PASSWORD=<pass> \
  scripts/backup/verify-restore.sh

# 3. Smoke test de endpoints críticos
curl -sf https://api.vetmanager.io/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.com","password":"invalid"}' | jq .error.code
# Esperar: "INVALID_CREDENTIALS" (no 5xx)

# 4. Verificar Redis Sentinel
kubectl exec -it vetmanager-redis-sentinel-0 -- \
  redis-cli -p 26379 SENTINEL masters
```

---

## 10. Cierre y post-mortem

- Crear issue en GitHub con label `incident` dentro de las 2 h de resolución.
- Completar template de post-mortem en `docs/postmortems/YYYY-MM-DD-titulo.md`.
- Actualizar este runbook si se descubrió un paso faltante.
- Verificar que el drill mensual de CI (OT-131) sigue pasando.

---

*RTO/RPO son objetivos, no garantías. Actualizar después de cada drill real con los tiempos medidos.*

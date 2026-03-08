import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";
import { withRedisLock } from "../infra/locks/redisLock.js";
import { runTenantMigrations } from "../migrations/runSqlMigrations.js";

export async function provisionTenant(opts: {
  redis: Redis;
  masterPool: Pool;
  tenantAdminPool: Pool;
  subdomain: string;
  plan: string;
  region: string;
  adminEmail?: string;
  adminPassword?: string;
}) {
  const tenantId = nanoid(12);
  const dbName   = `tenant_${opts.subdomain.replace(/[^a-z0-9_]/gi, "_")}`;

  await withRedisLock({
    redis: opts.redis,
    key: `lock:provision:${opts.subdomain}`,
    ttlMs: 120_000,
    fn: async () => {
      await opts.masterPool.query(
        "INSERT INTO tenants (tenant_id, subdomain, db_name, status, plan, region) VALUES (?,?,?,?,?,?)",
        [tenantId, opts.subdomain, dbName, "active", opts.plan, opts.region]
      );

      await opts.tenantAdminPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);

      const mysql = await import("mysql2/promise");
      const cfg: any = (opts.tenantAdminPool as any).config?.connectionConfig ?? {};
      const tenantPool = mysql.createPool({
        host: cfg.host, port: cfg.port, user: cfg.user,
        password: cfg.password, database: dbName,
        waitForConnections: true, connectionLimit: 5,
      });

      // ── 1. Infrastructure tables ─────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          schema_version INT NOT NULL DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      const [smRows] = await tenantPool.query<any[]>("SELECT schema_version FROM schema_meta LIMIT 1");
      if (!smRows?.length) await tenantPool.query("INSERT INTO schema_meta (schema_version) VALUES (1)");

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(255) NOT NULL,
          checksum VARCHAR(128) NOT NULL,
          executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ── 2. Users ─────────────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          tenant_id VARCHAR(64) NOT NULL,
          email VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          roles JSON NOT NULL DEFAULT ('["viewer"]'),
          is_active TINYINT DEFAULT 1,
          token_version INT NOT NULL DEFAULT 0,
          mfa_enabled TINYINT DEFAULT 0,
          totp_secret_enc TEXT NULL,
          locale VARCHAR(8) DEFAULT 'es',
          sucursal_id BIGINT NULL,
          veterinario_id BIGINT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          last_login_at DATETIME NULL,
          UNIQUE KEY uq_tenant_email (tenant_id, email),
          INDEX idx_tenant (tenant_id)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS auth_recovery_codes (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          user_id VARCHAR(36) NOT NULL,
          code_hash VARCHAR(128) NOT NULL,
          used TINYINT NOT NULL DEFAULT 0,
          used_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user (user_id)
        )
      `);

      // ── 3. Domain: sucursales ─────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS sucursales (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          nombre VARCHAR(128) NOT NULL,
          direccion VARCHAR(255) NULL,
          ciudad VARCHAR(128) NULL,
          provincia VARCHAR(64) NULL,
          telefono VARCHAR(32) NULL,
          email VARCHAR(255) NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id)
        )
      `);

      // ── 4. Domain: veterinarios ───────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS veterinarios (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          apellido VARCHAR(128) NOT NULL,
          matricula VARCHAR(64) NULL,
          especialidad VARCHAR(128) NULL,
          email VARCHAR(255) NULL,
          telefono VARCHAR(32) NULL,
          color_agenda VARCHAR(7) NULL COMMENT 'Hex color #RRGGBB',
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_sucursal (sucursal_id)
        )
      `);

      // ── 5. Domain: propietarios ───────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS propietarios (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          nombre VARCHAR(128) NOT NULL,
          apellido VARCHAR(128) NOT NULL,
          email VARCHAR(255) NULL,
          password_hash VARCHAR(255) NULL COMMENT 'Para portal propietario (plan pro)',
          telefono VARCHAR(32) NULL,
          direccion VARCHAR(255) NULL,
          ciudad VARCHAR(128) NULL,
          dni VARCHAR(32) NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_email (tenant_id, email)
        )
      `);

      // ── 6. Domain: pacientes ──────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS pacientes (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          propietario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          especie VARCHAR(64) NOT NULL,
          raza VARCHAR(128) NULL,
          fecha_nacimiento DATE NULL,
          sexo ENUM('M','F','desconocido') DEFAULT 'desconocido',
          peso_kg DECIMAL(6,2) NULL,
          microchip VARCHAR(64) NULL,
          alergias TEXT NULL,
          observaciones TEXT NULL,
          foto_url VARCHAR(512) NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_propietario (propietario_id),
          INDEX idx_microchip (microchip)
        )
      `);

      // ── 7. Domain: turnos ─────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS turnos (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          veterinario_id BIGINT NULL,
          paciente_id BIGINT NULL,
          propietario_id BIGINT NULL,
          fecha_hora DATETIME NOT NULL,
          duracion_min INT NOT NULL DEFAULT 30,
          motivo VARCHAR(255) NULL,
          estado ENUM('pendiente','confirmado','cancelado','completado','no_show') DEFAULT 'pendiente',
          notas TEXT NULL,
          recordatorio_env TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_vet_fecha (veterinario_id, fecha_hora),
          INDEX idx_paciente (paciente_id),
          INDEX idx_recordatorio (tenant_id, recordatorio_env, fecha_hora, estado)
        )
      `);

      // ── 8. Domain: consultas ──────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS consultas (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          turno_id BIGINT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
          motivo TEXT NULL,
          anamnesis TEXT NULL,
          examen_fisico TEXT NULL,
          diagnostico TEXT NULL,
          tratamiento TEXT NULL,
          temperatura DECIMAL(4,1) NULL,
          peso_kg DECIMAL(6,2) NULL,
          frecuencia_cardiaca INT NULL,
          frecuencia_respiratoria INT NULL,
          proxima_consulta DATE NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id),
          INDEX idx_vet (veterinario_id)
        )
      `);

      // ── 9. Domain: vacunas ────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS vacunas (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          laboratorio VARCHAR(128) NULL,
          lote VARCHAR(64) NULL,
          fecha_aplicacion DATE NOT NULL,
          fecha_vencimiento DATE NULL,
          proxima_dosis DATE NULL,
          notas TEXT NULL,
          recordatorio_env TINYINT NOT NULL DEFAULT 0,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id),
          INDEX idx_proxima_recordatorio (tenant_id, proxima_dosis, recordatorio_env)
        )
      `);

      // ── 10. Domain: desparasitaciones ─────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS desparasitaciones (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          tipo ENUM('interna','externa','combinada') NOT NULL DEFAULT 'interna',
          producto VARCHAR(128) NULL,
          dosis VARCHAR(64) NULL,
          fecha DATE NOT NULL,
          proxima_dosis DATE NULL,
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id)
        )
      `);

      // ── 11. Domain: prescripciones ────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS prescripciones (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          consulta_id BIGINT NOT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          medicamento VARCHAR(255) NOT NULL,
          dosis VARCHAR(128) NULL,
          frecuencia VARCHAR(128) NULL,
          duracion VARCHAR(128) NULL,
          via VARCHAR(64) NULL,
          instrucciones TEXT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id),
          INDEX idx_consulta (consulta_id)
        )
      `);

      // ── 12. Domain: internaciones ─────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS internaciones (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          consulta_id BIGINT NULL,
          fecha_ingreso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          fecha_egreso DATETIME NULL,
          motivo TEXT NULL,
          tratamiento TEXT NULL,
          jaula_num VARCHAR(16) NULL,
          estado ENUM('internado','alta','fallecido') NOT NULL DEFAULT 'internado',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id),
          INDEX idx_estado (tenant_id, estado)
        )
      `);

      // ── 13. Domain: productos / inventario ───────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS productos (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          descripcion TEXT NULL,
          categoria VARCHAR(64) NULL,
          precio DECIMAL(10,2) NOT NULL DEFAULT 0,
          stock INT NOT NULL DEFAULT 0,
          stock_minimo INT NOT NULL DEFAULT 5,
          unidad VARCHAR(32) DEFAULT 'unidad',
          is_active TINYINT NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_stock_critico (tenant_id, stock, stock_minimo)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS stock_movimientos (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          producto_id BIGINT NOT NULL,
          tipo ENUM('ingreso','venta','ajuste','devolucion') NOT NULL,
          cantidad INT NOT NULL,
          stock_post INT NOT NULL,
          referencia VARCHAR(128) NULL,
          actor_user_id VARCHAR(64) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant_producto (tenant_id, producto_id),
          INDEX idx_created_at (created_at)
        )
      `);

      // ── 14. Domain: ventas ────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS sales_orders (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          propietario_id BIGINT NULL,
          customer_name VARCHAR(200) NULL,
          total_cents BIGINT NOT NULL DEFAULT 0,
          status VARCHAR(32) NOT NULL DEFAULT 'paid',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(64) NULL,
          INDEX idx_tenant (tenant_id),
          INDEX idx_created_at (created_at)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS sales_order_items (
          id VARCHAR(64) PRIMARY KEY,
          order_id VARCHAR(64) NOT NULL,
          producto_id BIGINT NOT NULL,
          qty INT NOT NULL,
          unit_price_cents BIGINT NOT NULL,
          INDEX idx_order (order_id)
        )
      `);

      // ── 15. Domain: facturación ───────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS facturas (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          propietario_id BIGINT NULL,
          consulta_id BIGINT NULL,
          numero VARCHAR(32) NULL COMMENT 'Formato AFIP: TIPO-PPPP-NNNNNNNN',
          tipo ENUM('A','B','C','X','presupuesto') NOT NULL DEFAULT 'B',
          estado ENUM('borrador','emitida','pagada','anulada') NOT NULL DEFAULT 'borrador',
          subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
          iva_total DECIMAL(12,2) NOT NULL DEFAULT 0,
          total DECIMAL(12,2) NOT NULL DEFAULT 0,
          moneda VARCHAR(3) NOT NULL DEFAULT 'ARS',
          notas TEXT NULL,
          vencimiento DATE NULL,
          emitida_at DATETIME NULL,
          cae VARCHAR(32) NULL COMMENT 'CAE AFIP si está integrado',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_numero (tenant_id, numero),
          INDEX idx_estado (tenant_id, estado)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS factura_items (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          factura_id BIGINT NOT NULL,
          producto_id BIGINT NULL,
          descripcion VARCHAR(255) NOT NULL,
          cantidad DECIMAL(10,3) NOT NULL,
          precio_unitario DECIMAL(10,2) NOT NULL,
          iva_pct DECIMAL(5,2) NOT NULL DEFAULT 21,
          subtotal DECIMAL(12,2) NOT NULL,
          INDEX idx_factura (factura_id)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS factura_numeracion (
          tenant_id VARCHAR(64) NOT NULL,
          tipo VARCHAR(16) NOT NULL,
          punto_venta INT NOT NULL DEFAULT 1,
          ultimo_num INT NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, tipo, punto_venta)
        )
      `);

      // ── 16. Domain: agenda rules ──────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS agenda_rules (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          veterinario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          dia_semana TINYINT NOT NULL COMMENT '0=Dom 1=Lun ... 6=Sab',
          hora_inicio TIME NOT NULL,
          hora_fin TIME NOT NULL,
          duracion_slot_min INT NOT NULL DEFAULT 30,
          is_active TINYINT NOT NULL DEFAULT 1,
          INDEX idx_tenant (tenant_id),
          INDEX idx_vet (veterinario_id)
        )
      `);

      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS agenda_holidays (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          veterinario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          fecha DATE NOT NULL,
          motivo VARCHAR(255) NULL,
          INDEX idx_tenant_fecha (tenant_id, fecha)
        )
      `);

      // ── 17. Portal invite tokens ──────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS portal_invite_tokens (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          email VARCHAR(255) NOT NULL,
          expires_at DATETIME NOT NULL,
          used TINYINT NOT NULL DEFAULT 0,
          created_by VARCHAR(64) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant_email (tenant_id, email)
        )
      `);

      // ── 18. Outbox events ─────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS outbox_events (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          event_type VARCHAR(64) NOT NULL,
          payload_json JSON NOT NULL,
          status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
          attempts INT NOT NULL DEFAULT 0,
          next_run_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant_status (tenant_id, status, next_run_at)
        )
      `);

      // ── 19. Files ─────────────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS files (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          s3_key VARCHAR(512) NOT NULL,
          content_type VARCHAR(128) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          purpose VARCHAR(64) DEFAULT 'general',
          created_by VARCHAR(64) NULL,
          size_bytes BIGINT NULL,
          sha256 CHAR(64) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending_upload',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id)
        )
      `);

      // ── 20. Audit log ─────────────────────────────────────────────────────
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS auditoria_log (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          seq BIGINT NULL COMMENT 'Secuencia para chain verification',
          ts DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          actor_user_id VARCHAR(64) NULL,
          tenant_id VARCHAR(64) NOT NULL,
          action VARCHAR(64) NOT NULL,
          resource VARCHAR(128) NULL,
          resource_id VARCHAR(128) NULL,
          ip VARCHAR(64) NULL,
          user_agent VARCHAR(512) NULL,
          request_id VARCHAR(64) NULL,
          before_json JSON NULL,
          after_json JSON NULL,
          prev_hash VARCHAR(64) NULL,
          hash VARCHAR(64) NULL,
          INDEX idx_tenant_ts (tenant_id, ts),
          INDEX idx_actor (actor_user_id),
          INDEX idx_resource (resource, resource_id),
          INDEX idx_seq (tenant_id, seq)
        )
      `);

      // ── Run versioned SQL migrations ──────────────────────────────────────
      await runTenantMigrations(tenantPool);

      // ── Seed admin user ───────────────────────────────────────────────────
      if (opts.adminEmail && opts.adminPassword) {
        const hash = await bcrypt.hash(opts.adminPassword, 12);
        await tenantPool.query(
          "INSERT INTO users (tenant_id, email, password_hash, roles) VALUES (?,?,?,?)",
          [tenantId, opts.adminEmail.toLowerCase().trim(), hash, JSON.stringify(["admin"])]
        );
      }

      await tenantPool.end();
    },
  });

  return { tenantId, dbName };
}

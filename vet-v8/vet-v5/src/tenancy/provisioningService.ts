import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";
import { withRedisLock } from "../infra/locks/redisLock.js";
import { runTenantMigrations } from "../migrations/runSqlMigrations.js";

/**
 * FIX: Now seeds all core domain tables for a veterinary clinic.
 * Includes: users, pacientes, veterinarios, turnos, consultas, productos, sucursales.
 */
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
  const dbName = `tenant_${opts.subdomain.replace(/[^a-z0-9_]/gi, "_")}`;

  await withRedisLock({
    redis: opts.redis,
    key: `lock:provision:${opts.subdomain}`,
    ttlMs: 60_000,
    fn: async () => {
      await opts.masterPool.query(
        "INSERT INTO tenants (tenant_id, subdomain, db_name, status, plan, region) VALUES (?,?,?,?,?,?)",
        [tenantId, opts.subdomain, dbName, "active", opts.plan, opts.region]
      );

      await opts.tenantAdminPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);

      const mysql = await import("mysql2/promise");
      const cfg: any = (opts.tenantAdminPool as any).config?.connectionConfig ?? {};
      const tenantPool = mysql.createPool({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: dbName
      });

      // --- Infrastructure tables ---
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

      // --- Users ---
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
          last_login_at DATETIME NULL,
          UNIQUE KEY uq_tenant_email (tenant_id, email),
          INDEX idx_tenant (tenant_id)
        )
      `);

      // --- Domain: sucursales ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS sucursales (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          nombre VARCHAR(128) NOT NULL,
          direccion VARCHAR(255),
          telefono VARCHAR(32),
          is_active TINYINT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id)
        )
      `);

      // --- Domain: veterinarios ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS veterinarios (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          apellido VARCHAR(128) NOT NULL,
          matricula VARCHAR(64),
          especialidad VARCHAR(128),
          email VARCHAR(255),
          telefono VARCHAR(32),
          is_active TINYINT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_sucursal (sucursal_id)
        )
      `);

      // --- Domain: pacientes (animales) ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS pacientes (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          owner_user_id VARCHAR(36) NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          especie VARCHAR(64) NOT NULL,
          raza VARCHAR(128),
          fecha_nacimiento DATE,
          sexo ENUM('M','F','desconocido') DEFAULT 'desconocido',
          peso_kg DECIMAL(6,2),
          microchip VARCHAR(64),
          alergias TEXT,
          observaciones TEXT,
          is_active TINYINT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_sucursal (sucursal_id),
          INDEX idx_microchip (microchip)
        )
      `);

      // --- Domain: propietarios ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS propietarios (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          nombre VARCHAR(128) NOT NULL,
          apellido VARCHAR(128) NOT NULL,
          email VARCHAR(255),
          telefono VARCHAR(32),
          direccion VARCHAR(255),
          dni VARCHAR(32),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_email (email)
        )
      `);

      // --- Domain: turnos (agenda) ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS turnos (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          veterinario_id BIGINT NULL,
          paciente_id BIGINT NULL,
          propietario_id BIGINT NULL,
          fecha_hora DATETIME NOT NULL,
          duracion_min INT DEFAULT 30,
          motivo VARCHAR(255),
          estado ENUM('pendiente','confirmado','cancelado','completado') DEFAULT 'pendiente',
          notas TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_vet_fecha (veterinario_id, fecha_hora),
          INDEX idx_paciente (paciente_id)
        )
      `);

      // --- Domain: consultas ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS consultas (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          turno_id BIGINT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          sucursal_id BIGINT NULL,
          fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
          motivo TEXT,
          anamnesis TEXT,
          diagnostico TEXT,
          tratamiento TEXT,
          temperatura DECIMAL(4,1),
          peso_kg DECIMAL(6,2),
          frecuencia_cardiaca INT,
          frecuencia_respiratoria INT,
          proxima_consulta DATE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id),
          INDEX idx_vet (veterinario_id)
        )
      `);

      // --- Domain: vacunas ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS vacunas (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          paciente_id BIGINT NOT NULL,
          veterinario_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          laboratorio VARCHAR(128),
          lote VARCHAR(64),
          fecha_aplicacion DATE NOT NULL,
          fecha_vencimiento DATE,
          proxima_dosis DATE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_paciente (paciente_id)
        )
      `);

      // --- Domain: productos / inventario ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS productos (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          tenant_id VARCHAR(64) NOT NULL,
          sucursal_id BIGINT NULL,
          nombre VARCHAR(128) NOT NULL,
          descripcion TEXT,
          categoria VARCHAR(64),
          precio DECIMAL(10,2) NOT NULL DEFAULT 0,
          stock INT DEFAULT 0,
          stock_minimo INT DEFAULT 5,
          unidad VARCHAR(32) DEFAULT 'unidad',
          is_active TINYINT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_categoria (categoria)
        )
      `);

      // --- Audit table with indexes ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS auditoria_log (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          ts DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          actor_user_id VARCHAR(64),
          tenant_id VARCHAR(64),
          action VARCHAR(64),
          resource VARCHAR(128),
          resource_id VARCHAR(128),
          ip VARCHAR(64),
          user_agent VARCHAR(512),
          request_id VARCHAR(64),
          before_json JSON,
          after_json JSON,
          INDEX idx_tenant_ts (tenant_id, ts),
          INDEX idx_actor (actor_user_id),
          INDEX idx_resource (resource, resource_id)
        )
      `);

      // --- Files (S3 metadata) ---
      await tenantPool.query(`
        CREATE TABLE IF NOT EXISTS files (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          s3_key VARCHAR(512) NOT NULL,
          content_type VARCHAR(128) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          purpose VARCHAR(64) DEFAULT 'general',
          created_by VARCHAR(64) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_tenant (tenant_id),
          INDEX idx_created_at (created_at)
        )
      `);

      // Run versioned SQL migrations (for future changes)
      await runTenantMigrations(tenantPool);

      // --- Seed admin user ---
      if (opts.adminEmail && opts.adminPassword) {
        const hash = await bcrypt.hash(opts.adminPassword, 12);
        await tenantPool.query(
          `INSERT INTO users (tenant_id, email, password_hash, roles) VALUES (?,?,?,?)`,
          [tenantId, opts.adminEmail.toLowerCase().trim(), hash, JSON.stringify(["admin"])]
        );
      }

      await tenantPool.end();
    }
  });

  return { tenantId, dbName };
}

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using MySqlConnector;
using HealthCoverageVerifier.Helpers;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Data;

public sealed class Db(AppSettings settings)
{
    public async Task<MySqlConnection> OpenAsync()
    {
        var conn = new MySqlConnection(settings.ConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    public async Task MigrateAsync()
    {
        await using var conn = await OpenAsync();
        var sql = """
            CREATE TABLE IF NOT EXISTS usuarios (
              id INT AUTO_INCREMENT PRIMARY KEY,
              username VARCHAR(80) NOT NULL UNIQUE,
              password_hash VARCHAR(255) NOT NULL,
              role ENUM('admin','user') NOT NULL DEFAULT 'user',
              activo TINYINT(1) NOT NULL DEFAULT 1,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS consultas (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              entrada VARCHAR(80) NOT NULL,
              dni VARCHAR(20) NULL,
              cuil VARCHAR(20) NULL,
              apellido VARCHAR(120) NULL,
              fecha_prestacion DATE NULL,
              estado ENUM('pendiente','en_revision','completa','error') NOT NULL DEFAULT 'pendiente',
              decision_final VARCHAR(120) NULL,
              cobertura_recomendada VARCHAR(180) NULL,
              resumen TEXT NULL,
              observaciones TEXT NULL,
              creado_por INT NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              finished_at TIMESTAMP NULL,
              INDEX idx_consultas_created_at (created_at),
              INDEX idx_consultas_dni (dni),
              INDEX idx_consultas_cuil (cuil),
              CONSTRAINT fk_consultas_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS consulta_pasos (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              consulta_id BIGINT NOT NULL,
              orden INT NOT NULL,
              codigo VARCHAR(40) NOT NULL,
              nombre VARCHAR(160) NOT NULL,
              url VARCHAR(700) NOT NULL,
              estado ENUM('pendiente','consultado','requiere_operador','error') NOT NULL DEFAULT 'pendiente',
              resultado VARCHAR(120) NULL,
              resumen TEXT NULL,
              detalle JSON NULL,
              http_status INT NULL,
              titulo VARCHAR(255) NULL,
              texto_detectado MEDIUMTEXT NULL,
              requiere_operador TINYINT(1) NOT NULL DEFAULT 0,
              creado_por INT NOT NULL,
              started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              finished_at TIMESTAMP NULL,
              INDEX idx_pasos_consulta (consulta_id),
              CONSTRAINT fk_pasos_consulta FOREIGN KEY (consulta_id) REFERENCES consultas(id) ON DELETE CASCADE,
              CONSTRAINT fk_pasos_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS auditoria (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              usuario_id INT NULL,
              accion VARCHAR(80) NOT NULL,
              entidad VARCHAR(80) NOT NULL,
              entidad_id VARCHAR(80) NULL,
              detalle JSON NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_auditoria_accion (accion),
              INDEX idx_auditoria_created_at (created_at),
              CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """;
        foreach (var statement in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await using var cmd = new MySqlCommand(statement, conn);
            await cmd.ExecuteNonQueryAsync();
        }

        var hash = BCrypt.Net.BCrypt.HashPassword(settings.AdminPassword, 12);
        await using var admin = new MySqlCommand("""
            INSERT INTO usuarios (username, password_hash, role, activo)
            VALUES (@username, @hash, 'admin', 1)
            ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin', activo = 1
            """, conn);
        admin.Parameters.AddWithValue("@username", settings.AdminUsername);
        admin.Parameters.AddWithValue("@hash", hash);
        await admin.ExecuteNonQueryAsync();
    }

    public async Task<UserRecord?> GetUserByUsernameAsync(MySqlConnection conn, string username)
    {
        await using var cmd = new MySqlCommand(
            "SELECT id, username, password_hash, role, activo, created_at FROM usuarios WHERE username = @username", conn);
        cmd.Parameters.AddWithValue("@username", username);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? ReadUser(reader) : null;
    }

    public async Task<long> CreateConsultaAsync(MySqlConnection conn, int userId, PatientInput input)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO consultas (entrada, dni, cuil, apellido, fecha_prestacion, creado_por)
            VALUES (@entrada, @dni, @cuil, @apellido, @fecha, @userId);
            SELECT LAST_INSERT_ID();
            """, conn);
        cmd.Parameters.AddWithValue("@entrada", input.Entrada);
        cmd.Parameters.AddWithValue("@dni", (object?)input.Dni ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@cuil", (object?)input.Cuil ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@apellido", (object?)input.Apellido ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@fecha", input.FechaPrestacion is null ? DBNull.Value : input.FechaPrestacion.Value.ToString("yyyy-MM-dd"));
        cmd.Parameters.AddWithValue("@userId", userId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task InsertPasoAsync(MySqlConnection conn, long consultaId, int userId, PasoResultado paso)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO consulta_pasos
              (consulta_id, orden, codigo, nombre, url, estado, resultado, resumen, detalle,
               http_status, titulo, texto_detectado, requiere_operador, creado_por, finished_at)
            VALUES
              (@consultaId, @orden, @codigo, @nombre, @url, @estado, @resultado, @resumen, @detalle,
               @httpStatus, @titulo, @texto, @requiereOperador, @userId, NOW())
            """, conn);
        cmd.Parameters.AddWithValue("@consultaId", consultaId);
        cmd.Parameters.AddWithValue("@orden", paso.Orden);
        cmd.Parameters.AddWithValue("@codigo", paso.Codigo);
        cmd.Parameters.AddWithValue("@nombre", paso.Nombre);
        cmd.Parameters.AddWithValue("@url", paso.Url);
        cmd.Parameters.AddWithValue("@estado", paso.Estado);
        cmd.Parameters.AddWithValue("@resultado", paso.Resultado);
        cmd.Parameters.AddWithValue("@resumen", paso.Resumen);
        cmd.Parameters.AddWithValue("@detalle", JsonSerializer.Serialize(paso.Detalle));
        cmd.Parameters.AddWithValue("@httpStatus", (object?)paso.HttpStatus ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@titulo", (object?)paso.Titulo ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@texto", (object?)paso.TextoDetectado ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@requiereOperador", paso.RequiereOperador ? 1 : 0);
        cmd.Parameters.AddWithValue("@userId", userId);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task FinishConsultaAsync(MySqlConnection conn, long id, string estado, string resumen)
    {
        await using var cmd = new MySqlCommand(
            "UPDATE consultas SET estado = @estado, resumen = @resumen, finished_at = NOW() WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("@estado", estado);
        cmd.Parameters.AddWithValue("@resumen", resumen);
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<bool> CanSeeConsultaAsync(MySqlConnection conn, long id, CurrentUser user)
    {
        await using var cmd = new MySqlCommand(
            user.Role == "admin"
                ? "SELECT COUNT(*) FROM consultas WHERE id = @id"
                : "SELECT COUNT(*) FROM consultas WHERE id = @id AND creado_por = @userId", conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (user.Role != "admin") cmd.Parameters.AddWithValue("@userId", user.Id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync()) > 0;
    }

    public async Task<ConsultaDetail?> GetConsultaAsync(MySqlConnection conn, long id, CurrentUser user)
    {
        var where = user.Role == "admin" ? "c.id = @id" : "c.id = @id AND c.creado_por = @userId";
        await using var cmd = new MySqlCommand($"""
            SELECT c.*, u.username creado_por_nombre
            FROM consultas c
            JOIN usuarios u ON u.id = c.creado_por
            WHERE {where}
            """, conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (user.Role != "admin") cmd.Parameters.AddWithValue("@userId", user.Id);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        var consulta = new ConsultaDetail(
            reader.GetInt64("id"),
            reader.GetString("entrada"),
            GetNullableString(reader, "dni"),
            GetNullableString(reader, "cuil"),
            GetNullableString(reader, "apellido"),
            reader.IsDBNull(reader.GetOrdinal("fecha_prestacion")) ? null : DateOnly.FromDateTime(reader.GetDateTime("fecha_prestacion")),
            reader.GetString("estado"),
            GetNullableString(reader, "decision_final"),
            GetNullableString(reader, "cobertura_recomendada"),
            GetNullableString(reader, "resumen"),
            GetNullableString(reader, "observaciones"),
            reader.GetInt32("creado_por"),
            reader.GetString("creado_por_nombre"),
            reader.GetDateTime("created_at"),
            reader.IsDBNull(reader.GetOrdinal("finished_at")) ? null : reader.GetDateTime("finished_at"),
            []);
        await reader.CloseAsync();

        var pasos = new List<PasoDto>();
        await using var p = new MySqlCommand("""
            SELECT id, orden, codigo, nombre, url, estado, resultado, resumen, http_status, titulo,
                   texto_detectado, requiere_operador, started_at, finished_at
            FROM consulta_pasos
            WHERE consulta_id = @id
            ORDER BY orden
            """, conn);
        p.Parameters.AddWithValue("@id", id);
        await using var pr = await p.ExecuteReaderAsync();
        while (await pr.ReadAsync())
        {
            pasos.Add(new PasoDto(
                pr.GetInt64("id"),
                pr.GetInt32("orden"),
                pr.GetString("codigo"),
                pr.GetString("nombre"),
                pr.GetString("url"),
                pr.GetString("estado"),
                GetNullableString(pr, "resultado"),
                GetNullableString(pr, "resumen"),
                pr.IsDBNull(pr.GetOrdinal("http_status")) ? null : pr.GetInt32("http_status"),
                GetNullableString(pr, "titulo"),
                GetNullableString(pr, "texto_detectado"),
                pr.GetInt32("requiere_operador") == 1,
                pr.GetDateTime("started_at"),
                pr.IsDBNull(pr.GetOrdinal("finished_at")) ? null : pr.GetDateTime("finished_at")));
        }
        return consulta with { Pasos = pasos };
    }

    public async Task AuditAsync(MySqlConnection conn, int? userId, string accion, string entidad, string? entidadId, object? detalle)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle)
            VALUES (@userId, @accion, @entidad, @entidadId, @detalle)
            """, conn);
        cmd.Parameters.AddWithValue("@userId", (object?)userId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@accion", accion);
        cmd.Parameters.AddWithValue("@entidad", entidad);
        cmd.Parameters.AddWithValue("@entidadId", (object?)entidadId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@detalle", detalle is null ? DBNull.Value : JsonSerializer.Serialize(detalle));
        await cmd.ExecuteNonQueryAsync();
    }

    static UserRecord ReadUser(MySqlDataReader reader) => new(
        reader.GetInt32("id"),
        reader.GetString("username"),
        reader.GetString("password_hash"),
        reader.GetString("role"),
        reader.GetInt32("activo"),
        reader.GetDateTime("created_at"));

    static string? GetNullableString(MySqlDataReader reader, string name) =>
        reader.IsDBNull(reader.GetOrdinal(name)) ? null : reader.GetString(name);
}

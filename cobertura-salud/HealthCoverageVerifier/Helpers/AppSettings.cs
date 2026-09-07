using System;
using System.Linq;

namespace HealthCoverageVerifier.Helpers;

public sealed record AppSettings(
    string AppName,
    int Port,
    string FrontendUrl,
    string[] CorsOrigins,
    string Database,
    string ConnectionString,
    string JwtSecret,
    string AdminUsername,
    string AdminPassword)
{
    public static AppSettings FromEnvironment()
    {
        var host = Required("DB_HOST");
        var port = Required("DB_PORT");
        var database = Required("DB_NAME");
        var user = Required("DB_USER");
        var password = Required("DB_PASSWORD");
        var cs = $"Server={host};Port={port};Database={database};User ID={user};Password={password};CharSet=utf8mb4;Allow User Variables=True;";
        var origins = (Environment.GetEnvironmentVariable("CORS_ORIGINS") ?? Environment.GetEnvironmentVariable("FRONTEND_URL") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new AppSettings(
            Environment.GetEnvironmentVariable("APP_NAME") ?? "Verificacion de Cobertura de Salud",
            int.Parse(Environment.GetEnvironmentVariable("PORT") ?? "4510"),
            Environment.GetEnvironmentVariable("FRONTEND_URL") ?? "http://localhost:4610",
            origins.Length == 0 ? ["http://localhost:4610"] : origins,
            database,
            cs,
            Required("JWT_SECRET"),
            Environment.GetEnvironmentVariable("ADMIN_USERNAME") ?? "admin",
            Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "admin123");
    }

    static string Required(string key) =>
        Environment.GetEnvironmentVariable(key) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Falta configurar {key}");
}

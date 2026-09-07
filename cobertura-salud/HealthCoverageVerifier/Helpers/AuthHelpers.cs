using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Helpers;

public static class AuthHelpers
{
    public static string SignToken(UserRecord user, AppSettings settings)
    {
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.JwtSecret)),
            SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("username", user.Username),
            new Claim("role", user.Role)
        };
        var token = new JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(8), signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static string? NormalizeRole(string? role)
    {
        role = (role ?? "user").Trim().ToLowerInvariant();
        return role is "admin" or "user" ? role : null;
    }

    public static object? EmptyToNull(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();

    public static void LoadEnv(string path)
    {
        if (!File.Exists(path)) return;
        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#') || !line.Contains('=')) continue;
            var idx = line.IndexOf('=');
            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim().Trim('"').Trim('\'');
            if (Environment.GetEnvironmentVariable(key) is null)
                Environment.SetEnvironmentVariable(key, value);
        }
    }

    public static string BuildDecision(PatientInput parsed, IReadOnlyList<PasoResultado> pasos)
    {
        var captchas = pasos.Count(p => p.Resultado == "captcha_detectado");
        var logins = pasos.Count(p => p.Resultado == "login_detectado");
        var unmapped = pasos.Count(p => p.Resultado == "pantalla_no_mapeada");
        var blocked = pasos.Count(p => p.Estado == "requiere_operador" && p.Resultado is not "captcha_detectado" and not "login_detectado" and not "pantalla_no_mapeada");
        var errors = pasos.Count(p => p.Estado == "error");
        var dateRule = parsed.FechaPrestacion is not null && parsed.FechaPrestacion.Value >= new DateOnly(2025, 1, 1)
            ? "Para esta fecha de prestacion corresponde revisar OS DESTINO en SSS."
            : "Para prestaciones anteriores a 2025-01-01 corresponde revisar OS ORIGEN en SSS.";
        return $"Consulta recorrida. Captchas detectados: {captchas}. Logins detectados: {logins}. Pantallas no mapeadas: {unmapped}. Otros pasos con operador: {blocked}. Errores tecnicos: {errors}. {dateRule}";
    }
}

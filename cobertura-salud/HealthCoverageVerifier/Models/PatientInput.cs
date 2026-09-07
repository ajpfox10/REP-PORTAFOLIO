using System;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;

namespace HealthCoverageVerifier.Models;

public sealed record PatientInput(string Entrada, string? Dni, string? Cuil, string? Apellido, DateOnly? FechaPrestacion)
{
    public static PatientInput Parse(string? entrada, string? apellido, string? fechaPrestacion)
    {
        var raw = (entrada ?? "").Trim();
        if (raw.Length == 0) throw new BadHttpRequestException("Ingresar DNI, CUIL u otro identificador");

        var digits = Regex.Replace(raw, @"\D", "");
        string? dni = null;
        string? cuil = null;

        if (digits.Length == 11)
        {
            cuil = $"{digits[..2]}-{digits.Substring(2, 8)}-{digits[10..]}";
            dni = digits.Substring(2, 8).TrimStart('0');
        }
        else if (digits.Length is >= 7 and <= 9)
        {
            dni = digits;
        }

        DateOnly? fecha = DateOnly.TryParse(fechaPrestacion, out var parsedDate) ? parsedDate : null;
        return new PatientInput(raw, dni, cuil, string.IsNullOrWhiteSpace(apellido) ? null : apellido.Trim(), fecha);
    }
}

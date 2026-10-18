using System.Globalization;
using System.Text.RegularExpressions;
using PersonalContable.Core.Modelos;

namespace PersonalContable.Core.Servicios;

/// <summary>Datos tal como vienen del formulario, antes de convertirlos a <see cref="Personal"/>.</summary>
public sealed record DatosFormulario(
    string ApellidoNombre,
    string Cuil,
    string Domicilio,
    string Localidad,
    string Provincia,
    string CodigoPostal,
    Puesto? Puesto,
    Categoria? Categoria,
    DateTime? FechaIngreso,
    string SectorAsignado,
    string Actividad,
    string SueldoNominal);

public static partial class ValidadorPersonal
{
    public const int LargoMaximoNombre = 60;
    public static readonly DateOnly FechaIngresoMinima = new(1950, 1, 1);

    // CP de 4 dígitos o CPA (letra de provincia + 4 dígitos + 3 letras)
    [GeneratedRegex(@"^(\d{4}|[A-Z]\d{4}[A-Z]{3})$")]
    private static partial Regex CodigoPostalRegex();

    [GeneratedRegex(@"^[\p{L}][\p{L}\s'.,-]*$")]
    private static partial Regex NombreRegex();

    /// <summary>Valida todo el formulario. Devuelve un mensaje por campo con error.</summary>
    public static Dictionary<string, string> Validar(DatosFormulario d, IEnumerable<Personal> existentes, Guid? editandoId, DateOnly hoy, CultureInfo cultura)
    {
        var errores = new Dictionary<string, string>();
        void Error(string campo, string mensaje) => errores.TryAdd(campo, mensaje);

        string nombre = d.ApellidoNombre.Trim();
        if (nombre.Length == 0) Error(nameof(d.ApellidoNombre), "Ingresá apellido y nombre.");
        else if (nombre.Length > LargoMaximoNombre) Error(nameof(d.ApellidoNombre), $"Máximo {LargoMaximoNombre} caracteres.");
        else if (!NombreRegex().IsMatch(nombre)) Error(nameof(d.ApellidoNombre), "Solo letras, espacios y signos de puntuación.");

        string cuil = Cuil.Normalizar(d.Cuil);
        if (cuil.Length == 0) Error(nameof(d.Cuil), "Ingresá el CUIL.");
        else if (!Cuil.EsValido(cuil)) Error(nameof(d.Cuil), "El CUIL no es válido. Revisá los 11 dígitos.");
        else if (existentes.Any(p => p.Cuil == cuil && p.Id != editandoId))
            Error(nameof(d.Cuil), "Ya hay una persona cargada con ese CUIL.");

        if (string.IsNullOrWhiteSpace(d.Provincia)) Error(nameof(d.Provincia), "Elegí la provincia.");

        string cp = d.CodigoPostal.Trim().ToUpperInvariant();
        if (cp.Length == 0) Error(nameof(d.CodigoPostal), "Ingresá el código postal.");
        else if (!CodigoPostalRegex().IsMatch(cp)) Error(nameof(d.CodigoPostal), "Usá 4 dígitos (1425) o el CPA (C1425ABC).");

        if (d.Puesto is null) Error(nameof(d.Puesto), "Elegí el puesto.");
        if (d.Categoria is null) Error(nameof(d.Categoria), "Elegí la categoría.");

        if (d.FechaIngreso is null) Error(nameof(d.FechaIngreso), "Ingresá la fecha de ingreso.");
        else
        {
            var fecha = DateOnly.FromDateTime(d.FechaIngreso.Value);
            if (fecha < FechaIngresoMinima || fecha > hoy)
                Error(nameof(d.FechaIngreso), $"Tiene que estar entre {FechaIngresoMinima:dd/MM/yyyy} y hoy.");
        }

        if (!TryParseImporte(d.SueldoNominal, cultura, out decimal sueldo))
            Error(nameof(d.SueldoNominal), "Ingresá un importe válido, por ejemplo 850000,50.");
        else if (sueldo <= 0) Error(nameof(d.SueldoNominal), "El sueldo tiene que ser mayor a cero.");
        else if (sueldo > 1_000_000_000m) Error(nameof(d.SueldoNominal), "El importe es demasiado alto.");

        return errores;
    }

    /// <summary>
    /// Interpreta un importe escrito por una persona: acepta "850000", "850.000,50" o "$ 850.000".
    /// No acepta notación científica ni signos.
    /// </summary>
    public static bool TryParseImporte(string? texto, CultureInfo cultura, out decimal importe)
    {
        string limpio = (texto ?? string.Empty).Replace(cultura.NumberFormat.CurrencySymbol, string.Empty).Trim();
        return decimal.TryParse(limpio, NumberStyles.AllowDecimalPoint | NumberStyles.AllowThousands, cultura, out importe);
    }

    /// <summary>Convierte un formulario ya validado en un <see cref="Personal"/>.</summary>
    public static Personal CrearPersonal(DatosFormulario d, Guid id, CultureInfo cultura)
    {
        TryParseImporte(d.SueldoNominal, cultura, out decimal sueldo);
        return new Personal
        {
            Id = id,
            ApellidoNombre = d.ApellidoNombre.Trim(),
            Cuil = Cuil.Normalizar(d.Cuil),
            Domicilio = d.Domicilio.Trim(),
            Localidad = d.Localidad.Trim(),
            Provincia = d.Provincia.Trim(),
            CodigoPostal = d.CodigoPostal.Trim().ToUpperInvariant(),
            Puesto = d.Puesto!.Value,
            Categoria = d.Categoria!.Value,
            FechaIngreso = DateOnly.FromDateTime(d.FechaIngreso!.Value),
            SectorAsignado = d.SectorAsignado.Trim(),
            Actividad = d.Actividad.Trim(),
            SueldoNominal = Math.Round(sueldo, 2, MidpointRounding.AwayFromZero),
        };
    }
}

using System.Globalization;
using PersonalContable.Core.Modelos;

namespace PersonalContable.Core.Servicios;

/// <summary>
/// Exporta la planta a CSV para abrir con Excel en español: separador punto y coma,
/// importes con coma decimal y protección contra inyección de fórmulas.
/// </summary>
public static class ExportadorCsv
{
    private const char Separador = ';';

    private static readonly string[] Encabezados =
    [
        "Apellido y nombre", "CUIL", "Domicilio", "Localidad", "Provincia", "Código postal", "Puesto", "Categoría",
        "Fecha de ingreso", "Antigüedad (años)", "Sector", "Actividad", "Sueldo bruto", "Aportes", "Sueldo neto estimado",
    ];

    public static void Exportar(IEnumerable<Personal> personal, TextWriter salida, DateOnly hoy, CultureInfo cultura, ParametrosLiquidacion? parametros = null)
    {
        salida.WriteLine(string.Join(Separador, Encabezados.Select(Celda)));
        foreach (var p in personal.OrderBy(p => p.ApellidoNombre, StringComparer.Create(cultura, ignoreCase: true)))
        {
            var liquidacion = CalculadoraLiquidacion.Calcular(p.SueldoNominal, parametros);
            string[] valores =
            [
                p.ApellidoNombre, Cuil.Formatear(p.Cuil), p.Domicilio, p.Localidad, p.Provincia, p.CodigoPostal,
                p.Puesto.Nombre(), p.Categoria.Nombre(), p.FechaIngreso.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
                p.Antiguedad(hoy).ToString(CultureInfo.InvariantCulture), p.SectorAsignado, p.Actividad,
                Importe(p.SueldoNominal, cultura), Importe(liquidacion.TotalAportes, cultura), Importe(liquidacion.SueldoNeto, cultura),
            ];
            salida.WriteLine(string.Join(Separador, valores.Select(Celda)));
        }
    }

    private static string Importe(decimal valor, CultureInfo cultura) => valor.ToString("0.00", cultura);

    /// <summary>
    /// Escapa una celda. Si empieza con =, +, -, @, tab o retorno, Excel la interpretaría
    /// como fórmula: se antepone una comilla simple para que quede como texto.
    /// </summary>
    internal static string Celda(string? valor)
    {
        string texto = valor ?? string.Empty;
        if (texto.Length > 0 && "=+-@\t\r".Contains(texto[0]) && !EsNumero(texto)) texto = "'" + texto;
        bool requiereComillas = texto.IndexOfAny([Separador, '"', '\n', '\r']) >= 0;
        return requiereComillas ? $"\"{texto.Replace("\"", "\"\"")}\"" : texto;
    }

    private static bool EsNumero(string texto) =>
        decimal.TryParse(texto, NumberStyles.Number, CultureInfo.InvariantCulture, out _);
}

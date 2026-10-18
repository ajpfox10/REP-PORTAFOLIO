using System.Globalization;
using PersonalContable.Core.Servicios;

namespace PersonalContable.Tests;

public class ExportadorCsvTests
{
    [Theory]
    [InlineData("=HYPERLINK(\"http://x\")", "\"'=HYPERLINK(\"\"http://x\"\")\"")]
    [InlineData("+54 11 5555", "'+54 11 5555")]
    [InlineData("@SUMA(A1)", "'@SUMA(A1)")]
    [InlineData("Pérez; Juan", "\"Pérez; Juan\"")]
    [InlineData("-1500", "-1500")]
    [InlineData("Normal", "Normal")]
    public void Escapa_celdas_y_neutraliza_formulas(string valor, string esperado) =>
        Assert.Equal(esperado, ExportadorCsv.Celda(valor));

    [Fact]
    public void Exporta_con_punto_y_coma_e_importes_en_formato_argentino()
    {
        var salida = new StringWriter();
        ExportadorCsv.Exportar([Datos.Persona(sueldo: 1_000_000.5m)], salida, Datos.Hoy, new CultureInfo("es-AR"));

        string[] lineas = salida.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, lineas.Length);
        Assert.StartsWith("Apellido y nombre;CUIL;", lineas[0]);
        Assert.Contains("27-28658941-9", lineas[1]);
        Assert.Contains(";1000000,50;170000,10;830000,40", lineas[1]);
        Assert.Contains(";01/03/2018;8;", lineas[1]);
    }
}

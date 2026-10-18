using System.Globalization;
using PersonalContable.Core.Modelos;
using PersonalContable.Core.Servicios;

namespace PersonalContable.Tests;

public class ValidadorTests
{
    private static readonly CultureInfo Ar = new("es-AR");

    private static DatosFormulario Valido(string sueldo = "850.000,50", string cuil = "20-12345678-6", string cp = "1425") => new(
        "Pérez, Juan", cuil, "Mitre 100", "Rosario", "Santa Fe", cp, Puesto.Taller, Categoria.Operativo,
        new DateTime(2020, 5, 4), "Taller", "Mantenimiento", sueldo);

    [Fact]
    public void Un_formulario_completo_no_tiene_errores_y_convierte_bien()
    {
        var datos = Valido();
        Assert.Empty(ValidadorPersonal.Validar(datos, [], null, Datos.Hoy, Ar));

        var persona = ValidadorPersonal.CrearPersonal(datos, Guid.NewGuid(), Ar);
        Assert.Equal("20123456786", persona.Cuil);
        Assert.Equal(850_000.50m, persona.SueldoNominal);
        Assert.Equal(new DateOnly(2020, 5, 4), persona.FechaIngreso);
    }

    [Theory]
    [InlineData("850000")]
    [InlineData("$ 850.000")]
    [InlineData("850.000,5")]
    public void Acepta_importes_escritos_de_distintas_formas(string sueldo) =>
        Assert.True(ValidadorPersonal.TryParseImporte(sueldo, Ar, out _));

    [Theory]
    [InlineData("-5")]
    [InlineData("1e9")]
    [InlineData("abc")]
    public void Rechaza_importes_invalidos(string sueldo) =>
        Assert.Contains(nameof(DatosFormulario.SueldoNominal), ValidadorPersonal.Validar(Valido(sueldo), [], null, Datos.Hoy, Ar).Keys);

    [Theory]
    [InlineData("C1425ABC", true)]
    [InlineData("c1425abc", true)]
    [InlineData("1425", true)]
    [InlineData("142", false)]
    [InlineData("14255", false)]
    public void Valida_codigo_postal_y_cpa(string cp, bool valido)
    {
        var errores = ValidadorPersonal.Validar(Valido(cp: cp), [], null, Datos.Hoy, Ar);
        Assert.Equal(!valido, errores.ContainsKey(nameof(DatosFormulario.CodigoPostal)));
    }

    [Fact]
    public void No_permite_dos_personas_con_el_mismo_cuil_salvo_la_que_se_edita()
    {
        var existente = Datos.Persona(cuil: "20123456786");
        Assert.Contains(nameof(DatosFormulario.Cuil), ValidadorPersonal.Validar(Valido(), [existente], null, Datos.Hoy, Ar).Keys);
        Assert.Empty(ValidadorPersonal.Validar(Valido(), [existente], existente.Id, Datos.Hoy, Ar));
    }

    [Fact]
    public void Rechaza_fechas_de_ingreso_futuras()
    {
        var datos = Valido() with { FechaIngreso = new DateTime(2030, 1, 1) };
        Assert.Contains(nameof(DatosFormulario.FechaIngreso), ValidadorPersonal.Validar(datos, [], null, Datos.Hoy, Ar).Keys);
    }

    [Fact]
    public void Calcula_antiguedad_en_anios_completos()
    {
        var persona = Datos.Persona(ingreso: new DateOnly(2018, 10, 19));
        Assert.Equal(7, persona.Antiguedad(Datos.Hoy));
        Assert.Equal(8, persona.Antiguedad(new DateOnly(2026, 10, 19)));
    }
}

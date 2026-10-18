using PersonalContable.Core.Modelos;

namespace PersonalContable.Tests;

internal static class Datos
{
    public static readonly DateOnly Hoy = new(2026, 10, 18);

    public static Personal Persona(string nombre = "Gómez, Laura", decimal sueldo = 1_000_000m, string cuil = "27286589419",
        Puesto puesto = Puesto.Contable, Categoria categoria = Categoria.Administrativo, DateOnly? ingreso = null) => new()
    {
        ApellidoNombre = nombre,
        Cuil = cuil,
        Domicilio = "Av. Corrientes 1234",
        Localidad = "CABA",
        Provincia = "Ciudad Autónoma de Buenos Aires",
        CodigoPostal = "C1043AAZ",
        Puesto = puesto,
        Categoria = categoria,
        FechaIngreso = ingreso ?? new DateOnly(2018, 3, 1),
        SectorAsignado = "Liquidaciones",
        Actividad = "Sueldos",
        SueldoNominal = sueldo,
    };
}

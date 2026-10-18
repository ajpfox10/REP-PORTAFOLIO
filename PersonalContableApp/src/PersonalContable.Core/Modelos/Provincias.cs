namespace PersonalContable.Core.Modelos;

/// <summary>Las 24 jurisdicciones de la República Argentina.</summary>
public static class Provincias
{
    public static IReadOnlyList<string> Todas { get; } =
    [
        "Ciudad Autónoma de Buenos Aires", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba",
        "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
        "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe",
        "Santiago del Estero", "Tierra del Fuego", "Tucumán",
    ];
}

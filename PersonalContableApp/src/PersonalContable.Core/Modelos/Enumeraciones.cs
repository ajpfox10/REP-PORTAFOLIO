namespace PersonalContable.Core.Modelos;

/// <summary>Área de trabajo de la persona.</summary>
public enum Puesto
{
    Contable = 1,
    Taller = 2,
    RecursosHumanos = 3,
    IT = 4,
    Marketing = 5,
}

/// <summary>Nivel jerárquico dentro de la empresa.</summary>
public enum Categoria
{
    Dirección = 1,
    Jefe = 2,
    Contable = 3,
    Administrativo = 4,
    Operativo = 5,
}

public static class EnumeracionesExtensiones
{
    public static string Nombre(this Puesto puesto) => puesto switch
    {
        Puesto.RecursosHumanos => "Recursos Humanos",
        _ => puesto.ToString(),
    };

    public static string Nombre(this Categoria categoria) => categoria.ToString();

    public static IReadOnlyList<Puesto> TodosLosPuestos { get; } = Enum.GetValues<Puesto>();
    public static IReadOnlyList<Categoria> TodasLasCategorias { get; } = Enum.GetValues<Categoria>();
}

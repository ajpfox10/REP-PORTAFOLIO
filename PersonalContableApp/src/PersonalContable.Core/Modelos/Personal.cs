namespace PersonalContable.Core.Modelos;

/// <summary>Una persona de la planta de personal.</summary>
public sealed record Personal
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string ApellidoNombre { get; init; } = string.Empty;
    /// <summary>CUIL sin guiones (11 dígitos). Vacío en registros importados del formato anterior.</summary>
    public string Cuil { get; init; } = string.Empty;
    public string Domicilio { get; init; } = string.Empty;
    public string Localidad { get; init; } = string.Empty;
    public string Provincia { get; init; } = string.Empty;
    public string CodigoPostal { get; init; } = string.Empty;
    public Puesto Puesto { get; init; }
    public Categoria Categoria { get; init; }
    public DateOnly FechaIngreso { get; init; }
    public string SectorAsignado { get; init; } = string.Empty;
    public string Actividad { get; init; } = string.Empty;
    /// <summary>Sueldo bruto mensual.</summary>
    public decimal SueldoNominal { get; init; }

    /// <summary>Años completos de antigüedad a la fecha indicada.</summary>
    public int Antiguedad(DateOnly hoy)
    {
        if (hoy < FechaIngreso) return 0;
        int años = hoy.Year - FechaIngreso.Year;
        if (hoy < FechaIngreso.AddYears(años)) años--;
        return años;
    }
}

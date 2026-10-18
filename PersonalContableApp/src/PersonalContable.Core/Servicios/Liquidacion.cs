namespace PersonalContable.Core.Servicios;

/// <summary>
/// Alícuotas para estimar la liquidación de un empleado en relación de dependencia.
/// Los aportes del trabajador son los del régimen general; la contribución patronal
/// varía según el tipo de empleador, por eso es configurable.
/// </summary>
public sealed record ParametrosLiquidacion
{
    public decimal Jubilacion { get; init; } = 0.11m;
    /// <summary>Ley 19.032 (INSSJP / PAMI).</summary>
    public decimal Ley19032 { get; init; } = 0.03m;
    public decimal ObraSocial { get; init; } = 0.03m;
    public decimal ContribucionesPatronales { get; init; } = 0.24m;
    /// <summary>Base imponible máxima para los aportes. Null = sin tope.</summary>
    public decimal? TopeBaseImponible { get; init; }

    public static ParametrosLiquidacion PorDefecto { get; } = new();
}

public sealed record LiquidacionEstimada(
    decimal SueldoBruto,
    decimal Jubilacion,
    decimal Ley19032,
    decimal ObraSocial,
    decimal ContribucionesPatronales)
{
    public decimal TotalAportes => Jubilacion + Ley19032 + ObraSocial;
    public decimal SueldoNeto => SueldoBruto - TotalAportes;
    public decimal CostoLaboral => SueldoBruto + ContribucionesPatronales;
}

public static class CalculadoraLiquidacion
{
    public static LiquidacionEstimada Calcular(decimal sueldoBruto, ParametrosLiquidacion? parametros = null)
    {
        var p = parametros ?? ParametrosLiquidacion.PorDefecto;
        if (sueldoBruto < 0) throw new ArgumentOutOfRangeException(nameof(sueldoBruto), "El sueldo no puede ser negativo.");

        decimal baseAportes = p.TopeBaseImponible is decimal tope ? Math.Min(sueldoBruto, tope) : sueldoBruto;
        return new LiquidacionEstimada(
            sueldoBruto,
            Redondear(baseAportes * p.Jubilacion),
            Redondear(baseAportes * p.Ley19032),
            Redondear(baseAportes * p.ObraSocial),
            Redondear(sueldoBruto * p.ContribucionesPatronales));
    }

    private static decimal Redondear(decimal valor) => Math.Round(valor, 2, MidpointRounding.AwayFromZero);
}

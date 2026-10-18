using PersonalContable.Core.Modelos;

namespace PersonalContable.Core.Servicios;

public sealed record GrupoResumen(string Nombre, int Cantidad, decimal MasaSalarial, double Proporcion);

public sealed record ResumenPlantilla(
    int Cantidad,
    decimal MasaSalarialBruta,
    decimal NetoTotal,
    decimal CostoLaboralTotal,
    decimal SueldoPromedio,
    double AntiguedadPromedio,
    IReadOnlyList<GrupoResumen> PorPuesto,
    IReadOnlyList<GrupoResumen> PorCategoria)
{
    public static ResumenPlantilla Calcular(IReadOnlyCollection<Personal> personal, DateOnly hoy, ParametrosLiquidacion? parametros = null)
    {
        if (personal.Count == 0) return new ResumenPlantilla(0, 0, 0, 0, 0, 0, [], []);

        var liquidaciones = personal.Select(p => CalculadoraLiquidacion.Calcular(p.SueldoNominal, parametros)).ToList();
        decimal masa = personal.Sum(p => p.SueldoNominal);

        List<GrupoResumen> Agrupar<T>(Func<Personal, T> clave, Func<T, string> nombre) =>
            personal.GroupBy(clave)
                .Select(g => new GrupoResumen(nombre(g.Key), g.Count(), g.Sum(p => p.SueldoNominal),
                    masa == 0 ? 0 : (double)(g.Sum(p => p.SueldoNominal) / masa)))
                .OrderByDescending(g => g.MasaSalarial)
                .ToList();

        return new ResumenPlantilla(
            personal.Count,
            masa,
            liquidaciones.Sum(l => l.SueldoNeto),
            liquidaciones.Sum(l => l.CostoLaboral),
            Math.Round(masa / personal.Count, 2, MidpointRounding.AwayFromZero),
            personal.Average(p => p.Antiguedad(hoy)),
            Agrupar(p => p.Puesto, p => p.Nombre()),
            Agrupar(p => p.Categoria, c => c.Nombre()));
    }
}

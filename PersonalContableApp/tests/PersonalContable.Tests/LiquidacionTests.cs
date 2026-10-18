using PersonalContable.Core.Servicios;

namespace PersonalContable.Tests;

public class LiquidacionTests
{
    [Fact]
    public void Aplica_aportes_del_regimen_general()
    {
        var l = CalculadoraLiquidacion.Calcular(1_000_000m);

        Assert.Equal(110_000m, l.Jubilacion);
        Assert.Equal(30_000m, l.Ley19032);
        Assert.Equal(30_000m, l.ObraSocial);
        Assert.Equal(170_000m, l.TotalAportes);
        Assert.Equal(830_000m, l.SueldoNeto);
        Assert.Equal(1_240_000m, l.CostoLaboral);
    }

    [Fact]
    public void Respeta_el_tope_de_la_base_imponible()
    {
        var l = CalculadoraLiquidacion.Calcular(5_000_000m, new ParametrosLiquidacion { TopeBaseImponible = 3_000_000m });
        Assert.Equal(510_000m, l.TotalAportes);
        Assert.Equal(1_200_000m, l.ContribucionesPatronales); // las contribuciones no usan el tope
    }

    [Fact]
    public void Redondea_a_centavos()
    {
        var l = CalculadoraLiquidacion.Calcular(1234.567m);
        Assert.Equal(135.80m, l.Jubilacion);
    }
}

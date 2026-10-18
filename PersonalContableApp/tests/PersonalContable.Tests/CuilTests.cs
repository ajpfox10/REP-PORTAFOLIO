using PersonalContable.Core.Servicios;

namespace PersonalContable.Tests;

public class CuilTests
{
    [Theory]
    [InlineData("27-28658941-9")]
    [InlineData("20123456786")]
    [InlineData("30-50001091-2")]
    public void Acepta_cuil_con_digito_verificador_correcto(string cuil) => Assert.True(Cuil.EsValido(cuil));

    [Theory]
    [InlineData("20-12345678-5")]   // dígito verificador incorrecto
    [InlineData("99-12345678-6")]   // prefijo inexistente
    [InlineData("2012345678")]      // 10 dígitos
    [InlineData("")]
    [InlineData(null)]
    public void Rechaza_cuil_invalido(string? cuil) => Assert.False(Cuil.EsValido(cuil));

    [Fact]
    public void Formatea_y_normaliza()
    {
        Assert.Equal("20-12345678-6", Cuil.Formatear("20123456786"));
        Assert.Equal("20123456786", Cuil.Normalizar(" 20-12345678-6 "));
    }
}

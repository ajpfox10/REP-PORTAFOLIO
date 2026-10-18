using PersonalContable.Core.Modelos;
using PersonalContable.Core.Servicios;

namespace PersonalContable.Core.ViewModels;

/// <summary>Una fila de la tabla, con los datos ya preparados para mostrar.</summary>
public sealed class FilaPersonal
{
    public FilaPersonal(Personal personal, DateOnly hoy, ParametrosLiquidacion parametros)
    {
        Personal = personal;
        Antiguedad = personal.Antiguedad(hoy);
        Liquidacion = CalculadoraLiquidacion.Calcular(personal.SueldoNominal, parametros);
    }

    public Personal Personal { get; }
    public int Antiguedad { get; }
    public LiquidacionEstimada Liquidacion { get; }

    public string ApellidoNombre => Personal.ApellidoNombre;
    public string Cuil => Personal.Cuil.Length > 0 ? Servicios.Cuil.Formatear(Personal.Cuil) : "Sin cargar";
    public string Puesto => Personal.Puesto.Nombre();
    public string Categoria => Personal.Categoria.Nombre();
    public string Ubicacion => string.Join(", ", new[] { Personal.Localidad, Personal.Provincia }.Where(s => s.Length > 0));
    public string Sector => Personal.SectorAsignado;
    public DateTime FechaIngreso => Personal.FechaIngreso.ToDateTime(TimeOnly.MinValue);
    public string AntiguedadTexto => Antiguedad == 1 ? "1 año" : $"{Antiguedad} años";
    public decimal SueldoBruto => Personal.SueldoNominal;
    public decimal SueldoNeto => Liquidacion.SueldoNeto;
    public bool FaltaCuil => Personal.Cuil.Length == 0;
}

/// <summary>Opción de un filtro desplegable ("Todos" = sin valor).</summary>
public sealed record OpcionFiltro<T>(string Texto, T? Valor) where T : struct
{
    public override string ToString() => Texto;
}

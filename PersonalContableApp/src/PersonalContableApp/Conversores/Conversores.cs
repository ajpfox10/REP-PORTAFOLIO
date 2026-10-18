using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace PersonalContableApp.Conversores;

/// <summary>Visible si el valor no es null ni texto vacío. Con parámetro "invertir", al revés.</summary>
public sealed class HayValorAVisibilidad : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        bool hay = value is not null && (value is not string s || s.Length > 0) && (value is not bool b || b);
        if (parameter as string == "invertir") hay = !hay;
        return hay ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Proporción 0..1 a porcentaje 0..100 para barras.</summary>
public sealed class ProporcionAPorcentaje : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is double d ? d * 100 : 0d;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Muestra puestos y categorías con su nombre legible ("Recursos Humanos").</summary>
public sealed class EnumANombre : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value switch
    {
        PersonalContable.Core.Modelos.Puesto p => PersonalContable.Core.Modelos.EnumeracionesExtensiones.Nombre(p),
        PersonalContable.Core.Modelos.Categoria c => PersonalContable.Core.Modelos.EnumeracionesExtensiones.Nombre(c),
        _ => value?.ToString() ?? string.Empty,
    };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

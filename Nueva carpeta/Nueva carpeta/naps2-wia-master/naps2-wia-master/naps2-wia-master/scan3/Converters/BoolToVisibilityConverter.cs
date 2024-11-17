using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace scan3.Converters
{
    public class BoolToVisibilityConverter : IValueConverter
    {
        // Convierte un valor booleano a Visibility
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is bool boolValue)
            {
                return boolValue ? Visibility.Visible : Visibility.Collapsed;
            }
            return Visibility.Collapsed;
        }

        // Convierte de Visibility a booleano (opcional)
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is Visibility visibility)
            {
                return visibility == Visibility.Visible;
            }
            return false;
        }
    }
}

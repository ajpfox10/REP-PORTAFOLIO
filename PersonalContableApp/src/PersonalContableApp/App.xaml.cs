using System.Globalization;
using System.Threading;
using System.IO;
using System.Windows;
using System.Windows.Markup;
using System.Windows.Threading;
using PersonalContable.Core.Datos;
using PersonalContable.Core.ViewModels;
using PersonalContableApp.Servicios;
using PersonalContableApp.Vistas;

namespace PersonalContableApp;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Formatos argentinos ($ 1.234,56 y fechas dd/MM/yyyy) en toda la app, también en los bindings
        var cultura = new CultureInfo("es-AR");
        CultureInfo.DefaultThreadCurrentCulture = cultura;
        CultureInfo.DefaultThreadCurrentUICulture = cultura;
        Thread.CurrentThread.CurrentCulture = cultura;
        Thread.CurrentThread.CurrentUICulture = cultura;
        FrameworkElement.LanguageProperty.OverrideMetadata(typeof(FrameworkElement),
            new FrameworkPropertyMetadata(XmlLanguage.GetLanguage(cultura.IetfLanguageTag)));

        DispatcherUnhandledException += AlFallar;

        // Los datos van a la carpeta del usuario; la versión anterior los guardaba junto al .exe
        string rutaHeredada = Path.Combine(AppContext.BaseDirectory, "personal.json");
        var almacen = new AlmacenJson(AlmacenJson.RutaPorDefecto(), rutaHeredada);

        var ventana = new VentanaPrincipal();
        var viewModel = new PrincipalViewModel(almacen, new DialogosWpf(ventana), cultura: cultura);
        ventana.DataContext = viewModel;
        viewModel.Inicializar();
        MainWindow = ventana;
        ventana.Show();
    }

    private void AlFallar(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(
            $"Ocurrió un error inesperado. Tus datos guardados no se perdieron.\n\n{e.Exception.Message}",
            "Personal Contable", MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using scan3.Infrastructure.Logging;
using scan3.ViewModels;
using scan3.Views;

namespace scan3
{
    /// <summary>
    /// Lógica de interacción para App.xaml
    /// </summary>
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // Configuración del LoggerFactory global
            GlobalLogger.ConfigureLoggerFactory();

            // Crear e inyectar MainWindow con el ViewModel que necesita el logger
            var mainViewModel = new MainViewModel(GlobalLogger.GetLogger<MainViewModel>());
            var mainWindow = new MainWindow
            {
                DataContext = mainViewModel
            };         
        }
    }
}

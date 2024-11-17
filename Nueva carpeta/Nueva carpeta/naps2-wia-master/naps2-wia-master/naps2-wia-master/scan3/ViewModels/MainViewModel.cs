/*using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using scan3.Commands; // Asegúrate de incluir el namespace correcto

namespace scan3.ViewModels
{
    public class MainViewModel : INotifyPropertyChanged
    {
        // Implementación de INotifyPropertyChanged
        public event PropertyChangedEventHandler PropertyChanged;

        protected void OnPropertyChanged([CallerMemberName] string propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }

        // Propiedades para Scanners
        public ObservableCollection<string> Scanners { get; set; }
        private bool _isScannersVisible;
        public bool IsScannersVisible
        {
            get => _isScannersVisible;
            set
            {
                _isScannersVisible = value;
                OnPropertyChanged();
            }
        }
        private string _selectedScanner;
        public string SelectedScanner
        {
            get => _selectedScanner;
            set
            {
                _selectedScanner = value;
                OnPropertyChanged();
                // Actualizar estado o realizar otras acciones
                EstadoSeleccionado = $"Scanner seleccionado: {_selectedScanner}";
            }
        }

        // Propiedades para Impresoras
        public ObservableCollection<string> Impresoras { get; set; }
        private bool _isImpresorasVisible;
        public bool IsImpresorasVisible
        {
            get => _isImpresorasVisible;
            set
            {
                _isImpresorasVisible = value;
                OnPropertyChanged();
            }
        }
        private string _selectedImpresora;
        public string SelectedImpresora
        {
            get => _selectedImpresora;
            set
            {
                _selectedImpresora = value;
                OnPropertyChanged();
                // Actualizar estado o realizar otras acciones
                EstadoSeleccionado = $"Impresora seleccionada: {_selectedImpresora}";
            }
        }

        // Propiedad para el estado
        private string _estadoSeleccionado;
        public string EstadoSeleccionado
        {
            get => _estadoSeleccionado;
            set
            {
                _estadoSeleccionado = value;
                OnPropertyChanged();
            }
        }

        // Comandos
        public ICommand ListaScannersCommand { get; }
        public ICommand ListaImpresorasCommand { get; }

        public MainViewModel()
        {
            // Inicializar colecciones
            Scanners = new ObservableCollection<string>();
            Impresoras = new ObservableCollection<string>();

            // Inicializar comandos
            ListaScannersCommand = new RelayCommand(ShowScanners);
            ListaImpresorasCommand = new RelayCommand(ShowImpresoras);

            // Inicialmente, ocultar las listas
            IsScannersVisible = false;
            IsImpresorasVisible = false;
        }

        private void ShowScanners()
        {
            // Lógica para cargar Scanners
            Scanners.Clear();
            Scanners.Add("Scanner 1");
            Scanners.Add("Scanner 2");
            Scanners.Add("Scanner 3");

            IsScannersVisible = true;
            EstadoSeleccionado = "Scanners cargados.";
        }

        private void ShowImpresoras()
        {
            // Lógica para cargar Impresoras
            Impresoras.Clear();
            Impresoras.Add("Impresora A");
            Impresoras.Add("Impresora B");
            Impresoras.Add("Impresora C");

            IsImpresorasVisible = true;
            EstadoSeleccionado = "Impresoras cargadas.";
        }
    }
}*/
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows.Input;
using NAPS2.Wia;
using System;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Extensions.Logging;
using scan3.Commands;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.IO;
using System.Windows;
using Serilog.Core;
using Microsoft.Extensions.Logging.Abstractions;
using scan3.Infrastructure.Logging;
namespace scan3.ViewModels
{
    public class MainViewModel : INotifyPropertyChanged
    {
        
        public ICommand ListaScannersCommand { get; }
        public ICommand ScanCommand { get; }
        private readonly ILogger<MainViewModel> _logger;
        // Constructor sin parámetros para XAML
        public MainViewModel() : this(GlobalLogger.GetLogger<MainViewModel>())
        {
        }
        public MainViewModel(ILogger<MainViewModel> logger)
        {
            _logger = logger;
            Scanners = new ObservableCollection<string>();
            ScannedImages = new ObservableCollection<ImageSource>();
            ListaScannersCommand = new RelayCommand(LoadScanners);
            ScanCommand = new RelayCommand(ExecuteScan, CanScan);
            _logger.LogInformation("MainViewModel inicializado correctamente");
        }
        // Constructor con Logger para uso en otras partes del código
        // Implementación de INotifyPropertyChanged
        public event PropertyChangedEventHandler PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
        public ObservableCollection<string> Scanners { get; set; }
        private string _selectedScanner;
        public string SelectedScanner
        {
            get => _selectedScanner;
            set
            {
                _selectedScanner = value;
                OnPropertyChanged();
            }
        }
        public ObservableCollection<ImageSource> ScannedImages { get; set; }
        private ImageSource _selectedImage;
        public ImageSource SelectedImage
        {
            get => _selectedImage;
            set
            {
                _selectedImage = value;
                OnPropertyChanged();
            }
        }
        // Método para cargar los dispositivos escáner
        private void LoadScanners()
        {
            try
            {
                Scanners.Clear();
                var manager = new WiaDeviceManager();
                var deviceInfos = manager.GetDeviceInfos().ToList();
                foreach (var device in deviceInfos)
                {
                    Scanners.Add(device.Name());
                }
                _logger?.LogInformation("Escáneres cargados correctamente: {Count}", Scanners.Count);
            }
            catch (WiaException ex)
            {
                _logger?.LogError(ex, "Error al cargar los dispositivos de escaneo: {Message}", ex.Message);
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error inesperado al cargar los escáneres: {Message}", ex.Message);
            }
        }
        // Método para ejecutar el escaneo
        /*private void ExecuteScan()
        {
            try
            {
                if (SelectedScanner != null)
                {
                    var manager = new WiaDeviceManager();
                    var devices = manager.GetDeviceInfos();
                    var deviceInfo = devices.FirstOrDefault(d =>
                    {
                        var deviceName = d.Properties[WiaPropertyId.DIP_DEV_NAME].Value?.ToString();
                        return !string.IsNullOrEmpty(deviceName) && deviceName.Equals(SelectedScanner, StringComparison.OrdinalIgnoreCase);
                    });

                    if (deviceInfo != null)
                    {
                        var wiaDevice = manager.FindDevice(deviceInfo.Id());

                        // Obtener el estado del ADF
                        int estadoADF = (int)wiaDevice.Properties[WiaPropertyId.DPS_DOCUMENT_HANDLING_STATUS].Value;
                        string mensajeEstadoADF = WiaPropertyValue.InterpretarEstadoADF(estadoADF);

                        _logger?.LogInformation("Estado del ADF: {MensajeEstado}", mensajeEstadoADF);

                        if (estadoADF != WiaPropertyValue.FEED_READY)
                        {
                            MessageBox.Show("No hay papel en el ADF o el ADF no está listo: " + mensajeEstadoADF, "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
                            return;
                        }

                        var scanItem = wiaDevice.GetSubItems().FirstOrDefault();
                        if (scanItem != null)
                        {
                            var transfer = scanItem.StartTransfer();
                            transfer.PageScanned += (sender, args) =>
                            {
                                using (var stream = args.Stream)
                                {
                                    var bitmapImage = ConvertToImageSource(stream);
                                    ScannedImages.Add(bitmapImage);
                                }
                            };

                            if (transfer.Download())
                            {
                                _logger.LogInformation("Escaneo completado exitosamente con el dispositivo: {DeviceName}", SelectedScanner);
                            }
                            else
                            {
                                _logger.LogWarning("El usuario canceló la transferencia del escaneo.");
                            }
                        }
                        else
                        {
                            _logger.LogWarning("No se encontraron elementos para escanear en el dispositivo: {DeviceName}", SelectedScanner);
                        }
                    }
                    else
                    {
                        _logger.LogWarning("No se encontró el dispositivo seleccionado: {DeviceName}", SelectedScanner);
                    }
                }
            }
            catch (WiaException ex)
            {
                _logger.LogError(ex, "Error durante el escaneo con el dispositivo {DeviceName}: {Message}", SelectedScanner, ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error inesperado durante el escaneo: {Message}", ex.Message);
            }
        }*/
        private void ExecuteScan()
        {
            try
            {
                if (SelectedScanner != null)
                {
                    var manager = new WiaDeviceManager();
                    var devices = manager.GetDeviceInfos();
                    var deviceInfo = devices.FirstOrDefault(d =>
                    {
                        var deviceName = d.Properties[WiaPropertyId.DIP_DEV_NAME].Value?.ToString();
                        return !string.IsNullOrEmpty(deviceName) && deviceName.Equals(SelectedScanner, StringComparison.OrdinalIgnoreCase);
                    });

                    if (deviceInfo != null)
                    {
                        var wiaDevice = manager.FindDevice(deviceInfo.Id());

                        // Obtener el estado del ADF
                        var valueObject = wiaDevice.Properties[WiaPropertyId.DPS_DOCUMENT_HANDLING_STATUS].Value;
                        if (valueObject is int estadoADF)
                        {
                            string mensajeEstadoADF = WiaPropertyValue.InterpretarEstadoADF(estadoADF);
                            _logger?.LogInformation("Estado del ADF interpretado: {MensajeEstado} (Valor recibido: {EstadoADF})", mensajeEstadoADF, estadoADF);

                            // Verificar si el ADF tiene papel
                            if (!IsADFReady(wiaDevice))
                            {
                                var result = MessageBox.Show("No hay papel en el ADF o el ADF no está listo: " + mensajeEstadoADF + "\n¿Desea utilizar el cristal plano (flatbed) para escanear?", "ADF No Listo", MessageBoxButton.YesNo, MessageBoxImage.Question);
                                if (result == MessageBoxResult.No)
                                {
                                    _logger.LogInformation("El usuario eligió no continuar con el escaneo usando el cristal plano.");
                                    return;
                                }
                                else
                                {
                                    _logger.LogInformation("El usuario eligió continuar con el escaneo usando el cristal plano.");
                                    // Cambiar la configuración del dispositivo para usar el cristal plano
                                    wiaDevice.Properties[WiaPropertyId.DPS_DOCUMENT_HANDLING_SELECT].Value = WiaPropertyValue.FLATBED;
                                }
                            }

                            // Proceder con el escaneo si ADF está listo o si se elige el cristal plano
                            var scanItem = wiaDevice.GetSubItems().FirstOrDefault();
                            if (scanItem != null)
                            {
                                var transfer = scanItem.StartTransfer();
                                transfer.PageScanned += (sender, args) =>
                                {
                                    using (var stream = args.Stream)
                                    {
                                        var bitmapImage = ConvertToImageSource(stream);
                                        ScannedImages.Add(bitmapImage);
                                    }
                                };

                                if (transfer.Download())
                                {
                                    _logger.LogInformation("Escaneo completado exitosamente con el dispositivo: {DeviceName}", SelectedScanner);
                                }
                                else
                                {
                                    _logger.LogWarning("El usuario canceló la transferencia del escaneo.");
                                }
                            }
                            else
                            {
                                _logger.LogWarning("No se encontraron elementos para escanear en el dispositivo: {DeviceName}", SelectedScanner);
                            }
                        }
                        else
                        {
                            _logger?.LogWarning("El valor obtenido del ADF no es un entero válido: {Value}", valueObject);
                        }
                    }
                    else
                    {
                        _logger.LogWarning("No se encontró el dispositivo seleccionado: {DeviceName}", SelectedScanner);
                    }
                }
            }
            catch (WiaException ex)
            {
                _logger.LogError(ex, "Error durante el escaneo con el dispositivo {DeviceName}: {Message}", SelectedScanner, ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error inesperado durante el escaneo: {Message}", ex.Message);
            }
        }


        // Determina si se puede escanear
        private bool CanScan()
        {
            return !string.IsNullOrEmpty(SelectedScanner);
        }
        // Método para convertir la imagen escaneada en ImageSource
        private ImageSource ConvertToImageSource(Stream scannedStream)
        {
            try
            {
                scannedStream.Position = 0;

                var bitmapImage = new BitmapImage();
                bitmapImage.BeginInit();
                bitmapImage.StreamSource = scannedStream;
                bitmapImage.CacheOption = BitmapCacheOption.OnLoad;
                bitmapImage.EndInit();

                return bitmapImage;
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error al convertir la imagen escaneada a ImageSource: {Message}", ex.Message);
                return null;
            }
        }
        public bool IsADFReady(WiaDevice wiaDevice)
        {
            try
            {
                // Obtener la propiedad de estado de manejo de documentos
                var handlingStatusProperty = wiaDevice.Properties[WiaPropertyId.DPS_DOCUMENT_HANDLING_STATUS];
                if (handlingStatusProperty != null)
                {
                    int handlingStatus = (int)handlingStatusProperty.Value;
                    _logger?.LogInformation("Estado del ADF: {HandlingStatus}", handlingStatus);

                    // Verificar si el ADF está listo con papel
                    if ((handlingStatus & WiaPropertyValue.FEED_READY) != 0)
                    {
                        return true;
                    }
                    else
                    {
                        _logger?.LogWarning("El ADF no tiene papel o no está listo.");
                    }
                }
                else
                {
                    _logger?.LogWarning("No se pudo obtener la propiedad DPS_DOCUMENT_HANDLING_STATUS del dispositivo.");
                }
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error al verificar si el ADF tiene papel: {Message}", ex.Message);
            }

            // Si no hay papel o hubo un error, devolver false
            return false;
        }
    }
}

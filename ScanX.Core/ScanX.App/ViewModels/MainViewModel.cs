using ScanX.App.Helpers;
using ScanX.App.Models;
using ScanX.App.Views;
using ScanX.Args;
using ScanX.Models;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using ScanX.Exceptions;
using ScanX.App.Loggers;
using static ScanX.Models.ScanSetting;

namespace ScanX.App.ViewModels
{
    public class MainViewModel : BaseViewModel
    {
        private ScannerDevice _selectedDevice;

        private PageSize _selectedPageSize = PageSize.A4;
        public ObservableCollection<Media> Media { get; set; } = new ObservableCollection<Media>();
        public ICommand ListPrintersCommand { get; private set; }
        public ICommand ListScannersCommand { get; private set; }
        public ICommand ScanCommand { get; private set; }
        public ICommand ScanMultipleCommand { get; private set; }
        public ICommand ShowDeviceWindowCommand { get; private set; }
        private DeviceClient _service;
        public PageSize SelectedPageSize
        {
            get { return _selectedPageSize; }
            set { _selectedPageSize = value; RaisePropertyChanged(); }
        }
        // Enumerar todos los tamaños de página disponibles      
        private Media _selectedMedia;
        private ScanSetting.DPI _selectedDpi = ScanSetting.DPI.DPI_72;
        public ObservableCollection<string> Printers { get; set; } = new ObservableCollection<string>();
        public ObservableCollection<ScannerDevice> Scanners { get; set; } = new ObservableCollection<ScannerDevice>();
        public ScannerDevice SelectedDevice
        {
            get
            {
                return _selectedDevice;
            }
            set
            {
                if (_selectedDevice != value)
                {
                    _selectedDevice = value;
                    RaisePropertyChanged();
                }
            }
        }
        public DeviceClient Service
        {
            get
            {
                if (_service == null)
                    _service = new DeviceClient();

                return _service;
            }
            set { _service = value; }
        }
        private async Task Scan()
        {
            try
            {
                if (SelectedDevice == null)
                {
                    throw new ScanXException("No scanner device selected", ScanXExceptionCodes.NoDevice);
                }

                ScanSetting setting = new ScanSetting()
                {
                    Color = SelectedColorMode,
                    Dpi = SelectedDpi,
                    UseAdf = UseAdf,
                    UseDuplex = UseDuplex
                };

                var (width, height) = ScanSetting.GetA4SizeByDpi(SelectedPageSize, (int)SelectedDpi);
                setting.PageWidth = width;
                setting.PageHeight = height;

                // Log de las propiedades de escaneo antes de realizarlo
                Logger.LogInfo($"Attempting to scan with settings: Color={setting.Color}, Dpi={setting.Dpi}, UseAdf={setting.UseAdf}, UseDuplex={setting.UseDuplex}");

                // Verificar si el ADF está activado y si hay documentos presentes
                if (setting.UseAdf)
                {
                    bool isAdfLoaded = Service.IsAdfLoaded(SelectedDevice.DeviceId);
                    if (!isAdfLoaded)
                    {
                        throw new ScanXException("No documents found in the ADF", ScanXExceptionCodes.NoPaper);
                    }
                    Logger.LogInfo("Documents found in the ADF. Proceeding with scan.");
                }

                // Supongamos que `Service.Scan` lanza excepciones relacionadas con el escaneo.
                Service.Scan(SelectedDevice.DeviceId, setting);

                await Task.CompletedTask;
            }
            catch (ScanXException ex)
            {
                // Manejar excepciones específicas del escaneo
                Logger.LogError($"Scan failed with code {ex.Code}: {ex.Message}", ex);
                MessageBox.Show($"Error while scanning: {ex.Message}", "Scan Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            catch (Exception ex)
            {
                // Manejar cualquier otra excepción
                Logger.LogError("An unexpected error occurred during the scanning process.", ex);
                MessageBox.Show("An unexpected error occurred during the scanning process.", "Unexpected Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
        private async Task ScanMultiple()
        {
            if (SelectedDevice == null)
            {
                MessageBox.Show("Please select a scanner from the scanner list", "Select scanner", MessageBoxButton.OK, MessageBoxImage.Information, MessageBoxResult.OK);
                return;
            }

            ScanSetting setting = new ScanSetting()
            {
                Color = SelectedColorMode,
                Dpi = SelectedDpi,
                UseAdf = UseAdf,
                UseDuplex = UseDuplex
            };

            await Task.Run(() => { Service.Scan(SelectedDevice.DeviceId, setting, true); });

            await Task.CompletedTask;
        }
        private async void OnImageScanned(object sender, EventArgs e)
        {
            var args = e as DeviceImageScannedEventArgs;

            await Application.Current.Dispatcher.BeginInvoke(new Action(async () =>
            {
                var media = new Media()
                {
                    Size = args.ImageBytes.Length,
                    Page = args.Page,
                    Source = await ImageConverter.ConvertToImageSource(args.ImageBytes)
                };

                Media.Add(media);
            }), System.Windows.Threading.DispatcherPriority.Normal);
        }
        private bool _autoPageSize = false;
        public bool AutoPageSize
        {
            get { return _autoPageSize; }
            set
            {
                if (_autoPageSize != value)
                {
                    _autoPageSize = value;
                    RaisePropertyChanged();
                    UpdatePageSizeAutomatically();
                }
            }
        }
        private void UpdatePageSizeAutomatically()
        {
            if (AutoPageSize)
            {
                // Si AutoPageSize está activado, configura un valor predeterminado, por ejemplo, A4.
                SelectedPageSize = PageSize.A4;
            }
        }        
        public ScanSetting.DPI SelectedDpi
        {
            get { return _selectedDpi; }
            set { _selectedDpi = value; RaisePropertyChanged(); }
        }
        private ScanSetting.ColorModel _selectedColorMode = ScanSetting.ColorModel.Color;
        public ScanSetting.ColorModel SelectedColorMode
        {
            get { return _selectedColorMode; }
            set { _selectedColorMode = value; RaisePropertyChanged(); }
        }
        private bool _useAdf = false;
        public bool UseAdf
        {
            get { return _useAdf; }
            set { _useAdf = value; RaisePropertyChanged(); }
        }
        private bool _useDuplex = false;
        public bool UseDuplex
        {
            get { return _useDuplex; }
            set { _useDuplex = value; RaisePropertyChanged(); }
        }
        private void SetCommands()
        {
            ListPrintersCommand = new RelayCommand(async (arg) => { await ListPrinters(); });
            ListScannersCommand = new RelayCommand(async (arg) => { await ListScanners(); });
            ScanCommand = new RelayCommand(async (arg) => { await Scan(); });
            ShowDeviceWindowCommand = new RelayCommand(async (arg) => { await ShowDeviceWindow(); });
            ScanMultipleCommand = new RelayCommand(async (arg) => { await ScanMultiple(); });
        }
        private async Task ListScanners()
        {
            Scanners.Clear();

            var result = Service.GetAllScanners();

            foreach (var item in result)
            {
                Scanners.Add(item);
            }

            await Task.CompletedTask;
        }
        private async Task ListPrinters()
        {
            Printers.Clear();

            var result = Service.GetAllPrinters();

            foreach (var item in result)
            {
                Printers.Add(item);
            }

            await Task.CompletedTask;
        }
        private async Task ShowDeviceWindow()
        {
            DeviceWindow window = new DeviceWindow();
            window.Show();
            await Task.CompletedTask;
        }
        public IEnumerable<ScanSetting.DPI> Dpi
        {
            get
            {
                return Enum.GetValues(typeof(ScanSetting.DPI))
                    .Cast<ScanSetting.DPI>();
            }
        }
        public IEnumerable<ScanSetting.ColorModel> ColorMode
        {
            get
            {
                return Enum.GetValues(typeof(ScanSetting.ColorModel))
                    .Cast<ScanSetting.ColorModel>();
            }
        }
        public Media SelectedMedia
        {
            get
            {
                return _selectedMedia;
            }
            set
            {
                if (_selectedMedia != value)
                {
                    _selectedMedia = value;
                    RaisePropertyChanged();
                }
            }
        }
        public MainViewModel()
        {
            SetCommands();
            Service.OnImageScanned += OnImageScanned;
        }
        public IEnumerable<PageSize> PageSizes
        {
            get
            {
                return Enum.GetValues(typeof(PageSize))
                    .Cast<PageSize>();
            }
        }


        /* private async Task Scan()
         {
             try
             {
                 if (SelectedDevice == null)
                 {
                     throw new ScanXException("No scanner device selected", ScanXExceptionCodes.NoDevice);
                 }

                 ScanSetting setting = new ScanSetting()
                 {
                     Color = SelectedColorMode,
                     Dpi = SelectedDpi,
                     UseAdf = UseAdf,
                     UseDuplex = UseDuplex
                 };

                 // Log de las propiedades de escaneo antes de realizarlo
                 Logger.LogInfo($"Attempting to scan with settings: Color={setting.Color}, Dpi={setting.Dpi}, UseAdf={setting.UseAdf}, UseDuplex={setting.UseDuplex}");

                 // Verificar si el ADF está activado y si hay documentos presentes
                 if (setting.UseAdf)
                 {
                     bool isAdfLoaded = Service.IsAdfLoaded(SelectedDevice.DeviceId);
                     if (!isAdfLoaded)
                     {
                         throw new ScanXException("No documents found in the ADF", ScanXExceptionCodes.NoPaper);
                     }
                     Logger.LogInfo("Documents found in the ADF. Proceeding with scan.");
                 }

                 // Supongamos que `Service.Scan` lanza excepciones relacionadas con el escaneo.
                 Service.Scan(SelectedDevice.DeviceId, setting);

                 await Task.CompletedTask;
             }
             catch (ScanXException ex)
             {
                 // Manejar excepciones específicas del escaneo
                 Logger.LogError($"Scan failed with code {ex.Code}: {ex.Message}", ex);
                 MessageBox.Show($"Error while scanning: {ex.Message}", "Scan Error", MessageBoxButton.OK, MessageBoxImage.Error);
             }
             catch (Exception ex)
             {
                 // Manejar cualquier otra excepción
                 Logger.LogError("An unexpected error occurred during the scanning process.", ex);
                 MessageBox.Show("An unexpected error occurred during the scanning process.", "Unexpected Error", MessageBoxButton.OK, MessageBoxImage.Error);
             }
         }*/

    }
}

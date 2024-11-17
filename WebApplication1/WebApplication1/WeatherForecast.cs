    using Microsoft.AspNetCore.Mvc;
    using NTwain;
    using NTwain.Data;
    using System.Collections.Generic;
    using System.IO;
    using System.Threading.Tasks;
    using System;
    using PdfSharpCore.Pdf;
    using PdfSharpCore.Drawing;
    using System.Drawing; // Necesario para trabajar con imágenes
    using System.Drawing.Imaging;
    using static System.Net.Mime.MediaTypeNames;
    using System.Security.Principal;

    namespace WebApplication1
    {
        [Route("api/[controller]")]
        [ApiController]
        public class ScannerController : ControllerBase
        {
            private TwainSession _twainSession;

            // Constructor para inicializar TWAIN
            public ScannerController()
            {
                Console.WriteLine("Inicializando sesión TWAIN...");
                _twainSession = new TwainSession(TWIdentity.CreateFrom(TWIdnttyApp), null);
            }

            // Endpoint para listar todos los escáneres disponibles
            [HttpGet("scanners")]
            public ActionResult<IEnumerable<string>> GetScanners()
            {
                try
                {
                    Console.WriteLine("Intentando abrir la sesión TWAIN para listar los escáneres...");
                    _twainSession.Open();

                    List<string> scannerList = new List<string>();

                    // Utilizar NTwain para obtener la lista de escáneres TWAIN
                    foreach (var source in _twainSession)
                    {
                        Console.WriteLine($"Escáner encontrado: {source.Name}");
                        scannerList.Add(source.Name);
                    }

                    _twainSession.Close();
                    Console.WriteLine("Lista de escáneres obtenida con éxito.");

                    return Ok(scannerList);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error al obtener la lista de escáneres: {ex.Message}");
                    return StatusCode(500, $"Error al obtener la lista de escáneres: {ex.Message}");
                }
            }

            // Endpoint para escanear un documento
            [HttpPost("scan")]
            public async Task<IActionResult> ScanDocument([FromBody] ScanOptions options)
            {
                try
                {
                    Console.WriteLine("Iniciando proceso de escaneo...");

                    // Verificar si se ha proporcionado el nombre del escáner
                    if (string.IsNullOrEmpty(options.ScannerName))
                    {
                        Console.WriteLine("Error: No se ha proporcionado un nombre de escáner válido.");
                        return BadRequest("Debe proporcionar un nombre de escáner válido.");
                    }

                    _twainSession.Open();
                    Console.WriteLine($"Sesión TWAIN abierta. Buscando el escáner con el nombre: {options.ScannerName}");

                    // Buscar el escáner que queremos usar
                    var scanner = _twainSession.FirstOrDefault(source => source.Name == options.ScannerName);
                    if (scanner == null)
                    {
                        Console.WriteLine("Error: Escáner no encontrado.");
                        return NotFound("Escáner no encontrado.");
                    }

                    scanner.Open();
                    Console.WriteLine($"Escáner {options.ScannerName} encontrado y abierto. Configurando opciones de escaneo...");

                    // Configurar las opciones del escáner seleccionado
                    scanner.Capabilities.ICapPixelType.SetValue((TWPixelType)Enum.Parse(typeof(TWPixelType), options.ModoColor));
                    scanner.Capabilities.ICapXResolution.SetValue(options.Resolucion);
                    scanner.Capabilities.ICapYResolution.SetValue(options.Resolucion);
                    scanner.Capabilities.ICapFeederEnabled.SetValue(options.Fuente == "adf");
                    scanner.Capabilities.ICapDuplexEnabled.SetValue(options.Duplex);

                    // Realizar el escaneo
                    Console.WriteLine("Iniciando escaneo...");
                    var scannedImage = await Task.Run(() => scanner.Acquire().FirstOrDefault());

                    if (scannedImage == null)
                    {
                        throw new Exception("No se pudo adquirir la imagen.");
                    }

                    Console.WriteLine("Escaneo completado con éxito. Generando archivo de salida...");

                    // Generar el archivo en el formato solicitado
                    string outputPath = await GenerateOutput(scannedImage, options.OutputFormat);
                    Console.WriteLine($"Archivo generado exitosamente en la ruta: {outputPath}");

                    scanner.Close();
                    _twainSession.Close();

                    return Ok(new { rutaArchivo = outputPath });
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error al escanear el documento: {ex.Message}");
                    return StatusCode(500, $"Error al escanear el documento: {ex.Message}");
                }
            }

            // Método para generar el archivo escaneado en el formato solicitado
            private async Task<string> GenerateOutput(byte[] scanResult, string outputFormat)
            {
                string outputPath = Path.Combine("public/uploads", $"documentoEscaneado_{Guid.NewGuid()}");

                // Seleccionar el formato de salida
                switch (outputFormat.ToLower())
                {
                    case "pdf":
                        outputPath += ".pdf";
                        using (var doc = new PdfDocument())
                        {
                            var page = doc.AddPage();
                            using (var graphics = XGraphics.FromPdfPage(page))
                            using (var imageStream = new MemoryStream(scanResult))
                            {
                                var image = XImage.FromStream(imageStream);
                                graphics.DrawImage(image, 0, 0, page.Width, page.Height);
                            }

                            using (var fileStream = new FileStream(outputPath, FileMode.Create))
                            {
                                doc.Save(fileStream);
                            }
                        }
                        break;

                    case "tiff":
                        outputPath += ".tiff";
                        await SaveAsImageAsync(scanResult, outputPath, ImageFormat.Tiff);
                        break;

                    case "jpg":
                    case "jpeg":
                        outputPath += ".jpg";
                        await SaveAsImageAsync(scanResult, outputPath, ImageFormat.Jpeg);
                        break;

                    case "png":
                        outputPath += ".png";
                        await SaveAsImageAsync(scanResult, outputPath, ImageFormat.Png);
                        break;

                    default:
                        throw new ArgumentException("Formato de salida no soportado");
                }

                Console.WriteLine($"Archivo de salida generado: {outputPath}");
                return outputPath;
            }

            // Método auxiliar para guardar la imagen en el formato especificado
            private async Task SaveAsImageAsync(byte[] imageBytes, string outputPath, ImageFormat format)
            {
                using (var ms = new MemoryStream(imageBytes))
                using (var image = Image.FromStream(ms))
                {
                    await Task.Run(() => image.Save(outputPath, format));
                    Console.WriteLine($"Imagen guardada en {outputPath} con formato {format}");
                }
            }
        }

        // Clase auxiliar para definir las opciones de escaneo
        public class ScanOptions
        {
            public string ScannerName { get; set; }
            public string Fuente { get; set; } // Cristal o ADF
            public string ModoColor { get; set; } // Color, Gris, BN
            public bool Duplex { get; set; } // Sí o No
            public int Resolucion { get; set; } // DPI
            public string OutputFormat { get; set; } // PDF, TIFF, JPG, PNG
        }
    }

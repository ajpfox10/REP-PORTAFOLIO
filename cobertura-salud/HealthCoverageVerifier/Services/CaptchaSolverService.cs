using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Services;

public class CaptchaSolverService
{
    private readonly ImageProcessor _imageProcessor;
    private readonly OcrEngine _ocrEngine;

    public CaptchaSolverService()
    {
        _imageProcessor = new ImageProcessor();
        _ocrEngine = new OcrEngine();
    }

    public async Task<CaptchaResult> SolveCaptchaAsync(string imagePath)
    {
        var stopwatch = Stopwatch.StartNew();
        var result = new CaptchaResult
        {
            FilePath = imagePath,
            FileName = Path.GetFileName(imagePath),
            Timestamp = DateTime.Now
        };

        try
        {
            // Metodo 1: OCR basico
            var processedPath = _imageProcessor.PreprocessImage(imagePath);
            var ocrResult = _ocrEngine.ExtractText(processedPath);

            if (ocrResult.Success && ocrResult.Confidence >= 0.4)
            {
                result.Success = true;
                result.Text = ocrResult.Text;
                result.Confidence = ocrResult.Confidence;
                result.Method = "OCR Basico";
            }
            else
            {
                // Metodo 2: Procesamiento avanzado
                var advancedPath = _imageProcessor.AdvancedPreprocess(imagePath);
                var advancedResult = _ocrEngine.ExtractTextWithWhitelist(advancedPath);

                if (advancedResult.Success && advancedResult.Confidence >= 0.3)
                {
                    result.Success = true;
                    result.Text = advancedResult.Text;
                    result.Confidence = advancedResult.Confidence;
                    result.Method = "OCR Avanzado";
                }
                else
                {
                    // Metodo 3: Segmentacion de caracteres
                    var chars = _imageProcessor.SegmentCharacters(imagePath);
                    if (chars.Count > 0)
                    {
                        string finalText = "";
                        double totalConf = 0;
                        foreach (var charPath in chars)
                        {
                            var charResult = _ocrEngine.ExtractText(charPath);
                            finalText += charResult.Text;
                            totalConf += charResult.Confidence;
                            try { File.Delete(charPath); } catch { }
                        }
                        result.Text = finalText;
                        result.Confidence = totalConf / chars.Count;
                        result.Success = result.Confidence >= 0.25 && !string.IsNullOrEmpty(finalText);
                        result.Method = "Segmentacion";
                    }
                }
            }

            if (!result.Success)
            {
                result.Suggestion = "Prueba con una imagen de mejor calidad o ajusta los parametros";
            }
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        stopwatch.Stop();
        result.ProcessingTimeMs = stopwatch.ElapsedMilliseconds;
        return result;
    }
}

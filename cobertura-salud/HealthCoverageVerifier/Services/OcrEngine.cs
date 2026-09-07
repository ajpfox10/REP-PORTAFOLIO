using System;
using System.IO;
using System.Linq;
using Tesseract;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Services;

public class OcrEngine
{
    private readonly string _tessDataPath;

    public OcrEngine()
    {
        _tessDataPath = Path.Combine(AppContext.BaseDirectory, "tessdata");
        if (!Directory.Exists(_tessDataPath))
            Directory.CreateDirectory(_tessDataPath);
    }

    public OcrResult ExtractText(string imagePath)
    {
        var result = new OcrResult();
        try
        {
            using var engine = new TesseractEngine(_tessDataPath, "eng", EngineMode.Default);
            engine.SetVariable("tessedit_char_whitelist", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
            using var pix = Pix.LoadFromFile(imagePath);
            using var page = engine.Process(pix);
            result.Text = page.GetText().Trim();
            result.Confidence = page.GetMeanConfidence();
            result.Success = !string.IsNullOrEmpty(result.Text) && result.Confidence > 0.2;
        }
        catch (Exception ex) { result.ErrorMessage = ex.Message; }
        return result;
    }

    public OcrResult ExtractTextWithWhitelist(string imagePath)
    {
        var result = new OcrResult();
        try
        {
            using var engine = new TesseractEngine(_tessDataPath, "eng", EngineMode.TesseractAndLstm);
            engine.SetVariable("tessedit_char_whitelist", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
            engine.SetVariable("tessedit_pageseg_mode", "7");
            using var pix = Pix.LoadFromFile(imagePath);
            using var page = engine.Process(pix);
            result.Text = CleanText(page.GetText());
            result.Confidence = page.GetMeanConfidence();
            result.Success = !string.IsNullOrEmpty(result.Text) && result.Confidence > 0.2;
        }
        catch (Exception ex) { result.ErrorMessage = ex.Message; }
        return result;
    }

    private static string CleanText(string text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return new string(text.Where(c => char.IsLetterOrDigit(c)).ToArray());
    }
}

using System;

namespace HealthCoverageVerifier.Models;

public class CaptchaResult
{
    public string FilePath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public bool Success { get; set; }
    public double Confidence { get; set; }
    public string Method { get; set; } = string.Empty;
    public long ProcessingTimeMs { get; set; }
    public DateTime Timestamp { get; set; }
    public string ErrorMessage { get; set; } = string.Empty;
    public string Suggestion { get; set; } = string.Empty;
}

public class OcrResult
{
    public string Text { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public bool Success { get; set; }
    public string ErrorMessage { get; set; } = string.Empty;
}

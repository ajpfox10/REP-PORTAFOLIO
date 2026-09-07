using System;
using System.Collections.Concurrent;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Services;

/// <summary>
/// Consulta asistida a SSS (Padron de beneficiarios).
/// El operador resuelve el captcha dentro de la app: el backend abre la sesion,
/// devuelve la imagen del captcha, y al recibir el codigo envia el formulario y
/// extrae el resultado. No se resuelve captcha automaticamente.
/// </summary>
public sealed class SssService
{
    const string PageUrl = "https://www.sssalud.gob.ar/?page=bus650";
    const string ImageUrl = "https://www.sssalud.gob.ar/simage/securimage_show.php";
    const string PostUrl = "https://www.sssalud.gob.ar/index.php?page=bus650&user=GRAL&cat=consultas";
    const string UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

    readonly ConcurrentDictionary<string, SssPending> _sessions = new();

    public SssService() { }

    public async Task<SssStart> StartAsync(PatientInput patient)
    {
        Cleanup();
        var cookies = new CookieContainer();
        using var handler = new HttpClientHandler
        {
            CookieContainer = cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var http = CreateClient(handler);

        using (var pageResp = await http.GetAsync(PageUrl))
            pageResp.EnsureSuccessStatusCode();

        var sid = Guid.NewGuid().ToString("N");
        byte[] image;
        using (var imgResp = await http.GetAsync($"{ImageUrl}?sid={sid}"))
        {
            imgResp.EnsureSuccessStatusCode();
            image = await imgResp.Content.ReadAsByteArrayAsync();
        }
        if (image.Length == 0)
            throw new InvalidOperationException("SSS no devolvio la imagen del captcha.");

        var sessionId = Guid.NewGuid().ToString("N");
        _sessions[sessionId] = new SssPending(cookies, patient, DateTime.UtcNow);
        return new SssStart(sessionId, $"data:image/png;base64,{Convert.ToBase64String(image)}", patient.Cuil, patient.Dni);
    }

    public async Task<SssResolveResult> ResolveAsync(string sessionId, string code)
    {
        Cleanup();
        if (!_sessions.TryRemove(sessionId, out var pending))
            return SssResolveResult.Fault("sesion_expirada",
                "La sesion del captcha vencio. Volve a abrir la consulta de SSS.");

        using var handler = new HttpClientHandler
        {
            CookieContainer = pending.Cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var http = CreateClient(handler);

        var form = new Dictionary<string, string>
        {
            ["pagina_consulta"] = "",
            ["cuil_b"] = pending.Patient.Cuil ?? "",
            ["nro_doc"] = pending.Patient.Dni ?? "",
            ["code"] = (code ?? "").Trim(),
            ["B1"] = "Consultar"
        };

        string html;
        try
        {
            using var resp = await http.PostAsync(PostUrl, new FormUrlEncodedContent(form));
            html = await resp.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            return SssResolveResult.Fault("error_fuente", $"No se pudo consultar SSS: {ex.Message}");
        }

        return Interpret(html, pending.Patient);
    }

    static SssResolveResult Interpret(string html, PatientInput patient)
    {
        var text = HtmlToText(html);

        var captchaDeNuevo = Regex.IsMatch(html, @"securimage_show\.php|name=[""']?code[""']?", RegexOptions.IgnoreCase);
        var errorCodigo = Regex.IsMatch(text, "c[oó]digo", RegexOptions.IgnoreCase)
                          && Regex.IsMatch(text, "incorrecto|inv[aá]lid|erron", RegexOptions.IgnoreCase);
        if (captchaDeNuevo && (errorCodigo || text.Length < 400))
            return new SssResolveResult("captcha_incorrecto",
                "El codigo del captcha no fue aceptado. Se abrio un captcha nuevo, reintenta.",
                null, null, Snippet(text), patient);

        var negativo = Regex.Match(text, "no registra|sin cobertura|no se encontr|no existen datos|no posee",
            RegexOptions.IgnoreCase);
        if (negativo.Success)
            return new SssResolveResult("sin_cobertura",
                "SSS no informa cobertura para el dato consultado.",
                false, null, Snippet(text), patient);

        var obraSocial = ExtractObraSocial(text);
        var pareceCobertura = obraSocial is not null
            || Regex.IsMatch(text, "obra social|beneficiario|os origen|os destino|monotributo",
                RegexOptions.IgnoreCase);
        if (pareceCobertura)
            return new SssResolveResult("afiliado",
                obraSocial is null ? "SSS informa cobertura." : $"SSS informa cobertura: {obraSocial}.",
                true, obraSocial, Snippet(text), patient);

        return new SssResolveResult("sin_diagnostico",
            "SSS respondio pero no se pudo clasificar automaticamente. Revisar el texto detectado.",
            null, null, Snippet(text), patient);
    }

    static string? ExtractObraSocial(string text)
    {
        var m = Regex.Match(text,
            @"(?:Obra Social|Denominaci[oó]n|OS DESTINO|OS ORIGEN)\s*[:\-]?\s*(?<os>[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,''\-/]{4,80})",
            RegexOptions.IgnoreCase);
        return m.Success ? Regex.Replace(m.Groups["os"].Value, @"\s+", " ").Trim(' ', '.', '-', ',') : null;
    }

    static string HtmlToText(string html)
    {
        var noScript = Regex.Replace(html, @"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ",
            RegexOptions.IgnoreCase);
        var text = Regex.Replace(noScript, "<[^>]+>", " ");
        return Regex.Replace(WebUtility.HtmlDecode(text), @"\s+", " ").Trim();
    }

    static string Snippet(string text) => text.Length > 1800 ? text[..1800] : text;

    static HttpClient CreateClient(HttpClientHandler handler)
    {
        var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("es-AR,es;q=0.9");
        return http;
    }

    void Cleanup()
    {
        var limit = DateTime.UtcNow.AddMinutes(-10);
        foreach (var kv in _sessions)
            if (kv.Value.CreatedAt < limit)
                _sessions.TryRemove(kv.Key, out _);
    }
}

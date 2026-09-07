using System.Collections.Concurrent;
using System.Net;
using System.Text.RegularExpressions;

// Consultas asistidas a fuentes con captcha Securimage (SSS y Servicio Domestico).
// El operador resuelve el captcha dentro de la app: el backend abre la sesion,
// devuelve la imagen del captcha, y al recibir el codigo envia el formulario y
// extrae el resultado. No se resuelve captcha automaticamente.
sealed class SssService
{
    const string UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

    readonly ConcurrentDictionary<string, SssPending> _sessions = new();

    static readonly Dictionary<string, CaptchaSource> Sources = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sss"] = new(
            "sss",
            "SSS - Padron de beneficiarios",
            "https://www.sssalud.gob.ar/?page=bus650",
            "https://www.sssalud.gob.ar/simage/securimage_show.php",
            "https://www.sssalud.gob.ar/index.php?page=bus650&user=GRAL&cat=consultas",
            (p, code) => new Dictionary<string, string>
            {
                ["pagina_consulta"] = "",
                ["cuil_b"] = p.Cuil ?? "",
                ["nro_doc"] = p.Dni ?? "",
                ["code"] = code,
                ["B1"] = "Consultar"
            },
            InterpretSss),

        ["servicio_domestico"] = new(
            "servicio_domestico",
            "SSS - Pagos Servicio Domestico",
            "https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd",
            "https://seguro.sssalud.gob.ar/simage/securimage_show.php",
            "https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd",
            (p, code) => new Dictionary<string, string>
            {
                ["nro_cuil"] = p.Cuil ?? p.Entrada,
                ["code"] = code,
                ["buscar"] = "Buscar"
            },
            InterpretServicioDomestico)
    };

    public static bool IsKnownSource(string? fuente) => Sources.ContainsKey(fuente ?? "sss");

    // Abre la sesion en la fuente y trae la imagen del captcha para que la resuelva el operador.
    public async Task<SssStart> StartAsync(string? fuente, PatientInput patient)
    {
        Cleanup();
        var source = Sources[fuente ?? "sss"];

        var cookies = new CookieContainer();
        using var handler = new HttpClientHandler
        {
            CookieContainer = cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var http = CreateClient(handler);

        using (var pageResp = await http.GetAsync(source.PageUrl))
            pageResp.EnsureSuccessStatusCode();

        var sid = Guid.NewGuid().ToString("N");
        byte[] image;
        using (var imgResp = await http.GetAsync($"{source.ImageUrl}?sid={sid}"))
        {
            imgResp.EnsureSuccessStatusCode();
            image = await imgResp.Content.ReadAsByteArrayAsync();
        }
        if (image.Length == 0)
            throw new InvalidOperationException($"{source.Nombre} no devolvio la imagen del captcha.");

        var sessionId = Guid.NewGuid().ToString("N");
        _sessions[sessionId] = new SssPending(source.Codigo, cookies, patient, DateTime.UtcNow);
        return new SssStart(sessionId, source.Codigo, source.Nombre,
            $"data:image/png;base64,{Convert.ToBase64String(image)}", patient.Cuil, patient.Dni);
    }

    // Envia CUIL/DNI + codigo del captcha resuelto por el operador y clasifica la respuesta.
    public async Task<SssResolveResult> ResolveAsync(string sessionId, string code)
    {
        Cleanup();
        if (!_sessions.TryRemove(sessionId, out var pending))
            return SssResolveResult.Fault("sesion_expirada",
                "La sesion del captcha vencio. Volve a abrir la consulta.");

        var source = Sources[pending.Fuente];

        using var handler = new HttpClientHandler
        {
            CookieContainer = pending.Cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All
        };
        using var http = CreateClient(handler);

        var form = source.BuildForm(pending.Patient, (code ?? "").Trim());

        string html;
        try
        {
            using var resp = await http.PostAsync(source.PostUrl, new FormUrlEncodedContent(form));
            html = await resp.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            return SssResolveResult.Fault("error_fuente", $"No se pudo consultar {source.Nombre}: {ex.Message}");
        }

        var result = source.Interpret(html, pending.Patient);
        return result with { Codigo = source.Codigo, Nombre = source.Nombre, Url = source.PageUrl };
    }

    static SssResolveResult InterpretSss(string html, PatientInput patient)
    {
        var text = HtmlToText(html);
        if (CaptchaReaparecio(html, text))
            return CaptchaIncorrecto(text, patient);

        if (Regex.IsMatch(text, "no registra|sin cobertura|no se encontr|no existen datos|no posee", RegexOptions.IgnoreCase))
            return new SssResolveResult("sin_cobertura",
                "SSS no informa cobertura para el dato consultado.", false, null, Snippet(text), patient);

        var obraSocial = ExtractObraSocial(text);
        var pareceCobertura = obraSocial is not null
            || Regex.IsMatch(text, "obra social|beneficiario|os origen|os destino|monotributo", RegexOptions.IgnoreCase);
        if (pareceCobertura)
            return new SssResolveResult("afiliado",
                obraSocial is null ? "SSS informa cobertura." : $"SSS informa cobertura: {obraSocial}.",
                true, obraSocial, Snippet(text), patient);

        return new SssResolveResult("sin_diagnostico",
            "SSS respondio pero no se pudo clasificar automaticamente. Revisar el texto detectado.",
            null, null, Snippet(text), patient);
    }

    static SssResolveResult InterpretServicioDomestico(string html, PatientInput patient)
    {
        var text = HtmlToText(html);
        if (CaptchaReaparecio(html, text))
            return CaptchaIncorrecto(text, patient);

        if (Regex.IsMatch(text, "no registra|no se encontr|sin pagos|no posee", RegexOptions.IgnoreCase))
            return new SssResolveResult("sin_cobertura",
                "Servicio Domestico no informa pagos para el CUIL consultado.", false, null, Snippet(text), patient);

        var fila = Regex.Match(text, @"(?<periodo>\d{2}/\d{4}).{0,120}?(?<importe>\$?\s*[0-9][0-9.,]*)", RegexOptions.IgnoreCase);
        if (fila.Success || Regex.IsMatch(text, "periodo|importe|aporte|servicio dom", RegexOptions.IgnoreCase))
        {
            var detalle = fila.Success
                ? $"Ultimo periodo {fila.Groups["periodo"].Value}, importe {CleanInline(fila.Groups["importe"].Value)}"
                : null;
            return new SssResolveResult("afiliado",
                detalle is null ? "Servicio Domestico informa pagos registrados." : $"Servicio Domestico: {detalle}.",
                true, detalle, Snippet(text), patient);
        }

        return new SssResolveResult("sin_diagnostico",
            "Servicio Domestico respondio pero no se pudo clasificar. Revisar el texto detectado.",
            null, null, Snippet(text), patient);
    }

    static bool CaptchaReaparecio(string html, string text)
    {
        var captchaVisible = Regex.IsMatch(html, @"securimage_show\.php|id=[""']?siimage|name=[""']?code[""']?", RegexOptions.IgnoreCase);
        var errorCodigo = Regex.IsMatch(text, "c[oó]digo", RegexOptions.IgnoreCase)
                          && Regex.IsMatch(text, "incorrecto|inv[aá]lid|erron", RegexOptions.IgnoreCase);
        return captchaVisible && (errorCodigo || text.Length < 400);
    }

    static SssResolveResult CaptchaIncorrecto(string text, PatientInput patient) =>
        new("captcha_incorrecto",
            "El codigo del captcha no fue aceptado. Se abrio un captcha nuevo, reintenta.",
            null, null, Snippet(text), patient);

    static string? ExtractObraSocial(string text)
    {
        var m = Regex.Match(text,
            @"(?:Obra Social|Denominaci[oó]n|OS DESTINO|OS ORIGEN)\s*[:\-]?\s*(?<os>[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,'’\-/]{4,80})",
            RegexOptions.IgnoreCase);
        return m.Success ? CleanInline(m.Groups["os"].Value).Trim(' ', '.', '-', ',') : null;
    }

    static string HtmlToText(string html)
    {
        var noScript = Regex.Replace(html, @"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", RegexOptions.IgnoreCase);
        var text = Regex.Replace(noScript, "<[^>]+>", " ");
        return CleanInline(WebUtility.HtmlDecode(text));
    }

    static string CleanInline(string value) => Regex.Replace(value, @"\s+", " ").Trim();

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

sealed record CaptchaSource(
    string Codigo,
    string Nombre,
    string PageUrl,
    string ImageUrl,
    string PostUrl,
    Func<PatientInput, string, Dictionary<string, string>> BuildForm,
    Func<string, PatientInput, SssResolveResult> Interpret);

sealed record SssPending(string Fuente, CookieContainer Cookies, PatientInput Patient, DateTime CreatedAt);

sealed record SssStart(string SessionId, string Codigo, string Nombre, string CaptchaImage, string? Cuil, string? Dni);

sealed record SssResolveResult(
    string Estado,
    string Mensaje,
    bool? Afiliado,
    string? ObraSocial,
    string TextoDetectado,
    PatientInput Paciente,
    string Codigo = "sss",
    string Nombre = "SSS - Padron de beneficiarios",
    string Url = "https://www.sssalud.gob.ar/?page=bus650")
{
    public static SssResolveResult Fault(string estado, string mensaje) =>
        new(estado, mensaje, null, null, "", new PatientInput("", null, null, null, null));
}

sealed record SssStartRequest(string? Fuente, string? Dni, string? Cuil, string? Apellido);
sealed record SssResolveRequest(string? SessionId, string? Code);

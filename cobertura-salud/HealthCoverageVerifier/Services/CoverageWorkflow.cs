using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Playwright;
using HealthCoverageVerifier.Models;

namespace HealthCoverageVerifier.Services;

public sealed class CoverageWorkflow
{
    readonly PasoDef[] pasos =
    [
        new(1, "sss", "SSS - Padron de beneficiarios", "https://www.sssalud.gob.ar/?page=bus650",
            true, "Completar CUIL/DNI y captcha. Si informa cobertura, luego validar aportes en ARCA.",
            ["cuil_b", "nro_doc", "code"]),
        new(2, "arca", "ARCA - Aportes en Linea", "https://serviciossegsoc.afip.gob.ar/MisAportes/app/basica.aspx",
            false, "Consultar CUIL o DNI/apellido y revisar Incluido en declaracion jurada y Aportes de Obra Social.",
            ["tipo_consulta", "cuil", "dni", "apellido"]),
        new(3, "anses_codem", "ANSES - CODEM", "https://servicioswww.anses.gob.ar/ooss2/",
            true, "Validar comprobante de empadronamiento; puede requerir controles del sitio.",
            ["cuil_o_dni"]),
        new(4, "sisa_puco", "SISA / PUCO", "https://sisa.msal.gov.ar/sisa/#sisa",
            true, "Requiere sesion institucional; buscar DNI/CUIL si SSS no informa cobertura.",
            ["login", "dni_o_cuil"]),
        new(5, "ioma", "IOMA - Padron de afiliados", "https://sistemas.ioma.gba.gov.ar/sistemas/buscador/buscador.html",
            false, "Consultar si declara IOMA o hay indicio de obra social provincial.",
            ["dni", "sexo_o_afiliado"]),
        new(6, "pami", "PAMI / INSSJP - Padron de afiliados", "https://prestadores.pami.org.ar/result.php?c=6-2&vm=2",
            false, "Consultar jubilados/pensionados o indicio INSSJP. Debe existir alta efectiva para facturar.",
            ["dni_o_beneficio"]),
        new(7, "servicio_domestico", "SSS - Pagos Servicio Domestico", "https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd",
            true, "Completar CUIL y captcha. Verificar ultimo periodo pago y aporte completo.",
            ["nro_cuil", "code"])
    ];

    public async Task<List<PasoResultado>> RunAsync(PatientInput patient)
    {
        var results = new List<PasoResultado>();
        foreach (var paso in pasos)
            results.Add(await CheckPageAsync(paso, patient));
        return results;
    }

    async Task<PasoResultado> CheckPageAsync(PasoDef paso, PatientInput patient)
    {
        IPlaywright? playwright = null;
        IBrowser? browser = null;
        try
        {
            playwright = await Playwright.CreateAsync();
            browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
            {
                Headless = false,
                ExecutablePath = GetChromeExecutablePath(),
                Timeout = 30000
            });
            var page = await browser.NewPageAsync(new BrowserNewPageOptions
            {
                ViewportSize = new ViewportSize { Width = 1366, Height = 850 }
            });

            IResponse? response = null;
            try
            {
                response = await page.GotoAsync(paso.Url, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 30000
                });
            }
            catch (TimeoutException)
            {
                // Algunos organismos dejan recursos pendientes; igual usamos lo visible.
            }

            await page.WaitForTimeoutAsync(900);
            var accion = "";
            try
            {
                accion = await CompletarPasoAsync(page, paso, patient);
            }
            catch (Exception ex)
            {
                accion = $"Entro a la pagina, pero el intento de carga/click produjo navegacion o cambio de pantalla: {ex.Message}";
            }
            await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded, new PageWaitForLoadStateOptions { Timeout = 6000 }).ContinueWith(_ => { });
            await page.WaitForTimeoutAsync(1200);
            var title = await SafeTitleAsync(page);
            var text = await SafeBodyTextAsync(page);
            var status = response?.Status;
            var diagnostico = await DiagnosePageAsync(page, paso, status, title, text);
            var esperaManual = "";
            if (ShouldWaitForOperator(paso, diagnostico))
            {
                esperaManual = await WaitForOperatorResultAsync(page, paso, status);
                title = await SafeTitleAsync(page);
                text = await SafeBodyTextAsync(page);
                diagnostico = await DiagnosePageAsync(page, paso, status, title, text);
            }
            var extraccion = ExtractPageResult(paso, text);
            var estado = diagnostico.HasTechnicalError ? "error" : diagnostico.RequiresOperator ? "requiere_operador" : "consultado";
            var resumen = BuildPasoSummary(paso, patient, status, title, accion, diagnostico, extraccion, esperaManual);

            return new PasoResultado(
                paso.Orden,
                paso.Codigo,
                paso.Nombre,
                page.Url,
                estado,
                diagnostico.Resultado,
                resumen,
                status,
                title,
                text.Length > 1800 ? text[..1800] : text,
                diagnostico.RequiresOperator,
                new
                {
                    paso.Campos,
                    paso.Indicacion,
                    patient.Dni,
                    patient.Cuil,
                    patient.Apellido,
                    httpStatus = status,
                    title,
                    diagnostico.RequiresOperator,
                    diagnostico.HasTechnicalError,
                    diagnostico.HasCaptcha,
                    diagnostico.HasLogin,
                    diagnostico.HasBlocking,
                    diagnostico.HasExpectedForm,
                    diagnostico.HasPositiveResult,
                    diagnostico.HasNegativeResult,
                    diagnostico.Motivo,
                    diagnostico.AccionOperativa,
                    esperaManual,
                    extraccion,
                    accion,
                    finalUrl = page.Url
                });
        }
        catch (Exception ex)
        {
            return new PasoResultado(
                paso.Orden,
                paso.Codigo,
                paso.Nombre,
                paso.Url,
                "error",
                "error_fuente",
                $"No se pudo automatizar la pagina: {ex.Message}",
                null,
                null,
                null,
                paso.RequiereOperador,
                new { paso.Campos, paso.Indicacion, error = ex.Message });
        }
        finally
        {
            if (browser is not null) await browser.CloseAsync();
            playwright?.Dispose();
        }
    }

    static async Task<string> CompletarPasoAsync(IPage page, PasoDef paso, PatientInput patient)
    {
        var dni = patient.Dni ?? Regex.Replace(patient.Entrada, @"\D", "");
        var cuil = patient.Cuil ?? patient.Entrada;
        switch (paso.Codigo)
        {
            case "sss":
                await FillIfPresent(page, "input[name='cuil_b']", patient.Cuil ?? "");
                await FillIfPresent(page, "input[name='nro_doc']", dni);
                return "Entro a SSS y cargo CUIL/DNI. No presiona Consultar porque el sitio exige captcha.";
            case "servicio_domestico":
                await FillIfPresent(page, "input[name='nro_cuil']", cuil);
                return "Entro a Servicio Domestico y cargo CUIL. No presiona Buscar porque el sitio exige captcha.";
            case "arca":
                await TryArcaAsync(page, patient);
                return "Entro a ARCA y carga el dato disponible. Si aparece reCAPTCHA, espera que el operador tilde No soy un robot y presione CONTINUAR.";
            case "anses_codem":
                await FillFirstVisible(page, Regex.Replace(patient.Cuil ?? patient.Entrada, @"\D", ""));
                await ClickTextIfPresent(page, "CONTINUAR");
                return "Entro a ANSES/CODEM, carga documento/CUIL y presiona CONTINUAR.";
            case "sisa_puco":
                await TrySisaPucoAsync(page, dni);
                return "Entro a SISA/PUCO, abre PUCO si esta visible, busca por NroDoc y presiona Buscar.";
            case "ioma":
                await FillFirstVisible(page, dni);
                await ClickTextIfPresent(page, "Buscar");
                return "Entro a IOMA e intenta buscar por DNI si hay formulario visible.";
            case "pami":
                await FillFirstVisible(page, dni);
                await ClickTextIfPresent(page, "Buscar");
                await ClickTextIfPresent(page, "Consultar");
                return "Entro a PAMI e intenta buscar por DNI/beneficio si hay formulario visible.";
            default:
                return "Entro a la pagina.";
        }
    }

    static async Task TryArcaAsync(IPage page, PatientInput patient)
    {
        var dni = patient.Dni ?? Regex.Replace(patient.Entrada, @"\D", "");
        var cuilDigits = Regex.Replace(patient.Cuil ?? "", @"\D", "");
        if (cuilDigits.Length == 11)
        {
            await CheckIfPresent(page, "#ctl00_ContentPlaceHolder2_rdbCuil");
            await FillIfPresent(page, "input[id*='txtCuil'], input[name*='txtCuil']", cuilDigits);
        }
        else
        {
            await CheckIfPresent(page, "#ctl00_ContentPlaceHolder2_rdbApellido");
            await FillIfPresent(page, "input[id$='txtDocumento'], input[name$='txtDocumento']", dni);
            await FillIfPresent(page, "input[id$='txtApellido'], input[name$='txtApellido']", patient.Apellido ?? "");
        }
        var text = await SafeBodyTextAsync(page);
        if (ContainsAny(text, GenericCaptchaText) || await AnyVisibleAsync(page, GenericCaptchaSelectors))
            return;
        await ClickSelectorIfPresent(page, "input[type='submit'][value*='CONTINUAR'], input[type='submit'][value*='Continuar']");
    }

    static async Task TrySisaPucoAsync(IPage page, string dni)
    {
        await ClickTextIfPresent(page, "Consulta de Cobertura de Salud");
        await WaitForTextAsync(page, "Padrón Único Consolidado", 12000);
        await FillLastVisible(page, dni);
        await ClickTextIfPresent(page, "Buscar");
        await WaitForTextAsync(page, dni, 12000);
    }

    static async Task FillIfPresent(IPage page, string selector, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var locator = page.Locator(selector).First;
        if (await locator.CountAsync() == 0) return;
        if (!await SafeVisibleAsync(locator, 1500)) return;
        await SafeFillAsync(locator, value);
    }

    static async Task FillFirstVisible(IPage page, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var inputs = page.Locator("input[type='text'], input:not([type])");
        var count = Math.Min(await inputs.CountAsync(), 8);
        for (var i = 0; i < count; i += 1)
        {
            var input = inputs.Nth(i);
            if (!await SafeVisibleAsync(input, 700)) continue;
            await SafeFillAsync(input, value);
            return;
        }
    }

    static async Task FillLastVisible(IPage page, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var inputs = page.Locator("input[type='text'], input:not([type])");
        var count = Math.Min(await inputs.CountAsync(), 12);
        for (var i = count - 1; i >= 0; i -= 1)
        {
            var input = inputs.Nth(i);
            if (!await SafeVisibleAsync(input, 700)) continue;
            await SafeFillAsync(input, value);
            return;
        }
    }

    static async Task CheckIfPresent(IPage page, string selector)
    {
        var locator = page.Locator(selector).First;
        if (await locator.CountAsync() == 0 || !await SafeVisibleAsync(locator, 1000)) return;
        try { await locator.CheckAsync(new LocatorCheckOptions { Timeout = 2000 }); } catch { }
    }

    static async Task ClickSelectorIfPresent(IPage page, string selector)
    {
        var locator = page.Locator(selector).First;
        if (await locator.CountAsync() == 0 || !await SafeVisibleAsync(locator, 1000)) return;
        try { await locator.ClickAsync(new LocatorClickOptions { Timeout = 3000 }); } catch { }
    }

    static async Task ClickTextIfPresent(IPage page, string text)
    {
        var locator = page.GetByText(text, new PageGetByTextOptions { Exact = false }).First;
        if (await locator.CountAsync() == 0 || !await SafeVisibleAsync(locator, 1000)) return;
        try { await locator.ClickAsync(new LocatorClickOptions { Timeout = 3000 }); } catch { }
    }

    static async Task WaitForTextAsync(IPage page, string text, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var body = await SafeBodyTextAsync(page);
            if (body.Contains(text, StringComparison.OrdinalIgnoreCase)) return;
            await page.WaitForTimeoutAsync(700);
        }
    }

    static bool ShouldWaitForOperator(PasoDef paso, PageDiagnostic diagnostico) =>
        diagnostico.Resultado is "captcha_detectado" or "formulario_listo_requiere_operador"
        && paso.Codigo is "sss" or "arca" or "servicio_domestico";

    static async Task<string> WaitForOperatorResultAsync(IPage page, PasoDef paso, int? status)
    {
        var startText = await SafeBodyTextAsync(page);
        await FocusOperatorFieldAsync(page, paso);
        var deadline = DateTime.UtcNow.AddMinutes(3);
        while (DateTime.UtcNow < deadline)
        {
            await page.WaitForTimeoutAsync(2000);
            var title = await SafeTitleAsync(page);
            var text = await SafeBodyTextAsync(page);
            var diagnostic = await DiagnosePageAsync(page, paso, status, title, text);
            var changedEnough = text.Length > 0 && !string.Equals(text, startText, StringComparison.Ordinal);
            if (changedEnough && ExtractPageResult(paso, text).Length > 0)
                return "El operador intervino y se extrajo resultado.";
            if (changedEnough && diagnostic.Resultado is not "captcha_detectado" and not "formulario_listo_requiere_operador")
                return "El operador intervino y se capturo la pantalla posterior.";
        }
        return "Tiempo de espera agotado: queda pendiente intervencion del operador.";
    }

    static async Task FocusOperatorFieldAsync(IPage page, PasoDef paso)
    {
        var selector = paso.Codigo switch
        {
            "sss" => "input[name='code']",
            "servicio_domestico" => "input[name='code']",
            _ => ""
        };
        if (selector.Length == 0) return;
        var locator = page.Locator(selector).First;
        if (await locator.CountAsync() == 0 || !await SafeVisibleAsync(locator, 1000)) return;
        try { await locator.ClickAsync(new LocatorClickOptions { Timeout = 1000 }); } catch { }
    }

    static async Task<bool> SafeVisibleAsync(ILocator locator, float timeout)
    {
        try { return await locator.IsVisibleAsync(new LocatorIsVisibleOptions { Timeout = timeout }); }
        catch { return false; }
    }

    static async Task SafeFillAsync(ILocator locator, string value)
    {
        try { await locator.FillAsync(value, new LocatorFillOptions { Timeout = 2500 }); } catch { }
    }

    static async Task<string> SafeBodyTextAsync(IPage page)
    {
        try
        {
            return CleanWhitespace(await page.Locator("body").InnerTextAsync(new LocatorInnerTextOptions { Timeout = 5000 }));
        }
        catch
        {
            return "";
        }
    }

    static async Task<string> SafeTitleAsync(IPage page)
    {
        try { return await page.TitleAsync(); }
        catch { return ""; }
    }

    static readonly string[] GenericCaptchaSelectors =
    [
        "input[name='code']",
        "input[name*='captcha']",
        "input[id*='captcha']",
        ".g-recaptcha",
        "iframe[src*='recaptcha']",
        "img[src*='captcha']",
        "img#siimage",
        "img[src*='securimage']"
    ];

    static readonly string[] GenericCaptchaText =
    [
        "captcha",
        "codigo mostrado",
        "código mostrado",
        "ingrese el codigo",
        "ingrese el código",
        "no soy un robot"
    ];

    static readonly string[] GenericLoginSelectors =
    [
        "input[type='password']",
        "input[name*='password']",
        "input[id*='password']"
    ];

    static readonly string[] GenericLoginText =
    [
        "iniciar sesion",
        "iniciar sesión",
        "usuario",
        "contraseña",
        "clave fiscal",
        "ingresar con"
    ];

    static readonly string[] GenericBlockingText =
    [
        "incapsula",
        "access denied",
        "request unsuccessful",
        "cloudflare",
        "just a moment",
        "robot",
        "validacion del sitio",
        "validación del sitio"
    ];

    static readonly string[] GenericErrorText =
    [
        "no se puede acceder a este sitio",
        "this site can't be reached",
        "err_",
        "http error",
        "service unavailable",
        "temporarily unavailable",
        "404 not found",
        "403 forbidden",
        "500 internal server error",
        "sitio en mantenimiento",
        "pagina no encontrada",
        "página no encontrada"
    ];

    static readonly Dictionary<string, PageMap> PageMaps = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sss"] = new(
            ["input[name='cuil_b']", "input[name='nro_doc']", "input[name='code']"],
            ["input[name='code']", "img#siimage", "img[src*='securimage']", "img[src*='captcha']"],
            ["codigo mostrado", "código mostrado", "beneficiarios de agentes del seguro"],
            [],
            [],
            [],
            ["error en la consulta", "no se pudo realizar la consulta"],
            ["obra social", "os origen", "os destino", "beneficiario", "monotributo"],
            ["no registra", "sin cobertura", "no se encontraron", "no existen datos"],
            "Completar el captcha en la ventana abierta y presionar Consultar.",
            "Revisar si SSS cambio la ruta o esta caido; no cargar resultado automatico.",
            "Leer cobertura, estado, OS ORIGEN y OS DESTINO."),

        ["arca"] = new(
            ["input[id*='txtCuil']", "input[name*='txtCuil']", "input[id*='txtDocumento']", "input[name*='txtDocumento']"],
            [],
            [],
            ["input[type='password']"],
            ["clave fiscal", "cuit/cuil/cdi", "ingresar con clave fiscal"],
            [],
            ["error de servidor", "runtime error", "aplicacion no disponible"],
            ["incluido en declaracion jurada", "incluido en declaración jurada", "aportes de obra social", "periodo"],
            ["no registra aportes", "no se encontraron registros"],
            "Resolver la validacion/login si el sitio la pide; no se saltea desde la app.",
            "Reabrir ARCA y verificar si la consulta basica cambio o esta fuera de servicio.",
            "Controlar ultimos 12 meses, declaracion jurada y aportes de obra social."),

        ["anses_codem"] = new(
            ["input[type='text']", "input:not([type])"],
            ["iframe[src*='recaptcha']", ".g-recaptcha"],
            ["no soy un robot", "captcha"],
            ["input[type='password']"],
            ["mi anses", "cuil", "clave de la seguridad social", "iniciar sesión", "iniciar sesion"],
            ["incapsula", "access denied", "request unsuccessful"],
            ["pagina no encontrada", "página no encontrada", "servicio no disponible"],
            ["codem", "comprobante de empadronamiento", "obra social"],
            ["no registra", "no se encontraron"],
            "Intervenir en ANSES/CODEM y completar la validacion vigente del sitio.",
            "Verificar entrada CODEM vigente; ANSES suele cambiar protecciones/rutas.",
            "Leer obra social y titular/familiar si el comprobante queda visible."),

        ["sisa_puco"] = new(
            ["input[type='text']", "input:not([type])", "input[type='password']"],
            [],
            [],
            ["input[type='password']"],
            ["usuario", "contraseña", "sisa", "ingresar", "iniciar sesión", "iniciar sesion"],
            [],
            ["no se puede acceder", "service unavailable", "aplicacion no disponible"],
            ["puco", "cobertura", "paciente", "dni"],
            ["no registra cobertura", "sin cobertura"],
            "Ingresar con sesion institucional y buscar DNI/CUIL en PUCO/SISA.",
            "Confirmar disponibilidad de SISA y credenciales institucionales.",
            "Leer cobertura registrada, datos identificatorios y estado."),

        ["ioma"] = new(
            ["input[type='text']", "input:not([type])", "select"],
            [],
            [],
            ["input[type='password']"],
            ["usuario", "contraseña", "login"],
            [],
            ["404", "not found", "no se puede acceder", "service unavailable"],
            ["nro afiliado", "número de afiliado", "numero de afiliado", "estado afiliatorio", "tipo afiliado"],
            ["no se encontraron", "no registra", "inexistente"],
            "Completar el formulario vigente de IOMA si pide sexo, DNI o afiliado.",
            "Probar ruta alternativa de IOMA; el padron cambio varias veces.",
            "Confirmar estado afiliatorio, numero y tipo de afiliado."),

        ["pami"] = new(
            ["input[type='text']", "input:not([type])", "select"],
            [],
            [],
            ["input[type='password']"],
            ["usuario", "contraseña", "login"],
            [],
            ["404", "not found", "no se puede acceder", "service unavailable"],
            ["numero de afiliado", "número de afiliado", "estado de afiliacion", "estado de afiliación", "credencial vigente", "constancia de afiliacion", "constancia de afiliación"],
            ["no se encontraron", "no registra", "sin afiliacion", "sin afiliación"],
            "Completar la pantalla vigente de PAMI si requiere mas datos.",
            "Verificar entrada vigente de prestadores PAMI si no carga formulario.",
            "Confirmar alta efectiva, UGL/agencia y estado de afiliacion."),

        ["servicio_domestico"] = new(
            ["input[name='nro_cuil']", "input[name='code']"],
            ["input[name='code']", "img#siimage", "img[src*='securimage']", "img[src*='captcha']"],
            ["codigo mostrado", "código mostrado", "captcha"],
            [],
            [],
            [],
            ["error en la consulta", "no se pudo realizar la consulta"],
            ["periodo", "importe", "aporte", "servicio domestico", "servicio doméstico"],
            ["no registra", "no se encontraron", "sin pagos"],
            "Completar el captcha y presionar Buscar para ver pagos.",
            "Revisar si la consulta de SSS para casas particulares cambio o esta caida.",
            "Controlar ultimo periodo pago y monto de aporte.")
    };

    static async Task<PageDiagnostic> DiagnosePageAsync(IPage page, PasoDef paso, int? status, string title, string text)
    {
        var map = PageMaps[paso.Codigo];
        var hasExpectedForm = await AnyVisibleAsync(page, map.ReadySelectors);
        var hasCaptcha = await AnyVisibleAsync(page, Merge(map.CaptchaSelectors, GenericCaptchaSelectors))
            || ContainsAny(text, Merge(map.CaptchaText, GenericCaptchaText));
        var hasLogin = await AnyVisibleAsync(page, Merge(map.LoginSelectors, GenericLoginSelectors))
            || ContainsAny(text, Merge(map.LoginText, GenericLoginText))
            || LooksLikeLogin(text);
        var hasBlocking = ContainsAny($"{title} {text}", Merge(map.BlockingText, GenericBlockingText));
        var hasTechnicalError = status is >= 400
            || ContainsAny($"{title} {text}", Merge(map.ErrorText, GenericErrorText))
            || (status is null && string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(text));
        var hasNegativeResult = ContainsAny(text, map.NegativeText)
            || Regex.IsMatch(text, "sin cobertura|no posee|no registra|no se encontraron|no existen", RegexOptions.IgnoreCase);
        var hasPositiveResult = ContainsAny(text, map.PositiveText);

        if (hasTechnicalError)
            return new PageDiagnostic(
                false, true, hasCaptcha, hasLogin, hasBlocking, hasExpectedForm, hasPositiveResult, hasNegativeResult,
                "error_fuente",
                status is >= 400 ? $"HTTP {status}" : "error tecnico visible",
                map.TecnicoAccion);

        if (hasCaptcha)
            return new PageDiagnostic(
                true, false, true, hasLogin, hasBlocking, hasExpectedForm, hasPositiveResult, hasNegativeResult,
                "captcha_detectado",
                "captcha visible o campo de codigo detectado",
                map.OperadorAccion);

        if (hasLogin)
            return new PageDiagnostic(
                true, false, false, true, hasBlocking, hasExpectedForm, hasPositiveResult, hasNegativeResult,
                "login_detectado",
                "login o credenciales requeridas",
                map.OperadorAccion);

        if (hasBlocking)
            return new PageDiagnostic(
                true, false, false, false, true, hasExpectedForm, hasPositiveResult, hasNegativeResult,
                "bloqueo_validacion_sitio",
                "proteccion o validacion del sitio detectada",
                map.OperadorAccion);

        if (hasNegativeResult)
            return new PageDiagnostic(
                false, false, false, false, false, hasExpectedForm, hasPositiveResult, true,
                "sin_cobertura_detectada",
                "texto de no registro/sin cobertura detectado",
                map.ManualAccion);

        if (hasPositiveResult)
            return new PageDiagnostic(
                false, false, false, false, false, hasExpectedForm, true, false,
                paso.RequiereOperador ? "requiere_revision_manual" : "posible_cobertura_detectada",
                "texto compatible con cobertura o afiliacion detectado",
                map.ManualAccion);

        if (!hasExpectedForm)
            return new PageDiagnostic(
                true, false, false, false, false, false, false, false,
                "pantalla_no_mapeada",
                "la pagina cargo pero no se encontro el formulario o resultado esperado",
                "Revisar la pagina abierta: puede haber cambiado la ruta, el formulario o requerir navegacion manual.");

        if (paso.RequiereOperador)
            return new PageDiagnostic(
                true, false, false, false, false, hasExpectedForm, false, false,
                hasExpectedForm ? "formulario_listo_requiere_operador" : "requiere_operador_mapeado",
                hasExpectedForm ? "formulario encontrado, falta completar validacion manual" : "fuente marcada para intervencion manual",
                map.OperadorAccion);

        return new PageDiagnostic(
            false, false, false, false, false, hasExpectedForm, false, false,
            hasExpectedForm ? "formulario_disponible" : "sin_resultado_detectable",
            hasExpectedForm ? "formulario visible sin resultado final" : "no se detecto resultado conocido",
            hasExpectedForm ? map.ManualAccion : "Revisar la pagina abierta y clasificar manualmente si el sitio cambio.");
    }

    static bool LooksLikeLogin(string text) =>
        text.Contains("usuario", StringComparison.OrdinalIgnoreCase)
        && (text.Contains("contraseña", StringComparison.OrdinalIgnoreCase)
            || text.Contains("contrasena", StringComparison.OrdinalIgnoreCase)
            || text.Contains("password", StringComparison.OrdinalIgnoreCase));

    static async Task<bool> AnyVisibleAsync(IPage page, string[] selectors)
    {
        foreach (var selector in selectors)
        {
            var locator = page.Locator(selector).First;
            if (await locator.CountAsync() == 0) continue;
            if (await SafeVisibleAsync(locator, 700)) return true;
        }
        return false;
    }

    static bool ContainsAny(string text, string[] needles)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        return needles.Any(needle => !string.IsNullOrWhiteSpace(needle)
            && text.Contains(needle, StringComparison.OrdinalIgnoreCase));
    }

    static string[] Merge(string[] first, string[] second) =>
        first.Concat(second).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

    static string? GetChromeExecutablePath()
    {
        var candidates = new[]
        {
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    static string ExtractPageResult(PasoDef paso, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        return paso.Codigo switch
        {
            "arca" => ExtractArcaResult(text),
            "anses_codem" => ExtractAnsesResult(text),
            "sisa_puco" => ExtractPucoResult(text),
            "sss" => ExtractSssResult(text),
            "servicio_domestico" => ExtractServicioDomesticoResult(text),
            _ => ""
        };
    }

    static string ExtractArcaResult(string text)
    {
        var summary = Regex.Match(text, @"En el curso del último año,.*?(?=Período|Periodo|$)", RegexOptions.IgnoreCase);
        var firstRow = Regex.Match(text, @"(?<periodo>\d{2}/\d{4})\s+(?<dj>SI|NO)\s+(?<seguridad>INFORMATIVO|[0-9.,]+)\s+(?<obra>INFORMATIVO|[0-9.,]+)\s+(?<patronal>INFORMATIVO|[0-9.,]+)", RegexOptions.IgnoreCase);
        var parts = new List<string>();
        if (summary.Success) parts.Add(CleanWhitespace(summary.Value));
        if (firstRow.Success)
            parts.Add($"Primera fila: periodo {firstRow.Groups["periodo"].Value}, DDJJ {firstRow.Groups["dj"].Value}, seguridad social {firstRow.Groups["seguridad"].Value}, obra social {firstRow.Groups["obra"].Value}, contribucion patronal {firstRow.Groups["patronal"].Value}");
        return string.Join(" | ", parts);
    }

    static string ExtractAnsesResult(string text)
    {
        var noResults = Regex.Match(text, @"La consulta no arroj[oó] resultados\.?", RegexOptions.IgnoreCase);
        if (noResults.Success) return CleanWhitespace(noResults.Value);
        var obraSocial = Regex.Match(text, @"(Obra Social|CODEM|Comprobante).*", RegexOptions.IgnoreCase);
        return obraSocial.Success ? CleanWhitespace(obraSocial.Value) : "";
    }

    static string ExtractPucoResult(string text)
    {
        var row = Regex.Match(text, @"(?<tipo>DNI)\s+(?<doc>\d{7,9})\s+(?<sexo>[MF])\s+(?<cobertura>O\.[^\r\n]+?)\s+(?<denominacion>[A-ZÁÉÍÓÚÑ ]{6,})", RegexOptions.IgnoreCase);
        if (!row.Success) return "";
        return $"TipoDoc {row.Groups["tipo"].Value}, NroDoc {row.Groups["doc"].Value}, Sexo {row.Groups["sexo"].Value}, Cobertura Social {CleanWhitespace(row.Groups["cobertura"].Value)}, Denominacion {CleanWhitespace(row.Groups["denominacion"].Value)}";
    }

    static string ExtractSssResult(string text)
    {
        var noResults = Regex.Match(text, @"no registra|sin cobertura|no se encontraron|no existen datos", RegexOptions.IgnoreCase);
        if (noResults.Success) return CleanWhitespace(noResults.Value);
        var result = Regex.Match(text, @"(Obra Social|OS ORIGEN|OS DESTINO|Beneficiario).*", RegexOptions.IgnoreCase);
        return result.Success ? CleanWhitespace(result.Value) : "";
    }

    static string ExtractServicioDomesticoResult(string text)
    {
        var row = Regex.Match(text, @"(?<periodo>\d{2}/\d{4}).{0,120}(?<importe>\$?\s*[0-9][0-9.,]*)", RegexOptions.IgnoreCase);
        if (row.Success) return $"Primera fila: periodo {row.Groups["periodo"].Value}, importe/aporte {CleanWhitespace(row.Groups["importe"].Value)}";
        var noResults = Regex.Match(text, @"no registra|no se encontraron|sin pagos", RegexOptions.IgnoreCase);
        return noResults.Success ? CleanWhitespace(noResults.Value) : "";
    }

    static string BuildPasoSummary(PasoDef paso, PatientInput patient, int? status, string? title, string accion, PageDiagnostic diagnostico, string extraccion, string esperaManual)
    {
        var dato = patient.Cuil ?? patient.Dni ?? patient.Entrada;
        var baseText = $"{paso.Nombre}: {(status is null ? "HTTP -" : $"HTTP {status}")}. {(string.IsNullOrWhiteSpace(title) ? "Sin titulo detectado" : $"Titulo: {title}")}. Dato cargado: {dato}. {accion}";
        if (!string.IsNullOrWhiteSpace(esperaManual))
            baseText = $"{baseText} {esperaManual}";
        if (!string.IsNullOrWhiteSpace(extraccion))
            baseText = $"{baseText} Extraido: {extraccion}.";
        if (diagnostico.HasTechnicalError)
            return $"{baseText} Diagnostico: {diagnostico.Resultado} ({diagnostico.Motivo}). Accion: {diagnostico.AccionOperativa}";
        if (diagnostico.RequiresOperator)
            return $"{baseText} Diagnostico: {diagnostico.Resultado} ({diagnostico.Motivo}). Accion: {diagnostico.AccionOperativa}";
        return $"{baseText} Diagnostico: {diagnostico.Resultado} ({diagnostico.Motivo}). Accion: {diagnostico.AccionOperativa}";
    }

    static string? ExtractTitle(string html)
    {
        var match = Regex.Match(html, @"<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return match.Success ? System.Net.WebUtility.HtmlDecode(CleanWhitespace(match.Groups[1].Value)) : null;
    }

    static string CleanHtml(string html)
    {
        var noScripts = Regex.Replace(html, @"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", RegexOptions.IgnoreCase);
        var text = Regex.Replace(noScripts, "<[^>]+>", " ");
        return System.Net.WebUtility.HtmlDecode(CleanWhitespace(text));
    }

    static string CleanWhitespace(string value) => Regex.Replace(value, @"\s+", " ").Trim();
}

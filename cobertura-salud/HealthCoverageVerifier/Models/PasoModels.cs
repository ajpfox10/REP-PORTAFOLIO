using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace HealthCoverageVerifier.Models;

public sealed record PasoDef(
    int Orden, 
    string Codigo, 
    string Nombre, 
    string Url, 
    bool RequiereOperador, 
    string Indicacion, 
    string[] Campos);

public sealed record PageMap(
    string[] ReadySelectors,
    string[] CaptchaSelectors,
    string[] CaptchaText,
    string[] LoginSelectors,
    string[] LoginText,
    string[] BlockingText,
    string[] ErrorText,
    string[] PositiveText,
    string[] NegativeText,
    string OperadorAccion,
    string TecnicoAccion,
    string ManualAccion);

public sealed record PageDiagnostic(
    bool RequiresOperator,
    bool HasTechnicalError,
    bool HasCaptcha,
    bool HasLogin,
    bool HasBlocking,
    bool HasExpectedForm,
    bool HasPositiveResult,
    bool HasNegativeResult,
    string Resultado,
    string Motivo,
    string AccionOperativa);

public sealed record PasoResultado(
    int Orden,
    string Codigo,
    string Nombre,
    string Url,
    string Estado,
    string Resultado,
    string Resumen,
    int? HttpStatus,
    string? Titulo,
    string? TextoDetectado,
    bool RequiereOperador,
    object Detalle);

public sealed record PasoDto(
    long Id,
    int Orden,
    string Codigo,
    string Nombre,
    string Url,
    string Estado,
    string? Resultado,
    string? Resumen,
    int? HttpStatus,
    string? Titulo,
    string? TextoDetectado,
    bool RequiereOperador,
    DateTime StartedAt,
    DateTime? FinishedAt);

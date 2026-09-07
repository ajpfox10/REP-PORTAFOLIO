using System;
using System.Net;

namespace HealthCoverageVerifier.Models;

public sealed record SssPending(CookieContainer Cookies, PatientInput Patient, DateTime CreatedAt);

public sealed record SssStart(string SessionId, string CaptchaImage, string? Cuil, string? Dni);

public sealed record SssResolveResult(
    string Estado,
    string Mensaje,
    bool? Afiliado,
    string? ObraSocial,
    string TextoDetectado,
    PatientInput Paciente)
{
    public static SssResolveResult Fault(string estado, string mensaje) =>
        new(estado, mensaje, null, null, "", new PatientInput("", null, null, null, null));
}

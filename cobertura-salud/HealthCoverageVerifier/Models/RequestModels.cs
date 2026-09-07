namespace HealthCoverageVerifier.Models;

public sealed record LoginRequest(string? Username, string? Password);
public sealed record LoginResponse(string Token, UserDto User);
public sealed record UserCreateRequest(string? Username, string? Password, string? Role);
public sealed record UserPatchRequest(string? Role, bool? Activo, string? Password);
public sealed record ConsultaCreateRequest(string? Entrada, string? Apellido, string? FechaPrestacion);
public sealed record ConsultaDecisionRequest(string? DecisionFinal, string? CoberturaRecomendada, string? Observaciones);
public sealed record ErrorResponse(string Error);
public sealed record SssStartRequest(string? Entrada, string? Apellido);
public sealed record SssResolveRequest(string? SessionId, string? Code);

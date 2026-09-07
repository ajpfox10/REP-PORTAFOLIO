using System;
using System.Collections.Generic;

namespace HealthCoverageVerifier.Models;

public sealed record ConsultaListItem(
    long Id,
    string Entrada,
    string? Dni,
    string? Cuil,
    string? Apellido,
    string Estado,
    string? DecisionFinal,
    DateTime CreatedAt,
    DateTime? FinishedAt,
    string CreadoPorNombre);

public sealed record ConsultaDetail(
    long Id,
    string Entrada,
    string? Dni,
    string? Cuil,
    string? Apellido,
    DateOnly? FechaPrestacion,
    string Estado,
    string? DecisionFinal,
    string? CoberturaRecomendada,
    string? Resumen,
    string? Observaciones,
    int CreadoPor,
    string CreadoPorNombre,
    DateTime CreatedAt,
    DateTime? FinishedAt,
    IReadOnlyList<PasoDto> Pasos);

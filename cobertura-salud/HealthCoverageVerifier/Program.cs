using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;
using HealthCoverageVerifier.Data;
using HealthCoverageVerifier.Helpers;
using HealthCoverageVerifier.Models;
using HealthCoverageVerifier.Services;

// ─── Carga de variables de entorno ───────────────────────────────────────────
var envName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Production"
    ? "production"
    : "development";
AuthHelpers.LoadEnv(Path.Combine(AppContext.BaseDirectory, $".env.{envName}"));
AuthHelpers.LoadEnv(Path.Combine(Directory.GetCurrentDirectory(), $".env.{envName}"));

var settings = AppSettings.FromEnvironment();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{settings.Port}");

// ─── Servicios ──────────────────────────────────────────────────────────────
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<CoverageWorkflow>();
builder.Services.AddSingleton<SssService>();
builder.Services.AddSingleton<CaptchaSolverService>(); // OCR utility

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(settings.CorsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.JwtSecret));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("admin"));
});

var app = builder.Build();
await app.Services.GetRequiredService<Db>().MigrateAsync();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

// ═════════════════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// Health check
app.MapGet("/api/health", (AppSettings s) => Results.Ok(new
{
    ok = true,
    app = s.AppName,
    env = envName,
    db = s.Database
}));

// ─── Auth ───────────────────────────────────────────────────────────────────
app.MapPost("/api/auth/login", async Task<Results<Ok<LoginResponse>, UnauthorizedHttpResult, BadRequest<ErrorResponse>>> (
    LoginRequest request,
    Db db,
    AppSettings s) =>
{
    var username = (request.Username ?? "").Trim();
    var password = request.Password ?? "";
    if (username.Length == 0 || password.Length == 0)
        return TypedResults.BadRequest(new ErrorResponse("Usuario y contrasena son obligatorios"));

    await using var conn = await db.OpenAsync();
    var user = await db.GetUserByUsernameAsync(conn, username);
    if (user is null || user.Activo == 0 || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        return TypedResults.Unauthorized();

    await db.AuditAsync(conn, user.Id, "login", "usuarios", user.Id.ToString(), new { username });
    return TypedResults.Ok(new LoginResponse(AuthHelpers.SignToken(user, s), UserDto.From(user)));
});

app.MapGet("/api/auth/me", [Authorize] (ClaimsPrincipal principal) =>
    Results.Ok(new { user = CurrentUser.From(principal).ToDto() }));

// ─── Usuarios ───────────────────────────────────────────────────────────────
app.MapGet("/api/usuarios", [Authorize(Policy = "AdminOnly")] async (Db db) =>
{
    await using var conn = await db.OpenAsync();
    var users = new List<UserDto>();
    await using var cmd = new MySqlCommand(
        "SELECT id, username, role, activo, created_at FROM usuarios ORDER BY username", conn);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        users.Add(new UserDto(
            reader.GetInt32("id"),
            reader.GetString("username"),
            reader.GetString("role"),
            reader.GetInt32("activo") == 1,
            reader.GetDateTime("created_at")));
    }
    return Results.Ok(new { data = users });
});

app.MapPost("/api/usuarios", [Authorize(Policy = "AdminOnly")] async Task<Results<Created, BadRequest<ErrorResponse>, Conflict<ErrorResponse>>> (
    UserCreateRequest request,
    ClaimsPrincipal principal,
    Db db) =>
{
    var username = (request.Username ?? "").Trim();
    var password = request.Password ?? "";
    var role = AuthHelpers.NormalizeRole(request.Role);
    if (username.Length < 3) return TypedResults.BadRequest(new ErrorResponse("Usuario obligatorio, minimo 3 caracteres"));
    if (password.Length < 8) return TypedResults.BadRequest(new ErrorResponse("Contrasena obligatoria, minimo 8 caracteres"));
    if (role is null) return TypedResults.BadRequest(new ErrorResponse("Rol invalido"));

    await using var conn = await db.OpenAsync();
    try
    {
        await using var cmd = new MySqlCommand(
            "INSERT INTO usuarios (username, password_hash, role, activo) VALUES (@username, @hash, @role, 1)", conn);
        cmd.Parameters.AddWithValue("@username", username);
        cmd.Parameters.AddWithValue("@hash", BCrypt.Net.BCrypt.HashPassword(password, 12));
        cmd.Parameters.AddWithValue("@role", role);
        await cmd.ExecuteNonQueryAsync();
    }
    catch (MySqlException ex) when (ex.Number == 1062)
    {
        return TypedResults.Conflict(new ErrorResponse("Ya existe un usuario con ese nombre"));
    }

    await db.AuditAsync(conn, CurrentUser.From(principal).Id, "crear_usuario", "usuarios", username, new { role });
    return TypedResults.Created($"/api/usuarios/{username}");
});

app.MapPatch("/api/usuarios/{id:int}", [Authorize(Policy = "AdminOnly")] async Task<Results<Ok, BadRequest<ErrorResponse>, NotFound<ErrorResponse>>> (
    int id,
    UserPatchRequest request,
    ClaimsPrincipal principal,
    Db db) =>
{
    var current = CurrentUser.From(principal);
    var updates = new List<string>();
    await using var conn = await db.OpenAsync();
    await using var cmd = new MySqlCommand { Connection = conn };

    if (request.Role is not null)
    {
        var role = AuthHelpers.NormalizeRole(request.Role);
        if (role is null) return TypedResults.BadRequest(new ErrorResponse("Rol invalido"));
        if (id == current.Id && role != "admin")
            return TypedResults.BadRequest(new ErrorResponse("No se puede quitar el rol admin del usuario actual"));
        updates.Add("role = @role");
        cmd.Parameters.AddWithValue("@role", role);
    }
    if (request.Activo is not null)
    {
        var activo = request.Activo.Value ? 1 : 0;
        if (id == current.Id && activo == 0)
            return TypedResults.BadRequest(new ErrorResponse("No se puede desactivar el usuario actual"));
        updates.Add("activo = @activo");
        cmd.Parameters.AddWithValue("@activo", activo);
    }
    if (!string.IsNullOrWhiteSpace(request.Password))
    {
        if (request.Password.Length < 8)
            return TypedResults.BadRequest(new ErrorResponse("Contrasena minimo 8 caracteres"));
        updates.Add("password_hash = @hash");
        cmd.Parameters.AddWithValue("@hash", BCrypt.Net.BCrypt.HashPassword(request.Password, 12));
    }
    if (updates.Count == 0) return TypedResults.BadRequest(new ErrorResponse("No hay cambios para guardar"));

    cmd.CommandText = $"UPDATE usuarios SET {string.Join(", ", updates)} WHERE id = @id";
    cmd.Parameters.AddWithValue("@id", id);
    var affected = await cmd.ExecuteNonQueryAsync();
    if (affected == 0) return TypedResults.NotFound(new ErrorResponse("Usuario no encontrado"));

    await db.AuditAsync(conn, current.Id, "editar_usuario", "usuarios", id.ToString(), new
    {
        request.Role,
        request.Activo,
        cambiaPassword = !string.IsNullOrWhiteSpace(request.Password)
    });
    return TypedResults.Ok();
});

// ─── Consultas ──────────────────────────────────────────────────────────────
app.MapPost("/api/consultas", [Authorize] async (
    ConsultaCreateRequest request,
    ClaimsPrincipal principal,
    Db db,
    CoverageWorkflow workflow) =>
{
    var user = CurrentUser.From(principal);
    var parsed = PatientInput.Parse(request.Entrada, request.Apellido, request.FechaPrestacion);
    await using var conn = await db.OpenAsync();
    var consultaId = await db.CreateConsultaAsync(conn, user.Id, parsed);
    var pasos = await workflow.RunAsync(parsed);

    foreach (var paso in pasos)
        await db.InsertPasoAsync(conn, consultaId, user.Id, paso);

    await db.FinishConsultaAsync(conn, consultaId, "en_revision", AuthHelpers.BuildDecision(parsed, pasos));
    await db.AuditAsync(conn, user.Id, "crear_consulta", "consultas", consultaId.ToString(), new
    {
        parsed.Entrada,
        parsed.Dni,
        parsed.Cuil,
        pasos = pasos.Count
    });

    var consulta = await db.GetConsultaAsync(conn, consultaId, user);
    return Results.Created($"/api/consultas/{consultaId}", consulta);
});

app.MapGet("/api/consultas", [Authorize] async (ClaimsPrincipal principal, Db db) =>
{
    var user = CurrentUser.From(principal);
    await using var conn = await db.OpenAsync();
    var rows = new List<ConsultaListItem>();
    var where = user.Role == "admin" ? "" : "WHERE c.creado_por = @userId";
    await using var cmd = new MySqlCommand($"""
        SELECT c.id, c.entrada, c.dni, c.cuil, c.apellido, c.estado, c.decision_final,
               c.created_at, c.finished_at, u.username creado_por_nombre
        FROM consultas c
        JOIN usuarios u ON u.id = c.creado_por
        {where}
        ORDER BY c.created_at DESC
        LIMIT 100
        """, conn);
    if (user.Role != "admin") cmd.Parameters.AddWithValue("@userId", user.Id);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new ConsultaListItem(
            reader.GetInt64("id"),
            reader.GetString("entrada"),
            reader.IsDBNull(reader.GetOrdinal("dni")) ? null : reader.GetString("dni"),
            reader.IsDBNull(reader.GetOrdinal("cuil")) ? null : reader.GetString("cuil"),
            reader.IsDBNull(reader.GetOrdinal("apellido")) ? null : reader.GetString("apellido"),
            reader.GetString("estado"),
            reader.IsDBNull(reader.GetOrdinal("decision_final")) ? null : reader.GetString("decision_final"),
            reader.GetDateTime("created_at"),
            reader.IsDBNull(reader.GetOrdinal("finished_at")) ? null : reader.GetDateTime("finished_at"),
            reader.GetString("creado_por_nombre")));
    }
    return Results.Ok(new { data = rows });
});

app.MapGet("/api/consultas/{id:long}", [Authorize] async Task<Results<Ok<ConsultaDetail>, NotFound<ErrorResponse>>> (
    long id,
    ClaimsPrincipal principal,
    Db db) =>
{
    await using var conn = await db.OpenAsync();
    var consulta = await db.GetConsultaAsync(conn, id, CurrentUser.From(principal));
    return consulta is null
        ? TypedResults.NotFound(new ErrorResponse("Consulta no encontrada"))
        : TypedResults.Ok(consulta);
});

app.MapPatch("/api/consultas/{id:long}/decision", [Authorize] async Task<Results<Ok<ConsultaDetail>, NotFound<ErrorResponse>>> (
    long id,
    ConsultaDecisionRequest request,
    ClaimsPrincipal principal,
    Db db) =>
{
    var user = CurrentUser.From(principal);
    await using var conn = await db.OpenAsync();
    var allowed = await db.CanSeeConsultaAsync(conn, id, user);
    if (!allowed) return TypedResults.NotFound(new ErrorResponse("Consulta no encontrada"));

    await using var cmd = new MySqlCommand("""
        UPDATE consultas
        SET decision_final = @decision, cobertura_recomendada = @cobertura, observaciones = @observaciones,
            estado = 'completa', finished_at = COALESCE(finished_at, NOW())
        WHERE id = @id
        """, conn);
    cmd.Parameters.AddWithValue("@decision", AuthHelpers.EmptyToNull(request.DecisionFinal));
    cmd.Parameters.AddWithValue("@cobertura", AuthHelpers.EmptyToNull(request.CoberturaRecomendada));
    cmd.Parameters.AddWithValue("@observaciones", AuthHelpers.EmptyToNull(request.Observaciones));
    cmd.Parameters.AddWithValue("@id", id);
    await cmd.ExecuteNonQueryAsync();
    await db.AuditAsync(conn, user.Id, "cerrar_decision", "consultas", id.ToString(), request);
    return TypedResults.Ok((await db.GetConsultaAsync(conn, id, user))!);
});

// ─── SSS (consulta asistida con captcha) ─────────────────────────────────────
app.MapPost("/api/sss/iniciar", [Authorize] async Task<Results<Ok<SssStart>, BadRequest<ErrorResponse>>> (
    SssStartRequest request,
    SssService sss) =>
{
    try
    {
        var parsed = PatientInput.Parse(request.Entrada, request.Apellido, null);
        return TypedResults.Ok(await sss.StartAsync(parsed));
    }
    catch (BadHttpRequestException ex)
    {
        return TypedResults.BadRequest(new ErrorResponse(ex.Message));
    }
    catch (Exception ex)
    {
        return TypedResults.BadRequest(new ErrorResponse($"No se pudo abrir SSS: {ex.Message}"));
    }
});

app.MapPost("/api/sss/resolver", [Authorize] async Task<Results<Ok<SssResolveResult>, BadRequest<ErrorResponse>>> (
    SssResolveRequest request,
    ClaimsPrincipal principal,
    Db db,
    SssService sss) =>
{
    if (string.IsNullOrWhiteSpace(request.SessionId) || string.IsNullOrWhiteSpace(request.Code))
        return TypedResults.BadRequest(new ErrorResponse("Falta el codigo del captcha"));

    var user = CurrentUser.From(principal);
    var result = await sss.ResolveAsync(request.SessionId, request.Code);

    if (result.Estado is "afiliado" or "sin_cobertura" or "sin_diagnostico")
    {
        await using var conn = await db.OpenAsync();
        var consultaId = await db.CreateConsultaAsync(conn, user.Id, result.Paciente);
        var paso = new PasoResultado(
            1, "sss", "SSS - Padron de beneficiarios", "https://www.sssalud.gob.ar/?page=bus650",
            result.Estado == "sin_diagnostico" ? "requiere_operador" : "consultado",
            result.Estado, result.Mensaje, 200, "Consulta SSS",
            result.TextoDetectado, result.Estado == "sin_diagnostico",
            new { result.Afiliado, result.ObraSocial });
        await db.InsertPasoAsync(conn, consultaId, user.Id, paso);
        await db.FinishConsultaAsync(conn, consultaId,
            result.Estado == "sin_diagnostico" ? "en_revision" : "completa", result.Mensaje);
        await db.AuditAsync(conn, user.Id, "consulta_sss", "consultas", consultaId.ToString(),
            new { result.Estado, result.Afiliado, result.ObraSocial });
    }

    return TypedResults.Ok(result);
});

// ─── OCR / Captcha Solver (utilidad integrada) ─────────────────────────────
app.MapPost("/api/captcha/solve", [Authorize] async (
    IFormFile image,
    CaptchaSolverService solver) =>
{
    if (image == null || image.Length == 0)
        return Results.BadRequest(new ErrorResponse("Debe enviar una imagen"));

    var tempPath = Path.Combine(Path.GetTempPath(), $"captcha_{Guid.NewGuid()}{Path.GetExtension(image.FileName)}");
    await using (var stream = File.Create(tempPath))
        await image.CopyToAsync(stream);

    var result = await solver.SolveCaptchaAsync(tempPath);
    try { File.Delete(tempPath); } catch { }

    return Results.Ok(result);
});

// Fallback para SPA
app.MapFallbackToFile("index.html");

app.Run();

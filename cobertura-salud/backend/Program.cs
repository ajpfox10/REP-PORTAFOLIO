using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Playwright;
using MySqlConnector;

var envName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Production"
    ? "production"
    : "development";
LoadEnv(Path.Combine(AppContext.BaseDirectory, $".env.{envName}"));
LoadEnv(Path.Combine(Directory.GetCurrentDirectory(), $".env.{envName}"));

var settings = AppSettings.FromEnvironment();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{settings.Port}");

builder.Services.AddSingleton(settings);
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<CoverageWorkflow>();
builder.Services.AddSingleton<SssService>();

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
// Sirve wwwroot, incluyendo los archivos de actualizacion de la app de escritorio
// (electron-updater necesita .yml y .blockmap, que no son tipos conocidos por defecto).
var updateContentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
updateContentTypes.Mappings[".yml"] = "text/yaml";
updateContentTypes.Mappings[".blockmap"] = "application/octet-stream";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = updateContentTypes });

app.MapGet("/api/health", (AppSettings s) => Results.Ok(new
{
    ok = true,
    app = s.AppName,
    env = envName,
    db = s.Database
}));

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
    return TypedResults.Ok(new LoginResponse(SignToken(user, s), UserDto.From(user)));
});

app.MapGet("/api/auth/me", [Authorize] (ClaimsPrincipal principal) =>
    Results.Ok(new { user = CurrentUser.From(principal).ToDto() }));

// Credencial institucional de SSS-HPGD para que la app de escritorio haga el
// login automatico en el acceso restringido (sin intervencion del operador).
app.MapGet("/api/sss/credenciales", [Authorize] (AppSettings s) =>
    Results.Ok(new { username = s.SssUsername, password = s.SssPassword }));

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
    var role = NormalizeRole(request.Role);
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
        var role = NormalizeRole(request.Role);
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

    await db.FinishConsultaAsync(conn, consultaId, "en_revision", BuildDecision(parsed, pasos));
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

// Historial de un documento (DNI/CUIL) para la app de escritorio: cada consulta
// previa con su fecha, quien la hizo, y el resultado por fuente.
app.MapGet("/api/desktop/historial", [Authorize] async (string? dni, string? cuil, Db db) =>
{
    var dniN = (dni ?? "").Trim();
    var cuilN = (cuil ?? "").Trim();
    if (dniN.Length == 0 && cuilN.Length == 0) return Results.Ok(new { data = Array.Empty<object>() });

    await using var conn = await db.OpenAsync();
    var conds = new List<string>();
    if (dniN.Length > 0) conds.Add("c.dni = @dni");
    if (cuilN.Length > 0) conds.Add("c.cuil = @cuil");
    var where = "WHERE (" + string.Join(" OR ", conds) + ")";

    await using var cmd = new MySqlCommand($"""
        SELECT c.id, c.created_at, u.username, p.nombre AS fuente, p.resultado, p.estado
        FROM consultas c
        JOIN usuarios u ON u.id = c.creado_por
        LEFT JOIN consulta_pasos p ON p.consulta_id = c.id
        {where}
        ORDER BY c.created_at DESC, c.id DESC, p.orden
        LIMIT 1000
        """, conn);
    if (dniN.Length > 0) cmd.Parameters.AddWithValue("@dni", dniN);
    if (cuilN.Length > 0) cmd.Parameters.AddWithValue("@cuil", cuilN);

    var orden = new List<long>();
    var mapa = new Dictionary<long, (DateTime fecha, string usuario, List<object> fuentes)>();
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        var cid = reader.GetInt64("id");
        if (!mapa.ContainsKey(cid))
        {
            mapa[cid] = (reader.GetDateTime("created_at"), reader.GetString("username"), new List<object>());
            orden.Add(cid);
        }
        if (!reader.IsDBNull(reader.GetOrdinal("fuente")))
        {
            mapa[cid].fuentes.Add(new
            {
                fuente = reader.GetString("fuente"),
                resultado = reader.IsDBNull(reader.GetOrdinal("resultado")) ? null : reader.GetString("resultado"),
                estado = reader.IsDBNull(reader.GetOrdinal("estado")) ? null : reader.GetString("estado")
            });
        }
    }
    var data = orden.Select(cid => new { id = cid, fecha = mapa[cid].fecha, usuario = mapa[cid].usuario, fuentes = mapa[cid].fuentes });
    return Results.Ok(new { data });
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
    cmd.Parameters.AddWithValue("@decision", EmptyToNull(request.DecisionFinal));
    cmd.Parameters.AddWithValue("@cobertura", EmptyToNull(request.CoberturaRecomendada));
    cmd.Parameters.AddWithValue("@observaciones", EmptyToNull(request.Observaciones));
    cmd.Parameters.AddWithValue("@id", id);
    await cmd.ExecuteNonQueryAsync();
    await db.AuditAsync(conn, user.Id, "cerrar_decision", "consultas", id.ToString(), request);
    return TypedResults.Ok((await db.GetConsultaAsync(conn, id, user))!);
});

app.MapPost("/api/sss/iniciar", [Authorize] async Task<Results<Ok<SssStart>, BadRequest<ErrorResponse>>> (
    SssStartRequest request,
    SssService sss) =>
{
    if (!SssService.IsKnownSource(request.Fuente))
        return TypedResults.BadRequest(new ErrorResponse("Fuente de consulta no valida"));
    try
    {
        var parsed = PatientInput.FromDatos(request.Dni, request.Cuil, request.Apellido);
        return TypedResults.Ok(await sss.StartAsync(request.Fuente, parsed));
    }
    catch (BadHttpRequestException ex)
    {
        return TypedResults.BadRequest(new ErrorResponse(ex.Message));
    }
    catch (Exception ex)
    {
        return TypedResults.BadRequest(new ErrorResponse($"No se pudo abrir la fuente: {ex.Message}"));
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
            1, result.Codigo, result.Nombre, result.Url,
            result.Estado == "sin_diagnostico" ? "requiere_operador" : "consultado",
            result.Estado, result.Mensaje, 200, result.Nombre,
            result.TextoDetectado, result.Estado == "sin_diagnostico",
            new { result.Afiliado, result.ObraSocial });
        await db.InsertPasoAsync(conn, consultaId, user.Id, paso);
        await db.FinishConsultaAsync(conn, consultaId,
            result.Estado == "sin_diagnostico" ? "en_revision" : "completa", result.Mensaje);
        await db.AuditAsync(conn, user.Id, $"consulta_{result.Codigo}", "consultas", consultaId.ToString(),
            new { result.Estado, result.Afiliado, result.ObraSocial });
    }

    return TypedResults.Ok(result);
});

app.MapPost("/api/consulta-local", [Authorize] async Task<Results<Ok<ConsultaLocalResponse>, BadRequest<ErrorResponse>>> (
    ConsultaLocalRequest request,
    ClaimsPrincipal principal,
    Db db,
    CoverageWorkflow workflow) =>
{
    PatientInput patient;
    try { patient = PatientInput.FromDatos(request.Dni, request.Cuil, request.Apellido); }
    catch (BadHttpRequestException ex) { return TypedResults.BadRequest(new ErrorResponse(ex.Message)); }

    var paso = await workflow.RunOneAsync(request.Fuente ?? "sss", patient);
    if (paso is null) return TypedResults.BadRequest(new ErrorResponse("Fuente de consulta no valida"));

    var user = CurrentUser.From(principal);
    var estadoConsulta = paso.Estado switch
    {
        "error" => "error",
        "requiere_operador" => "en_revision",
        _ => "completa"
    };

    await using var conn = await db.OpenAsync();
    var consultaId = await db.CreateConsultaAsync(conn, user.Id, patient);
    await db.InsertPasoAsync(conn, consultaId, user.Id, paso);
    await db.FinishConsultaAsync(conn, consultaId, estadoConsulta, paso.Resumen);
    await db.AuditAsync(conn, user.Id, $"local_{paso.Codigo}", "consultas", consultaId.ToString(),
        new { paso.Estado, paso.Resultado });

    return TypedResults.Ok(new ConsultaLocalResponse(
        consultaId, paso.Codigo, paso.Nombre, paso.Estado, paso.Resultado,
        paso.Resumen, paso.Titulo, paso.HttpStatus, paso.TextoDetectado, paso.Url));
});

app.MapPost("/api/desktop/recorrido", [Authorize] async Task<Results<Ok<DesktopRecorridoResponse>, BadRequest<ErrorResponse>>> (
    DesktopRecorridoRequest request,
    ClaimsPrincipal principal,
    Db db) =>
{
    PatientInput patient;
    try { patient = PatientInput.FromDatos(request.Dni, request.Cuil, request.Apellido); }
    catch (BadHttpRequestException ex) { return TypedResults.BadRequest(new ErrorResponse(ex.Message)); }

    var user = CurrentUser.From(principal);
    var resultados = request.Resultados ?? new List<DesktopResultado>();

    await using var conn = await db.OpenAsync();
    var consultaId = await db.CreateConsultaAsync(conn, user.Id, patient);

    var orden = 1;
    foreach (var r in resultados)
    {
        var estado = (r.Veredicto ?? "").Contains("determinar", StringComparison.OrdinalIgnoreCase)
            ? "requiere_operador" : "consultado";
        var texto = r.Texto is { Length: > 4000 } ? r.Texto[..4000] : r.Texto;
        var paso = new PasoResultado(
            orden++, r.Fuente ?? "fuente", r.Nombre ?? r.Fuente ?? "fuente", r.Url ?? "",
            estado, r.Veredicto ?? "sin_resultado", r.Veredicto ?? "", 200, r.Nombre,
            texto, estado == "requiere_operador", new { r.Veredicto, origen = "escritorio" });
        await db.InsertPasoAsync(conn, consultaId, user.Id, paso);
    }

    await db.FinishConsultaAsync(conn, consultaId, "completa",
        $"Recorrido de escritorio: {resultados.Count} fuentes consultadas por {user.Username}.");
    await db.AuditAsync(conn, user.Id, "recorrido_escritorio", "consultas", consultaId.ToString(),
        new { fuentes = resultados.Count, resultados = resultados.Select(x => new { x.Fuente, x.Veredicto }) });

    return TypedResults.Ok(new DesktopRecorridoResponse(consultaId, user.Username, resultados.Count));
});

app.MapGet("/api/reporte", [Authorize(Policy = "AdminOnly")] async (string? usuario, string? dni, string? cuil, string? desde, string? hasta, Db db) =>
{
    await using var conn = await db.OpenAsync();
    var filtros = new List<string>();
    if (!string.IsNullOrWhiteSpace(usuario)) filtros.Add("u.username LIKE @usuario");
    if (!string.IsNullOrWhiteSpace(dni)) filtros.Add("c.dni LIKE @dni");
    if (!string.IsNullOrWhiteSpace(cuil)) filtros.Add("c.cuil LIKE @cuil");
    // Rango de fechas sobre la fecha de la consulta (inclusive en ambos extremos).
    DateTime? desdeDt = DateTime.TryParse(desde, out var d1) ? d1.Date : null;
    DateTime? hastaDt = DateTime.TryParse(hasta, out var d2) ? d2.Date.AddDays(1) : null;
    if (desdeDt is not null) filtros.Add("c.created_at >= @desde");
    if (hastaDt is not null) filtros.Add("c.created_at < @hasta");
    var where = filtros.Count > 0 ? "WHERE " + string.Join(" AND ", filtros) : "";

    await using var cmd = new MySqlCommand($"""
        SELECT c.id, c.created_at, u.username, c.entrada, c.dni, c.cuil, c.apellido,
               p.nombre AS fuente, p.resultado, p.estado, p.resumen
        FROM consulta_pasos p
        JOIN consultas c ON c.id = p.consulta_id
        JOIN usuarios u ON u.id = c.creado_por
        {where}
        ORDER BY c.created_at DESC, c.id DESC, p.orden
        LIMIT 5000
        """, conn);
    if (!string.IsNullOrWhiteSpace(usuario)) cmd.Parameters.AddWithValue("@usuario", "%" + usuario.Trim() + "%");
    if (!string.IsNullOrWhiteSpace(dni)) cmd.Parameters.AddWithValue("@dni", "%" + dni.Trim() + "%");
    if (!string.IsNullOrWhiteSpace(cuil)) cmd.Parameters.AddWithValue("@cuil", "%" + cuil.Trim() + "%");
    if (desdeDt is not null) cmd.Parameters.AddWithValue("@desde", desdeDt.Value);
    if (hastaDt is not null) cmd.Parameters.AddWithValue("@hasta", hastaDt.Value);

    var rows = new List<ReporteRow>();
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        rows.Add(new ReporteRow(
            reader.GetInt64("id"),
            reader.GetDateTime("created_at"),
            reader.GetString("username"),
            reader.GetString("entrada"),
            reader.IsDBNull(reader.GetOrdinal("dni")) ? null : reader.GetString("dni"),
            reader.IsDBNull(reader.GetOrdinal("cuil")) ? null : reader.GetString("cuil"),
            reader.IsDBNull(reader.GetOrdinal("apellido")) ? null : reader.GetString("apellido"),
            reader.GetString("fuente"),
            reader.IsDBNull(reader.GetOrdinal("resultado")) ? null : reader.GetString("resultado"),
            reader.GetString("estado"),
            reader.IsDBNull(reader.GetOrdinal("resumen")) ? null : reader.GetString("resumen")));
    }
    return Results.Ok(new { data = rows });
});

app.MapFallbackToFile("index.html");
app.Run();

static string? NormalizeRole(string? role)
{
    role = (role ?? "user").Trim().ToLowerInvariant();
    return role is "admin" or "user" ? role : null;
}

static object? EmptyToNull(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();

static string SignToken(UserRecord user, AppSettings settings)
{
    var credentials = new SigningCredentials(
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.JwtSecret)),
        SecurityAlgorithms.HmacSha256);
    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new Claim(ClaimTypes.Name, user.Username),
        new Claim(ClaimTypes.Role, user.Role),
        new Claim("username", user.Username),
        new Claim("role", user.Role)
    };
    var token = new JwtSecurityToken(claims: claims, expires: DateTime.UtcNow.AddHours(8), signingCredentials: credentials);
    return new JwtSecurityTokenHandler().WriteToken(token);
}

static string BuildDecision(PatientInput parsed, IReadOnlyList<PasoResultado> pasos)
{
    var captchas = pasos.Count(p => p.Resultado == "captcha_detectado");
    var logins = pasos.Count(p => p.Resultado == "login_detectado");
    var unmapped = pasos.Count(p => p.Resultado == "pantalla_no_mapeada");
    var blocked = pasos.Count(p => p.Estado == "requiere_operador" && p.Resultado is not "captcha_detectado" and not "login_detectado" and not "pantalla_no_mapeada");
    var errors = pasos.Count(p => p.Estado == "error");
    var dateRule = parsed.FechaPrestacion is not null && parsed.FechaPrestacion.Value >= new DateOnly(2025, 1, 1)
        ? "Para esta fecha de prestacion corresponde revisar OS DESTINO en SSS."
        : "Para prestaciones anteriores a 2025-01-01 corresponde revisar OS ORIGEN en SSS.";
    return $"Consulta recorrida. Captchas detectados: {captchas}. Logins detectados: {logins}. Pantallas no mapeadas: {unmapped}. Otros pasos con operador: {blocked}. Errores tecnicos: {errors}. {dateRule}";
}

static void LoadEnv(string path)
{
    if (!File.Exists(path)) return;
    foreach (var rawLine in File.ReadAllLines(path))
    {
        var line = rawLine.Trim();
        if (line.Length == 0 || line.StartsWith('#') || !line.Contains('=')) continue;
        var idx = line.IndexOf('=');
        var key = line[..idx].Trim();
        var value = line[(idx + 1)..].Trim().Trim('"').Trim('\'');
        if (Environment.GetEnvironmentVariable(key) is null)
            Environment.SetEnvironmentVariable(key, value);
    }
}

sealed record AppSettings(
    string AppName,
    int Port,
    string FrontendUrl,
    string[] CorsOrigins,
    string Database,
    string ConnectionString,
    string JwtSecret,
    string AdminUsername,
    string AdminPassword,
    string SuperUsername,
    string SuperPassword,
    string SssUsername,
    string SssPassword)
{
    public static AppSettings FromEnvironment()
    {
        var host = Required("DB_HOST");
        var port = Required("DB_PORT");
        var database = Required("DB_NAME");
        var user = Required("DB_USER");
        var password = Required("DB_PASSWORD");
        var cs = $"Server={host};Port={port};Database={database};User ID={user};Password={password};CharSet=utf8mb4;Allow User Variables=True;";
        var origins = (Environment.GetEnvironmentVariable("CORS_ORIGINS") ?? Environment.GetEnvironmentVariable("FRONTEND_URL") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new AppSettings(
            Environment.GetEnvironmentVariable("APP_NAME") ?? "Verificacion de Cobertura de Salud",
            int.Parse(Environment.GetEnvironmentVariable("PORT") ?? "4510"),
            Environment.GetEnvironmentVariable("FRONTEND_URL") ?? "http://localhost:4610",
            origins.Length == 0 ? ["http://localhost:4610"] : origins,
            database,
            cs,
            Required("JWT_SECRET"),
            Environment.GetEnvironmentVariable("ADMIN_USERNAME") ?? "admin",
            Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "admin123",
            Environment.GetEnvironmentVariable("SUPERUSER_USERNAME") ?? "superusuario",
            Environment.GetEnvironmentVariable("SUPERUSER_PASSWORD") ?? "SUPERUSUARIO0987",
            Environment.GetEnvironmentVariable("SSS_USERNAME") ?? "",
            Environment.GetEnvironmentVariable("SSS_PASSWORD") ?? "");
    }

    static string Required(string key) =>
        Environment.GetEnvironmentVariable(key) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Falta configurar {key}");
}

sealed class Db(AppSettings settings)
{
    public async Task<MySqlConnection> OpenAsync()
    {
        var conn = new MySqlConnection(settings.ConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    public async Task MigrateAsync()
    {
        await using var conn = await OpenAsync();
        var sql = """
            CREATE TABLE IF NOT EXISTS usuarios (
              id INT AUTO_INCREMENT PRIMARY KEY,
              username VARCHAR(80) NOT NULL UNIQUE,
              password_hash VARCHAR(255) NOT NULL,
              role ENUM('admin','user') NOT NULL DEFAULT 'user',
              activo TINYINT(1) NOT NULL DEFAULT 1,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS consultas (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              entrada VARCHAR(80) NOT NULL,
              dni VARCHAR(20) NULL,
              cuil VARCHAR(20) NULL,
              apellido VARCHAR(120) NULL,
              fecha_prestacion DATE NULL,
              estado ENUM('pendiente','en_revision','completa','error') NOT NULL DEFAULT 'pendiente',
              decision_final VARCHAR(120) NULL,
              cobertura_recomendada VARCHAR(180) NULL,
              resumen TEXT NULL,
              observaciones TEXT NULL,
              creado_por INT NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              finished_at TIMESTAMP NULL,
              INDEX idx_consultas_created_at (created_at),
              INDEX idx_consultas_dni (dni),
              INDEX idx_consultas_cuil (cuil),
              CONSTRAINT fk_consultas_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS consulta_pasos (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              consulta_id BIGINT NOT NULL,
              orden INT NOT NULL,
              codigo VARCHAR(40) NOT NULL,
              nombre VARCHAR(160) NOT NULL,
              url VARCHAR(700) NOT NULL,
              estado ENUM('pendiente','consultado','requiere_operador','error') NOT NULL DEFAULT 'pendiente',
              resultado VARCHAR(120) NULL,
              resumen TEXT NULL,
              detalle JSON NULL,
              http_status INT NULL,
              titulo VARCHAR(255) NULL,
              texto_detectado MEDIUMTEXT NULL,
              requiere_operador TINYINT(1) NOT NULL DEFAULT 0,
              creado_por INT NOT NULL,
              started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              finished_at TIMESTAMP NULL,
              INDEX idx_pasos_consulta (consulta_id),
              CONSTRAINT fk_pasos_consulta FOREIGN KEY (consulta_id) REFERENCES consultas(id) ON DELETE CASCADE,
              CONSTRAINT fk_pasos_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

            CREATE TABLE IF NOT EXISTS auditoria (
              id BIGINT AUTO_INCREMENT PRIMARY KEY,
              usuario_id INT NULL,
              accion VARCHAR(80) NOT NULL,
              entidad VARCHAR(80) NOT NULL,
              entidad_id VARCHAR(80) NULL,
              detalle JSON NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_auditoria_accion (accion),
              INDEX idx_auditoria_created_at (created_at),
              CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """;
        foreach (var statement in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await using var cmd = new MySqlCommand(statement, conn);
            await cmd.ExecuteNonQueryAsync();
        }

        var hash = BCrypt.Net.BCrypt.HashPassword(settings.AdminPassword, 12);
        await using var admin = new MySqlCommand("""
            INSERT INTO usuarios (username, password_hash, role, activo)
            VALUES (@username, @hash, 'admin', 1)
            ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin', activo = 1
            """, conn);
        admin.Parameters.AddWithValue("@username", settings.AdminUsername);
        admin.Parameters.AddWithValue("@hash", hash);
        await admin.ExecuteNonQueryAsync();

        // Superusuario (rol admin) para el informe general de consultas.
        if (!string.IsNullOrWhiteSpace(settings.SuperUsername) && !string.IsNullOrWhiteSpace(settings.SuperPassword))
        {
            await using var super = new MySqlCommand("""
                INSERT INTO usuarios (username, password_hash, role, activo)
                VALUES (@username, @hash, 'admin', 1)
                ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin', activo = 1
                """, conn);
            super.Parameters.AddWithValue("@username", settings.SuperUsername);
            super.Parameters.AddWithValue("@hash", BCrypt.Net.BCrypt.HashPassword(settings.SuperPassword, 12));
            await super.ExecuteNonQueryAsync();
        }
    }

    public async Task<UserRecord?> GetUserByUsernameAsync(MySqlConnection conn, string username)
    {
        await using var cmd = new MySqlCommand(
            "SELECT id, username, password_hash, role, activo, created_at FROM usuarios WHERE username = @username", conn);
        cmd.Parameters.AddWithValue("@username", username);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? ReadUser(reader) : null;
    }

    public async Task<long> CreateConsultaAsync(MySqlConnection conn, int userId, PatientInput input)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO consultas (entrada, dni, cuil, apellido, fecha_prestacion, creado_por)
            VALUES (@entrada, @dni, @cuil, @apellido, @fecha, @userId);
            SELECT LAST_INSERT_ID();
            """, conn);
        cmd.Parameters.AddWithValue("@entrada", input.Entrada);
        cmd.Parameters.AddWithValue("@dni", (object?)input.Dni ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@cuil", (object?)input.Cuil ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@apellido", (object?)input.Apellido ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@fecha", input.FechaPrestacion is null ? DBNull.Value : input.FechaPrestacion.Value.ToString("yyyy-MM-dd"));
        cmd.Parameters.AddWithValue("@userId", userId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task InsertPasoAsync(MySqlConnection conn, long consultaId, int userId, PasoResultado paso)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO consulta_pasos
              (consulta_id, orden, codigo, nombre, url, estado, resultado, resumen, detalle,
               http_status, titulo, texto_detectado, requiere_operador, creado_por, finished_at)
            VALUES
              (@consultaId, @orden, @codigo, @nombre, @url, @estado, @resultado, @resumen, @detalle,
               @httpStatus, @titulo, @texto, @requiereOperador, @userId, NOW())
            """, conn);
        cmd.Parameters.AddWithValue("@consultaId", consultaId);
        cmd.Parameters.AddWithValue("@orden", paso.Orden);
        cmd.Parameters.AddWithValue("@codigo", paso.Codigo);
        cmd.Parameters.AddWithValue("@nombre", paso.Nombre);
        cmd.Parameters.AddWithValue("@url", paso.Url);
        cmd.Parameters.AddWithValue("@estado", paso.Estado);
        cmd.Parameters.AddWithValue("@resultado", paso.Resultado);
        cmd.Parameters.AddWithValue("@resumen", paso.Resumen);
        cmd.Parameters.AddWithValue("@detalle", JsonSerializer.Serialize(paso.Detalle));
        cmd.Parameters.AddWithValue("@httpStatus", (object?)paso.HttpStatus ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@titulo", (object?)paso.Titulo ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@texto", (object?)paso.TextoDetectado ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@requiereOperador", paso.RequiereOperador ? 1 : 0);
        cmd.Parameters.AddWithValue("@userId", userId);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task FinishConsultaAsync(MySqlConnection conn, long id, string estado, string resumen)
    {
        await using var cmd = new MySqlCommand(
            "UPDATE consultas SET estado = @estado, resumen = @resumen, finished_at = NOW() WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("@estado", estado);
        cmd.Parameters.AddWithValue("@resumen", resumen);
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<bool> CanSeeConsultaAsync(MySqlConnection conn, long id, CurrentUser user)
    {
        await using var cmd = new MySqlCommand(
            user.Role == "admin"
                ? "SELECT COUNT(*) FROM consultas WHERE id = @id"
                : "SELECT COUNT(*) FROM consultas WHERE id = @id AND creado_por = @userId", conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (user.Role != "admin") cmd.Parameters.AddWithValue("@userId", user.Id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync()) > 0;
    }

    public async Task<ConsultaDetail?> GetConsultaAsync(MySqlConnection conn, long id, CurrentUser user)
    {
        var where = user.Role == "admin" ? "c.id = @id" : "c.id = @id AND c.creado_por = @userId";
        await using var cmd = new MySqlCommand($"""
            SELECT c.*, u.username creado_por_nombre
            FROM consultas c
            JOIN usuarios u ON u.id = c.creado_por
            WHERE {where}
            """, conn);
        cmd.Parameters.AddWithValue("@id", id);
        if (user.Role != "admin") cmd.Parameters.AddWithValue("@userId", user.Id);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        var consulta = new ConsultaDetail(
            reader.GetInt64("id"),
            reader.GetString("entrada"),
            GetNullableString(reader, "dni"),
            GetNullableString(reader, "cuil"),
            GetNullableString(reader, "apellido"),
            reader.IsDBNull(reader.GetOrdinal("fecha_prestacion")) ? null : DateOnly.FromDateTime(reader.GetDateTime("fecha_prestacion")),
            reader.GetString("estado"),
            GetNullableString(reader, "decision_final"),
            GetNullableString(reader, "cobertura_recomendada"),
            GetNullableString(reader, "resumen"),
            GetNullableString(reader, "observaciones"),
            reader.GetInt32("creado_por"),
            reader.GetString("creado_por_nombre"),
            reader.GetDateTime("created_at"),
            reader.IsDBNull(reader.GetOrdinal("finished_at")) ? null : reader.GetDateTime("finished_at"),
            []);
        await reader.CloseAsync();

        var pasos = new List<PasoDto>();
        await using var p = new MySqlCommand("""
            SELECT id, orden, codigo, nombre, url, estado, resultado, resumen, http_status, titulo,
                   texto_detectado, requiere_operador, started_at, finished_at
            FROM consulta_pasos
            WHERE consulta_id = @id
            ORDER BY orden
            """, conn);
        p.Parameters.AddWithValue("@id", id);
        await using var pr = await p.ExecuteReaderAsync();
        while (await pr.ReadAsync())
        {
            pasos.Add(new PasoDto(
                pr.GetInt64("id"),
                pr.GetInt32("orden"),
                pr.GetString("codigo"),
                pr.GetString("nombre"),
                pr.GetString("url"),
                pr.GetString("estado"),
                GetNullableString(pr, "resultado"),
                GetNullableString(pr, "resumen"),
                pr.IsDBNull(pr.GetOrdinal("http_status")) ? null : pr.GetInt32("http_status"),
                GetNullableString(pr, "titulo"),
                GetNullableString(pr, "texto_detectado"),
                pr.GetInt32("requiere_operador") == 1,
                pr.GetDateTime("started_at"),
                pr.IsDBNull(pr.GetOrdinal("finished_at")) ? null : pr.GetDateTime("finished_at")));
        }
        return consulta with { Pasos = pasos };
    }

    public async Task AuditAsync(MySqlConnection conn, int? userId, string accion, string entidad, string? entidadId, object? detalle)
    {
        await using var cmd = new MySqlCommand("""
            INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle)
            VALUES (@userId, @accion, @entidad, @entidadId, @detalle)
            """, conn);
        cmd.Parameters.AddWithValue("@userId", (object?)userId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@accion", accion);
        cmd.Parameters.AddWithValue("@entidad", entidad);
        cmd.Parameters.AddWithValue("@entidadId", (object?)entidadId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@detalle", detalle is null ? DBNull.Value : JsonSerializer.Serialize(detalle));
        await cmd.ExecuteNonQueryAsync();
    }

    static UserRecord ReadUser(MySqlDataReader reader) => new(
        reader.GetInt32("id"),
        reader.GetString("username"),
        reader.GetString("password_hash"),
        reader.GetString("role"),
        reader.GetInt32("activo"),
        reader.GetDateTime("created_at"));

    static string? GetNullableString(MySqlDataReader reader, string name) =>
        reader.IsDBNull(reader.GetOrdinal(name)) ? null : reader.GetString(name);
}

sealed class CoverageWorkflow
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
            true, "No hay consulta publica por DNI: requiere sesion institucional (usuario/clave o WS de PUCO).",
            ["login", "dni_o_cuil"], RequiereCredenciales: true),
        new(5, "ioma", "IOMA - Padron de afiliados", "https://sistemas.ioma.gba.gov.ar/sistemas/buscador/buscador.html",
            false, "La URL publica es un buscador de contenido, no un padron. El padron de afiliados requiere login institucional.",
            ["dni", "sexo_o_afiliado"], RequiereCredenciales: true),
        new(6, "pami", "PAMI / INSSJP - Padron de afiliados", "https://prestadores.pami.org.ar/result.php?c=6-2&vm=2",
            false, "No hay consulta publica por DNI: la verificacion de afiliados va por Clave Unica PAMI (CUP), con login.",
            ["dni_o_beneficio"], RequiereCredenciales: true),
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

    // Modo local: abre el Chrome visible de una sola fuente para que el operador
    // resuelva el captcha/reCAPTCHA en la misma maquina y la app lea el resultado.
    public async Task<PasoResultado?> RunOneAsync(string codigo, PatientInput patient)
    {
        var paso = pasos.FirstOrDefault(p => p.Codigo == codigo);
        return paso is null ? null : await CheckPageAsync(paso, patient);
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

            // Fuentes sin consulta publica por DNI: abrimos la pagina para un operador con
            // credenciales, pero no fingimos una busqueda ni extraemos resultado automatico.
            if (paso.RequiereCredenciales)
            {
                var titleCred = await SafeTitleAsync(page);
                var textCred = await SafeBodyTextAsync(page);
                return new PasoResultado(
                    paso.Orden, paso.Codigo, paso.Nombre, page.Url,
                    "requiere_operador", "requiere_acceso_institucional",
                    $"{paso.Nombre}: no hay consulta publica por DNI/CUIL. Requiere acceso institucional (login). {paso.Indicacion}",
                    response?.Status, titleCred,
                    textCred.Length > 1800 ? textCred[..1800] : textCred,
                    true,
                    new
                    {
                        paso.Campos,
                        paso.Indicacion,
                        motivo = "Fuente sin consulta publica; requiere credenciales o login institucional.",
                        finalUrl = page.Url
                    });
            }

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
        diagnostico.Resultado is "captcha_detectado" or "login_detectado" or "formulario_listo_requiere_operador"
        && paso.Codigo is "sss" or "arca" or "anses_codem" or "servicio_domestico";

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

sealed record PasoDef(int Orden, string Codigo, string Nombre, string Url, bool RequiereOperador, string Indicacion, string[] Campos, bool RequiereCredenciales = false);
sealed record PageMap(
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

sealed record PageDiagnostic(
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

sealed record PasoResultado(
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

sealed record PatientInput(string Entrada, string? Dni, string? Cuil, string? Apellido, DateOnly? FechaPrestacion)
{
    public static PatientInput Parse(string? entrada, string? apellido, string? fechaPrestacion)
    {
        var raw = (entrada ?? "").Trim();
        if (raw.Length == 0) throw new BadHttpRequestException("Ingresar DNI, CUIL u otro identificador");
        var digits = Regex.Replace(raw, @"\D", "");
        string? dni = null;
        string? cuil = null;
        if (digits.Length == 11)
        {
            cuil = $"{digits[..2]}-{digits.Substring(2, 8)}-{digits[10..]}";
            dni = digits.Substring(2, 8).TrimStart('0');
        }
        else if (digits.Length is >= 7 and <= 9)
        {
            dni = digits;
        }
        DateOnly? fecha = DateOnly.TryParse(fechaPrestacion, out var parsedDate) ? parsedDate : null;
        return new PatientInput(raw, dni, cuil, string.IsNullOrWhiteSpace(apellido) ? null : apellido.Trim(), fecha);
    }

    // Cuando el operador carga DNI y/o CUIL por separado. Al menos uno es obligatorio.
    public static PatientInput FromDatos(string? dni, string? cuil, string? apellido)
    {
        var cuilDigits = Regex.Replace(cuil ?? "", @"\D", "");
        var dniDigits = Regex.Replace(dni ?? "", @"\D", "");

        string? cuilFmt = cuilDigits.Length == 11
            ? $"{cuilDigits[..2]}-{cuilDigits.Substring(2, 8)}-{cuilDigits[10..]}"
            : null;
        string? dniVal = dniDigits.Length is >= 7 and <= 9
            ? dniDigits
            : cuilDigits.Length == 11 ? cuilDigits.Substring(2, 8).TrimStart('0') : null;

        var entrada = cuilFmt ?? dniVal ?? "";
        if (entrada.Length == 0) throw new BadHttpRequestException("Ingresar DNI o CUIL valido");
        return new PatientInput(entrada, dniVal, cuilFmt,
            string.IsNullOrWhiteSpace(apellido) ? null : apellido.Trim(), null);
    }
}

sealed record CurrentUser(int Id, string Username, string Role)
{
    public static CurrentUser From(ClaimsPrincipal principal)
    {
        var id = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? "0");
        var username = principal.FindFirstValue("username") ?? principal.Identity?.Name ?? "";
        var role = principal.FindFirstValue(ClaimTypes.Role) ?? principal.FindFirstValue("role") ?? "user";
        return new CurrentUser(id, username, role);
    }

    public UserDto ToDto() => new(Id, Username, Role, true, DateTime.Now);
}

sealed record UserRecord(int Id, string Username, string PasswordHash, string Role, int Activo, DateTime CreatedAt);
sealed record UserDto(int Id, string Username, string Role, bool Activo, DateTime CreatedAt)
{
    public static UserDto From(UserRecord user) => new(user.Id, user.Username, user.Role, user.Activo == 1, user.CreatedAt);
}

sealed record LoginRequest(string? Username, string? Password);
sealed record LoginResponse(string Token, UserDto User);
sealed record UserCreateRequest(string? Username, string? Password, string? Role);
sealed record UserPatchRequest(string? Role, bool? Activo, string? Password);
sealed record ConsultaCreateRequest(string? Entrada, string? Apellido, string? FechaPrestacion);
sealed record ConsultaDecisionRequest(string? DecisionFinal, string? CoberturaRecomendada, string? Observaciones);
sealed record ConsultaLocalRequest(string? Fuente, string? Dni, string? Cuil, string? Apellido);
sealed record DesktopResultado(string? Fuente, string? Nombre, string? Veredicto, string? Texto, string? Url);
sealed record DesktopRecorridoRequest(string? Dni, string? Cuil, string? Apellido, List<DesktopResultado>? Resultados);
sealed record DesktopRecorridoResponse(long ConsultaId, string Usuario, int Fuentes);
sealed record ReporteRow(
    long ConsultaId,
    DateTime Fecha,
    string Usuario,
    string Entrada,
    string? Dni,
    string? Cuil,
    string? Apellido,
    string Fuente,
    string? Resultado,
    string Estado,
    string? Resumen);
sealed record ConsultaLocalResponse(
    long ConsultaId,
    string Codigo,
    string Nombre,
    string Estado,
    string Resultado,
    string Resumen,
    string? Titulo,
    int? HttpStatus,
    string? TextoDetectado,
    string Url);
sealed record ErrorResponse(string Error);
sealed record ConsultaListItem(
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
sealed record ConsultaDetail(
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
sealed record PasoDto(
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

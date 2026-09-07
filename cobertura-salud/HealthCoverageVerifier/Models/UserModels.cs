using System;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace HealthCoverageVerifier.Models;

public sealed record CurrentUser(int Id, string Username, string Role)
{
    public static CurrentUser From(ClaimsPrincipal principal)
    {
        var id = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier) 
            ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? "0");
        var username = principal.FindFirstValue("username") 
            ?? principal.Identity?.Name ?? "";
        var role = principal.FindFirstValue(ClaimTypes.Role) 
            ?? principal.FindFirstValue("role") ?? "user";
        return new CurrentUser(id, username, role);
    }

    public UserDto ToDto() => new(Id, Username, Role, true, DateTime.Now);
}

public sealed record UserRecord(int Id, string Username, string PasswordHash, string Role, int Activo, DateTime CreatedAt);

public sealed record UserDto(int Id, string Username, string Role, bool Activo, DateTime CreatedAt)
{
    public static UserDto From(UserRecord user) => 
        new(user.Id, user.Username, user.Role, user.Activo == 1, user.CreatedAt);
}

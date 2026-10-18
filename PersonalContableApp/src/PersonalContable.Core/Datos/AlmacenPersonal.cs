using System.Text.Json;
using System.Text.Json.Serialization;
using PersonalContable.Core.Modelos;

namespace PersonalContable.Core.Datos;

public sealed record ResultadoCarga(IReadOnlyList<Personal> Personal, string? Advertencia);

public interface IAlmacenPersonal
{
    ResultadoCarga Cargar();
    void Guardar(IEnumerable<Personal> personal);
}

/// <summary>
/// Guarda la planta en un archivo JSON.
/// - Escritura atómica: se escribe un temporal y se reemplaza el original, con copia .bak.
///   Si la PC se apaga a mitad de camino, el archivo anterior queda intacto.
/// - Un archivo dañado nunca se pisa: se renombra para poder recuperarlo.
/// - Lee el formato de la versión anterior (lista sin versión y año de ingreso).
/// </summary>
public sealed class AlmacenJson : IAlmacenPersonal
{
    private const int VersionActual = 2;
    private readonly string _ruta;
    private readonly string? _rutaHeredada;
    private readonly Func<DateTime> _ahora;

    private static readonly JsonSerializerOptions Opciones = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <param name="ruta">Archivo de datos.</param>
    /// <param name="rutaHeredada">Archivo de la versión anterior, que se importa si todavía no hay datos.</param>
    public AlmacenJson(string ruta, string? rutaHeredada = null, Func<DateTime>? ahora = null)
    {
        _ruta = ruta;
        _rutaHeredada = rutaHeredada;
        _ahora = ahora ?? (() => DateTime.Now);
    }

    public string Ruta => _ruta;

    /// <summary>%LOCALAPPDATA%\PersonalContable\personal.json</summary>
    public static string RutaPorDefecto() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PersonalContable", "personal.json");

    public ResultadoCarga Cargar()
    {
        string? origen = File.Exists(_ruta) ? _ruta
            : _rutaHeredada is not null && File.Exists(_rutaHeredada) ? _rutaHeredada
            : null;
        if (origen is null) return new ResultadoCarga([], null);

        try
        {
            var personal = Leer(File.ReadAllText(origen));
            string? aviso = origen == _ruta ? null
                : $"Se importaron {personal.Count} registros de la versión anterior.";
            return new ResultadoCarga(personal, aviso);
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            string respaldo = RespaldarDañado(origen);
            return new ResultadoCarga([],
                $"El archivo de datos estaba dañado y no se pudo leer. Se guardó una copia en \"{respaldo}\" y se empezó con la lista vacía.");
        }
    }

    public void Guardar(IEnumerable<Personal> personal)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_ruta))!);
        var archivo = new ArchivoV2(VersionActual, personal.ToList());
        string temporal = _ruta + ".tmp";
        File.WriteAllText(temporal, JsonSerializer.Serialize(archivo, Opciones));
        if (File.Exists(_ruta)) File.Replace(temporal, _ruta, _ruta + ".bak");
        else File.Move(temporal, _ruta);
    }

    private static List<Personal> Leer(string json)
    {
        using var documento = JsonDocument.Parse(json);
        if (documento.RootElement.ValueKind == JsonValueKind.Array)
        {
            var heredados = JsonSerializer.Deserialize<List<PersonalV1>>(json, Opciones) ?? [];
            return heredados.Select(Migrar).ToList();
        }
        var archivo = JsonSerializer.Deserialize<ArchivoV2>(json, Opciones)
            ?? throw new JsonException("Archivo vacío");
        if (archivo.Version > VersionActual)
            throw new NotSupportedException($"El archivo es de una versión más nueva ({archivo.Version}).");
        return archivo.Personal ?? [];
    }

    private string RespaldarDañado(string origen)
    {
        string destino = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(origen))!,
            $"personal.dañado-{_ahora():yyyyMMdd-HHmmss}.json");
        File.Copy(origen, destino, overwrite: true);
        return destino;
    }

    private static Personal Migrar(PersonalV1 v1) => new()
    {
        ApellidoNombre = v1.ApellidoNombre ?? string.Empty,
        Domicilio = v1.Domicilio ?? string.Empty,
        Localidad = v1.Localidad ?? string.Empty,
        Provincia = v1.Provincia ?? string.Empty,
        CodigoPostal = v1.CodigoPostal ?? string.Empty,
        Puesto = v1.Puesto,
        Categoria = v1.Categoria,
        // La versión anterior solo guardaba el año: se toma el 1 de enero
        FechaIngreso = new DateOnly(Math.Clamp(v1.AñoIngreso, 1950, 9999), 1, 1),
        SectorAsignado = v1.SectorAsignado ?? string.Empty,
        Actividad = v1.Actividad ?? string.Empty,
        SueldoNominal = v1.SueldoNominal,
    };

    private sealed record ArchivoV2(int Version, List<Personal>? Personal);

    private sealed record PersonalV1(
        string? ApellidoNombre, string? Domicilio, string? Localidad, string? Provincia, string? CodigoPostal,
        Puesto Puesto, Categoria Categoria, int AñoIngreso, string? SectorAsignado, string? Actividad, decimal SueldoNominal);
}

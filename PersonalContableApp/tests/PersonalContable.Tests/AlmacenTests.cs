using PersonalContable.Core.Datos;
using PersonalContable.Core.Modelos;

namespace PersonalContable.Tests;

public sealed class AlmacenTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("pca-").FullName;
    private string Ruta => Path.Combine(_dir, "personal.json");

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void Guarda_y_vuelve_a_leer_sin_perder_datos()
    {
        var almacen = new AlmacenJson(Ruta);
        var persona = Datos.Persona();
        almacen.Guardar([persona]);

        var leido = almacen.Cargar();
        Assert.Null(leido.Advertencia);
        Assert.Equal(persona, Assert.Single(leido.Personal));
    }

    [Fact]
    public void Crea_la_carpeta_y_deja_copia_de_respaldo_al_sobrescribir()
    {
        var almacen = new AlmacenJson(Path.Combine(_dir, "nueva", "personal.json"));
        almacen.Guardar([Datos.Persona("Uno")]);
        almacen.Guardar([Datos.Persona("Dos")]);

        Assert.True(File.Exists(Path.Combine(_dir, "nueva", "personal.json.bak")));
        Assert.False(File.Exists(Path.Combine(_dir, "nueva", "personal.json.tmp")));
        Assert.Equal("Dos", almacen.Cargar().Personal[0].ApellidoNombre);
    }

    [Fact]
    public void Un_archivo_danado_se_respalda_y_no_se_pisa()
    {
        File.WriteAllText(Ruta, "{ esto no es json");
        var almacen = new AlmacenJson(Ruta, ahora: () => new DateTime(2026, 10, 18, 9, 30, 0));

        var resultado = almacen.Cargar();

        Assert.Empty(resultado.Personal);
        Assert.Contains("dañado", resultado.Advertencia);
        string respaldo = Path.Combine(_dir, "personal.dañado-20261018-093000.json");
        Assert.Equal("{ esto no es json", File.ReadAllText(respaldo));
    }

    [Fact]
    public void Importa_el_formato_de_la_version_anterior()
    {
        string heredado = Path.Combine(_dir, "viejo.json");
        File.WriteAllText(heredado, """
        [
          {
            "ApellidoNombre": "Fernández, Ana",
            "Domicilio": "Belgrano 50",
            "Localidad": "Córdoba",
            "Provincia": "Córdoba",
            "CodigoPostal": "5000",
            "Puesto": "RecursosHumanos",
            "Categoria": "Jefe",
            "AñoIngreso": 2015,
            "SectorAsignado": "Personal",
            "Actividad": "Selección",
            "SueldoNominal": 1500000.50
          }
        ]
        """);

        var resultado = new AlmacenJson(Ruta, heredado).Cargar();

        var persona = Assert.Single(resultado.Personal);
        Assert.Equal(Puesto.RecursosHumanos, persona.Puesto);
        Assert.Equal(Categoria.Jefe, persona.Categoria);
        Assert.Equal(new DateOnly(2015, 1, 1), persona.FechaIngreso);
        Assert.Equal(1_500_000.50m, persona.SueldoNominal);
        Assert.Equal(string.Empty, persona.Cuil);
        Assert.Contains("versión anterior", resultado.Advertencia);
    }

    [Fact]
    public void Prefiere_el_archivo_nuevo_si_ya_existe()
    {
        string heredado = Path.Combine(_dir, "viejo.json");
        File.WriteAllText(heredado, "[]");
        new AlmacenJson(Ruta).Guardar([Datos.Persona()]);

        var resultado = new AlmacenJson(Ruta, heredado).Cargar();
        Assert.Single(resultado.Personal);
        Assert.Null(resultado.Advertencia);
    }

    [Fact]
    public void No_abre_archivos_de_una_version_mas_nueva()
    {
        File.WriteAllText(Ruta, """{ "Version": 99, "Personal": [] }""");
        var resultado = new AlmacenJson(Ruta).Cargar();
        Assert.NotNull(resultado.Advertencia);
    }
}

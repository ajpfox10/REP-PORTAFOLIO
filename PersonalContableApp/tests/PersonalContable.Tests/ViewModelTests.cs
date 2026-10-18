using System.Globalization;
using PersonalContable.Core.Datos;
using PersonalContable.Core.Modelos;
using PersonalContable.Core.ViewModels;

namespace PersonalContable.Tests;

internal sealed class AlmacenEnMemoria : IAlmacenPersonal
{
    public List<Personal> Guardado = [];
    public bool Fallar;
    public string? Advertencia;
    public ResultadoCarga Cargar() => new(Guardado.ToList(), Advertencia);
    public void Guardar(IEnumerable<Personal> personal)
    {
        if (Fallar) throw new IOException("disco lleno");
        Guardado = personal.ToList();
    }
}

internal sealed class DialogosFalsos : IDialogos
{
    public bool RespuestaConfirmar = true;
    public List<string> Mensajes = [];
    public string? Archivo;
    public bool Confirmar(string titulo, string mensaje) { Mensajes.Add(mensaje); return RespuestaConfirmar; }
    public void Informar(string titulo, string mensaje) => Mensajes.Add(mensaje);
    public void Error(string titulo, string mensaje) => Mensajes.Add("ERROR " + mensaje);
    public string? ElegirArchivoParaGuardar(string nombreSugerido, string filtro) => Archivo;
}

public class ViewModelTests
{
    private static readonly CultureInfo Ar = new("es-AR");

    private static (PrincipalViewModel vm, AlmacenEnMemoria almacen, DialogosFalsos dialogos) Crear(params Personal[] iniciales)
    {
        var almacen = new AlmacenEnMemoria { Guardado = [.. iniciales] };
        var dialogos = new DialogosFalsos();
        var vm = new PrincipalViewModel(almacen, dialogos, () => Datos.Hoy, Ar);
        vm.Inicializar();
        return (vm, almacen, dialogos);
    }

    private static void Completar(FormularioPersonalViewModel f)
    {
        f.ApellidoNombre = "Ruiz, Carla";
        f.Cuil = "20-12345678-6";
        f.Provincia = "Mendoza";
        f.CodigoPostal = "5500";
        f.Puesto = Puesto.IT;
        f.Categoria = Categoria.Jefe;
        f.FechaIngreso = new DateTime(2022, 2, 1);
        f.SueldoNominal = "2.000.000";
    }

    [Fact]
    public void Agrega_una_persona_y_actualiza_tabla_y_resumen()
    {
        var (vm, almacen, _) = Crear();
        vm.NuevoCommand.Execute(null);
        Assert.True(vm.PanelAbierto);
        Completar(vm.Formulario);

        vm.GuardarCommand.Execute(null);

        Assert.False(vm.PanelAbierto);
        Assert.Single(almacen.Guardado);
        Assert.Equal("Ruiz, Carla", vm.Seleccionada?.ApellidoNombre);
        Assert.Equal(2_000_000m, vm.Resumen.MasaSalarialBruta);
        Assert.Equal(1_660_000m, vm.Resumen.NetoTotal);
    }

    [Fact]
    public void No_guarda_si_el_formulario_tiene_errores_y_los_muestra()
    {
        var (vm, almacen, _) = Crear();
        vm.NuevoCommand.Execute(null);
        Assert.False(vm.Formulario.HasErrors); // no se muestran errores antes de tocar nada

        vm.GuardarCommand.Execute(null);

        Assert.True(vm.PanelAbierto);
        Assert.Empty(almacen.Guardado);
        Assert.True(vm.Formulario.HasErrors);
        Assert.Equal("Ingresá el CUIL.", vm.Formulario.ErrorDe(nameof(FormularioPersonalViewModel.Cuil)));
    }

    [Fact]
    public void Edita_sin_duplicar_y_mantiene_el_id()
    {
        var persona = Datos.Persona();
        var (vm, almacen, _) = Crear(persona);
        vm.Seleccionada = vm.Filas[0];
        vm.EditarCommand.Execute(null);
        vm.Formulario.SueldoNominal = "1.500.000";

        vm.GuardarCommand.Execute(null);

        var guardada = Assert.Single(almacen.Guardado);
        Assert.Equal(persona.Id, guardada.Id);
        Assert.Equal(1_500_000m, guardada.SueldoNominal);
    }

    [Fact]
    public void Eliminar_pide_confirmacion()
    {
        var (vm, almacen, dialogos) = Crear(Datos.Persona());
        vm.Seleccionada = vm.Filas[0];

        dialogos.RespuestaConfirmar = false;
        vm.EliminarCommand.Execute(null);
        Assert.Single(almacen.Guardado);

        dialogos.RespuestaConfirmar = true;
        vm.EliminarCommand.Execute(null);
        Assert.Empty(almacen.Guardado);
        Assert.Empty(vm.Filas);
    }

    [Fact]
    public void Si_falla_el_guardado_no_se_pierde_el_estado_anterior()
    {
        var (vm, almacen, dialogos) = Crear(Datos.Persona());
        almacen.Fallar = true;
        vm.Seleccionada = vm.Filas[0];

        vm.EliminarCommand.Execute(null);

        Assert.Single(vm.Filas);
        Assert.Contains(dialogos.Mensajes, m => m.StartsWith("ERROR"));
    }

    [Fact]
    public void Busca_sin_importar_acentos_y_filtra_por_puesto()
    {
        var (vm, _, _) = Crear(
            Datos.Persona("Martínez, José", puesto: Puesto.Taller, cuil: "20123456786"),
            Datos.Persona("Gómez, Laura", puesto: Puesto.Contable));

        vm.Busqueda = "martinez";
        Assert.Equal("Martínez, José", Assert.Single(vm.Filas).ApellidoNombre);
        Assert.Equal("1 de 2 personas", vm.TextoConteo);

        vm.Busqueda = string.Empty;
        vm.FiltroPuesto = vm.OpcionesPuesto.First(o => o.Valor == Puesto.Contable);
        Assert.Equal("Gómez, Laura", Assert.Single(vm.Filas).ApellidoNombre);

        vm.LimpiarFiltrosCommand.Execute(null);
        Assert.Equal(2, vm.Filas.Count);
    }

    [Fact]
    public void Muestra_el_aviso_del_almacen()
    {
        var almacen = new AlmacenEnMemoria { Advertencia = "Se importaron 3 registros" };
        var vm = new PrincipalViewModel(almacen, new DialogosFalsos(), () => Datos.Hoy, Ar);
        vm.Inicializar();
        Assert.Equal("Se importaron 3 registros", vm.Aviso);
        vm.CerrarAvisoCommand.Execute(null);
        Assert.Null(vm.Aviso);
    }

    [Fact]
    public void Exporta_al_archivo_elegido()
    {
        var (vm, _, dialogos) = Crear(Datos.Persona());
        string ruta = Path.Combine(Path.GetTempPath(), $"pca-{Guid.NewGuid()}.csv");
        dialogos.Archivo = ruta;
        try
        {
            vm.ExportarCommand.Execute(null);
            string contenido = File.ReadAllText(ruta);
            Assert.Contains("Gómez, Laura", contenido);
            Assert.Equal(0xEF, File.ReadAllBytes(ruta)[0]); // BOM UTF-8 para que Excel muestre bien los acentos
        }
        finally { File.Delete(ruta); }
    }

    [Fact]
    public void Vista_previa_de_liquidacion_mientras_se_escribe()
    {
        var (vm, _, _) = Crear();
        vm.NuevoCommand.Execute(null);
        Assert.Null(vm.Formulario.Liquidacion);
        vm.Formulario.SueldoNominal = "1.000.000";
        Assert.Equal(830_000m, vm.Formulario.Liquidacion?.SueldoNeto);
    }
}

using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PersonalContable.Core.Datos;
using PersonalContable.Core.Modelos;
using PersonalContable.Core.Servicios;

namespace PersonalContable.Core.ViewModels;

/// <summary>Pantalla principal: resumen, listado con filtros y formulario lateral.</summary>
public sealed partial class PrincipalViewModel : ObservableObject
{
    private readonly IAlmacenPersonal _almacen;
    private readonly IDialogos _dialogos;
    private readonly Func<DateOnly> _hoy;
    private readonly CultureInfo _cultura;
    private readonly ParametrosLiquidacion _parametros;
    private List<Personal> _personal = [];

    public PrincipalViewModel(IAlmacenPersonal almacen, IDialogos dialogos, Func<DateOnly>? hoy = null,
        CultureInfo? cultura = null, ParametrosLiquidacion? parametros = null)
    {
        _almacen = almacen;
        _dialogos = dialogos;
        _hoy = hoy ?? (() => DateOnly.FromDateTime(DateTime.Today));
        _cultura = cultura ?? CultureInfo.CurrentCulture;
        _parametros = parametros ?? ParametrosLiquidacion.PorDefecto;
        Formulario = new FormularioPersonalViewModel(() => _personal, _hoy, _cultura, _parametros);
        Resumen = ResumenPlantilla.Calcular([], _hoy(), _parametros);

        OpcionesPuesto = [new("Todos los puestos", null), .. EnumeracionesExtensiones.TodosLosPuestos.Select(p => new OpcionFiltro<Puesto>(p.Nombre(), p))];
        OpcionesCategoria = [new("Todas las categorías", null), .. EnumeracionesExtensiones.TodasLasCategorias.Select(c => new OpcionFiltro<Categoria>(c.Nombre(), c))];
        _filtroPuesto = OpcionesPuesto[0];
        _filtroCategoria = OpcionesCategoria[0];
    }

    public FormularioPersonalViewModel Formulario { get; }
    public ObservableCollection<FilaPersonal> Filas { get; } = [];
    public IReadOnlyList<OpcionFiltro<Puesto>> OpcionesPuesto { get; }
    public IReadOnlyList<OpcionFiltro<Categoria>> OpcionesCategoria { get; }
    public ParametrosLiquidacion Parametros => _parametros;

    [ObservableProperty] private ResumenPlantilla _resumen;
    [ObservableProperty] private string _busqueda = string.Empty;
    [ObservableProperty] private OpcionFiltro<Puesto> _filtroPuesto;
    [ObservableProperty] private OpcionFiltro<Categoria> _filtroCategoria;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(EditarCommand), nameof(EliminarCommand))]
    private FilaPersonal? _seleccionada;

    [ObservableProperty] private bool _panelAbierto;
    /// <summary>Mensaje informativo arriba de la tabla (por ejemplo, datos importados).</summary>
    [ObservableProperty] private string? _aviso;

    public int Total => _personal.Count;
    public string TextoConteo => Filas.Count == _personal.Count
        ? $"{_personal.Count} {(_personal.Count == 1 ? "persona" : "personas")}"
        : $"{Filas.Count} de {_personal.Count} personas";
    public bool HayPersonal => _personal.Count > 0;
    public bool SinResultados => _personal.Count > 0 && Filas.Count == 0;
    public int SinCuil => _personal.Count(p => p.Cuil.Length == 0);

    public void Inicializar()
    {
        var resultado = _almacen.Cargar();
        _personal = [.. resultado.Personal];
        Aviso = resultado.Advertencia;
        Actualizar();
    }

    partial void OnBusquedaChanged(string value) => AplicarFiltros();
    partial void OnFiltroPuestoChanged(OpcionFiltro<Puesto> value) => AplicarFiltros();
    partial void OnFiltroCategoriaChanged(OpcionFiltro<Categoria> value) => AplicarFiltros();

    [RelayCommand]
    private void Nuevo()
    {
        Formulario.Nuevo();
        PanelAbierto = true;
    }

    private bool HaySeleccion() => Seleccionada is not null;

    [RelayCommand(CanExecute = nameof(HaySeleccion))]
    private void Editar()
    {
        if (Seleccionada is null) return;
        Formulario.Editar(Seleccionada.Personal);
        PanelAbierto = true;
    }

    [RelayCommand]
    private void Guardar()
    {
        var persona = Formulario.IntentarCrear();
        if (persona is null) return;

        var anterior = _personal.ToList();
        int indice = _personal.FindIndex(p => p.Id == persona.Id);
        if (indice >= 0) _personal[indice] = persona; else _personal.Add(persona);

        if (!Persistir(anterior)) return;
        PanelAbierto = false;
        Actualizar(seleccionar: persona.Id);
    }

    [RelayCommand]
    private void Cancelar() => PanelAbierto = false;

    [RelayCommand(CanExecute = nameof(HaySeleccion))]
    private void Eliminar()
    {
        if (Seleccionada is not { } fila) return;
        if (!_dialogos.Confirmar("Eliminar persona", $"¿Seguro que querés eliminar a {fila.ApellidoNombre}? Esta acción no se puede deshacer.")) return;

        var anterior = _personal.ToList();
        _personal.RemoveAll(p => p.Id == fila.Personal.Id);
        if (!Persistir(anterior)) return;
        if (Formulario.EditandoId == fila.Personal.Id) PanelAbierto = false;
        Actualizar();
    }

    [RelayCommand]
    private void Exportar()
    {
        if (_personal.Count == 0)
        {
            _dialogos.Informar("Exportar", "No hay personal para exportar.");
            return;
        }
        string? ruta = _dialogos.ElegirArchivoParaGuardar($"personal_{_hoy():yyyy-MM-dd}.csv", "Planilla CSV (*.csv)|*.csv");
        if (ruta is null) return;
        try
        {
            using var escritor = new StreamWriter(ruta, append: false, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            ExportadorCsv.Exportar(_personal, escritor, _hoy(), _cultura, _parametros);
            _dialogos.Informar("Exportar", $"Se exportaron {_personal.Count} personas a:\n{ruta}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _dialogos.Error("No se pudo exportar", $"Revisá que el archivo no esté abierto en otro programa.\n\n{ex.Message}");
        }
    }

    [RelayCommand]
    private void LimpiarFiltros()
    {
        Busqueda = string.Empty;
        FiltroPuesto = OpcionesPuesto[0];
        FiltroCategoria = OpcionesCategoria[0];
    }

    [RelayCommand]
    private void CerrarAviso() => Aviso = null;

    /// <summary>Guarda en disco; si falla, vuelve atrás el cambio en memoria.</summary>
    private bool Persistir(List<Personal> anterior)
    {
        try
        {
            _almacen.Guardar(_personal);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _personal = anterior;
            _dialogos.Error("No se pudo guardar", $"Los cambios no se guardaron.\n\n{ex.Message}");
            return false;
        }
    }

    private void Actualizar(Guid? seleccionar = null)
    {
        Resumen = ResumenPlantilla.Calcular(_personal, _hoy(), _parametros);
        AplicarFiltros(seleccionar);
        OnPropertyChanged(nameof(Total));
        OnPropertyChanged(nameof(HayPersonal));
        OnPropertyChanged(nameof(SinCuil));
    }

    private void AplicarFiltros(Guid? seleccionar = null)
    {
        Guid? actual = seleccionar ?? Seleccionada?.Personal.Id;
        string texto = Normalizar(Busqueda);
        var hoy = _hoy();

        var visibles = _personal
            .Where(p => FiltroPuesto.Valor is null || p.Puesto == FiltroPuesto.Valor)
            .Where(p => FiltroCategoria.Valor is null || p.Categoria == FiltroCategoria.Valor)
            .Where(p => texto.Length == 0 || Coincide(p, texto))
            .OrderBy(p => p.ApellidoNombre, StringComparer.Create(_cultura, ignoreCase: true))
            .Select(p => new FilaPersonal(p, hoy, _parametros))
            .ToList();

        Filas.Clear();
        foreach (var fila in visibles) Filas.Add(fila);
        Seleccionada = Filas.FirstOrDefault(f => f.Personal.Id == actual);

        OnPropertyChanged(nameof(TextoConteo));
        OnPropertyChanged(nameof(SinResultados));
    }

    private static bool Coincide(Personal p, string texto) =>
        new[] { p.ApellidoNombre, p.Cuil, Cuil.Formatear(p.Cuil), p.Localidad, p.Provincia, p.SectorAsignado, p.Actividad, p.Puesto.Nombre(), p.Categoria.Nombre() }
            .Any(campo => Normalizar(campo).Contains(texto, StringComparison.Ordinal));

    /// <summary>Minúsculas y sin acentos: "Martínez" encuentra "martinez".</summary>
    internal static string Normalizar(string? texto)
    {
        string descompuesto = (texto ?? string.Empty).Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(descompuesto.Length);
        foreach (char c in descompuesto)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString();
    }
}

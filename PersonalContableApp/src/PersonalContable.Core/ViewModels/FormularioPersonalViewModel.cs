using System.Collections;
using System.ComponentModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using PersonalContable.Core.Modelos;
using PersonalContable.Core.Servicios;

namespace PersonalContable.Core.ViewModels;

/// <summary>
/// Formulario de alta y edición. Valida mientras se escribe, pero solo muestra el
/// error de un campo después de que la persona lo tocó o intentó guardar.
/// </summary>
public sealed partial class FormularioPersonalViewModel : ObservableObject, INotifyDataErrorInfo
{
    private readonly Func<IReadOnlyCollection<Personal>> _existentes;
    private readonly Func<DateOnly> _hoy;
    private readonly CultureInfo _cultura;
    private readonly ParametrosLiquidacion _parametros;
    private readonly HashSet<string> _tocados = [];
    private Dictionary<string, string> _errores = [];
    private bool _cargando;

    public FormularioPersonalViewModel(Func<IReadOnlyCollection<Personal>> existentes, Func<DateOnly> hoy, CultureInfo cultura, ParametrosLiquidacion parametros)
    {
        _existentes = existentes;
        _hoy = hoy;
        _cultura = cultura;
        _parametros = parametros;
    }

    public Guid? EditandoId { get; private set; }
    public bool EsEdicion => EditandoId is not null;
    public string Titulo => EsEdicion ? "Editar persona" : "Nueva persona";
    public string TextoGuardar => EsEdicion ? "Guardar cambios" : "Agregar";

    [ObservableProperty] private string _apellidoNombre = string.Empty;
    [ObservableProperty] private string _cuil = string.Empty;
    [ObservableProperty] private string _domicilio = string.Empty;
    [ObservableProperty] private string _localidad = string.Empty;
    [ObservableProperty] private string _provincia = string.Empty;
    [ObservableProperty] private string _codigoPostal = string.Empty;
    [ObservableProperty] private Puesto? _puesto;
    [ObservableProperty] private Categoria? _categoria;
    [ObservableProperty] private DateTime? _fechaIngreso;
    [ObservableProperty] private string _sectorAsignado = string.Empty;
    [ObservableProperty] private string _actividad = string.Empty;
    [ObservableProperty] private string _sueldoNominal = string.Empty;

    public IReadOnlyList<Puesto> Puestos => EnumeracionesExtensiones.TodosLosPuestos;
    public IReadOnlyList<Categoria> Categorias => EnumeracionesExtensiones.TodasLasCategorias;
    public IReadOnlyList<string> Provincias => Modelos.Provincias.Todas;

    /// <summary>Vista previa de la liquidación mientras se escribe el sueldo.</summary>
    public LiquidacionEstimada? Liquidacion =>
        ValidadorPersonal.TryParseImporte(SueldoNominal, _cultura, out decimal sueldo) && sueldo > 0
            ? CalculadoraLiquidacion.Calcular(sueldo, _parametros)
            : null;

    public void Nuevo()
    {
        Cargar(null, new DatosFormulario(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty,
            string.Empty, null, null, null, string.Empty, string.Empty, string.Empty));
    }

    public void Editar(Personal p)
    {
        Cargar(p.Id, new DatosFormulario(p.ApellidoNombre, Servicios.Cuil.Formatear(p.Cuil), p.Domicilio, p.Localidad,
            p.Provincia, p.CodigoPostal, p.Puesto, p.Categoria, p.FechaIngreso.ToDateTime(TimeOnly.MinValue),
            p.SectorAsignado, p.Actividad, p.SueldoNominal.ToString("0.##", _cultura)));
    }

    /// <summary>Valida todo; si está bien devuelve la persona lista para guardar.</summary>
    public Personal? IntentarCrear()
    {
        foreach (var campo in CamposValidados) _tocados.Add(campo);
        Revalidar();
        return HasErrors ? null : ValidadorPersonal.CrearPersonal(Datos(), EditandoId ?? Guid.NewGuid(), _cultura);
    }

    private static readonly string[] CamposValidados =
    [
        nameof(ApellidoNombre), nameof(Cuil), nameof(Provincia), nameof(CodigoPostal),
        nameof(Puesto), nameof(Categoria), nameof(FechaIngreso), nameof(SueldoNominal),
    ];

    private void Cargar(Guid? id, DatosFormulario d)
    {
        _cargando = true;
        EditandoId = id;
        ApellidoNombre = d.ApellidoNombre;
        Cuil = d.Cuil;
        Domicilio = d.Domicilio;
        Localidad = d.Localidad;
        Provincia = d.Provincia;
        CodigoPostal = d.CodigoPostal;
        Puesto = d.Puesto;
        Categoria = d.Categoria;
        FechaIngreso = d.FechaIngreso;
        SectorAsignado = d.SectorAsignado;
        Actividad = d.Actividad;
        SueldoNominal = d.SueldoNominal;
        _cargando = false;

        _tocados.Clear();
        Revalidar();
        OnPropertyChanged(nameof(EsEdicion));
        OnPropertyChanged(nameof(Titulo));
        OnPropertyChanged(nameof(TextoGuardar));
    }

    private DatosFormulario Datos() => new(ApellidoNombre, Cuil, Domicilio, Localidad, Provincia, CodigoPostal,
        Puesto, Categoria, FechaIngreso, SectorAsignado, Actividad, SueldoNominal);

    protected override void OnPropertyChanged(PropertyChangedEventArgs e)
    {
        base.OnPropertyChanged(e);
        if (_cargando || e.PropertyName is null || !CamposValidados.Contains(e.PropertyName)) return;
        _tocados.Add(e.PropertyName);
        Revalidar();
        if (e.PropertyName == nameof(SueldoNominal)) OnPropertyChanged(nameof(Liquidacion));
    }

    private void Revalidar()
    {
        var todos = ValidadorPersonal.Validar(Datos(), _existentes(), EditandoId, _hoy(), _cultura);
        var visibles = todos.Where(kv => _tocados.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
        var cambiados = _errores.Keys.Union(visibles.Keys)
            .Where(k => !_errores.TryGetValue(k, out var a) | !visibles.TryGetValue(k, out var b) || a != b)
            .ToList();
        _errores = visibles;
        foreach (var campo in cambiados) ErrorsChanged?.Invoke(this, new DataErrorsChangedEventArgs(campo));
        OnPropertyChanged(nameof(HasErrors));
        OnPropertyChanged(nameof(Liquidacion));
    }

    // ── INotifyDataErrorInfo ─────────────────────────────────────────────────
    public bool HasErrors => _errores.Count > 0;
    public event EventHandler<DataErrorsChangedEventArgs>? ErrorsChanged;

    public IEnumerable GetErrors(string? propertyName) =>
        propertyName is not null && _errores.TryGetValue(propertyName, out var error) ? new[] { error } : Array.Empty<string>();

    public string? ErrorDe(string campo) => _errores.GetValueOrDefault(campo);
}

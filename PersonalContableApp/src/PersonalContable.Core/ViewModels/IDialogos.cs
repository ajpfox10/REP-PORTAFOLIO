namespace PersonalContable.Core.ViewModels;

/// <summary>Lo que la lógica necesita de la interfaz, sin depender de WPF.</summary>
public interface IDialogos
{
    bool Confirmar(string titulo, string mensaje);
    void Informar(string titulo, string mensaje);
    void Error(string titulo, string mensaje);
    /// <summary>Pide dónde guardar un archivo. Devuelve null si la persona cancela.</summary>
    string? ElegirArchivoParaGuardar(string nombreSugerido, string filtro);
}

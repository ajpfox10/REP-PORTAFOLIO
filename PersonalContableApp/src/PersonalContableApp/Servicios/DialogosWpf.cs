using System.Windows;
using Microsoft.Win32;
using PersonalContable.Core.ViewModels;

namespace PersonalContableApp.Servicios;

/// <summary>Implementación de los diálogos con las ventanas estándar de Windows.</summary>
public sealed class DialogosWpf(Window duenia) : IDialogos
{
    public bool Confirmar(string titulo, string mensaje) =>
        MessageBox.Show(duenia, mensaje, titulo, MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No)
            == MessageBoxResult.Yes;

    public void Informar(string titulo, string mensaje) =>
        MessageBox.Show(duenia, mensaje, titulo, MessageBoxButton.OK, MessageBoxImage.Information);

    public void Error(string titulo, string mensaje) =>
        MessageBox.Show(duenia, mensaje, titulo, MessageBoxButton.OK, MessageBoxImage.Error);

    public string? ElegirArchivoParaGuardar(string nombreSugerido, string filtro)
    {
        var dialogo = new SaveFileDialog { FileName = nombreSugerido, Filter = filtro, AddExtension = true };
        return dialogo.ShowDialog(duenia) == true ? dialogo.FileName : null;
    }
}

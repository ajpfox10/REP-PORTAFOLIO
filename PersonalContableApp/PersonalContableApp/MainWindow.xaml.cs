// Archivo: MainWindow.xaml.cs
using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Microsoft.Win32;
using PersonalContableApp.Models;
using PersonalContableApp.Data;

namespace PersonalContableApp
{
    public partial class MainWindow : Window
    {
        private RepositorioPersonal repositorio = new RepositorioPersonal();
        private ICollectionView _vistaPersonal;
        private Personal? _personalEditando;

        public MainWindow()
        {
            InitializeComponent();
            _vistaPersonal = CollectionViewSource.GetDefaultView(repositorio.ObtenerTodo());
            _vistaPersonal.Filter = FiltrarPersonal;
            dataGridPersonal.ItemsSource = _vistaPersonal;
        }

        protected override void OnContentRendered(EventArgs e)
        {
            base.OnContentRendered(e);
            if (repositorio.HuboErrorAlCargar)
                MessageBox.Show("El archivo de datos está corrupto o no se pudo leer. Se inició con la lista vacía.",
                                "Advertencia", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        // ── Filtro ────────────────────────────────────────────────────────────

        private bool FiltrarPersonal(object obj)
        {
            if (obj is not Personal p) return false;
            string texto = txtBusqueda.Text.Trim().ToLower();
            if (string.IsNullOrEmpty(texto)) return true;
            return p.ApellidoNombre.ToLower().Contains(texto)
                || p.Puesto.ToString().ToLower().Contains(texto)
                || p.Categoria.ToString().ToLower().Contains(texto)
                || (p.SectorAsignado?.ToLower().Contains(texto) ?? false)
                || (p.Localidad?.ToLower().Contains(texto) ?? false)
                || (p.Actividad?.ToLower().Contains(texto) ?? false);
        }

        private void txtBusqueda_TextChanged(object sender, TextChangedEventArgs e)
        {
            _vistaPersonal.Refresh();
        }

        // ── Agregar / Guardar cambios ─────────────────────────────────────────

        private void Agregar_Click(object sender, RoutedEventArgs e)
        {
            if (!ValidarFormulario(out Personal datos)) return;

            try
            {
                if (_personalEditando != null)
                {
                    repositorio.ActualizarPersonal(_personalEditando, datos);
                    SalirModoEdicion();
                    MessageBox.Show("Personal actualizado exitosamente.", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                else
                {
                    repositorio.AgregarPersonal(datos);
                    LimpiarCampos();
                    MessageBox.Show("Personal agregado exitosamente.", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error al guardar: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ── Editar ────────────────────────────────────────────────────────────

        private void Editar_Click(object sender, RoutedEventArgs e)
        {
            if (dataGridPersonal.SelectedItem is not Personal seleccionado)
            {
                MessageBox.Show("Seleccione un personal para editar.", "Información", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            _personalEditando = seleccionado;
            PopularFormulario(seleccionado);
            EntrarModoEdicion();
        }

        private void Cancelar_Click(object sender, RoutedEventArgs e)
        {
            SalirModoEdicion();
        }

        private void EntrarModoEdicion()
        {
            txtTituloFormulario.Text = "Editar Personal";
            btnAgregar.Content = "Guardar Cambios";
            btnCancelar.Visibility = Visibility.Visible;
        }

        private void SalirModoEdicion()
        {
            _personalEditando = null;
            txtTituloFormulario.Text = "Agregar Nuevo Personal";
            btnAgregar.Content = "Agregar";
            btnCancelar.Visibility = Visibility.Collapsed;
            LimpiarCampos();
        }

        private void PopularFormulario(Personal p)
        {
            txtApellidoNombre.Text = p.ApellidoNombre;
            txtDomicilio.Text = p.Domicilio;
            txtLocalidad.Text = p.Localidad;
            txtProvincia.Text = p.Provincia;
            txtCodigoPostal.Text = p.CodigoPostal;
            txtAñoIngreso.Text = p.AñoIngreso.ToString();
            txtSectorAsignado.Text = p.SectorAsignado;
            txtActividad.Text = p.Actividad;
            txtSueldoNominal.Text = p.SueldoNominal.ToString(CultureInfo.CurrentCulture);
            SeleccionarCombo(cmbPuesto, (int)p.Puesto);
            SeleccionarCombo(cmbCategoria, (int)p.Categoria);
        }

        private void SeleccionarCombo(ComboBox combo, int tag)
        {
            foreach (ComboBoxItem item in combo.Items)
            {
                if (Convert.ToInt32(item.Tag) == tag)
                {
                    combo.SelectedItem = item;
                    return;
                }
            }
        }

        // ── Eliminar ──────────────────────────────────────────────────────────

        private void Eliminar_Click(object sender, RoutedEventArgs e)
        {
            if (dataGridPersonal.SelectedItem is not Personal seleccionado)
            {
                MessageBox.Show("Seleccione un personal para eliminar.", "Información", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var resultado = MessageBox.Show($"¿Está seguro de eliminar a {seleccionado.ApellidoNombre}?",
                                            "Confirmar Eliminación",
                                            MessageBoxButton.YesNo,
                                            MessageBoxImage.Question);
            if (resultado != MessageBoxResult.Yes) return;

            if (ReferenceEquals(_personalEditando, seleccionado)) SalirModoEdicion();

            try
            {
                bool eliminado = repositorio.EliminarPersonal(seleccionado);
                if (eliminado)
                    MessageBox.Show("Personal eliminado exitosamente.", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
                else
                    MessageBox.Show("No se pudo eliminar el personal.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error al eliminar: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ── Exportar CSV ──────────────────────────────────────────────────────

        private void Exportar_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new SaveFileDialog
            {
                Filter = "CSV (*.csv)|*.csv",
                FileName = "personal_contable"
            };
            if (dialog.ShowDialog() != true) return;

            try
            {
                using var writer = new StreamWriter(dialog.FileName, false, new UTF8Encoding(true));
                writer.WriteLine("Apellido y Nombre,Domicilio,Localidad,Provincia,Código Postal,Puesto,Categoría,Año Ingreso,Sector Asignado,Actividad,Sueldo Nominal");
                foreach (Personal p in repositorio.ObtenerTodo())
                {
                    writer.WriteLine(string.Join(",",
                        EscaparCsv(p.ApellidoNombre),
                        EscaparCsv(p.Domicilio),
                        EscaparCsv(p.Localidad),
                        EscaparCsv(p.Provincia),
                        EscaparCsv(p.CodigoPostal),
                        p.Puesto,
                        p.Categoria,
                        p.AñoIngreso,
                        EscaparCsv(p.SectorAsignado),
                        EscaparCsv(p.Actividad),
                        p.SueldoNominal.ToString(CultureInfo.InvariantCulture)));
                }
                MessageBox.Show($"Exportado exitosamente a:\n{dialog.FileName}", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error al exportar: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private static string EscaparCsv(string valor)
        {
            if (string.IsNullOrEmpty(valor)) return string.Empty;
            if (valor.Contains(',') || valor.Contains('"') || valor.Contains('\n'))
                return $"\"{valor.Replace("\"", "\"\"")}\"";
            return valor;
        }

        // ── Validación ────────────────────────────────────────────────────────

        private bool ValidarFormulario(out Personal personal)
        {
            personal = null!;

            if (string.IsNullOrWhiteSpace(txtApellidoNombre.Text))
            {
                MessageBox.Show("El campo 'Apellido y Nombre' es obligatorio.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (txtApellidoNombre.Text.Length > 50)
            {
                MessageBox.Show("El campo 'Apellido y Nombre' no puede exceder los 50 caracteres.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (string.IsNullOrWhiteSpace(txtAñoIngreso.Text) || !int.TryParse(txtAñoIngreso.Text, out int añoIngreso))
            {
                MessageBox.Show("El campo 'Año de Ingreso' debe ser un número válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (añoIngreso < 1950 || añoIngreso > DateTime.Now.Year)
            {
                MessageBox.Show($"El 'Año de Ingreso' debe estar entre 1950 y {DateTime.Now.Year}.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (string.IsNullOrWhiteSpace(txtSueldoNominal.Text) ||
                !decimal.TryParse(txtSueldoNominal.Text, NumberStyles.Any, CultureInfo.CurrentCulture, out decimal sueldoNominal))
            {
                MessageBox.Show("El campo 'Sueldo Nominal' debe ser un valor decimal válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (sueldoNominal <= 0)
            {
                MessageBox.Show("El campo 'Sueldo Nominal' debe ser un valor mayor a cero.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            string codigoPostalTrimmed = txtCodigoPostal.Text.Trim();
            if (string.IsNullOrWhiteSpace(codigoPostalTrimmed) || !int.TryParse(codigoPostalTrimmed, out _))
            {
                MessageBox.Show("El campo 'Código Postal' debe ser un número válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (codigoPostalTrimmed.Length < 4 || codigoPostalTrimmed.Length > 5)
            {
                MessageBox.Show("El campo 'Código Postal' debe tener entre 4 y 5 dígitos.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (cmbPuesto.SelectedItem is not ComboBoxItem selectedPuesto)
            {
                MessageBox.Show("Seleccione un 'Puesto' válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            if (cmbCategoria.SelectedItem is not ComboBoxItem selectedCategoria)
            {
                MessageBox.Show("Seleccione una 'Categoría' válida.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }

            personal = new Personal(
                txtApellidoNombre.Text.Trim(),
                txtDomicilio.Text.Trim(),
                txtLocalidad.Text.Trim(),
                txtProvincia.Text.Trim(),
                codigoPostalTrimmed,
                (Puesto)Convert.ToInt32(selectedPuesto.Tag),
                (Categoria)Convert.ToInt32(selectedCategoria.Tag),
                añoIngreso,
                txtSectorAsignado.Text.Trim(),
                txtActividad.Text.Trim(),
                sueldoNominal
            );
            return true;
        }

        // ── Limpiar ───────────────────────────────────────────────────────────

        private void LimpiarCampos()
        {
            txtApellidoNombre.Text = string.Empty;
            txtDomicilio.Text = string.Empty;
            txtLocalidad.Text = string.Empty;
            txtProvincia.Text = string.Empty;
            txtCodigoPostal.Text = string.Empty;
            cmbPuesto.SelectedIndex = -1;
            cmbCategoria.SelectedIndex = -1;
            txtAñoIngreso.Text = string.Empty;
            txtSectorAsignado.Text = string.Empty;
            txtActividad.Text = string.Empty;
            txtSueldoNominal.Text = string.Empty;
        }
    }
}

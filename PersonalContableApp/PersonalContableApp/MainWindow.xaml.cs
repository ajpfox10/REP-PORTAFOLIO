// Archivo: MainWindow.xaml.cs
using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using PersonalContableApp.Models; // Espacio de nombres para las clases de modelo
using PersonalContableApp.Data;   // Espacio de nombres para RepositorioPersonal

namespace PersonalContableApp
{
    /// <summary>
    /// Lógica de interacción para MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        // Instancia del repositorio para gestionar el personal.
        private RepositorioPersonal repositorio = new RepositorioPersonal();

        /// <summary>
        /// Constructor de la ventana principal.
        /// </summary>
        public MainWindow()
        {
            InitializeComponent();
            // Vincular el DataGrid con la lista de personal obtenida del repositorio.
            dataGridPersonal.ItemsSource = repositorio.ObtenerTodo();
        }

        /// <summary>
        /// Evento que se dispara al hacer clic en el botón "Agregar".
        /// Se encarga de validar los datos y agregar un nuevo personal al repositorio.
        /// </summary>
        private void Agregar_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                // Validar campos obligatorios.
                if (string.IsNullOrWhiteSpace(txtApellidoNombre.Text))
                {
                    MessageBox.Show("El campo 'Apellido y Nombre' es obligatorio.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                if (txtApellidoNombre.Text.Length > 50)
                {
                    MessageBox.Show("El campo 'Apellido y Nombre' no puede exceder los 50 caracteres.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                if (string.IsNullOrWhiteSpace(txtAñoIngreso.Text) || !int.TryParse(txtAñoIngreso.Text, out int añoIngreso))
                {
                    MessageBox.Show("El campo 'Año de Ingreso' debe ser un número válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                if (añoIngreso < 1950 || añoIngreso > DateTime.Now.Year)
                {
                    MessageBox.Show($"El 'Año de Ingreso' debe estar entre 1950 y {DateTime.Now.Year}.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                if (string.IsNullOrWhiteSpace(txtSueldoNominal.Text) || !decimal.TryParse(txtSueldoNominal.Text, out decimal sueldoNominal))
                {
                    MessageBox.Show("El campo 'Sueldo Nominal' debe ser un valor decimal válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                // Validar Código Postal (debe ser numérico y de 4 a 5 dígitos)
                if (string.IsNullOrWhiteSpace(txtCodigoPostal.Text) || !int.TryParse(txtCodigoPostal.Text, out int codigoPostalNumerico))
                {
                    MessageBox.Show("El campo 'Código Postal' debe ser un número válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                if (txtCodigoPostal.Text.Length < 4 || txtCodigoPostal.Text.Length > 5)
                {
                    MessageBox.Show("El campo 'Código Postal' debe tener entre 4 y 5 dígitos.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }

                // Obtener los valores de los campos de texto.
                string apellidoNombre = txtApellidoNombre.Text.Trim();
                string domicilio = txtDomicilio.Text.Trim();
                string localidad = txtLocalidad.Text.Trim();
                string provincia = txtProvincia.Text.Trim();
                string codigoPostal = txtCodigoPostal.Text.Trim();
                string sectorAsignado = txtSectorAsignado.Text.Trim();
                string actividad = txtActividad.Text.Trim();

                // Obtener el puesto seleccionado.
                if (!(cmbPuesto.SelectedItem is ComboBoxItem selectedPuesto))
                {
                    MessageBox.Show("Seleccione un 'Puesto' válido.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                Puesto puesto = (Puesto)Convert.ToInt32(selectedPuesto.Tag);

                // Obtener la categoría seleccionada.
                if (!(cmbCategoria.SelectedItem is ComboBoxItem selectedCategoria))
                {
                    MessageBox.Show("Seleccione una 'Categoría' válida.", "Validación", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                Categoria categoria = (Categoria)Convert.ToInt32(selectedCategoria.Tag);

                // Crear un nuevo objeto Personal con los datos ingresados.
                Personal nuevoPersonal = new Personal(
                    apellidoNombre,
                    domicilio,
                    localidad,
                    provincia,
                    codigoPostal,
                    puesto,
                    categoria,
                    añoIngreso,
                    sectorAsignado,
                    actividad,
                    sueldoNominal
                );

                // Agregar el nuevo personal al repositorio.
                repositorio.AgregarPersonal(nuevoPersonal);

                // Actualizar el DataGrid para reflejar los cambios.
                dataGridPersonal.Items.Refresh();

                // Limpiar los campos del formulario.
                LimpiarCampos();

                // Informar al usuario que el personal fue agregado exitosamente.
                MessageBox.Show("Personal agregado exitosamente.", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                // Manejo de excepciones generales.
                MessageBox.Show($"Ocurrió un error: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        /// <summary>
        /// Evento que se dispara al hacer clic en el botón "Eliminar Seleccionado".
        /// Se encarga de eliminar el personal seleccionado del DataGrid y del repositorio.
        /// </summary>
        private void Eliminar_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                // Obtener el personal seleccionado en el DataGrid.
                if (dataGridPersonal.SelectedItem is Personal seleccionado)
                {
                    // Confirmar la eliminación.
                    var resultado = MessageBox.Show($"¿Está seguro de eliminar a {seleccionado.ApellidoNombre}?",
                                                    "Confirmar Eliminación",
                                                    MessageBoxButton.YesNo,
                                                    MessageBoxImage.Question);

                    if (resultado == MessageBoxResult.Yes)
                    {
                        // Eliminar del repositorio.
                        bool eliminado = repositorio.EliminarPersonal(seleccionado);

                        if (eliminado)
                        {
                            // Actualizar el DataGrid.
                            dataGridPersonal.Items.Refresh();
                            MessageBox.Show("Personal eliminado exitosamente.", "Éxito", MessageBoxButton.OK, MessageBoxImage.Information);
                        }
                        else
                        {
                            MessageBox.Show("No se pudo eliminar el personal.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                        }
                    }
                }
                else
                {
                    MessageBox.Show("Seleccione un personal para eliminar.", "Información", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                // Manejo de excepciones generales.
                MessageBox.Show($"Ocurrió un error: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        /// <summary>
        /// Método para limpiar los campos del formulario después de agregar un personal.
        /// </summary>
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

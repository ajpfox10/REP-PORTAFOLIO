using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Windows.Forms;

namespace tablerodecomando
{
    public partial class FORMUALRIOEXPEDIENTES : Form
    {
        private readonly CONEXION.ConexionMySQL conexionMySQL;
        private DataTable originalDataTable; // Variable para almacenar los datos originales
        public FORMUALRIOEXPEDIENTES()
        {
            InitializeComponent();
            conexionMySQL = new CONEXION.ConexionMySQL();
        }
        private void FORMULARIOEXPEDIENTES_Load(object sender, EventArgs e)
        {
            CargarDatosEnListView();
            CargarDatosEnListView1();
        }
        private void CargarDatosEnListView()
        {
            try
            {
                // Llama al método para ejecutar la consulta y obtener los datos
                originalDataTable = conexionMySQL.EjecutarConsultaComoProcedimiento().Copy();

                // Resto del código...
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error al cargar los datos: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        private void CargarValoresColumnaSeleccionada()
        {
            if (cmbColumnas.SelectedItem != null)
            {
                string columnaSeleccionada = cmbColumnas.SelectedItem.ToString();
                var valoresUnicos = ObtenerValoresUnicosDeColumna(columnaSeleccionada);

                // Llena el ComboBox de valores con los valores únicos de la columna seleccionada
                cmbValores.Items.Clear();
                cmbValores.Items.AddRange(valoresUnicos.ToArray());
            }
        }
        private void cmbColumnas_SelectedIndexChanged(object sender, EventArgs e)
        {
            CargarValoresColumnaSeleccionada();
        }
        private IEnumerable<string> ObtenerValoresUnicosDeColumna(string nombreColumna)
        {
            var valoresUnicos = originalDataTable.AsEnumerable()
                .Select(row => row.Field<object>(nombreColumna)?.ToString())
                .Distinct()
                .Where(value => !string.IsNullOrEmpty(value))
                .ToArray();

            return valoresUnicos;
        }
        private void FiltrarListViewPorValorSeleccionado()
        {
            if (originalDataTable != null && cmbColumnas.SelectedItem != null && cmbValores.SelectedItem != null)
            {
                string columnaSeleccionada = cmbColumnas.SelectedItem.ToString();
                string valorSeleccionado = cmbValores.SelectedItem.ToString();

                // Filtra las filas del DataTable según el valor seleccionado en la columna seleccionada
                var filasFiltradas = originalDataTable.AsEnumerable()
                    .Where(row => row.Field<object>(columnaSeleccionada)?.ToString() == valorSeleccionado)
                    .CopyToDataTable();

                // Limpia y actualiza el ListView con las filas filtradas
                expedientes.Items.Clear();
                foreach (DataRow row in filasFiltradas.Rows)
                {
                    var listViewItem = new ListViewItem(row.ItemArray.Select(item => item.ToString()).ToArray());
                    expedientes.Items.Add(listViewItem);
                }
            }
        }
        private void cmbValores_SelectedIndexChanged(object sender, EventArgs e)
        {
            FiltrarListViewPorValorSeleccionado();
        }
        private void CargarDatosEnListView1()
        {
            try
            {
                // Llama al método para ejecutar la consulta y obtener los datos
                var dataTable = conexionMySQL.EjecutarConsultaComoProcedimiento();

                // Limpia cualquier dato existente en el ListView
                expedientes.Items.Clear();
                expedientes.Columns.Clear();

                // Agrega columnas al ListView
                foreach (DataColumn column in dataTable.Columns)
                {
                    expedientes.Columns.Add(column.ColumnName);
                    cmbColumnas.Items.Add(column.ColumnName); // Add this line to populate the ComboBox
                }

                // Agrega filas al ListView
                foreach (DataRow row in dataTable.Rows)
                {
                    var listViewItem = new ListViewItem(row.ItemArray.Select(item => item.ToString()).ToArray());
                    expedientes.Items.Add(listViewItem);
                }

                // Ajusta el ancho de las columnas para que se ajusten al contenido
                foreach (ColumnHeader column in expedientes.Columns)
                {
                    column.Width = -2;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error al cargar los datos: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using static tablerodecomando.CONEXION;

namespace tablerodecomando
{
    public partial class agentesporservicio : Form
    {
        private readonly CONEXION.ConexionMySQL conexionMySQL;
        private DataTable originalDataTable; // Variable para almacenar los datos originales
        public agentesporservicio()
        {
            InitializeComponent();

            // Crear una instancia de la clase de conexión
            conexionMySQL = new CONEXION.ConexionMySQL();

            // Realizar un ping al servidor
            // conexionMySQL.RealizarPingAlServidor();

            // Cargar datos en el ComboBox al cargar el formulario
            CargarDatosEnListView();
        }

        private void CargarDatosEnListView()
        {
            try
            {
                // Llama al método para ejecutar la consulta y obtener los datos
                originalDataTable = conexionMySQL.EjecutarConsultaComoProcedimiento1().Copy();

                // Assuming you have a ComboBox named "servicios" in your form
                // Clear existing items in the ComboBox
                comboBoxServicios.Items.Clear();

                // Use a HashSet to store unique servicio names
                HashSet<string> uniqueServicios = new HashSet<string>();

                // Loop through the rows in the DataTable and add unique servicio names to the HashSet
                foreach (DataRow row in originalDataTable.Rows)
                {
                    // Assuming the column containing the servicio names is named "NombreServicio"
                    string servicioName = row["Sector"].ToString();

                    // Add to HashSet if not already present
                    if (!uniqueServicios.Contains(servicioName))
                    {
                        uniqueServicios.Add(servicioName);

                        // Add the unique servicio name to the ComboBox
                        comboBoxServicios.Items.Add(servicioName);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error al cargar los datos: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

    }
}


using MySqlConnector;
using System;
using System.Data;
using System.Net.NetworkInformation;
using System.Windows.Forms;

namespace tablerodecomando
{
    internal class CONEXION
    {
        public class ConexionMySQL : ConexionMySQLBase, IDisposable
        {
            private readonly string connectionString;
            public MySqlConnection conexion;
            public ConexionMySQL()
            {
                connectionString = "Server=127.0.0.1;port=3306;username=superusuario;password=tronador101110;database=personalv3;";
                conexion = new MySqlConnection(connectionString);
            }
            public void RealizarPingAlServidor()
            {
                string ipServidor = "127.0.0.1";  // Reemplaza con la dirección IP de tu servidor
                Ping ping = new Ping();
                PingReply reply = ping.Send(ipServidor);
                if (reply.Status == IPStatus.Success)
                {
                 MessageBox.Show("¡Hola! Bienvenido al sistema de Tablero de Comando. ¡Vamos a ir agregando funciones poco a poco!");
                }
                else
                {
                  MessageBox.Show("Esta PC no tiene acceso al servidor de RRHH. Solicite a sistemas que coloque la dirección del Ministerio.");
                }
            }
            public DataTable EjecutarConsultaComoProcedimiento()
             {
                DataTable dataTable = new();

                try
                {
                    Conectar();

                    using MySqlCommand command = new("ObtenerDatos", conexion); // Nombre del procedimiento almacenado
                    command.CommandType = CommandType.StoredProcedure;

                    using MySqlDataAdapter adapter = new(command);
                    adapter.Fill(dataTable);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Error al ejecutar la consulta: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally
                {
                    if (conexion.State == ConnectionState.Open)
                    {
                        conexion.Close();
                    }
                }

                return dataTable;
            }
            public DataTable EjecutarConsultaComoProcedimiento1()
            {
                DataTable dataTable = new();
                try
                {
                    Conectar();
                    {
                        using MySqlCommand command = new("Agentesporsectoryley", conexion); // Nombre del procedimiento almacenado
                        command.CommandType = CommandType.StoredProcedure;
                        using MySqlDataAdapter adapter = new(command);
                        adapter.Fill(dataTable);             
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Error al ejecutar la consulta: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally
                {
                    if (conexion.State == ConnectionState.Open)
                    {
                        conexion.Close();
                    }
                }

                return dataTable;
            }

            public void Conectar()
            {
                if (conexion.State == ConnectionState.Closed)
                {
                    conexion.Open();
                }
            }
            public MySqlConnection GetConnection()
            {
                return conexion;
            }
        }
    }
}
using MySqlConnector;

namespace tablerodecomando
{
    public class ConexionMySQLBase
    {
        protected MySqlConnection conexion;

        public void Dispose()
        {
            if (conexion != null)
            {
                conexion.Close();
                conexion.Dispose();
            }
        }
    }
}
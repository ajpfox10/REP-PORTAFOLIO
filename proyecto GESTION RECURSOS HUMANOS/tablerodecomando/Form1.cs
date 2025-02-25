using static tablerodecomando.CONEXION;

namespace tablerodecomando
{
    public partial class Formprincipal : Form
    {
        public Formprincipal()
        {
            InitializeComponent();
        }

        private void button1_Click(object sender, EventArgs e)
        {
            // Instancia el formulario secundario
            FORMUALRIOEXPEDIENTES formSecundario = new FORMUALRIOEXPEDIENTES();

            // Muestra el formulario secundario
            formSecundario.Show();
        }

        private void Formprincipal_Load(object sender, EventArgs e)
        {
            ConexionMySQL conexionMySQL = new ConexionMySQL();
            //   conexionMySQL.RealizarPingAlServidor();
        }

        private void button2_Click(object sender, EventArgs e)
        {
            // Instancia el formulario secundario
            agentesporservicio agentesporservicio2 = new agentesporservicio();

            // Muestra el formulario secundario
            agentesporservicio2.Show();
        }
    }
}
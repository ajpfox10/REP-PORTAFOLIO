using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace ProcessMonitor
{
    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Lista de procesos a monitorear
            string[] monitoredProcesses = { "WINWORD", "explorer" }; // Puedes añadir más nombres de procesos aquí

            // Variable para controlar si ya se mostró el mensaje
            bool messageShown = false;

            while (true)
            {
                // Obtener todos los procesos en ejecución
                var runningProcesses = Process.GetProcesses();

                // Comprobar si alguno de los procesos monitoreados está en ejecución
                bool isProcessRunning = runningProcesses
                    .Any(p => monitoredProcesses.Contains(p.ProcessName, StringComparer.OrdinalIgnoreCase));

                if (isProcessRunning && !messageShown)
                {
                    // Mostrar el mensaje personalizado
                    MessageBox.Show("TRANSITO:1-GABY 0", "Alerta", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    messageShown = true; // Evitar mostrar el mensaje repetidamente
                }
                else if (!isProcessRunning)
                {
                    messageShown = false; // Restablecer para la próxima vez
                }

                // Esperar un segundo antes de verificar nuevamente
                Thread.Sleep(1000);
            }
        }
    }
}

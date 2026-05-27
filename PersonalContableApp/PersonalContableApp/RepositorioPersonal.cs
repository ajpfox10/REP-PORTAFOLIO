// Archivo: Data/RepositorioPersonal.cs
using System.Collections.ObjectModel;
using PersonalContableApp.Models;

namespace PersonalContableApp.Data
{
    public class RepositorioPersonal
    {
        private ObservableCollection<Personal> personalList;
        public bool HuboErrorAlCargar { get; private set; }

        public RepositorioPersonal()
        {
            try
            {
                personalList = PersistenciaServicio.Cargar();
            }
            catch
            {
                personalList = new ObservableCollection<Personal>();
                HuboErrorAlCargar = true;
            }
        }

        public ObservableCollection<Personal> ObtenerTodo() => personalList;

        public void AgregarPersonal(Personal personal)
        {
            personalList.Add(personal);
            PersistenciaServicio.Guardar(personalList);
        }

        public bool EliminarPersonal(Personal personal)
        {
            bool eliminado = personalList.Remove(personal);
            if (eliminado) PersistenciaServicio.Guardar(personalList);
            return eliminado;
        }

        public void ActualizarPersonal(Personal original, Personal actualizado)
        {
            int index = personalList.IndexOf(original);
            if (index >= 0)
            {
                personalList[index] = actualizado;
                PersistenciaServicio.Guardar(personalList);
            }
        }
    }
}

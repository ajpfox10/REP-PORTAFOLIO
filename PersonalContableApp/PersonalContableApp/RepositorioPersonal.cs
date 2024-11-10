// Archivo: Data/RepositorioPersonal.cs
using System;
using System.Collections.Generic;
using PersonalContableApp.Models;

namespace PersonalContableApp.Data
{
    /// <summary>
    /// Clase que actúa como repositorio para gestionar la colección de personal.
    /// </summary>
    public class RepositorioPersonal
    {
        // Lista privada para almacenar los objetos Personal.
        private List<Personal> personalList = new List<Personal>();

        /// <summary>
        /// Constructor de la clase RepositorioPersonal.
        /// </summary>
        public RepositorioPersonal()
        {
            // Inicialización de la lista de personal.
        }

        /// <summary>
        /// Método para agregar un nuevo personal al repositorio.
        /// </summary>
        /// <param name="personal">Objeto Personal a agregar.</param>
        public void AgregarPersonal(Personal personal)
        {
            personalList.Add(personal);
        }

        /// <summary>
        /// Método para obtener toda la lista de personal.
        /// </summary>
        /// <returns>Lista de Personal.</returns>
        public List<Personal> ObtenerTodo()
        {
            return personalList;
        }

        /// <summary>
        /// Método para eliminar un personal del repositorio.
        /// </summary>
        /// <param name="personal">Objeto Personal a eliminar.</param>
        /// <returns>True si se eliminó, False en caso contrario.</returns>
        public bool EliminarPersonal(Personal personal)
        {
            return personalList.Remove(personal);
        }
    }
}


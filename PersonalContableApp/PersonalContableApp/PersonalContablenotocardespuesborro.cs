using System;

namespace PersonalContableApp.Models
{
    /// <summary>
    /// Clase que representa a un miembro del personal contable.
    /// </summary>
    public class PersonalContable
    {
        // Propiedades públicas con getters y setters.
        public string ApellidoNombre { get; set; }
        public string Domicilio { get; set; }
        public string Localidad { get; set; }
        public string Provincia { get; set; }
        public string CodigoPostal { get; set; }
        public Puesto Puesto { get; set; }
        public Categoria Categoria { get; set; }
        public int AñoIngreso { get; set; }
        public string SectorAsignado { get; set; }
        public string Actividad { get; set; }
        public decimal SueldoNominal { get; set; }

        /// <summary>
        /// Constructor para inicializar un objeto PersonalContable.
        /// </summary>
        public PersonalContable(string apellidoNombre, string domicilio, string localidad, string provincia,
                                string codigoPostal, Puesto puesto, Categoria categoria, int añoIngreso,
                                string sectorAsignado, string actividad, decimal sueldoNominal)
        {
            ApellidoNombre = apellidoNombre;
            Domicilio = domicilio;
            Localidad = localidad;
            Provincia = provincia;
            CodigoPostal = codigoPostal;
            Puesto = puesto;
            Categoria = categoria;
            AñoIngreso = añoIngreso;
            SectorAsignado = sectorAsignado;
            Actividad = actividad;
            SueldoNominal = sueldoNominal;
        }
    }
}

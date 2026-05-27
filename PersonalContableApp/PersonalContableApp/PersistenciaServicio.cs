// Archivo: Data/PersistenciaServicio.cs
using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using PersonalContableApp.Models;

namespace PersonalContableApp.Data
{
    public static class PersistenciaServicio
    {
        private static readonly string RutaArchivo = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "personal.json");

        private static readonly JsonSerializerOptions Opciones = new JsonSerializerOptions
        {
            WriteIndented = true,
            Converters = { new JsonStringEnumConverter() }
        };

        public static void Guardar(ObservableCollection<Personal> lista)
        {
            File.WriteAllText(RutaArchivo, JsonSerializer.Serialize(lista, Opciones));
        }

        public static ObservableCollection<Personal> Cargar()
        {
            if (!File.Exists(RutaArchivo))
                return new ObservableCollection<Personal>();

            string json = File.ReadAllText(RutaArchivo);
            return JsonSerializer.Deserialize<ObservableCollection<Personal>>(json, Opciones)
                   ?? new ObservableCollection<Personal>();
        }
    }
}

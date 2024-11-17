using System;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.Extensions.Logging;

namespace scan3.Infrastructure.Logging
{
    internal static class GlobalLogger
    {
        private static ILoggerFactory _loggerFactory;

        // Método para configurar el LoggerFactory global
        public static void ConfigureLoggerFactory()
        {
            if (_loggerFactory == null)
            {
                // Configurar Serilog para escribir en un archivo de texto en la ruta del proyecto
                Log.Logger = new LoggerConfiguration()
                    .MinimumLevel.Debug() // Registrar todos los niveles
                    .WriteTo.Console() // Para ver los logs también en la consola
                    .WriteTo.File("logs/application_log.txt", rollingInterval: RollingInterval.Day) // Archivo de logs con rotación diaria
                    .CreateLogger();

                // Crear el LoggerFactory usando Serilog
                _loggerFactory = LoggerFactory.Create(builder =>
                {
                    builder.AddSerilog(Log.Logger, dispose: true);
                });
            }
        }

        // Método para obtener un ILogger específico
        public static ILogger<T> GetLogger<T>()
        {
            if (_loggerFactory == null)
            {
                throw new InvalidOperationException("LoggerFactory no está configurado. Llama a ConfigureLoggerFactory antes de intentar obtener un logger.");
            }

            return _loggerFactory.CreateLogger<T>();
        }
    }
}

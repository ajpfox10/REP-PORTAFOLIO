using System.IO;
using System;

namespace ScanX.App.Loggers
{
    public static class Logger
    {
        private static readonly string logFilePath = "log.txt";

        public static void LogError(string message, Exception ex)
        {
            try
            {
                using (StreamWriter writer = new StreamWriter(logFilePath, true))
                {
                    writer.WriteLine($"[{DateTime.Now}] ERROR: {message}");
                    writer.WriteLine($"Exception: {ex.GetType()} - {ex.Message}");
                    writer.WriteLine($"Stack Trace: {ex.StackTrace}");
                    writer.WriteLine("----------------------------------------------------");
                }
            }
            catch (Exception loggingEx)
            {
                Console.WriteLine($"Error while logging: {loggingEx.Message}");
            }
        }

        public static void LogWarning(string message)
        {
            try
            {
                using (StreamWriter writer = new StreamWriter(logFilePath, true))
                {
                    writer.WriteLine($"[{DateTime.Now}] WARNING: {message}");
                    writer.WriteLine("----------------------------------------------------");
                }
            }
            catch (Exception loggingEx)
            {
                Console.WriteLine($"Error while logging: {loggingEx.Message}");
            }
        }

        public static void LogInfo(string message)
        {
            try
            {
                using (StreamWriter writer = new StreamWriter(logFilePath, true))
                {
                    writer.WriteLine($"[{DateTime.Now}] INFO: {message}");
                    writer.WriteLine("----------------------------------------------------");
                }
            }
            catch (Exception loggingEx)
            {
                Console.WriteLine($"Error while logging: {loggingEx.Message}");
            }
        }
    }
}

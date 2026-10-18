namespace PersonalContable.Core.Servicios;

/// <summary>Validación y formato del CUIL (Código Único de Identificación Laboral).</summary>
public static class Cuil
{
    private static readonly int[] Pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    private static readonly HashSet<string> Prefijos = ["20", "23", "24", "25", "26", "27", "30", "33", "34"];

    /// <summary>Deja solo los dígitos: "20-12345678-6" → "20123456786".</summary>
    public static string Normalizar(string? texto) =>
        new((texto ?? string.Empty).Where(char.IsAsciiDigit).ToArray());

    /// <summary>Comprueba prefijo y dígito verificador (módulo 11).</summary>
    public static bool EsValido(string? texto)
    {
        string cuil = Normalizar(texto);
        if (cuil.Length != 11 || !Prefijos.Contains(cuil[..2])) return false;
        return cuil[10] - '0' == DigitoVerificador(cuil[..10]);
    }

    /// <summary>Calcula el dígito verificador de los primeros 10 dígitos; -1 si no tiene uno válido.</summary>
    public static int DigitoVerificador(string diezDigitos)
    {
        int suma = 0;
        for (int i = 0; i < 10; i++) suma += (diezDigitos[i] - '0') * Pesos[i];
        int resto = 11 - suma % 11;
        return resto switch
        {
            11 => 0,
            10 => -1,
            _ => resto,
        };
    }

    /// <summary>"20123456786" → "20-12345678-6". Si no tiene 11 dígitos lo devuelve sin cambios.</summary>
    public static string Formatear(string? texto)
    {
        string cuil = Normalizar(texto);
        return cuil.Length == 11 ? $"{cuil[..2]}-{cuil[2..10]}-{cuil[10]}" : texto ?? string.Empty;
    }
}

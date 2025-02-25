<?php
require_once __DIR__ . '/../CONFIG/conexion.php';

// Habilitar el log de errores
ini_set('log_errors', 1);
ini_set('display_errors', 1); // Mostrar errores para depuraci�n
error_reporting(E_ALL);

// Abrir un archivo de log personalizado
$logFile = __DIR__ . '/registro_debug.log';
file_put_contents($logFile, "=== Comenzando ejecuci�n de registro.php ===\n", FILE_APPEND);

// Registrar la solicitud y sus cabeceras
file_put_contents($logFile, "Request Method: " . $_SERVER['REQUEST_METHOD'] . "\n", FILE_APPEND);

// Registrar todos los datos recibidos a trav�s de POST
file_put_contents($logFile, "POST Data Received: " . print_r($_POST, true) . "\n", FILE_APPEND);

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $nombre = $_POST['nombre'] ?? null;
        $email = $_POST['email'] ?? null;
        $password = $_POST['password'] ?? null;
        $direccion = $_POST['direccion'] ?? null;
        $telefono = $_POST['telefono'] ?? null;

        // Log de los datos recibidos en la solicitud HTTP
        file_put_contents($logFile, "POST Values: Nombre=$nombre, Email=$email, Direccion=$direccion, Telefono=$telefono\n", FILE_APPEND);

        // Validar que no haya campos vac�os
        $camposFaltantes = [];
        if (empty($nombre)) $camposFaltantes[] = 'nombre';
        if (empty($email)) $camposFaltantes[] = 'email';
        if (empty($password)) $camposFaltantes[] = 'password';
        if (empty($direccion)) $camposFaltantes[] = 'direccion';
        if (empty($telefono)) $camposFaltantes[] = 'telefono';

        if (!empty($camposFaltantes)) {
            throw new Exception('Todos los campos son obligatorios: ' . implode(', ', $camposFaltantes));
        }

        // Aqu� deber�as agregar el c�digo para conectar con la base de datos e insertar el nuevo usuario.
        $stmt = $conexion->prepare("INSERT INTO usuarios (nombre, email, password, direccion, telefono) VALUES (?, ?, ?, ?, ?)");
        if (!$stmt) {
            throw new Exception('Preparaci�n de consulta fallida: ' . $conexion->error);
        }

        $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
        $stmt->bind_param("sssss", $nombre, $email, $hashedPassword, $direccion, $telefono);

        // Intentar ejecutar la consulta
        if ($stmt->execute()) {
            echo json_encode(['success' => true, 'message' => 'Registro exitoso.']);
        } else {
            throw new Exception('Error al registrar el usuario: ' . $stmt->error);
        }

    } else {
        throw new Exception('M�todo no soportado.');
    }

} catch (Exception $e) {
    // Capturar excepciones y devolver una respuesta JSON con el mensaje de error
    $errorMessage = 'Error: ' . $e->getMessage();
    file_put_contents($logFile, $errorMessage . "\n", FILE_APPEND);
    echo json_encode(['success' => false, 'message' => $errorMessage]);
}

file_put_contents($logFile, "=== Fin de ejecuci�n de registro.php ===\n", FILE_APPEND);
?>

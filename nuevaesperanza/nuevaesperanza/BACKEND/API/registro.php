<?php
require_once __DIR__ . '/../CONFIG/conexion.php';

ini_set('log_errors', 1);
ini_set('display_errors', 0);
error_reporting(E_ALL);

$logDir = __DIR__ . '/../LOGS';
if (!is_dir($logDir)) mkdir($logDir, 0750, true);
$logFile = $logDir . '/registro_debug.log';
file_put_contents($logFile, "=== Comenzando ejecucion de registro.php ===\n", FILE_APPEND);

header('Content-Type: application/json');

try {
    // Soporte para HTTP POST y CLI (invocado desde Node.js via stdin)
    if (php_sapi_name() === 'cli') {
        $input = json_decode(file_get_contents('php://stdin'), true) ?? [];
        $nombre   = $input['nombre']   ?? null;
        $email    = $input['email']    ?? null;
        $password = $input['password'] ?? null;
        $direccion = $input['direccion'] ?? null;
        $telefono = $input['telefono'] ?? null;
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $nombre   = $_POST['nombre']   ?? null;
        $email    = $_POST['email']    ?? null;
        $password = $_POST['password'] ?? null;
        $direccion = $_POST['direccion'] ?? null;
        $telefono = $_POST['telefono'] ?? null;
    } else {
        throw new Exception('Metodo no soportado.');
    }

    file_put_contents($logFile, "Values: Nombre=$nombre, Email=$email, Direccion=$direccion, Telefono=$telefono\n", FILE_APPEND);

    $camposFaltantes = [];
    if (empty($nombre))    $camposFaltantes[] = 'nombre';
    if (empty($email))     $camposFaltantes[] = 'email';
    if (empty($password))  $camposFaltantes[] = 'password';
    if (empty($direccion)) $camposFaltantes[] = 'direccion';
    if (empty($telefono))  $camposFaltantes[] = 'telefono';

    if (!empty($camposFaltantes)) {
        throw new Exception('Todos los campos son obligatorios: ' . implode(', ', $camposFaltantes));
    }

    $conexion = conectarBaseDatos();

    $stmt = $conexion->prepare(
        "INSERT INTO usuarios (nombre, email, password, direccion, telefono) VALUES (?, ?, ?, ?, ?)"
    );
    if (!$stmt) {
        throw new Exception('Preparacion de consulta fallida.');
    }

    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
    $stmt->execute([$nombre, $email, $hashedPassword, $direccion, $telefono]);

    echo json_encode(['success' => true, 'message' => 'Registro exitoso.']);

} catch (Exception $e) {
    $errorMessage = 'Error: ' . $e->getMessage();
    file_put_contents($logFile, $errorMessage . "\n", FILE_APPEND);
    echo json_encode(['success' => false, 'message' => $errorMessage]);
}

file_put_contents($logFile, "=== Fin de ejecucion de registro.php ===\n", FILE_APPEND);
?>

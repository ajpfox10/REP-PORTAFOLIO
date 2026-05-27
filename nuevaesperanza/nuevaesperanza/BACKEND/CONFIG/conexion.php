<?php
function conectarBaseDatos() {
    $host    = getenv('DB_HOST')    ?: 'localhost';
    $db      = getenv('DB_NAME')    ?: 'nuevaesperanza';
    $user    = getenv('DB_USER')    ?: 'root';
    $pass    = getenv('DB_PASS')    ?: '';
    $charset = 'utf8mb4';

    $dsn = "mysql:host=$host;dbname=$db;charset=$charset";
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    return new PDO($dsn, $user, $pass, $options);
}
?>

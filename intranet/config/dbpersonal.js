// config/db.js

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: '192.168.0.21',
    port: 3306,
    user: 'xxxxxxxxxx',
    password: 'xxxxxxxxxx',
    database: 'xxxxxxxxxx',
    waitForConnections: true,
    connectionLimit: 10, // Puedes ajustar este valor según tus necesidades
    queueLimit: 0
});

module.exports = pool;
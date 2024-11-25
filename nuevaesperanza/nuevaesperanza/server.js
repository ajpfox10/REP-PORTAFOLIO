'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var port = process.env.PORT || 1337;

http.createServer(function (req, res) {
    console.log('Solicitud para:', req.url);

    // Define la ruta base de los recursos del frontend
    let baseDir = path.join(__dirname, 'FRONTEND', 'RECURSOS');
    let filePath;

    // Para cualquier ruta, construir la ruta a partir de la base y la solicitud
    if (req.url === '/') {
        filePath = path.join(baseDir, 'index.html');
    } else {
        filePath = path.join(baseDir, req.url);
    }

    // Normaliza la ruta del archivo
    filePath = path.normalize(filePath);

    console.log('Ruta resuelta del archivo:', filePath);

    // Determina la extensión y el tipo de contenido del archivo
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    // Lee el archivo solicitado y envíalo como respuesta
    fs.readFile(filePath, function (err, content) {
        if (err) {
            if (err.code == 'ENOENT') {
                // Archivo no encontrado, responder con un error 404
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404: File Not Found\n');
                console.error('Archivo no encontrado:', filePath);
            } else {
                // Error diferente, responder con un error 500
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500: Internal Server Error\n');
                console.error('Error interno del servidor:', err);
            }
        } else {
            // Si el archivo se encuentra, responder con el contenido y el tipo adecuado
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}).listen(port);

console.log(`Server running at http://localhost:${port}/`);

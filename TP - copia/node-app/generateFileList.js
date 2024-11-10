const fs = require('fs');
const path = require('path');

// Ruta del directorio principal del proyecto
const projectDir = path.join(__dirname);

// Función para recorrer todos los archivos del proyecto
function getFiles(dir, ext, filelist = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) {
            filelist = getFiles(filepath, ext, filelist);
        } else if (path.extname(file) === ext) {
            filelist.push(filepath);
        }
    });
    return filelist;
}

// Obtener todos los archivos .js del proyecto
const jsFiles = getFiles(projectDir, '.js');

// Crear archivo de salida
const outputFilePath = path.join(__dirname, 'lista_archivos_con_texto.txt');
const outputStream = fs.createWriteStream(outputFilePath, { flags: 'w' });

// Escribir el nombre del archivo y su contenido
jsFiles.forEach(file => {
    outputStream.write(`Archivo: ${file}\n`);
    outputStream.write('------------------------------------------\n');
    const content = fs.readFileSync(file, 'utf8');
    outputStream.write(content);
    outputStream.write('\n\n');
});

// Cerrar el archivo de salida
outputStream.end(() => {
    console.log(`Archivo generado: ${outputFilePath}`);
});

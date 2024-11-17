const fs = require('fs');
const path = require('path');

// Directorio raíz del proyecto (puedes cambiarlo al que desees)
const rootDir = path.resolve(__dirname);

// Archivo de salida
const outputFile = path.join(__dirname, 'output.txt');

// Función para recorrer directorios y encontrar archivos .cs
function findCSFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir); // Lee el contenido del directorio

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Si es una carpeta, recursivamente llamamos a la función
            findCSFiles(fullPath, fileList);
        } else if (file.endsWith('.cs')) {
            // Si es un archivo .cs, guardamos su ruta
            fileList.push({
                name: file,
                folder: path.dirname(fullPath),
                path: fullPath
            });
        }
    });

    return fileList;
}

// Función para generar el archivo de salida con el contenido de los archivos .cs
function generateOutputFile(csFiles) {
    let content = '';

    csFiles.forEach(file => {
        // Leer el contenido del archivo .cs
        let fileContent;
        try {
            fileContent = fs.readFileSync(file.path, 'utf8');
        } catch (err) {
            console.error(`Error leyendo el archivo ${file.path}:`, err);
            fileContent = 'Error al leer el contenido del archivo.';
        }

        // Agregar la información y el contenido al string de salida
        content += `----------------------------------------\n`;
        content += `Archivo: ${file.name}\n`;
        content += `Carpeta: ${file.folder}\n`;
        content += `Ruta: ${file.path}\n`;
        content += `Contenido:\n${fileContent}\n`;
        content += `----------------------------------------\n\n`;
    });

    // Escribir todo el contenido en el archivo de salida
    fs.writeFileSync(outputFile, content, 'utf8');
    console.log(`Archivo generado: ${outputFile}`);
}

// Ejecutar el script
(function main() {
    console.log('Buscando archivos .cs...');
    const csFiles = findCSFiles(rootDir);

    if (csFiles.length > 0) {
        console.log(`${csFiles.length} archivo(s) encontrado(s).`);
        generateOutputFile(csFiles);
    } else {
        console.log('No se encontraron archivos .cs.');
    }
})();

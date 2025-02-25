const { spawn } = require('child_process');
const path = require('path');

// Funci�n para ejecutar scripts PHP
const executePHP = (scriptName, args = []) => {
    return new Promise((resolve, reject) => {
        console.log('[LOG Servicio] Ejecutando script PHP:', scriptName, 'con argumentos:', args);

        // Construir la ruta completa al script PHP
        const scriptPath = path.join(__dirname, '../BACKEND/API', scriptName);

        // Iniciar el proceso PHP
        const php = spawn('php', [scriptPath, ...args]);

        let output = '';
        let errorOutput = '';

        // Capturar salida est�ndar
        php.stdout.on('data', (data) => {
            console.log('[LOG Servicio] Salida est�ndar PHP:', data.toString());
            output += data.toString();
        });

        // Capturar salida de error
        php.stderr.on('data', (data) => {
            console.error('[LOG Servicio] Error PHP:', data.toString());
            errorOutput += data.toString();
        });

        // Manejar el cierre del proceso
        php.on('close', (code) => {
            if (code === 0) {
                console.log('[LOG Servicio] Script PHP finalizado correctamente');
                resolve(output.trim()); // Devolver salida sin espacios extras
            } else {
                console.error(`[LOG Servicio] Script PHP finalizado con errores. C�digo: ${code}`);
                reject(new Error(`PHP cerr� con c�digo ${code}: ${errorOutput.trim()}`));
            }
        });

        // Manejar errores en la ejecuci�n
        php.on('error', (err) => {
            console.error('[LOG Servicio] Error al ejecutar PHP:', err.message);
            reject(err);
        });
    });
};

module.exports = { executePHP };


const { spawn } = require('child_process');
const path = require('path');

// Ejecuta un script PHP pasando datos como JSON por stdin
const executePHP = (scriptName, data = {}) => {
    return new Promise((resolve, reject) => {
        console.log('[LOG Servicio] Ejecutando script PHP:', scriptName);

        const scriptPath = path.join(__dirname, '../API', scriptName);
        const php = spawn('php', [scriptPath]);

        let output = '';
        let errorOutput = '';

        php.stdin.write(JSON.stringify(data));
        php.stdin.end();

        php.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });

        php.stderr.on('data', (chunk) => {
            console.error('[LOG Servicio] Error PHP:', chunk.toString());
            errorOutput += chunk.toString();
        });

        php.on('close', (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                reject(new Error(`PHP cerro con codigo ${code}: ${errorOutput.trim()}`));
            }
        });

        php.on('error', (err) => {
            console.error('[LOG Servicio] Error al ejecutar PHP:', err.message);
            reject(err);
        });
    });
};

module.exports = { executePHP };

 const dbPersonal = require('../config/dbPersonal'); // Asegúrate de que la ruta sea correcta
const db = require('../config/db'); // Conexión a la base de datos intranet

//-----------------------------------------------------------------------------------------------------------------
const pool = require('../config/db');
exports.register = async (req, res) => {
    const { username, password, rol, servicio, nivel } = req.body;
    if (!username || !password || !rol) {
        return res.status(400).json({ message: 'Username, password, and role are required' });
    }
    try {
        const [existingUser] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Username already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO usuarios (username, password, rol, servicio, nivel, activo) VALUES (?, ?, ?, ?, ?, 1)',
            [username, hashedPassword, rol, servicio, nivel]
        );
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//---------------------------------------------------------------------------------------------------------------------
exports.deactivate = async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    try {
        const result = await pool.query('UPDATE usuarios SET activo = 0 WHERE username = ?', [username]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User deactivated successfully' });
    } catch (error) {
        console.error('Error during deactivation:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//----------------------------------------------------------------------------------------------------------------------
exports.activate = async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    try {
        const result = await pool.query('UPDATE usuarios SET activo = 1 WHERE username = ?', [username]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User activated successfully' });
    } catch (error) {
        console.error('Error during activation:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//----------------------------------------------------------------------------------------------------------------------
exports.changeRole = async (req, res) => {
    const { username, newRole } = req.body;
    if (!username || !newRole) {
        return res.status(400).json({ message: 'Username and new role are required' });
    }
    try {
        const result = await pool.query('UPDATE usuarios SET rol = ? WHERE username = ?', [newRole, username]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User role updated successfully' });
    } catch (error) {
        console.error('Error during role change:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//-----------------------------------------------------------------------------------------------------------------------
exports.changeLevel = async (req, res) => {
    const { username, newLevel } = req.body;
    if (!username || !newLevel) {
        return res.status(400).json({ message: 'Username and new level are required' });
    }
    try {
        const result = await pool.query('UPDATE usuarios SET nivel = ? WHERE username = ?', [newLevel, username]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User level updated successfully' });
    } catch (error) {
        console.error('Error during level change:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//----------------------------------------------------------------------------------------------------------------------
exports.changeService = async (req, res) => {
    const { username, newService } = req.body;
    if (!username || !newService) {
        return res.status(400).json({ message: 'Username and new service are required' });
    }
    try {
        const result = await pool.query('UPDATE usuarios SET servicio = ? WHERE username = ?', [newService, username]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json({ message: 'User service updated successfully' });
    } catch (error) {
        console.error('Error during service change:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
//----------------------------------------------------------------------------------------------------------------------
exports.getUsers = async (req, res) => {
    try {
        const [users] = await pool.query('SELECT username, rol, servicio, nivel, activo FROM usuarios');
        res.status(200).json(users);
    } catch (error) {
        console.error('Error retrieving users:', error);
        res.status(500).json({ message: 'Error retrieving users' });
    }
};
//-----------------------------------------------------------------------------------------------------------------------
// userController.js
exports.getServices = async (req, res) => {
    const userService = req.user.servicio; // Obtener el servicio del usuario desde el token JWT

    try {
        // Consulta que filtra los servicios basados en la columna `filtropor` y el servicio del usuario
        const [rows] = await pool.query('SELECT id, servicio, tipodecuidados FROM servicios WHERE filtropor = ?', [userService]);
        
        res.json(rows); // Devuelve el array de servicios filtrados en formato JSON
    } catch (error) {
        console.error('Error al obtener los servicios:', error);
        res.status(500).json({ message: 'Error al obtener los servicios' });
    }
};

//-----------------------------------------------------------------------------------------------------------------------
exports.getAgentes = async (req, res) => {
    try {
        const userService = req.user.servicio; // Obtener el servicio del usuario desde el token JWT
        // Filtrar agentes por sector y devolver también la columna LEY
        const [agentes] = await dbPersonal.query(
            'SELECT DNI, `APELLDO Y NOMBRE`, LEY FROM PERSONAL WHERE ACTIVO = -1 AND sector = ? ORDER BY `APELLDO Y NOMBRE` ASC', 
            [userService]
        );
        res.status(200).json(agentes);
    } catch (error) {
        console.error('Error retrieving agents:', error);
        res.status(500).json({ message: 'Error retrieving agents' });
    }
};

//-----------------------------------------------------------------------------------------------------------------------
exports.getTiposDeNovedad = async (req, res) => {
    try {
        const [tiposNovedad] = await pool.query('SELECT id, nombre FROM novedades');
        res.status(200).json(tiposNovedad);
    } catch (error) {
        console.error('Error retrieving types of novelties:', error);
        res.status(500).json({ message: 'Error retrieving types of novelties' });
    }
};
//----------------------------------------------------------------------------------------------------------------------
exports.cargarNovedad = async (req, res) => {
    const { agente, apellido, tipoNovedad, fecha, observaciones } = req.body;  // Incluye 'apellido'
    try {
        // Obtener el sector del agente
        const [agenteInfo] = await dbPersonal.query('SELECT sector FROM PERSONAL WHERE DNI = ?', [agente]);
        if (agenteInfo.length === 0) {
            return res.status(404).json({ message: 'Agente no encontrado' });
        }
        const sector = agenteInfo[0].sector;
        // Verificar si ya existe una novedad con las mismas características
        const [existingNovedad] = await pool.query(
            'SELECT * FROM novedadescargadas WHERE agente = ? AND tipoNovedad = ? AND fecha = ? AND observaciones = ? AND eliminado = 0',
            [agente, tipoNovedad, fecha, observaciones]
        );
        if (existingNovedad.length > 0) {
            return res.status(409).json({ message: 'Esta novedad ya ha sido cargada previamente' });
        }
        // Inserta la novedad incluyendo el campo 'sector'
        await pool.query('INSERT INTO novedadescargadas (agente, Apellido, tipoNovedad, fecha, observaciones, sector) VALUES (?, ?, ?, ?, ?, ?)', 
            [agente, apellido, tipoNovedad, fecha, observaciones, sector]);
        res.status(201).json({ message: 'Novedad cargada con éxito' });
    } catch (error) {
        console.error('Error loading novelty:', error.message, error.stack);
        res.status(500).json({ message: 'Error loading novelty', error: error.message });
    }
};
//------------------------------------------------------------------------------------------------------------------------
exports.getAgentesServicios = async (req, res) => {
    try {
        const userService = req.user.servicio;
        const [rows] = await pool.query(
            'SELECT id, agente_id, servicio_id, DATE_FORMAT(fecha_desde, "%Y-%m-%d") as fecha_desde, tipoCuidado, agente_nombre, servicio FROM agentes_servicios WHERE eliminado = 0 AND servicio = ?',
            [userService]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error al obtener datos de agentes_servicios:', error);
        res.status(500).json({ message: 'Error al obtener datos', error: error.message });
    }
};
//------------------------------------------------------------------------------------------------------------------------
exports.cargarNovedadesPorRango = async (req, res) => {
    const { agente, apellido, tipoNovedad, fechaDesde, fechaHasta, observaciones } = req.body;
    try {
        // Obtener el servicio del agente desde la tabla PERSONAL
        const [agenteInfo] = await dbPersonal.query('SELECT sector FROM PERSONAL WHERE DNI = ?', [agente]);
        if (agenteInfo.length === 0) {
            return res.status(404).json({ message: 'Agente no encontrado' });
        }
        const sector = agenteInfo[0].sector;  // Correcto: servicio se asigna a sector
        const startDate = fechaDesde ? new Date(fechaDesde) : new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
        const endDate = new Date(fechaHasta);
        if (startDate > endDate) {
            return res.status(400).json({ message: 'La fecha desde no puede ser mayor que la fecha hasta' });
        }
        let currentDate = new Date(startDate);
        const fechasVerificadas = new Set();
        while (currentDate <= endDate) {
            const formattedDate = currentDate.toISOString().split('T')[0];
            const [existingNovedad] = await pool.query(
                'SELECT fecha FROM novedadescargadas WHERE agente = ? AND tipoNovedad = ? AND fecha = ? AND observaciones = ? AND eliminado = 0',
                [agente, tipoNovedad, formattedDate, observaciones]
            );
            if (existingNovedad.length > 0) {
                fechasVerificadas.add(formattedDate);
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        if (fechasVerificadas.size > 0) {
            return res.status(409).json({ 
                message: `No se pudo agregar. Las siguientes fechas ya existen: ${Array.from(fechasVerificadas).join(', ')}` 
            });
        }
        currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const formattedDate = currentDate.toISOString().split('T')[0];
            if (!fechasVerificadas.has(formattedDate)) {
                console.log('Insertando novedad:', { agente, apellido, tipoNovedad, formattedDate, observaciones, sector }); // Log para verificar
                await pool.query(
                    'INSERT INTO novedadescargadas (agente, Apellido, tipoNovedad, fecha, observaciones, sector) VALUES (?, ?, ?, ?, ?, ?)',
                    [agente, apellido, tipoNovedad, formattedDate, observaciones, sector]  // Insertamos 'sector' con el valor de 'servicio'
                );
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        res.status(201).json({ message: 'Novedades cargadas exitosamente para el rango de fechas' });
    } catch (error) {
        console.error('Error loading novelties by range:', error.message, error.stack);
        res.status(500).json({ message: 'Error loading novelties by range', error: error.message });
    }
};
//-------------------------------------------------------------------------------------------------------------------------------
exports.eliminarNovedad = async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query('UPDATE novedadescargadas SET eliminado = 1 WHERE id = ?', [id]);
        res.status(200).json({ message: 'Novedad eliminada (marcada como eliminada)' });
    } catch (error) {
        console.error('Error deleting novelty:', error);
        res.status(500).json({ message: 'Error deleting novelty' });
    }
};
//---------------------------------------------------------------------------------------------------------------------------------
exports.buscarApellido = async (req, res) => {
    const { apellido } = req.query;
    try {
        const [agentes] = await dbPersonal.query(
            'SELECT DNI, `APELLDO Y NOMBRE` FROM PERSONAL WHERE `APELLDO Y NOMBRE` LIKE ?',
            [`%${apellido}%`]
        );
        res.status(200).json(agentes);
    } catch (error) {
        console.error('Error al buscar el apellido:', error.message);
        res.status(500).json({ message: 'Error al buscar el apellido' });
    }
};
//---------------------------------------------------------------------------------------------------------------------------------
exports.getTiposCuidado = async (req, res) => {
    try {
        const [tiposCuidado] = await pool.query('SELECT id, tipodecuidado FROM tipodecuidado');
        res.status(200).json(tiposCuidado);
    } catch (error) {
        console.error('Error al obtener los tipos de cuidado:', error);
        res.status(500).json({ message: 'Error al obtener los tipos de cuidado' });
    }
};
//-----------------------------------------------------------------------------------------------------------------------------------------------------
exports.insertAgenteServicio = async (req, res) => {
    const { agente, servicio_id, fecha_desde, tipoCuidado, agenteNombre } = req.body;
    const servicio = req.user.servicio;

    if (!agente || !servicio_id || !servicio || !fecha_desde || !tipoCuidado || !agenteNombre) {
        return res.status(400).json({ message: 'Todos los campos son requeridos' });
    }

    try {
        const [existingAgent] = await pool.query(
            'SELECT * FROM agentes_servicios WHERE agente_id = ? AND eliminado = 0',
            [agente]
        );

        if (existingAgent.length > 0) {
            return res.status(409).json({ message: 'El agente ya está registrado en un servicio activo' });
        }

        const query = `
            INSERT INTO agentes_servicios (agente_id, servicio_id, fecha_desde, tipoCuidado, agente_nombre, servicio, eliminado, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
        `;
        await pool.query(query, [agente, servicio_id, fecha_desde, tipoCuidado, agenteNombre, servicio]);

        res.status(201).json({ message: 'Datos insertados exitosamente en agentes_servicios' });
    } catch (error) {
        console.error('Error al insertar datos en agentes_servicios:', error);
        res.status(500).json({ message: 'Error al insertar datos', error: error.message });
    }
};


//-----------------------------------------------------------------------------------------------------------------------------------------------------
exports.getNovedadesCargadas = async (req, res) => {
    try {
        const userService = req.user.servicio; // Obtener el servicio del usuario desde el token JWT
        // Recuperar solo las novedades del servicio del usuario logueado
        const [novedades] = await pool.query(
            'SELECT id, agente, Apellido as apellido, tipoNovedad, DATE_FORMAT(fecha, "%Y-%m-%d") as fecha, observaciones FROM novedadescargadas WHERE eliminado = 0 AND sector = ?',
            [userService]
        );
        res.status(200).json(novedades);
    } catch (error) {
        console.error('Error retrieving loaded novelties:', error);
        res.status(500).json({ message: 'Error retrieving loaded novelties' });
    }
};
//---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
exports.eliminarAgenteServicio = async (req, res) => {
    const { id } = req.body; // Capturar el ID desde el cuerpo de la solicitud
    console.log('ID recibido:', id); // Verificación de ID recibido
    try {
        // Ejecutar la consulta para marcar como eliminado
        const [result] = await pool.query('UPDATE agentes_servicios SET eliminado = 1 WHERE id = ?', [id]);

        // Verificar si alguna fila fue afectada
        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Agente/Servicio marcado como eliminado' });
        } else {
            res.status(404).json({ message: 'Agente/Servicio no encontrado' });
        }
    } catch (error) {
        console.error('Error al marcar como eliminado:', error);
        res.status(500).json({ message: 'Error al eliminar agente/servicio', error: error.message });
    }
};
//---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
exports.cambiarServicio = async (req, res) => {
    const { id, nuevoServicio, nuevoTipoCuidado, modificatore } = req.body;

    // Obtener el servicio del agente logueado desde req.user
    const servicioUsuario = req.user.servicio; // Asumimos que el middleware de autenticación llena req.user.servicio

    // Validación de los datos de entrada
    if (!id || !nuevoServicio || !nuevoTipoCuidado || !modificatore) {
        return res.status(400).json({ message: 'Todos los campos son requeridos' });
    }

    // Validar que servicioUsuario esté presente
    if (!servicioUsuario) {
        return res.status(400).json({ message: 'El servicio del usuario logueado es requerido' });
    }

    try {
        // Iniciar una transacción
        await pool.query('START TRANSACTION');

        // Actualizar el registro existente para marcarlo como eliminado y agregar fecha_hasta
        const [updateResult] = await pool.query(
            'UPDATE agentes_servicios SET eliminado = 1, fecha_hasta = ? WHERE id = ?',
            [modificatore, id]
        );

        if (updateResult.affectedRows > 0) {
            // Preparar la fecha desde para el nuevo registro (un día después de modificatore)
            const nuevaFechaDesde = new Date(modificatore);
            nuevaFechaDesde.setDate(nuevaFechaDesde.getDate() + 1);

            // Insertar un nuevo registro con los nuevos valores y el servicio del usuario logueado
            const [insertResult] = await pool.query(
                'INSERT INTO agentes_servicios (agente_id, agente_nombre, servicio_id, tipoCuidado, fecha_desde, servicio, eliminado) ' +
                'SELECT agente_id, agente_nombre, ?, ?, ?, ?, 0 FROM agentes_servicios WHERE id = ?',
                [nuevoServicio, nuevoTipoCuidado, nuevaFechaDesde.toISOString().split('T')[0], servicioUsuario, id]
            );

            if (insertResult.affectedRows > 0) {
                await pool.query('COMMIT');
                res.status(200).json({ message: 'Servicio y tipo de cuidado cambiados exitosamente' });
            } else {
                await pool.query('ROLLBACK');
                res.status(500).json({ message: 'Error al crear nuevo registro' });
            }
        } else {
            await pool.query('ROLLBACK');
            res.status(404).json({ message: 'Agente/Servicio no encontrado para actualizar' });
        }
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error al cambiar el servicio:', error);
        res.status(500).json({ message: 'Error al cambiar el servicio', error: error.message });
    }
}; 
//----------------------------------------------------------------------------------------------------------------------------------------------------------------------
const PDFDocument = require('pdfkit'); // Librería para crear PDFs
const fs = require('fs'); // Para guardar el archivo

exports.generarReportePDF = async (req, res) => {
    try {
        // Consulta para obtener los datos agrupados por servicio_id y tipoCuidado
        const [rows] = await pool.query(`
            SELECT servicio_id, agente_id, agente_nombre, tipoCuidado, fecha_desde
            FROM agentes_servicios
            WHERE eliminado = 0
            ORDER BY servicio_id, tipoCuidado
        `);
        // Crear un nuevo documento PDF
        const doc = new PDFDocument({ margin: 50 });
        const filePath = './reporte_agentes_servicio.pdf';
        const writeStream = fs.createWriteStream(filePath);

        doc.pipe(writeStream);

        // Configurar el encabezado del PDF
        doc.fontSize(20).font('Helvetica-Bold').text('Reporte de Agentes por Servicio', { align: 'center' });
        doc.moveDown(1); // Agregar espacio después del título

        let currentServicioId = null;
        let agenteCount = 0; // Contador de agentes por servicio
        let tipoCuidadoCount = {}; // Contador de agentes por tipo de cuidado

        // Definir posiciones de inicio para columnas
        const startX = 50;
        const startY = doc.y;
        const rowHeight = 20;

        // Definir anchos de columna
        const columnWidths = {
            servicio: 100,
            nombre: 200,
            tipoCuidado: 100,
            fecha: 100
        };

        // Encabezados de la tabla
        const tableHeaders = ['Servicio ID', 'Nombre del Agente', 'Tipo de Cuidado', 'Fecha Desde'];

        // Dibujar encabezados de la tabla
        doc.fontSize(12).font('Helvetica-Bold').fillColor('blue');
        drawTableHeader(doc, startX, startY, columnWidths, tableHeaders);
        let yPosition = startY + rowHeight;

        // Iterar sobre los resultados y agregar contenido al PDF
        rows.forEach(row => {
            if (row.servicio_id !== currentServicioId) {
                if (currentServicioId !== null) {
                    // Mostrar contador de agentes para el servicio anterior
                    yPosition += 10;
                    doc.fontSize(12).font('Helvetica-Bold').fillColor('black').text(`Total de Agentes para ${currentServicioId}: ${agenteCount}`, startX, yPosition);
                    yPosition += rowHeight;

                    // Mostrar contador de agentes por tipo de cuidado
                    for (const tipo in tipoCuidadoCount) {
                        doc.text(`Total de Agentes para Tipo de Cuidado ${tipo}: ${tipoCuidadoCount[tipo]}`, startX, yPosition);
                        yPosition += rowHeight;
                    }
                    yPosition += rowHeight;

                    // Resetear contadores
                    tipoCuidadoCount = {};
                    agenteCount = 0;
                }
                currentServicioId = row.servicio_id;
            }

            // Agregar tipo de cuidado al contador
            if (!tipoCuidadoCount[row.tipoCuidado]) {
                tipoCuidadoCount[row.tipoCuidado] = 0;
            }
            tipoCuidadoCount[row.tipoCuidado]++;

            // Dibujar líneas horizontales y columnas
            drawTableRow(doc, startX, yPosition, columnWidths, row);
            yPosition += rowHeight;

            agenteCount++; // Incrementar el contador de agentes
        });

        // Mostrar contador de agentes para el último servicio
        if (currentServicioId !== null) {
            yPosition += 10;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('black').text(`Total de Agentes para ${currentServicioId}: ${agenteCount}`, startX, yPosition);
            yPosition += rowHeight;

            // Mostrar contador de agentes por tipo de cuidado
            for (const tipo in tipoCuidadoCount) {
                doc.text(`Total de Agentes para Tipo de Cuidado ${tipo}: ${tipoCuidadoCount[tipo]}`, startX, yPosition);
                yPosition += rowHeight;
            }
        }

        // Finalizar el PDF
        doc.end();
        console.log('Documento PDF finalizado.');

        // Esperar a que el archivo se escriba completamente y luego enviarlo como respuesta
        writeStream.on('finish', () => {
            console.log('PDF escrito completamente. Enviando archivo al cliente.');
            res.download(filePath, 'reporte_agentes_servicio.pdf', (err) => {
                if (err) {
                    console.error('Error al enviar el archivo:', err);
                    res.status(500).send('Error al enviar el archivo PDF');
                } else {
                    console.log('Archivo enviado exitosamente. Eliminando archivo temporal.');
                    fs.unlinkSync(filePath); // Eliminar el archivo después de enviarlo
                }
            });
        });

        writeStream.on('error', (err) => {
            console.error('Error al escribir el archivo PDF:', err);
            res.status(500).send('Error al generar el archivo PDF');
        });

    } catch (error) {
        console.error('Error al generar el reporte PDF:', error);
        res.status(500).json({ message: 'Error al generar el reporte PDF' });
    }
};

// Función para dibujar encabezados de tabla
function drawTableHeader(doc, startX, startY, columnWidths, headers) {
    let xPosition = startX;
    headers.forEach((header, index) => {
        doc.text(header, xPosition, startY);
        xPosition += columnWidths[Object.keys(columnWidths)[index]];
    });
    // Dibujar línea horizontal debajo de los encabezados
    doc.moveTo(startX, startY + 15).lineTo(startX + Object.values(columnWidths).reduce((a, b) => a + b), startY + 15).stroke();
}

// Función para dibujar filas de tabla
function drawTableRow(doc, startX, yPosition, columnWidths, rowData) {
    const rowText = [
        rowData.servicio_id,
        rowData.agente_nombre,
        rowData.tipoCuidado,
        new Date(rowData.fecha_desde).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' })
    ];

    let xPosition = startX;
    doc.fontSize(12).font('Helvetica').fillColor('black');
    rowText.forEach((text, index) => {
        doc.text(text, xPosition, yPosition);
        xPosition += columnWidths[Object.keys(columnWidths)[index]];
    });
    // Dibujar línea horizontal debajo de la fila
    doc.moveTo(startX, yPosition + 15).lineTo(startX + Object.values(columnWidths).reduce((a, b) => a + b), yPosition + 15).stroke();
}
//-----------------------------------------------------------------------------------------------------------------------------------------
exports.logout = (req, res) => {
    // Borrar la cookie que contiene el token
    res.clearCookie('token', {
        httpOnly: true,
        secure: true, // Asegúrate de que esté en true si estás usando HTTPS
        sameSite: 'Strict'
    });
    return res.status(200).json({ message: 'Logged out successfully' });
};
//-------------------------------------------------------------------------------------------------------------------------------------------
exports.getFilteredNovedades = async (req, res) => {
    try {
        const ley = req.query.ley; // Obtener el valor de LEY desde el query string

        if (!ley) {
            console.log('Valor de LEY no proporcionado o indefinido');
            return res.status(400).json({ message: 'Valor de LEY requerido' });
        }

        let query = 'SELECT * FROM novedades';
        let params = [];

        if (['2', '3', '4', '5'].includes(ley)) {
            query += ' WHERE LEY IN (?, ?)';
            params.push('nombrado', 'ambos');
        }

        console.log(`Ley del agente: ${ley}`);
        console.log(`Consulta SQL ejecutada: ${query} con parámetros ${params}`);

        const [novedades] = await pool.query(query, params);

        res.status(200).json(novedades);
    } catch (error) {
        console.error('Error retrieving filtered novedades:', error);
        res.status(500).json({ message: 'Error retrieving filtered novedades' });
    }
};
//-----------------------------------------------------------------------------------------------------------------------------------------------
exports.cargarAgentesAsignables = async (req, res) => {
    try {
        // Obtener el servicio del usuario desde el token
        const userService = req.user.servicio;

        // Conectar a la base de datos personalv3 para obtener agentes
        const [agentes] = await dbPersonal.query(`
            SELECT DNI, \`APELLDO Y NOMBRE\`, LEY
            FROM PERSONAL
            WHERE ACTIVO = -1 
              AND sector = ? 
              AND DNI NOT IN (
                  SELECT agente_id 
                  FROM intranet.agentes_servicios  -- Cambiar a la base de datos correcta
                  WHERE eliminado = 0
              )
            ORDER BY \`APELLDO Y NOMBRE\` ASC
        `, [userService]); // Usar el servicio obtenido del token

        res.status(200).json(agentes);
    } catch (error) {
        console.error('Error al cargar los agentes asignables:', error);
        res.status(500).json({ message: 'Error al cargar los agentes asignables', error: error.message });
    }
};






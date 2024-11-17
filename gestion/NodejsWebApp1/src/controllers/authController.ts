import Swal from 'sweetalert2';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connection from '../config/db'; // Importar la conexión a la base de datos

// Registro de usuarios
export const register = async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        // Verificar si el usuario ya existe
        const [existingUser] = await connection.execute(
            'SELECT * FROM users WHERE nameuser = ?',
            [username]
        );

        if ((existingUser as any[]).length > 0) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }

        // Hashear la contraseña
        const hashedPassword = bcrypt.hashSync(password, 8);

        // Insertar el nuevo usuario en la base de datos
        await connection.execute(
            'INSERT INTO users (nameuser, pass) VALUES (?, ?)',
            [username, hashedPassword]
        );

        res.status(201).json({ message: 'Usuario registrado con éxito' });
    } catch (error) {
        res.status(500).json({ message: 'Error al registrar el usuario' });
    }
};

// Login de usuarios
export const login = async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        // Buscar el usuario en la base de datos
        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE nameuser = ?',
            [username]
        );

        const user = (rows as any[])[0];

        if (!user) {
            return res.status(400).json({ message: 'Usuario o contraseña incorrectos' });
        }

        // Verificar la contraseña
        const isPasswordValid = bcrypt.compareSync(password, user.pass);

        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Usuario o contraseña incorrectos' });
        }

        // Generar un token JWT
        const token = jwt.sign(
            { iduser: user.iduser, lvl: user.lvl, TIPOUSUARIO: user.TIPOUSUARIO },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1h' }
        );

        res.json({
            message: 'Login exitoso',
            token,
            user: {
                iduser: user.iduser,
                nameuser: user.nameuser,
                lvl: user.lvl,
                TIPOUSUARIO: user.TIPOUSUARIO
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al iniciar sesión' });
    }
};

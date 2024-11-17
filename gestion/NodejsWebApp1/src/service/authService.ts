import connection from '../config/db';
import bcrypt from 'bcryptjs';
import Swal from 'sweetalert2';

// Define la interfaz para el tipo de usuario esperado
interface User {
    iduser: number;
    nameuser: string;
    pass: string;
    lvl: string;
    color_preferido?: string;
    usar_fondo?: number;
    fondo_imagen?: string;
    TIPOUSUARIO: string;
    ACTIVO: number;
}

// Funci�n para autenticar usuario
export const authenticateUser = async (username: string, password: string): Promise<{ error?: string; user?: Omit<User, 'pass'> }> => {
    try {
        // Ejecutar la consulta a la base de datos
        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE nameuser = ?',
            [username]
        );

        // Asegurar que TypeScript sepa que `rows` es un array de objetos de tipo `User`
        const users = rows as User[];

        // Obtener el primer usuario del array
        const user = users[0];

        // Verificar si el usuario no existe
        if (!user) {
            return { error: 'Usuario no encontrado' };
        }

        // Comparar la contrase�a proporcionada con la contrase�a hasheada almacenada
        const passwordMatch = await bcrypt.compare(password, user.pass);

        // Verificar si las contrase�as coinciden
        if (!passwordMatch) {
            return { error: 'Contrase�a incorrecta' };
        }

        // Retornar la informaci�n del usuario excluyendo la contrase�a
        const { pass, ...userInfo } = user;
        return { user: userInfo };

    } catch (error) {
        // Manejar errores, por ejemplo, conectividad con la base de datos
        return { error: 'Error en la autenticaci�n' };
    }
};

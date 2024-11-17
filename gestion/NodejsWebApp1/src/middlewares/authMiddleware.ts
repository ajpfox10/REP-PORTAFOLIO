import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface CustomRequest extends Request {
    body: {
        username?: string;
        // otros campos de body si es necesario
    };
}

export const verifyToken = (req: CustomRequest, res: Response, next: NextFunction) => {
    const token = req.headers['x-access-token'] as string;
    if (!token) {
        return res.status(401).json({ message: 'Token no proporcionado' });
    }

    // Utilizando 'Error' en lugar de 'JsonWebTokenError'
    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err: Error | null, decoded: object | undefined) => {
        if (err) {
            return res.status(401).json({ message: 'Token no válido' });
        }

        // Casting a un tipo conocido para extraer 'username'
        const payload = decoded as { username?: string };
        if (payload.username) {
            req.body.username = payload.username;
        }
        next();
    });
};

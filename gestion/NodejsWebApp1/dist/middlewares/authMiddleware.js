"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const verifyToken = (req, res, next) => {
    const token = req.headers['x-access-token'];
    if (!token) {
        return res.status(401).json({ message: 'Token no proporcionado' });
    }
    // Utilizando 'Error' en lugar de 'JsonWebTokenError'
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'secret', (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Token no v�lido' });
        }
        // Casting a un tipo conocido para extraer 'username'
        const payload = decoded;
        if (payload.username) {
            req.body.username = payload.username;
        }
        next();
    });
};
exports.verifyToken = verifyToken;

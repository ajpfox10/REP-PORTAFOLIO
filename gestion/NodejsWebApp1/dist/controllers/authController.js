"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../config/db")); // Importar la conexi�n a la base de datos
// Registro de usuarios
const register = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password } = req.body;
    try {
        // Verificar si el usuario ya existe
        const [existingUser] = yield db_1.default.execute('SELECT * FROM users WHERE nameuser = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }
        // Hashear la contrase�a
        const hashedPassword = bcryptjs_1.default.hashSync(password, 8);
        // Insertar el nuevo usuario en la base de datos
        yield db_1.default.execute('INSERT INTO users (nameuser, pass) VALUES (?, ?)', [username, hashedPassword]);
        res.status(201).json({ message: 'Usuario registrado con �xito' });
    }
    catch (error) {
        res.status(500).json({ message: 'Error al registrar el usuario' });
    }
});
exports.register = register;
// Login de usuarios
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password } = req.body;
    try {
        // Buscar el usuario en la base de datos
        const [rows] = yield db_1.default.execute('SELECT * FROM users WHERE nameuser = ?', [username]);
        const user = rows[0];
        if (!user) {
            return res.status(400).json({ message: 'Usuario o contrase�a incorrectos' });
        }
        // Verificar la contrase�a
        const isPasswordValid = bcryptjs_1.default.compareSync(password, user.pass);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Usuario o contrase�a incorrectos' });
        }
        // Generar un token JWT
        const token = jsonwebtoken_1.default.sign({ iduser: user.iduser, lvl: user.lvl, TIPOUSUARIO: user.TIPOUSUARIO }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
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
    }
    catch (error) {
        res.status(500).json({ message: 'Error al iniciar sesi�n' });
    }
});
exports.login = login;

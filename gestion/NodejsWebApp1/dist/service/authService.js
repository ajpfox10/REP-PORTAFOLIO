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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateUser = void 0;
const db_1 = __importDefault(require("../config/db"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Funci�n para autenticar usuario
const authenticateUser = (username, password) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Ejecutar la consulta a la base de datos
        const [rows] = yield db_1.default.execute('SELECT * FROM users WHERE nameuser = ?', [username]);
        // Asegurar que TypeScript sepa que `rows` es un array de objetos de tipo `User`
        const users = rows;
        // Obtener el primer usuario del array
        const user = users[0];
        // Verificar si el usuario no existe
        if (!user) {
            return { error: 'Usuario no encontrado' };
        }
        // Comparar la contrase�a proporcionada con la contrase�a hasheada almacenada
        const passwordMatch = yield bcryptjs_1.default.compare(password, user.pass);
        // Verificar si las contrase�as coinciden
        if (!passwordMatch) {
            return { error: 'Contrase�a incorrecta' };
        }
        // Retornar la informaci�n del usuario excluyendo la contrase�a
        const { pass } = user, userInfo = __rest(user, ["pass"]);
        return { user: userInfo };
    }
    catch (error) {
        // Manejar errores, por ejemplo, conectividad con la base de datos
        return { error: 'Error en la autenticaci�n' };
    }
});
exports.authenticateUser = authenticateUser;

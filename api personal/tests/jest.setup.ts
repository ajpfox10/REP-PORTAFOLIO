import path from "path";

// Cargar .env una sola vez para TODOS los tests
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "3001";

// Forzar DB de TEST si existe en el mismo .env
process.env.DB_HOST = process.env.DB_HOST_TEST || process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT_TEST || process.env.DB_PORT || "3306";
process.env.DB_NAME = process.env.DB_NAME_TEST || process.env.DB_NAME || "personalv5_test";
process.env.DB_USER = process.env.DB_USER_TEST || process.env.DB_USER || "root";
process.env.DB_PASSWORD =
  process.env.DB_PASSWORD_TEST ?? process.env.DB_PASSWORD ?? "";

// Disable OpenAPI validation by default for unit tests
process.env.ENABLE_OPENAPI_VALIDATION = "false";

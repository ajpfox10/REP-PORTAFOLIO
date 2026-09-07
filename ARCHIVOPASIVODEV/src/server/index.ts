import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./config/env.js";
import { applySecurity } from "./middlewares/security.js";
import { requestId } from "./middlewares/requestId.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { authRouter } from "./routes/auth.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { accountRouter } from "./routes/account.routes.js";
import { hcRouter } from "./routes/hc.routes.js";
import { healthRouter } from "./routes/health.routes.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../../client");

// Orden base de middlewares compartidos por toda la API.
app.use(requestId);
applySecurity(app);

// Rutas de sistema y API versionada.
app.use("/api", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/account", accountRouter);
app.use("/api/admin", adminRouter);
app.use("/api/hc", hcRouter);

// Sirve el frontend compilado cuando existe build de Vite.
app.use(express.static(clientDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

// Handler final para errores controlados e inesperados.
app.use(errorHandler);

app.listen(env.APP_PORT, env.APP_HOST, () => {
  console.log(`${env.APP_NAME} escuchando en ${env.PUBLIC_URL}`);
});

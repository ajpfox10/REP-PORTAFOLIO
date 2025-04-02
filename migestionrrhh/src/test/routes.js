"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("../src/app.module");
const common_1 = require("@nestjs/common");
async function listarRutas() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    if (!server || !server._router) {
        common_1.Logger.error('No se encontraron rutas registradas.');
        return;
    }
    const routes = server._router.stack
        .filter((layer) => layer.route)
        .map((layer) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0].toUpperCase(),
    }));
    console.table(routes);
    await app.close();
}
listarRutas().catch((err) => {
    common_1.Logger.error(err);
});
//# sourceMappingURL=routes.js.map
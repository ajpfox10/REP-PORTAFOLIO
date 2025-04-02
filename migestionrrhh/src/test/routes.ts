import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Logger } from '@nestjs/common';

async function listarRutas() {
    const app = await NestFactory.create(AppModule);
    await app.init();

    const server = app.getHttpAdapter().getInstance();

    if (!server || !server._router) {
        Logger.error('No se encontraron rutas registradas.');
        return;
    }

    const routes = server._router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
            path: layer.route.path,
            method: Object.keys(layer.route.methods)[0].toUpperCase(),
        }));

    console.table(routes);
    await app.close();
}

listarRutas().catch((err) => {
    Logger.error(err);
});

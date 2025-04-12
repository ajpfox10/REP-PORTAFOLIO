import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    getHello(): string {
        return '¡Hola! El servidor NestJS está funcionando correctamente 🚀';
    }
}

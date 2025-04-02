import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) { }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Token no proporcionado o mal formado');
        }

        const token = authHeader.split(' ')[1];

        try {
            const decoded = this.jwtService.verify(token);
            request.user = decoded;
            return true;
        } catch (error) {
            throw new UnauthorizedException('Token inválido o expirado');
        }
    }
}

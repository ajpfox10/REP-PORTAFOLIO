// test/utils/test-setup.ts

import { ExecutionContext } from '@nestjs/common';

jest.mock('@auth/guards/jwt-auth.guard', () => ({
    JwtAuthGuard: jest.fn().mockImplementation(() => ({
        canActivate: (context: ExecutionContext) => true,
    })),
}));

jest.mock('@auth/guards/roles.guard', () => ({
    RolesGuard: jest.fn().mockImplementation(() => ({
        canActivate: (context: ExecutionContext) => true,
    })),
}));

jest.mock('@nestjs/jwt', () => {
    const actual = jest.requireActual('@nestjs/jwt');
    return {
        ...actual,
        JwtModule: {
            register: jest.fn().mockReturnValue({
                module: class { },
                providers: [],
                exports: [],
            }),
        },
        JwtService: jest.fn().mockImplementation(() => ({
            sign: jest.fn(() => 'mocked-token'),
            verify: jest.fn(() => ({ sub: 'user-id' })),
        })),
    };
});

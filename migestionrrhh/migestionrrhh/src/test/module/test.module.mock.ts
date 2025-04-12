// test/module/test.module.mock.ts

import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Module({
    providers: [
        {
            provide: JwtService,
            useValue: {
                sign: jest.fn().mockReturnValue('mocked-token'),
                verify: jest.fn().mockReturnValue({ userId: 1 }),
            },
        },
    ],
    exports: [JwtService],
})
export class TestMockModule { }


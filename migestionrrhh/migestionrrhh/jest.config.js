module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^@auth/(.*)$': '<rootDir>/src/auth/$1',
        '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    },
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest',
    },
    globals: {
        'ts-jest': {
            tsconfig: 'tsconfig.json'
        }
    },
    modulePathIgnorePatterns: [
        "<rootDir>/node_modules/",
        "<rootDir>/dist/"
    ],
};

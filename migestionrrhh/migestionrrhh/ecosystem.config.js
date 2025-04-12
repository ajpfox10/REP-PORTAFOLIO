module.exports = {
    apps: [
        {
            name: 'rrhh-api',
            script: 'dist/main.js',         // el archivo JS que corre Nest (después del build)
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'development',
                PORT: 4000,
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 4000,
            },
        },
    ],
};

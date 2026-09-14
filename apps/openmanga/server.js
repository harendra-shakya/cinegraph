const { createApp } = require('./server/app');
const { getConfig } = require('./server/config');

const config = getConfig(__dirname);
const app = createApp({ rootDir: config.rootDir });

if (require.main === module) {
    const host = process.env.HOST || '127.0.0.1';
    app.listen(config.port, host, () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
}

module.exports = {
    app,
    createApp,
};

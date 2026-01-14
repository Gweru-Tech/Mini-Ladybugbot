const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const __path = process.cwd();
const PORT = process.env.PORT || 8000;
const code = require('./pair');

// Increase event listener limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static file serving (optional - if you have CSS, JS, images)
// app.use(express.static(path.join(__path, 'public')));

// Route handlers
app.use('/code', code);

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__path, 'pair.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__path, 'main.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║      🌙 ʟᴀᴅʏʙᴜɢ ʙᴏᴛ ᴍɪɴɪ Server          ║
    ║                                       ║
    ║  Server running on:                   ║
    ║  http://0.0.0.0:${PORT}               ║
    ║                                       ║
    ║  Don't forget to give a star! ⭐     ║
    ╚═══════════════════════════════════════╝
    `);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

module.exports = app;

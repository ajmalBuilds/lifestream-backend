"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var app_simple_1 = require("./app");
// Start server
(0, app_simple_1.startServer)().catch(function (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
});
// Graceful shutdown
process.on('SIGINT', function () {
    console.log('🛑 Shutting down server gracefully...');
    process.exit(0);
});
process.on('SIGTERM', function () {
    console.log('🛑 Server terminated');
    process.exit(0);
});

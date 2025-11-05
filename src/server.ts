import App from './app';

const app = new App();

// Start server
app.listen().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n📢 Received ${signal}. Shutting down gracefully...`);
  
  app.close().then(() => {
    console.log('✅ All services closed successfully.');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
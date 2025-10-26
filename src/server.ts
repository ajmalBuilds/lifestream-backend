import App from './app';

const app = new App();

// Start server
app.listen().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Server terminated');
  process.exit(0);
});
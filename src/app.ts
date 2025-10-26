import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config/env';
import { testConnection } from './config/database';

// Import routes
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { requestRoutes } from './routes/requests';

// Import socket handlers
import { setupSocketHandlers } from './sockets/socketHandlers';

class App {
  public app: express.Application;
  public server: any;
  public io: SocketIOServer;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.clientUrl,
        methods: ['GET', 'POST'],
      },
    });

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeSocketHandlers();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    this.app.use(helmet());
    this.app.use(cors({
      origin: config.clientUrl,
      credentials: true,
    }));
    this.app.use(morgan('combined'));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
  }

  private initializeRoutes(): void {
    // API Routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/requests', requestRoutes);

    // Health check route
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'success',
        message: 'LifeStream API is running!',
        timestamp: new Date().toISOString(),
      });
    });

    // Root route
    this.app.get('/', (req, res) => {
      res.status(200).json({
        status: 'success',
        message: 'LifeStream Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    });
  }

  private initializeSocketHandlers(): void {
    setupSocketHandlers(this.io);
  }

  private initializeErrorHandling(): void {
    // 404 handler - MUST be after all other routes
    this.app.use((req, res) => {
        res.status(404).json({
          status: 'error',
          message: `Route ${req.originalUrl} not found`,
        });
      });

    // Global error handler
    this.app.use(
      (
        error: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        console.error('Global error handler:', error);
        res.status(error.status || 500).json({
          status: 'error',
          message: error.message || 'Internal server error',
        });
      }
    );
  }

  public async listen(): Promise<void> {
    await testConnection();
    
    this.server.listen(config.port, () => {
      console.log(`🚀 LifeStream Server running on port ${config.port}`);
      console.log(`📱 Client URL: ${config.clientUrl}`);
      console.log(`🌍 Environment: ${config.nodeEnv}`);
      console.log(`📍 Health check: http://localhost:${config.port}/health`);
    });
  }
}

export default App;
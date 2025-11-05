import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config/env';
import { testConnection, pool } from './config/database';
import rateLimit from 'express-rate-limit';

// Import routes
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { requestRoutes } from './routes/requests';
import { chatRoutes } from './routes/chat';

// Import socket handlers
import { initializeSocketIO } from './sockets';

class App {
  public app: express.Application;
  public server: ReturnType<typeof createServer>;
  public io: SocketIOServer;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.clientUrl,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true,
      },
    });

    this.initializeSecurity();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeSocketHandlers();
    this.initializeErrorHandling();
  }

  private initializeSecurity(): void {
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        status: 'error',
        message: 'Too many requests from this IP, please try again later.',
      },
    });

    this.app.use(limiter);
    
    // Helmet security headers
    this.app.use(helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false
    }));
    
    // CORS configuration
    this.app.use(cors({
      origin: config.clientUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));
  }

  private initializeMiddlewares(): void {
    this.app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  }

  private initializeRoutes(): void {
    // API Routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/requests', requestRoutes);
    this.app.use('/api/chat', chatRoutes);

    // Health check route
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({
        status: 'success',
        message: 'LifeStream API is running!',
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv,
        version: '1.0.0',
      });
    });

    // Root route
    this.app.get('/', (req: Request, res: Response) => {
      res.status(200).json({
        status: 'success',
        message: 'LifeStream Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        documentation: `${config.clientUrl}/docs`,
        endpoints: {
          auth: '/api/auth',
          users: '/api/users',
          requests: '/api/requests',
          chat: '/api/chat',
          health: '/health'
        }
      });
    });
  }

  private initializeSocketHandlers(): void {
    // Initialize all socket handlers (main + chat)
    initializeSocketIO(this.io);
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        status: 'error',
        message: `Route ${req.originalUrl} not found`,
        method: req.method,
      });
    });

    // Global error handler
    this.app.use((
      error: any,
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      console.error('🚨 Global error handler:', {
        message: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
      });

      // Handle JWT errors
      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({
          status: 'error',
          message: 'Invalid token',
        });
        return;
      }

      if (error.name === 'TokenExpiredError') {
        res.status(401).json({
          status: 'error',
          message: 'Token expired',
        });
        return;
      }

      // Handle database errors
      if (error.code === '23505') { // Unique violation
        res.status(409).json({
          status: 'error',
          message: 'Resource already exists',
        });
        return;
      }

      // Handle Zod validation errors
      if (error.name === 'ZodError') {
        res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: error.errors,
        });
        return;
      }

      // Handle rate limit errors
      if (error.status === 429) {
        res.status(429).json({
          status: 'error',
          message: 'Too many requests, please try again later.',
        });
        return;
      }

      const statusCode = error.status || error.statusCode || 500;
      const message = error.message || 'Internal server error';

      res.status(statusCode).json({
        status: 'error',
        message,
        ...(config.nodeEnv === 'development' && { 
          stack: error.stack,
        }),
      });
    });
  }

  public async listen(): Promise<void> {
    try {
      await testConnection();
      
      this.server.listen(config.port, () => {
        console.log(`
LifeStream Server Started Successfully!
Port: ${config.port}
Client URL: ${config.clientUrl}
Environment: ${config.nodeEnv}
Health Check: http://localhost:${config.port}/health
Started at: ${new Date().toISOString()}
        `);
      });

      // Handle server errors
      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${config.port} is already in use`);
          process.exit(1);
        } else {
          console.error('Server error:', error);
          process.exit(1);
        }
      });

    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close Socket.IO
      this.io.close(() => {
        console.log('Socket.IO server closed');
      });

      // Close HTTP server
      this.server.close((err) => {
        if (err) {
          console.error('Error closing HTTP server:', err);
          reject(err);
          return;
        }
        console.log('HTTP server closed');
      });

      // Close database pool
      pool.end()
        .then(() => {
          console.log('Database connection pool closed');
          resolve();
        })
        .catch((error) => {
          console.error('Error closing database pool:', error);
          reject(error);
        });
    });
  }
}

export default App;
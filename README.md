# **LifeStream Backend API Documentation**
## **Table of Contents**

- [Overview](#overview)
- [Base URL & Authentication](#base-url--authentication)
- [API Endpoints](#api-endpoints)
- [Socket.io Real-time Events](#socketio-real-time-events)
- [Database Schema](#database-schema)
- [Error Handling](#error-handling)
- [Setup & Deployment](#setup--deployment)

## **Overview**

LifeStream is a real-time blood and platelet management system that connects donors, recipients, hospitals, and blood banks through a unified digital platform. The backend provides RESTful APIs and real-time WebSocket communication for emergency blood requests, donor matching, and instant coordination.

### **Key Features**

- **JWT Authentication**
- **Real-time emergency alerts**
- **Location-based donor matching**
- **Instant messaging system**
- **Blood bank inventory management**
- **Analytics and reporting**

## **Base URL & Authentication**

### **Base URL**

```
http://localhost:5000/api
```

### **Authentication**

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

### **Environment Variables**

```
# Server
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/lifestream
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secure-jwt-secret
JWT_EXPIRES_IN=7d
```

## **API Endpoints**

### **Authentication Endpoints**

### **Register User**

```
POST /auth/register
```

**Request Body:**

```
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "bloodType": "O+",
  "userType": "donor",
  "phone": "+1234567890",
  "dateOfBirth": "1990-01-01",
  "gender": "male"
}
```

**Response:**

```
{
  "status": "success",
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "bloodType": "O+",
      "userType": "donor",
      "phone": "+1234567890",
      "isVerified": false
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### **Login User**

```
POST /auth/login
```

**Request Body:**

```
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**

```
{
  "status": "success",
  "message": "Login successful",
  "data": {
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "bloodType": "O+",
      "userType": "donor",
      "phone": "+1234567890",
      "isVerified": false
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### **Get Current User**

```
GET /auth/me
Headers: Authorization: Bearer <token>
```

### **User Management Endpoints**

### **Get User Profile**

```
GET /users/profile
Headers: Authorization: Bearer <token>
```

**Response:**

```
{
  "status": "success",
  "data": {
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "bloodType": "O+",
      "userType": "donor",
      "phone": "+1234567890",
      "location": {
        "latitude": 40.730610,
        "longitude": -73.935242
      },
      "isVerified": true,
      "createdAt": "2025-10-25T17:51:13.937Z"
    }
  }
}
```

### **Update User Profile**

```
PUT /users/profile
Headers: Authorization: Bearer <token>
```

**Request Body:**

```
{
  "name": "John Smith",
  "phone": "+1987654321",
  "dateOfBirth": "1990-01-01",
  "gender": "male"
}
```

### **Update User Location**

```
POST /users/location
Headers: Authorization: Bearer <token>
```

**Request Body:**

```
{
  "latitude": 40.730610,
  "longitude": -73.935242
}
```

### **Get Nearby Donors**

```
GET /users/donors/nearby?latitude=40.730610&longitude=-73.935242&radius=10&bloodType=O+
Headers: Authorization: Bearer <token>
```

**Response:**

```
{
  "status": "success",
  "data": {
    "donors": [
      {
        "id": 2,
        "name": "Alice Smith",
        "bloodType": "O+",
        "distance": 1.5,
        "phone": "+1234567890",
        "isVerified": true,
        "location": {
          "latitude": 40.731000,
          "longitude": -73.935500
        }
      }
    ],
    "count": 1
  }
}
```

### **Get Nearby Blood Banks**

```
GET /users/blood-banks/nearby?latitude=40.730610&longitude=-73.935242&radius=20
Headers: Authorization: Bearer <token>
```

### **Blood Request Endpoints**

### **Create Blood Request**

```
POST /requests/create
Headers: Authorization: Bearer <token>
```

**Request Body:**

```
{
  "patientName": "Emergency Patient",
  "bloodType": "O+",
  "unitsNeeded": 2,
  "hospital": "City General Hospital",
  "urgency": "critical",
  "location": {
    "latitude": 40.730610,
    "longitude": -73.935242
  },
  "additionalNotes": "Urgent surgery required"
}
```

**Response:**

```
{
  "status": "success",
  "message": "Blood request created successfully",
  "data": {
    "request": {
      "id": 1,
      "patientName": "Emergency Patient",
      "bloodType": "O+",
      "unitsNeeded": 2,
      "hospital": "City General Hospital",
      "urgency": "critical",
      "status": "active",
      "createdAt": "2025-10-25T17:51:13.937Z"
    }
  }
}
```

### **Get Active Requests**

```
GET /requests/active?bloodType=O+&urgency=high&limit=20&offset=0
Headers: Authorization: Bearer <token>
```

### **Get Nearby Requests**

```
GET /requests/nearby?latitude=40.730610&longitude=-73.935242&radius=10&bloodType=O+
Headers: Authorization: Bearer <token>
```

### **Get Request Details**

```
GET /requests/:requestId
Headers: Authorization: Bearer <token>
```

### **Respond to Request (Donor)**

```
POST /requests/:requestId/respond
Headers: Authorization: Bearer <token>
```

**Request Body:**

```
{
  "message": "I can donate immediately, I'm 15 minutes away",
  "availability": "2025-10-25T18:00:00.000Z"
}
```

### **Get Request Responses**

```
GET /requests/:requestId/responses
Headers: Authorization: Bearer <token>
```

### **Select Donor for Request**

```
POST /requests/:requestId/select-donor
Headers: Authorization: Bearer <token>
```

**Request Body:**

```
{
  "donorId": 2
}
```

### **Create Emergency Request**

```
POST /requests/emergency
Headers: Authorization: Bearer <token>
```

## **Socket.io Real-time Events**

### **Connection Setup**

```
const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});
```

### **Client Events (Emits)**

### **Join User Room**

```
socket.emit('join-user', userId);
```

**Purpose:** Join user's personal room for targeted notifications

### **Create Blood Request**

```
socket.emit('create-request', {
  patientName: "Emergency Patient",
  bloodType: "O+",
  unitsNeeded: 2,
  hospital: "City General Hospital",
  urgency: "critical",
  location: { latitude: 40.730610, longitude: -73.935242 }
});
```

### **Respond to Request (Donor)**

```
socket.emit('donor-response', {
  requestId: 1,
  donorId: 2,
  message: "I can donate immediately",
  availability: "immediately"
});
```

### **Update Location**

```
socket.emit('update-location', {
  userId: 1,
  latitude: 40.730610,
  longitude: -73.935242
});
```

### **Send Message**

```
socket.emit('send-message', {
  conversationId: 1,
  senderId: 1,
  message: "Hello, I can help with the blood donation",
  messageType: "text"
});
```

### **Server Events (Listeners)**

### **Welcome Message**

```
socket.on('welcome', (data) => {
  console.log(data);
// {//   message: "Welcome to LifeStream Real-Time Service!",//   socketId: "abc123",//   timestamp: "2025-10-25T17:51:13.937Z"// }});
```

### **Joined Room Confirmation**

```
socket.on('joined-room', (data) => {
  console.log(data);
// {//   room: "user:1",//   userId: "1"// }});
```

### **Request Created Confirmation**

```
socket.on('request-created', (data) => {
  console.log(data);
// {//   status: "success",//   requestId: 1761449169983,//   message: "Blood request broadcasted to nearby donors"// }});
```

### **New Blood Request (Broadcast)**

```
socket.on('new-blood-request', (data) => {
  console.log(data);
// {//   id: 1761449169983,//   patientName: "Emergency Patient",//   bloodType: "O+",//   unitsNeeded: 2,//   hospital: "City General Hospital",//   urgency: "critical",//   location: { latitude: 40.730610, longitude: -73.935242 },//   createdAt: "2025-10-25T17:51:13.937Z"// }});
```

### **Donor Available Notification**

```
socket.on('donor-available', (data) => {
  console.log(data);
// {//   donorId: 2,//   message: "I can donate immediately",//   responseTime: "2025-10-25T17:51:13.937Z"// }});
```

### **New Message**

```
socket.on('new-message', (data) => {
  console.log(data);
// {//   conversationId: 1,//   senderId: 2,//   message: "Hello, I can help with the blood donation",//   messageType: "text",//   timestamp: "2025-10-25T17:51:13.937Z",//   messageId: 1761449169983// }});
```

### **Location Updated**

```
socket.on('location-updated', (data) => {
  console.log(data);
// {//   userId: 1,//   location: { latitude: 40.730610, longitude: -73.935242 },//   timestamp: "2025-10-25T17:51:13.937Z"// }});
```

## **Database Schema**

### **Users Table**

```
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  blood_type VARCHAR(5) NOT NULL CHECK (blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('donor', 'recipient', 'both')),
  phone VARCHAR(20) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other')),
  location GEOGRAPHY(Point, 4326),
  is_verified BOOLEAN DEFAULT FALSE,
  verification_status VARCHAR(20) DEFAULT 'pending',
  document_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Blood Requests Table**

```
CREATE TABLE blood_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  patient_name VARCHAR(100) NOT NULL,
  blood_type VARCHAR(5) NOT NULL CHECK (blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  units_needed INTEGER NOT NULL CHECK (units_needed > 0),
  hospital VARCHAR(255) NOT NULL,
  urgency VARCHAR(20) NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  location GEOGRAPHY(Point, 4326),
  additional_notes TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired')),
  is_emergency BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### **Donor Responses Table**

```
CREATE TABLE donor_responses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES blood_requests(id) ON DELETE CASCADE,
  donor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  availability TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, donor_id)
);
```

### **Blood Banks Table**

```
CREATE TABLE blood_banks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  location GEOGRAPHY(Point, 4326),
  phone VARCHAR(20),
  email VARCHAR(255),
  inventory JSONB DEFAULT '{}',
  operating_hours JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## **Error Handling**

### **Standard Error Response Format**

```
{
  "status": "error",
  "message": "Descriptive error message"
}
```

### **Common HTTP Status Codes**

- `200` - Success
- `201` - Created
- `400` - Bad Request (Validation errors)
- `401` - Unauthorized (Invalid token)
- `403` - Forbidden (Insufficient permissions)
- `404` - Not Found
- `409` - Conflict (Duplicate resource)
- `500` - Internal Server Error

### **Example Error Responses**

### **Validation Error**

```
{
  "status": "error",
  "message": "All fields are required: name, email, password, bloodType, userType, phone"
}
```

### **Authentication Error**

```
{
  "status": "error",
  "message": "Invalid email or password"
}
```

### **Not Found Error**

```
{
  "status": "error",
  "message": "User not found"
}
```

## **Setup & Deployment**

### **Local Development Setup**

1. **Clone and Install Dependencies**

```
git clone <repository-url>
cd lifestream-backend
npm install
```

1. **Environment Setup**

```
cp .env.example .env
# Edit .env with your configuration
```

1. **Database Setup**

```
# Run the schema creation SQL in your PostgreSQL database
psql -d lifestream -f database/schema.sql
```

1. **Start Development Server**

```
npm run dev
```

### **Production Deployment**

1. **Build the Project**

```
npm run build
```

1. **Start Production Server**

```
npm start
```

### **Docker Deployment**

```
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 5000
CMD ["node", "dist/server.js"]
```

## **🧪 Testing**

### **Run Tests**

```
npm test
```

### **API Testing with curl**

```
# Health checkcurl http://localhost:5000/health

# Register usercurl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "bloodType": "O+",
    "userType": "donor",
    "phone": "+1234567890"
  }'
```

### [**Socket.io](https://socket.io/) Testing**

```
node test-socket.js
```

## **Monitoring & Logging**

### **Health Check Endpoint**

```
GET /health
```

**Response:**

```
{
  "status": "success",
  "message": "LifeStream API is running!",
  "timestamp": "2025-10-25T17:51:13.937Z",
  "version": "1.0.0"
}
```

### **Logging Levels**

- `error` - Application errors
- `warn` - Warning messages
- `info` - General information
- `debug` - Debug information (development only)

## **Security Features**

- **JWT Authentication** with configurable expiration
- **Password Hashing** using bcrypt
- **CORS Protection** with configurable origins
- **Input Validation** and sanitization
- **SQL Injection Prevention** with parameterized queries
- **Helmet.js** for security headers

## **Performance Optimization**

- **Database Indexing** on frequently queried fields
- **Connection Pooling** with PostgreSQL
- **Redis Caching** for session storage
- **Query Optimization** with EXPLAIN ANALYZE
- **Compression** for response bodies

---

## **Support**

For technical support or questions:

1. Check the API documentation
2. Review error messages and status codes
3. Test with the provided examples
4. Contact the development team

---

**LifeStream Backend API** - Saving lives through real-time technology.
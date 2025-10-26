const { io } = require('socket.io-client');

console.log('🔌 Testing LifeStream Socket.io Connection...');
console.log('Connecting to: http://localhost:5000');

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling'],
  timeout: 10000
});

socket.on('connect', () => {
  console.log('✅ SUCCESS: Connected to server with ID:', socket.id);
  console.log('Socket connected:', socket.connected);
  
  // Join as user 1
  socket.emit('join-user', '1');
  console.log('Sent join-user event for user 1');
  
  // Create a test blood request
  setTimeout(() => {
    const testRequest = {
      patientName: "Emergency Patient",
      bloodType: "O+", 
      unitsNeeded: 3,
      hospital: "City General Hospital", 
      urgency: "critical",
      location: { latitude: 40.730610, longitude: -73.935242 }
    };
    
    socket.emit('create-request', testRequest);
    console.log('Sent create-request event');
  }, 1000);
});

socket.on('welcome', (data) => {
  console.log('📢 Server welcome:', data);
});

socket.on('joined-room', (data) => {
  console.log('🚪 Joined room:', data);
});

socket.on('request-created', (data) => {
  console.log('✅ Request created response:', data);
});

socket.on('new-blood-request', (data) => {
  console.log('🆕 Received new blood request (this should appear in other clients):', data);
});

socket.on('connect_error', (error) => {
  console.log('❌ CONNECTION ERROR:', error.message);
  console.log('Error details:', error);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected from server:', reason);
});

socket.on('error', (error) => {
  console.log('❌ Socket error:', error);
});

// Auto-disconnect after 10 seconds
setTimeout(() => {
  console.log('\n🛑 Test completed, disconnecting...');
  if (socket.connected) {
    socket.disconnect();
  }
  process.exit(0);
}, 10000);
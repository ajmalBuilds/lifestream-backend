const { io } = require('socket.io-client');

console.log('🩸 BLOOD REQUESTER - Creating emergency request...');
console.log('Connecting to: http://localhost:5000');

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Requester connected with ID:', socket.id);
  
  // Join as hospital user
  socket.emit('join-user', 'hospital-123');
  console.log('🏥 Hospital joined the system');
  
  // Create emergency blood request after 2 seconds
  setTimeout(() => {
    const emergencyRequest = {
      patientName: "Critical Patient - Car Accident",
      bloodType: "O+", 
      unitsNeeded: 4,
      hospital: "City General Emergency", 
      urgency: "critical",
      location: { 
        latitude: 40.7589, 
        longitude: -73.9851 
      },
      additionalNotes: "URGENT: Multiple trauma patient, need blood immediately for surgery"
    };
    
    console.log('🚨 SENDING EMERGENCY BLOOD REQUEST...');
    socket.emit('create-request', emergencyRequest);
    
  }, 2000);
});

socket.on('welcome', (data) => {
  console.log('📢 Server:', data.message);
});

socket.on('joined-room', (data) => {
  console.log('🚪 Joined room:', data.room);
});

socket.on('request-created', (data) => {
  console.log('✅ EMERGENCY REQUEST CREATED!');
  console.log('   Request ID:', data.requestId);
  console.log('   Status:', data.status);
  console.log('   Message:', data.message);
});

socket.on('donor-available', (data) => {
  console.log('🎉 DONOR RESPONDED!');
  console.log('   Donor ID:', data.donorId);
  console.log('   Message:', data.message);
  console.log('   Response Time:', data.responseTime);
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection error:', error.message);
});

// Keep running for 30 seconds to receive donor responses
setTimeout(() => {
  console.log('\n🛑 Requester test completed');
  socket.disconnect();
  process.exit(0);
}, 30000);
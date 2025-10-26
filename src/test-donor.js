const { io } = require('socket.io-client');

console.log('❤️  BLOOD DONOR - Waiting for emergency requests...');
console.log('Connecting to: http://localhost:5000');

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Donor connected with ID:', socket.id);
  
  // Join as donor
  socket.emit('join-user', 'donor-456');
  console.log('❤️  Donor ready to help!');
  console.log('👂 Listening for emergency blood requests...');
});

socket.on('welcome', (data) => {
  console.log('📢 Server:', data.message);
});

socket.on('joined-room', (data) => {
  console.log('🚪 Joined room:', data.room);
});

socket.on('new-blood-request', (data) => {
  console.log('\n🚨🚨🚨 EMERGENCY BLOOD REQUEST RECEIVED! 🚨🚨🚨');
  console.log('=============================================');
  console.log('💉 Patient:', data.patientName);
  console.log('🩸 Blood Type:', data.bloodType);
  console.log('📦 Units Needed:', data.unitsNeeded);
  console.log('🏥 Hospital:', data.hospital);
  console.log('⚠️  Urgency:', data.urgency.toUpperCase());
  console.log('📍 Location:', data.location);
  console.log('📝 Notes:', data.additionalNotes);
  console.log('🕐 Created:', new Date(data.createdAt).toLocaleTimeString());
  console.log('=============================================\n');
  
  // Simulate donor responding after 3 seconds
  setTimeout(() => {
    console.log('✅ DONOR RESPONDING TO EMERGENCY...');
    
    const donorResponse = {
      requestId: data.id,
      donorId: 'donor-456',
      message: `I have ${data.bloodType} blood and can donate immediately. I'm 15 minutes away from ${data.hospital}.`,
      availability: 'immediately'
    };
    
    socket.emit('donor-response', donorResponse);
    console.log('💬 Donor response sent:', donorResponse.message);
    
  }, 3000);
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection error:', error.message);
});

// Keep running indefinitely
console.log('❤️  Donor is actively listening for emergencies...');
console.log('   Press Ctrl+C to stop the donor');
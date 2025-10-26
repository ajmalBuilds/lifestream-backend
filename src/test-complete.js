const { io } = require('socket.io-client');

console.log('🧪 COMPREHENSIVE LIFESTREAM TEST 🧪\n');

// Test different user types
const users = [
  { type: '🏥 Hospital', id: 'hospital-1', bloodType: 'O+' },
  { type: '❤️  Donor', id: 'donor-1', bloodType: 'O+' },
  { type: '❤️  Donor', id: 'donor-2', bloodType: 'A+' },
  { type: '🏥 Hospital', id: 'hospital-2', bloodType: 'B-' }
];

users.forEach((user, index) => {
  setTimeout(() => {
    const socket = io('http://localhost:5000', {
      transports: ['websocket', 'polling']
    });
    
    socket.userType = user.type;
    socket.userId = user.id;
    
    socket.on('connect', () => {
      console.log(`${user.type} ${user.id} connected`);
      socket.emit('join-user', user.id);
      
      if (user.type === '🏥 Hospital') {
        // Hospitals create requests
        setTimeout(() => {
          const request = {
            patientName: `Test Patient from ${user.id}`,
            bloodType: user.bloodType,
            unitsNeeded: 2,
            hospital: `${user.id} Medical Center`,
            urgency: 'high',
            location: { latitude: 40.730610, longitude: -73.935242 }
          };
          
          socket.emit('create-request', request);
          console.log(`   🩸 ${user.type} created blood request`);
        }, 1000);
      }
    });
    
    socket.on('new-blood-request', (data) => {
      console.log(`   🚨 ${user.type} received emergency request for ${data.bloodType}`);
    });
    
  }, index * 1500);
});

console.log('\n🚀 Starting comprehensive test with multiple users...');
console.log('   Waiting 10 seconds to observe real-time interactions...');

setTimeout(() => {
  console.log('\n✅ Comprehensive test completed!');
  process.exit(0);
}, 10000);
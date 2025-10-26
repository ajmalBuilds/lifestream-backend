const { io } = require('socket.io-client');

console.log('📍 Testing Location Updates...');

const socket = io('http://localhost:5000', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Connected with ID:', socket.id);
  
  // Simulate moving locations every 2 seconds
  let count = 0;
  const interval = setInterval(() => {
    const locations = [
      { latitude: 40.7589, longitude: -73.9851 },  // Times Square
      { latitude: 40.7614, longitude: -73.9776 },  // Rockefeller Center
      { latitude: 40.7549, longitude: -73.9840 },  // Empire State Building
      { latitude: 40.7505, longitude: -73.9934 }   // Madison Square Garden
    ];
    
    const location = locations[count % locations.length];
    socket.emit('update-location', {
      userId: 'mobile-user-123',
      ...location
    });
    
    console.log(`📍 Location update ${count + 1}:`, location);
    count++;
    
    if (count >= 8) {
      clearInterval(interval);
      socket.disconnect();
      process.exit(0);
    }
  }, 2000);
});

socket.on('location-updated', (data) => {
  console.log('🔄 Other user location updated:', data);
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection error:', error.message);
});
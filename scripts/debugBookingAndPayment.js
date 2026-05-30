const axios = require('axios');

async function debugBookingAndPayment() {
  try {
    // 1. LOGIN
    const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'test@example.com',
      password: 'password123'
    });
    const token = loginRes.data.token;
    console.log('Login success');

    // 2. CREATE BOOKING
    const bookingPayload = {
      room: '6a06114ce61cd55dc0c3257c',
      hostel: '6a0334f9f21d08d6c67ebcfc',
      checkInDate: new Date().toISOString()
    };

    console.log('Sending booking request...');
    const bookingRes = await axios.post('http://localhost:5000/api/bookings', bookingPayload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const bookingId = bookingRes.data._id || bookingRes.data.bookingId;
    console.log('Booking success, ID:', bookingId);

    // 3. INITIALIZE PAYMENT
    console.log('Initializing payment for booking:', bookingId);
    const paymentRes = await axios.post('http://localhost:5000/api/payments/initialize', {
      bookingId: bookingId
    }, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('Payment initialization success:', paymentRes.data);

  } catch (err) {
    if (err.response) {
      console.error('API Error Status:', err.response.status);
      console.error('API Error Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Request Error:', err.message);
    }
  }
}

debugBookingAndPayment();

require('dotenv').config();
const axios = require('axios');

async function testAnalytics() {
  const baseUrl = 'http://127.0.0.1:5000/api';
  
  try {
    // 1. Send tracking event
    console.log("--- SENDING TRACKING EVENT ---");
    await axios.post(`${baseUrl}/analytics/track`, {
      eventType: 'page_view',
      page: '/hostels'
    });
    console.log("Tracking event success");

    // 2. Login as admin
    const adminLogin = await axios.post(`${baseUrl}/auth/login`, {
      email: 'richardofor69@gmail.com',
      password: 'Admin123!'
    });
    const token = adminLogin.data.token;
    const config = { headers: { Authorization: `Bearer ${token}` } };

    console.log("\n--- TRAFFIC ANALYTICS ---");
    const traffic = await axios.get(`${baseUrl}/admin/analytics/traffic?timeframe=last30days`, config);
    console.log(JSON.stringify(traffic.data.data, null, 2));

    console.log("\n--- REVENUE ANALYTICS ---");
    const revenue = await axios.get(`${baseUrl}/admin/analytics/revenue?timeframe=last30days`, config);
    console.log(`Found ${revenue.data.data.length} revenue records`);

    console.log("\n--- CONVERSION FUNNELS ---");
    const funnels = await axios.get(`${baseUrl}/admin/analytics/funnels?timeframe=last30days`, config);
    console.log(JSON.stringify(funnels.data.data, null, 2));

    console.log("\n--- EXPORT CSV ---");
    const csv = await axios.get(`${baseUrl}/admin/analytics/export?timeframe=last30days`, {
      ...config,
      responseType: 'text'
    });
    console.log(csv.data.slice(0, 200) + '...');

  } catch(e) {
    console.log("Error:", e.response?.data || e.message);
  }
}
testAnalytics();

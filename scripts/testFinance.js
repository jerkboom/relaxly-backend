require('dotenv').config();
const axios = require('axios');

async function testFinance() {
  try {
    const adminLogin = await axios.post('http://127.0.0.1:5000/api/auth/login', {
      email: 'richardofor69@gmail.com',
      password: 'Admin123!'
    });
    const token = adminLogin.data.token;
    const config = { headers: { Authorization: `Bearer ${token}` } };
    const baseUrl = 'http://127.0.0.1:5000/api/finance';

    console.log("--- FINANCE SUMMARY ---");
    const summary = await axios.get(`${baseUrl}/summary`, config);
    console.log(JSON.stringify(summary.data.data, null, 2));

    console.log("\n--- EXPORT LEDGER CSV ---");
    const csv = await axios.get(`${baseUrl}/export`, config);
    console.log(csv.data.slice(0, 300) + '...');

  } catch(e) {
    console.log("Error:", e.response?.data || e.message);
  }
}
testFinance();

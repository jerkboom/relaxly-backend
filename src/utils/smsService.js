const axios = require('axios');

class SMSService {
  async sendSMS({ to, message }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      console.warn('[SMS] Twilio credentials not configured — SMS not sent (mock mode).');
      return { status: 'mock', messageId: 'mock_' + Math.random().toString(36).substr(2, 9) };
    }


    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const params = new URLSearchParams();
      params.append('To', to);
      params.append('From', fromNumber);
      params.append('Body', message);

      const response = await axios.post(url, params.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('--- SMS SEND SUCCESS ---');
      return {
        status: 'success',
        messageId: response.data.sid
      };
    } catch (error) {
      console.error('--- SMS SEND ERROR ---');
      console.error(error.response ? error.response.data : error.message);
      throw new Error(error.response ? error.response.data.message : 'SMS send failed');
    }
  }
}

module.exports = new SMSService();

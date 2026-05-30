const axios = require('axios');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

const getHeaders = () => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack secret key is not configured');
  }
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
};

const createMomoRecipient = async (name, phoneNumber, network) => {
  const networkCode = getNetworkBankCode(network);
  try {
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transferrecipient`,
      {
        type: 'mobile_money',
        name,
        account_number: phoneNumber,
        bank_code: networkCode,
        currency: 'GHS',
      },
      { headers: getHeaders() }
    );
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message);
  }
};

const createBankRecipient = async (name, accountNumber, bankCode) => {
  try {
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transferrecipient`,
      {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'GHS',
      },
      { headers: getHeaders() }
    );
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message);
  }
};

const verifyRecipient = async (recipientCode) => {
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transferrecipient/${recipientCode}`,
      { headers: getHeaders() }
    );
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message);
  }
};

const getNetworkBankCode = (network) => {
  const map = {
    'MTN': 'MTN',
    'TELECEL': 'VOD',
    'AIRTELTIGO': 'ATL'
  };
  return map[network] || network;
};

module.exports = {
  createMomoRecipient,
  createBankRecipient,
  verifyRecipient,
};

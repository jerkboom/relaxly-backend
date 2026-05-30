const PayoutMethod = require('../models/PayoutMethod');
const User = require('../models/User');
const { createMomoRecipient, createBankRecipient, verifyRecipient } = require('../services/paystackRecipientService');

exports.setupPayoutMethod = async (req, res) => {
  try {
    const { type, accountName, accountNumber, provider, bankCode } = req.body;
    const ownerId = req.user._id;

    if (!type || !accountName || !accountNumber) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    let paystackResponse;
    if (type === 'momo') {
      if (!provider) return res.status(400).json({ success: false, message: 'MoMo provider is required' });
      paystackResponse = await createMomoRecipient(accountName, accountNumber, provider);
    } else if (type === 'bank') {
      if (!bankCode) return res.status(400).json({ success: false, message: 'Bank code is required' });
      paystackResponse = await createBankRecipient(accountName, accountNumber, bankCode);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payout type' });
    }

    if (!paystackResponse || !paystackResponse.status) {
      return res.status(400).json({ success: false, message: 'Failed to create Paystack recipient' });
    }

    const payoutData = {
      owner: ownerId,
      type,
      accountName,
      accountNumber,
      provider: type === 'momo' ? provider : undefined,
      bankCode: type === 'bank' ? bankCode : provider, // Store provider in bankCode field for convenience if needed
      recipientCode: paystackResponse.data.recipient_code,
      recipientId: paystackResponse.data.id,
      isVerified: true, // If Paystack created it, we consider it verified for our flow
    };

    const payoutMethod = await PayoutMethod.findOneAndUpdate(
      { owner: ownerId },
      payoutData,
      { upsert: true, new: true }
    );

    // Also update the User model for backward compatibility/quick check
    await User.findByIdAndUpdate(ownerId, {
      payoutEnabled: true,
      payoutMethod: {
        type,
        accountName,
        recipientCode: payoutData.recipientCode,
        verified: true,
        momo: type === 'momo' ? { network: provider, phoneNumber: accountNumber } : undefined,
        bank: type === 'bank' ? { bankName: bankCode, accountNumber } : undefined,
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Payout method verified successfully',
      payoutMethod
    });
  } catch (error) {
    console.error('Payout Setup Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyPayoutMethod = async (req, res) => {
  try {
    const payoutMethod = await PayoutMethod.findOne({ owner: req.user._id });
    return res.status(200).json({ 
      success: true, 
      data: payoutMethod || null, payoutMethod: payoutMethod || null, payoutEnabled: !!(payoutMethod && payoutMethod.isVerified) 
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePayoutMethod = exports.setupPayoutMethod;

exports.verifyPayoutMethod = async (req, res) => {
  try {
    const payoutMethod = await PayoutMethod.findOne({ owner: req.user._id });
    if (!payoutMethod || !payoutMethod.recipientCode) {
      return res.status(400).json({ success: false, message: 'No payout method to verify' });
    }

    const response = await verifyRecipient(payoutMethod.recipientCode);
    if (response && response.status) {
      payoutMethod.isVerified = response.data.active !== undefined ? response.data.active : true;
      await payoutMethod.save();
      
      // Sync with User model
      await User.findByIdAndUpdate(req.user._id, {
        'payoutMethod.verified': payoutMethod.isVerified,
        payoutEnabled: payoutMethod.isVerified
      });
    }

    return res.status(200).json({ success: true, verified: payoutMethod.isVerified });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};




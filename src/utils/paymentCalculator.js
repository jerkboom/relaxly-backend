/**
 * Helper to round monetary values to 2 decimal places
 * @param {number} value 
 * @returns {number}
 */
const roundMoney = (value) => {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
};

/**
 * Calculates the payment breakdown for a booking
 *
 * @param {number} basePrice - The owner's real amount for the room
 * @param {number} platformAdjustment - Fixed adjustment per room type
 * @param {number} commissionPercent - The commission percentage (e.g., 10 for 10%)
 * @param {number} serviceFeePercent - The service fee percentage (e.g., 2 for 2%)
 * @returns {object} The calculated breakdown
 */
const calculatePaymentBreakdown = (
  basePrice,
  platformAdjustment,
  commissionPercent,
  serviceFeePercent
) => {
  // Ensure ALL inputs are safely converted
  const safeBasePrice = Math.max(0, Number(basePrice) || 0);
  const safeAdjustment = Number(platformAdjustment) || 0;
  const safeCommissionPercent = Math.max(0, Number(commissionPercent) || 0);
  const safeServiceFeePercent = Math.max(0, Number(serviceFeePercent) || 0);

  // displayPrice = basePrice + adjustment
  const displayPrice = roundMoney(safeBasePrice + safeAdjustment);

  // New formulas:
  // commissionAmount = (basePrice * commissionPercent) / 100
  const commissionAmount = roundMoney(safeBasePrice * (safeCommissionPercent / 100));
  
  // serviceFeeAmount = (displayPrice * serviceFeePercent) / 100
  // Note: Standardizing service fee on display price as it's the "visible price" to the student
  const serviceFeeAmount = roundMoney(displayPrice * (safeServiceFeePercent / 100));

  // Student Pays: displayPrice + serviceFeeAmount
  const totalPaid = roundMoney(displayPrice + serviceFeeAmount);

  // Owner Receives: basePrice - commissionAmount
  const ownerAmount = Math.max(0, roundMoney(safeBasePrice - commissionAmount));

  // Paystack Ghana Fee Logic: 1.95% with NO CAP
  const paystackFee = roundMoney(totalPaid * 0.0195);

  // Platform Gross Revenue: adjustment + commissionAmount + serviceFeeAmount
  const platformGrossRevenue = roundMoney(safeAdjustment + commissionAmount + serviceFeeAmount);

  // Platform Net Profit: gross - paystack fee
  const rawNetRevenue = platformGrossRevenue - paystackFee;
  const platformNetProfit = Math.max(0, roundMoney(rawNetRevenue));
  
  // Tax Reserve: 2% of platform net profit
  const taxReserve = roundMoney(platformNetProfit * 0.02);
  
  const platformFinalRetainedProfit = roundMoney(platformNetProfit - taxReserve);
  const platformLoss = roundMoney(rawNetRevenue < 0 ? Math.abs(rawNetRevenue) : 0);

  const breakdown = {
    basePrice: safeBasePrice,
    platformAdjustment: safeAdjustment,
    displayPrice: displayPrice,
    roomPrice: displayPrice, // For legacy compatibility
    commissionPercent: safeCommissionPercent,
    serviceFeePercent: safeServiceFeePercent,
    commissionAmount: commissionAmount,
    serviceFeeAmount: serviceFeeAmount,
    ownerPayoutAmount: ownerAmount, // Step 8 requirement
    // Keep legacy fields for backward compatibility where possible
    commissionRate: safeCommissionPercent, 
    bookingFee: serviceFeeAmount,
    adminCommission: commissionAmount,
    paystackFee: paystackFee,
    platformGrossRevenue: platformGrossRevenue,
    platformNetProfit: platformNetProfit,
    platformNetRevenue: platformNetProfit,
    taxReserve: taxReserve,
    platformFinalRetainedProfit: platformFinalRetainedProfit,
    platformLoss: platformLoss,
    ownerAmount: ownerAmount,
    totalPaid: totalPaid,
  };

  // Log FULL breakdown output
  console.log('FINAL FINANCIAL BREAKDOWN:', JSON.stringify(breakdown, null, 2));

  // Ensure ALL returned fields are numbers and add isNaN guards
  Object.entries(breakdown).forEach(([key, value]) => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`[FINANCIAL_CORRUPTION_ERROR] Invalid calculation for ${key}: ${value}. Breakdown: ${JSON.stringify(breakdown)}`);
    }
  });

  return breakdown;
};

module.exports = {
  calculatePaymentBreakdown,
};



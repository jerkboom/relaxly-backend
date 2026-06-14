const asyncHandler = require('express-async-handler');
const PayoutQueue = require('../models/PayoutQueue');
const Booking = require('../models/Booking');
const Hostel = require('../models/Hostel');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * Helper to get owner payouts with filtering
 */
const getOwnerPayoutsData = async (ownerId, filters = {}) => {
  const { status, startDate, endDate } = filters;
  
  // Robust owner ID handling
  const query = { owner: ownerId };
  
  if (status) query.status = status;
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        query.createdAt.$gte = s;
    }
    if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
    }
  }

  return await PayoutQueue.find(query)
    .populate('hostel', 'name location')
    .populate({
      path: 'booking',
      select: 'bookingCode amount createdAt student',
      populate: {
        path: 'student',
        select: 'name email'
      }
    })
    .sort({ createdAt: -1 });
};

/**
 * @desc    Get owner earnings analytics
 * @route   GET /api/owner/reports/earnings
 */
const getEarningsReport = asyncHandler(async (req, res) => {
  const ownerId = req.user.id;
  const { startDate, endDate } = req.query;

  const ownerHostels = await Hostel.find({ owner: ownerId }).select('_id');
  const hostelIds = ownerHostels.map(h => h._id);

  const query = {
    hostel: { $in: hostelIds },
    paymentStatus: 'paid'
  };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const bookings = await Booking.find(query)
    .populate('student', 'name email')
    .populate('hostel', 'name')
    .populate('room', 'roomType')
    .sort({ createdAt: 1 });

  const totalRevenue = bookings.reduce((sum, b) => sum + (b.amount || 0), 0);
  const paidBookings = bookings.length;
  const averageBookingValue = paidBookings > 0 ? totalRevenue / paidBookings : 0;

  const monthlyMap = {};
  bookings.forEach(b => {
    const date = new Date(b.createdAt);
    const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
    if (!monthlyMap[monthKey]) {
      monthlyMap[monthKey] = { name: monthKey, revenue: 0, count: 0 };
    }
    monthlyMap[monthKey].revenue += b.amount || 0;
    monthlyMap[monthKey].count += 1;
  });

  const hostelMap = {};
  bookings.forEach(b => {
    const name = b.hostel?.name || 'Unknown Hostel';
    if (!hostelMap[name]) {
      hostelMap[name] = { name, revenue: 0, count: 0 };
    }
    hostelMap[name].revenue += b.amount || 0;
    hostelMap[name].count += 1;
  });

  return sendSuccess(res, {
    totalRevenue,
    paidBookings,
    averageBookingValue,
    monthlyRevenue: Object.values(monthlyMap),
    hostelBreakdown: Object.values(hostelMap).sort((a, b) => b.revenue - a.revenue),
    bookingsCount: bookings.length
  });
});

/**
 * @desc    Export owner financial report as CSV
 */
const exportFinancialCsv = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ owner: req.user.id, paymentStatus: 'paid' })
    .populate('student', 'name email')
    .populate('hostel', 'name')
    .populate('room', 'roomType');

  const fields = ['bookingCode', 'createdAt', 'student.name', 'hostel.name', 'room.roomType', 'amount', 'bookingStatus'];
  const parser = new Parser({ fields });
  const csv = parser.parse(bookings);

  res.header('Content-Type', 'text/csv');
  res.attachment(`revenue-report-${Date.now()}.csv`);
  res.send(csv);
});

/**
 * @desc    Export owner financial report as Excel
 */
const exportFinancialExcel = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ owner: req.user.id, paymentStatus: 'paid' })
    .populate('student', 'name email')
    .populate('hostel', 'name')
    .populate('room', 'roomType');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Revenue');
  sheet.columns = [
    { header: 'Booking Code', key: 'code', width: 20 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Student', key: 'student', width: 25 },
    { header: 'Hostel', key: 'hostel', width: 25 },
    { header: 'Amount', key: 'amount', width: 15 },
  ];
  bookings.forEach(b => {
    sheet.addRow({
      code: b.bookingCode,
      date: b.createdAt.toLocaleDateString(),
      student: b.student?.name,
      hostel: b.hostel?.name,
      amount: b.amount
    });
  });

  res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(`revenue-report-${Date.now()}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

/**
 * @desc    Export owner payouts as CSV
 */
const exportPayoutsCsv = asyncHandler(async (req, res) => {
  const payouts = await getOwnerPayoutsData(req.user.id, req.query);

  const fields = [
    { label: 'Date', value: (row) => new Date(row.createdAt).toLocaleDateString('en-GB') },
    { label: 'Hostel', value: (row) => row.hostel?.name || 'N/A' },
    { label: 'Student', value: (row) => row.booking?.student?.name || 'N/A' },
    { label: 'Booking ID', value: (row) => row.booking?.bookingCode || 'N/A' },
    { label: 'Amount (GHS)', value: 'finalTransferAmount' },
    { label: 'Status', value: 'status' },
    { label: 'Reference', value: 'transferReference' }
  ];

  const json2csvParser = new Parser({ fields });
  const csv = json2csvParser.parse(payouts);

  res.header('Content-Type', 'text/csv');
  res.attachment(`payout-report-${Date.now()}.csv`);
  return res.send(csv);
});

/**
 * @desc    Export owner payouts as Excel
 */
const exportPayoutsExcel = asyncHandler(async (req, res) => {
  const payouts = await getOwnerPayoutsData(req.user.id, req.query);

  const workbook = new ExcelJS.Workbook();
  const sheet1 = workbook.addWorksheet('Payout Transactions');
  const sheet2 = workbook.addWorksheet('Summary');

  sheet1.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Hostel', key: 'hostel', width: 25 },
    { header: 'Student', key: 'student', width: 25 },
    { header: 'Booking ID', key: 'bookingId', width: 20 },
    { header: 'Amount (GHS)', key: 'amount', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Reference', key: 'ref', width: 30 },
  ];

  payouts.forEach(p => {
    sheet1.addRow({
      date: new Date(p.createdAt).toLocaleDateString('en-GB'),
      hostel: p.hostel?.name || 'N/A',
      student: p.booking?.student?.name || 'N/A',
      bookingId: p.booking?.bookingCode || 'N/A',
      amount: p.finalTransferAmount || 0,
      status: p.status,
      ref: p.transferReference || 'N/A'
    });
  });

  sheet1.getRow(1).font = { bold: true };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);
  const totalPending = payouts.filter(p => ['pending', 'approved', 'processing'].includes(p.status)).reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);

  sheet2.columns = [ { header: 'Metric', key: 'metric', width: 30 }, { header: 'Value', key: 'value', width: 20 } ];
  sheet2.addRows([
    { metric: 'Total Paid Out (GHS)', value: totalPaid.toFixed(2) },
    { metric: 'Total Pending (GHS)', value: totalPending.toFixed(2) },
    { metric: 'Number of Transactions', value: payouts.length },
    { metric: 'Period', value: `${req.query.startDate || 'Start'} to ${req.query.endDate || 'Present'}` },
    { metric: 'Generated At', value: new Date().toLocaleString() }
  ]);
  sheet2.getRow(1).font = { bold: true };

  res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(`payout-report-${Date.now()}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

/**
 * @desc    Export owner payouts as PDF
 */
const exportPayoutsPdf = asyncHandler(async (req, res) => {
  const payouts = await getOwnerPayoutsData(req.user.id, req.query);

  const doc = new PDFDocument({ margin: 50 });
  res.header('Content-Type', 'application/pdf');
  res.attachment(`financial-statement-${Date.now()}.pdf`);
  doc.pipe(res);

  doc.fontSize(25).text('Relaxly Financial Statement', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Owner: ${req.user.name}`);
  doc.text(`Period: ${req.query.startDate || 'Start'} - ${req.query.endDate || 'Present'}`);
  doc.text(`Generated At: ${new Date().toLocaleString()}`);
  doc.moveDown();

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);
  const totalPending = payouts.filter(p => ['pending', 'approved', 'processing'].includes(p.status)).reduce((sum, p) => sum + (p.finalTransferAmount || 0), 0);

  doc.rect(50, doc.y, 500, 100).fill('#f8fafc').stroke('#e2e8f0');
  doc.fillColor('#000000');
  const summaryY = doc.y + 15;
  doc.text('Total Revenue (Paid Out):', 70, summaryY);
  doc.text(`GHS ${totalPaid.toLocaleString()}`, 400, summaryY, { align: 'right' });
  doc.text('Total Pending Payouts:', 70, summaryY + 20);
  doc.text(`GHS ${totalPending.toLocaleString()}`, 400, summaryY + 20, { align: 'right' });
  doc.text('Number of Transactions:', 70, summaryY + 40);
  doc.text(`${payouts.length}`, 400, summaryY + 40, { align: 'right' });
  doc.text('Statement Status:', 70, summaryY + 60);
  doc.text('Official Digital Copy', 400, summaryY + 60, { align: 'right' });
  doc.moveDown(7);

  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Date', 50, tableTop);
  doc.text('Hostel', 130, tableTop);
  doc.text('Student', 250, tableTop);
  doc.text('Status', 380, tableTop);
  doc.text('Amount', 480, tableTop, { align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke('#cbd5e1');
  
  doc.font('Helvetica');
  let y = tableTop + 25;
  payouts.forEach(p => {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.text(new Date(p.createdAt).toLocaleDateString('en-GB'), 50, y);
    doc.text(p.hostel?.name?.substring(0, 15) || 'N/A', 130, y);
    doc.text(p.booking?.student?.name?.substring(0, 20) || 'N/A', 250, y);
    doc.text(p.status.toUpperCase(), 380, y);
    doc.text(`GHS ${p.finalTransferAmount.toLocaleString()}`, 480, y, { align: 'right' });
    y += 20;
  });

  doc.end();
});

module.exports = {
  getEarningsReport,
  exportFinancialCsv,
  exportFinancialExcel,
  exportPayoutsCsv,
  exportPayoutsExcel,
  exportPayoutsPdf
};

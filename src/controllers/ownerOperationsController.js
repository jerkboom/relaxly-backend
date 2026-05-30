const asyncHandler = require('express-async-handler');
const ownerOperationsService = require('../services/ownerOperationsService');
const { sendSuccess } = require('../utils/responseHandler');

// @desc    Get owner intelligence overview
// @route   GET /api/admin/owners/:id/overview
const getOwnerOverview = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerOverview(req.params.id);
  sendSuccess(res, data);
});

// @desc    Get all hostels for an owner
// @route   GET /api/admin/owners/:id/hostels
const getOwnerHostels = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerHostels(req.params.id);
  sendSuccess(res, data);
});

// @desc    Get all rooms for an owner
// @route   GET /api/admin/owners/:id/rooms
const getOwnerRooms = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerRooms(req.params.id);
  sendSuccess(res, data);
});

// @desc    Get paginated bookings for an owner
// @route   GET /api/admin/owners/:id/bookings
const getOwnerBookings = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerBookings(req.params.id, req.query);
  sendSuccess(res, data);
});

// @desc    Get paginated transaction ledger for an owner
// @route   GET /api/admin/owners/:id/transactions
const getOwnerTransactions = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerTransactions(req.params.id, req.query);
  sendSuccess(res, data);
});

// @desc    Get all payouts for an owner
// @route   GET /api/admin/owners/:id/payouts
const getOwnerPayouts = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerPayouts(req.params.id);
  sendSuccess(res, data);
});

// @desc    Get deep analytics for an owner
// @route   GET /api/admin/owners/:id/analytics
const getOwnerAnalytics = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerAnalytics(req.params.id);
  sendSuccess(res, data);
});

// @desc    Get unified activity timeline for an owner
// @route   GET /api/admin/owners/:id/timeline
const getOwnerActivityTimeline = asyncHandler(async (req, res) => {
  const data = await ownerOperationsService.getOwnerActivityTimeline(req.params.id);
  sendSuccess(res, data);
});

const PDFDocument = require('pdfkit');

// @desc    Download owner audit report
// @route   GET /api/admin/owners/:id/audit-report
const getOwnerAuditReport = asyncHandler(async (req, res) => {
  const ownerId = req.params.id;
  const ownerData = await ownerOperationsService.getOwnerOverview(ownerId);
  const hostels = await ownerOperationsService.getOwnerHostels(ownerId);
  const bookings = await ownerOperationsService.getOwnerBookings(ownerId, { limit: 1000 });
  const payouts = await ownerOperationsService.getOwnerPayouts(ownerId);

  const { owner, stats, riskProfile } = ownerData;

  const doc = new PDFDocument({ margin: 50 });
  const fileName = `audit-report-${owner.name.replace(/\s+/g, '-').toLowerCase()}-${ownerId}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

  doc.pipe(res);

  // HEADER
  doc.fillColor('#444444').fontSize(20).text('Relaxly Owner Audit Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#eeeeee');
  doc.moveDown();

  // OWNER PROFILE
  doc.fillColor('#333333').fontSize(14).text('Owner Profile', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#444444');
  doc.text(`Name: ${owner.name}`);
  doc.text(`Email: ${owner.email}`);
  doc.text(`Phone: ${owner.phone || 'N/A'}`);
  doc.text(`Status: ${owner.status?.toUpperCase() || 'N/A'}`);
  doc.text(`Verification: ${owner.verificationStatus?.toUpperCase() || 'PENDING'}`);
  doc.text(`Commission Rate: ${owner.commissionRate}%`);
  doc.moveDown();

  // FINANCIAL STATS
  doc.fillColor('#333333').fontSize(14).text('Financial Performance', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#444444');
  doc.text(`Gross Revenue: GHS ${stats.grossRevenue.toLocaleString()}`);
  doc.text(`Net Earnings: GHS ${stats.netEarnings.toLocaleString()}`);
  doc.text(`Platform Fees: GHS ${stats.platformCommission.toLocaleString()}`);
  doc.text(`Pending Payouts: GHS ${stats.pendingPayouts.toLocaleString()}`);
  doc.moveDown();

  // RISK PROFILE
  doc.fillColor('#333333').fontSize(14).text('Risk & Operational Health', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#444444');
  doc.text(`Portfolio Occupancy: ${Math.round(stats.occupancyRate)}%`);
  doc.text(`Average Rating: ${stats.avgRating.toFixed(1)} / 5.0`);
  doc.text(`Cancellation Rate: ${riskProfile.cancellationRate.toFixed(1)}%`);
  doc.text(`Failed Payouts: ${riskProfile.failedPayouts}`);
  doc.text(`Payout Freeze: ${owner.payoutFrozen ? 'FROZEN' : 'Active'}`);
  doc.moveDown();

  // PROPERTIES
  doc.fillColor('#333333').fontSize(14).text('Property Inventory', { underline: true });
  doc.moveDown(0.5);
  if (hostels.length === 0) {
    doc.fontSize(10).text('No hostels found for this owner.');
  } else {
    hostels.forEach((h, index) => {
      doc.fontSize(10).fillColor('#444444')
        .text(`${index + 1}. ${h.name} (${h.totalRooms} Rooms) - Status: ${h.status}`);
    });
  }
  doc.moveDown();

  // RECENT BOOKINGS
  doc.fillColor('#333333').fontSize(14).text('Recent Bookings', { underline: true });
  doc.moveDown(0.5);
  if (!bookings.bookings || bookings.bookings.length === 0) {
    doc.fontSize(10).text('No bookings found.');
  } else {
    const list = bookings.bookings.slice(0, 10); // Show top 10 in PDF
    list.forEach((b, index) => {
      doc.fontSize(8).fillColor('#444444')
        .text(`${index + 1}. [${b.code}] GHS ${b.amount} - ${b.student?.name} - ${b.status.toUpperCase()}`);
    });
    if (bookings.bookings.length > 10) {
      doc.fontSize(8).text(`... and ${bookings.bookings.length - 10} more bookings.`);
    }
  }

  // FOOTER
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#999999').text(
      'Relaxly Internal Audit Document - Confidential',
      50,
      doc.page.height - 50,
      { align: 'center' }
    );
  }

  doc.end();
});

module.exports = {
  getOwnerOverview,
  getOwnerHostels,
  getOwnerRooms,
  getOwnerBookings,
  getOwnerTransactions,
  getOwnerPayouts,
  getOwnerAnalytics,
  getOwnerActivityTimeline,
  getOwnerAuditReport
};

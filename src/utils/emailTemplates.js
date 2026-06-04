const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatCurrency = (value, currency = 'GHS') => {
  const amount = Number(value) || 0;

  return `${currency} ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (value) => {
  if (!value) return 'N/A';

  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const button = ({ href, label, background }) => {
  if (!href) return '';

  return `
    <a href="${escapeHtml(href)}"
       style="background:${background};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:bold;margin:6px 4px;">
      ${escapeHtml(label)}
    </a>`;
};

const detailRow = (label, value) => `
  <p style="margin:10px 0;color:#374151;font-size:15px;line-height:1.45;">
    <strong style="color:#111827;">${escapeHtml(label)}:</strong> ${escapeHtml(value)}
  </p>`;

const baseEmailTemplate = ({
  accent = '#2563eb',
  eyebrow,
  title,
  greeting,
  intro,
  detailsTitle = 'Booking Details',
  details = [],
  statusLabel,
  statusColor = '#059669',
  actions = [],
  footer = 'Relaxly Ghana<br>Find your perfect stay.',
}) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:600px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:${accent};padding:30px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:30px;letter-spacing:.2px;">Relaxly</h1>
        <p style="color:rgba(255,255,255,.82);margin:8px 0 0;font-size:15px;">${escapeHtml(eyebrow)}</p>
      </div>

      <div style="padding:30px;">
        <h2 style="color:#111827;margin:0 0 16px;font-size:24px;">${escapeHtml(title)}</h2>
        ${greeting ? `<p style="margin:0 0 14px;color:#374151;font-size:16px;">${escapeHtml(greeting)}</p>` : ''}
        <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.55;">${escapeHtml(intro)}</p>

        <div style="background:#f8fafc;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #e5e7eb;">
          <h3 style="margin:0 0 14px;color:#111827;font-size:18px;">${escapeHtml(detailsTitle)}</h3>
          ${details.map(({ label, value }) => detailRow(label, value)).join('')}
          ${statusLabel ? `
            <p style="margin:10px 0;color:#374151;font-size:15px;line-height:1.45;">
              <strong style="color:#111827;">Status:</strong>
              <span style="color:${statusColor};font-weight:bold;">${escapeHtml(statusLabel)}</span>
            </p>` : ''}
        </div>

        ${actions.length ? `
          <div style="text-align:center;margin-top:30px;">
            ${actions.map(button).join('')}
          </div>` : ''}
      </div>

      <div style="background:#f3f4f6;padding:20px;text-align:center;font-size:13px;color:#6b7280;line-height:1.5;">
        ${footer}
      </div>
    </div>
  </body>
</html>`;

const buildStudentBookingConfirmationEmail = ({ booking, owner }) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://relaxlygh.com').replace(/\/$/, '');
  const hostel = booking.hostel || {};
  const room = booking.room || {};
  const student = booking.student || {};
  const ownerEmail = owner?.email;

  return {
    subject: `Booking Confirmed - ${hostel.name || 'Your Hostel'} | Relaxly`,
    html: baseEmailTemplate({
      accent: '#2563eb',
      eyebrow: 'Your booking has been confirmed',
      title: 'Booking Confirmed',
      greeting: `Hello ${student.name || 'there'},`,
      intro: 'Your booking has been successfully confirmed and payment received.',
      details: [
        { label: 'Hostel', value: hostel.name || 'N/A' },
        { label: 'Booking Code', value: booking.bookingCode || booking._id },
        { label: 'Location', value: hostel.location || 'N/A' },
        { label: 'Room', value: room.roomType || room.occupancyStyle || 'N/A' },
        { label: 'Amount Paid', value: formatCurrency(booking.totalPaid || booking.amountPaid || booking.amount, booking.currency || 'GHS') },
        { label: 'Booking Date', value: formatDate(booking.createdAt) },
      ],
      statusLabel: 'Confirmed',
      statusColor: '#059669',
      actions: [
        {
          href: `${frontendUrl}/student/bookings`,
          label: 'View My Booking',
          background: '#2563eb',
        },
        ownerEmail
          ? {
              href: `mailto:${ownerEmail}`,
              label: 'Contact Host',
              background: '#111827',
            }
          : null,
      ].filter(Boolean),
      footer: 'Relaxly Ghana<br>Find your perfect stay.',
    }),
  };
};

const buildHostBookingNotificationEmail = ({ booking, owner }) => {
  const adminUrl = (process.env.ADMIN_URL || process.env.FRONTEND_URL || 'https://admin.relaxlygh.com').replace(/\/$/, '');
  const hostel = booking.hostel || {};
  const student = booking.student || {};

  return {
    subject: `New Booking Received - ${hostel.name || 'Relaxly'}`,
    html: baseEmailTemplate({
      accent: '#059669',
      eyebrow: 'A new booking has been received',
      title: 'New Booking Alert',
      greeting: owner?.name ? `Hello ${owner.name},` : '',
      intro: 'A student has successfully booked a room and payment has been received.',
      details: [
        { label: 'Hostel', value: hostel.name || 'N/A' },
        { label: 'Guest', value: student.name || 'N/A' },
        { label: 'Booking Code', value: booking.bookingCode || booking._id },
        { label: 'Amount', value: formatCurrency(booking.totalPaid || booking.amountPaid || booking.amount, booking.currency || 'GHS') },
        { label: 'Booking Date', value: formatDate(booking.createdAt) },
      ],
      statusLabel: 'Paid',
      statusColor: '#059669',
      actions: [
        {
          href: `${adminUrl}/bookings`,
          label: 'View Booking',
          background: '#059669',
        },
      ],
      footer: 'Relaxly Admin Portal',
    }),
  };
};

module.exports = {
  buildStudentBookingConfirmationEmail,
  buildHostBookingNotificationEmail,
};

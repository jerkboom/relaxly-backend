const nodemailer = require('nodemailer');

// Singleton transporter for efficiency
let transporter = null;

const createTransporter = () => {
  if (!transporter) {
    const config = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // Use STARTTLS
      requireTLS: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        // Do not fail on invalid certs
        rejectUnauthorized: false
      }
    };

    transporter = nodemailer.createTransport(config);
    
    // Verify connection on creation
    transporter.verify((error, success) => {
      if (error) {
        console.error('✗ SMTP Connection Failed:', error.message);
      } else {
        console.log('✓ SMTP Connected and ready to send emails');
      }
    });
  }
  return transporter;
};

const sendEmail = async (options) => {
  console.log('--- EMAIL SEND START ---');
  console.log('To:', options.email);
  console.log('Subject:', options.subject);

  try {
    const mailTransporter = createTransporter();

    const mailOptions = {
      from: `"Relaxly" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      html: options.message,
    };

    const info = await mailTransporter.sendMail(mailOptions);
    console.log('--- EMAIL SEND SUCCESS ---');
    console.log('Message ID:', info.messageId);
    return info;
  } catch (error) {
    console.error('--- EMAIL SEND ERROR ---');
    console.error('Error Message:', error.message);
    console.error('Error Code:', error.code);
    throw error;
  }
};

module.exports = sendEmail;

const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  console.log('--- EMAIL SEND START ---');
  console.log('To:', options.email);
  console.log('Subject:', options.subject);
  console.log('Using User:', process.env.EMAIL_USER);

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // use SSL
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection configuration
    await transporter.verify();
    console.log('Transporter verified and ready');

    const mailOptions = {
      from: `"Relaxly" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      html: options.message,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('--- EMAIL SEND SUCCESS ---');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    return info;
  } catch (error) {
    console.error('--- EMAIL SEND ERROR ---');
    console.error('Full Error Object:', JSON.stringify(error, null, 2));
    console.error('Error Message:', error.message);
    console.error('Error Code:', error.code);
    console.error('Error Command:', error.command);
    throw error;
  }
};

module.exports = sendEmail;

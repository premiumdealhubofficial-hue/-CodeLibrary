const nodemailer = require('nodemailer');
const config = require('./config');

/**
 * Builds list of prioritized transporters with aggressive timeouts and fallbacks.
 * Strategy 1: Port 587 (SMTP + STARTTLS) - Most reliable on cloud providers like Render
 * Strategy 2: Port 465 (SMTPS + SSL direct)
 * Strategy 3: Service Preset (service: 'gmail')
 */
function createTransporters() {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    return [];
  }

  const host = config.SMTP_HOST || 'smtp.gmail.com';
  const configuredPort = Number(config.SMTP_PORT) || 587;
  const isGmail = host.toLowerCase().includes('gmail.com');
  const transports = [];

  // Primary Strategy: Port 587 STARTTLS (The cloud standard for submission)
  transports.push({
    name: `SMTP Port 587 STARTTLS (${host}:587)`,
    transporter: nodemailer.createTransport({
      host: host,
      port: 587,
      secure: false, // Must be false for STARTTLS
      requireTLS: true,
      family: 4, // Force IPv4
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      connectionTimeout: 5000, // 5 seconds
      greetingTimeout: 5000,
      socketTimeout: 7000,
      tls: {
        rejectUnauthorized: false
      }
    })
  });

  // Secondary Strategy: Port 465 SSL Direct (if 587 is blocked or host requires 465)
  transports.push({
    name: `SMTP Port 465 SSL (${host}:465)`,
    transporter: nodemailer.createTransport({
      host: host,
      port: 465,
      secure: true, // Must be true for port 465
      family: 4,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 7000,
      tls: {
        rejectUnauthorized: false
      }
    })
  });

  // Tertiary Strategy: Service Preset for Gmail
  if (isGmail) {
    transports.push({
      name: 'Gmail Service Preset',
      transporter: nodemailer.createTransport({
        service: 'gmail',
        family: 4,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASS
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 7000
      })
    });
  }

  return transports;
}

/**
 * Checks if the SMTP delivery service is configured with user credentials.
 */
function isSmtpConfigured() {
  return Boolean(config.SMTP_USER && config.SMTP_PASS);
}

/**
 * Classifies raw SMTP error into a safe, human-actionable message.
 */
function classifySmtpError(err) {
  if (!err) return 'Unknown SMTP delivery error';
  const msg = String(err.message || err);
  const code = String(err.code || '');

  if (code === 'EAUTH' || msg.includes('535') || msg.includes('Username and Password not accepted') || msg.includes('BadCredentials')) {
    return 'Gmail SMTP authentication failed. Please verify that SMTP_USER is correct and that SMTP_PASS is a valid 16-character Gmail App Password (generated in Google Account > Security > 2-Step Verification > App passwords).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
    return 'Connection to Gmail SMTP server timed out on ports 587 and 465. Outbound SMTP connection blocked by hosting network or invalid host.';
  }
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
    return 'Could not connect to SMTP mail server. Please verify SMTP_HOST and SMTP_PORT in Render Environment Variables.';
  }
  return `Email delivery error: ${msg}`;
}

/**
 * Safe diagnostics function to test SMTP connectivity without exposing secrets.
 */
async function testSmtpConnection() {
  if (!isSmtpConfigured()) {
    return {
      configured: false,
      message: 'SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS in Render Environment Variables.'
    };
  }

  const transports = createTransporters();
  const results = [];

  for (const { name, transporter } of transports) {
    try {
      await transporter.verify();
      return {
        configured: true,
        connected: true,
        activeTransport: name,
        host: config.SMTP_HOST || 'smtp.gmail.com',
        userSanitized: config.SMTP_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      };
    } catch (err) {
      results.push({
        transport: name,
        error: err.message,
        code: err.code
      });
    }
  }

  return {
    configured: true,
    connected: false,
    host: config.SMTP_HOST || 'smtp.gmail.com',
    userSanitized: config.SMTP_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
    errors: results,
    classifiedSummary: classifySmtpError(results[0]?.error)
  };
}

/**
 * Sends a 6-digit OTP email to the admin for secure login verification.
 * 
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit numeric verification code
 * @returns {Promise<Object>} Nodemailer send result
 */
async function sendAdminLoginOtp(toEmail, otpCode) {
  // Mock mode for local tests
  if (process.env.NODE_ENV === 'test' && !config.SMTP_USER) {
    return { messageId: 'test-mock-id-' + Date.now(), accepted: [toEmail] };
  }

  if (!isSmtpConfigured()) {
    const error = new Error('SMTP email service is not configured on the server. Please configure SMTP_USER and SMTP_PASS in Render Environment Variables.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const transports = createTransporters();
  if (transports.length === 0) {
    const error = new Error('No valid SMTP transports available.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #161f30; border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 20px 40px rgba(0,0,0,0.5); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 30px 30px 20px 30px; text-align: center; background: linear-gradient(180deg, rgba(59, 130, 246, 0.12) 0%, transparent 100%);">
              <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #ffffff; font-size: 24px; font-weight: bold; margin-bottom: 12px;">
                &#128274;
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">CodeLibrary</h1>
              <p style="margin: 5px 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">Secure Admin Management Portal</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 20px 35px 30px 35px;">
              <p style="margin: 0 0 15px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                Hello Admin,
              </p>
              <p style="margin: 0 0 22px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                Use the following 6-digit one-time verification code to complete your login to the CodeLibrary Admin Panel.
              </p>

              <!-- OTP Code Display -->
              <div style="background-color: #0b0f19; border: 1px solid #3b82f6; border-radius: 8px; padding: 18px 10px; text-align: center; margin: 0 0 22px 0;">
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #60a5fa;">
                  ${otpCode}
                </div>
              </div>

              <!-- Security Notices -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 12px 15px; font-size: 13px; color: #fbbf24; line-height: 1.5;">
                    &#9201; <strong>Code expires in 5 minutes.</strong><br>
                    &#128737; Never share this code with anyone. CodeLibrary staff will never ask for your verification code.
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                If you did not initiate this login request, your credentials may be compromised. Please review your account settings and server environment immediately.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: #0f172a; text-align: center; border-top: 1px solid rgba(148, 163, 184, 0.1);">
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                &copy; ${new Date().getFullYear()} CodeLibrary. All rights reserved. &bull; Automated Security Notification
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textContent = `
CodeLibrary Admin Verification Code: ${otpCode}

Your single-use 6-digit verification code to access the CodeLibrary Admin Panel is: ${otpCode}

This code will expire in 5 minutes.

If you did not attempt to log in to the CodeLibrary Admin Panel, please ignore this message or review your security configuration.
  `.trim();

  const mailOptions = {
    from: config.SMTP_FROM || (config.SMTP_USER ? `CodeLibrary <${config.SMTP_USER}>` : 'CodeLibrary Security <no-reply@codelibrary.in>'),
    to: toEmail,
    subject: `Your CodeLibrary Admin Verification Code: ${otpCode}`,
    text: textContent,
    html: htmlContent
  };

  let lastError = null;

  // Try transporters in priority order
  for (const { name, transporter } of transports) {
    try {
      const result = await transporter.sendMail(mailOptions);
      return result;
    } catch (err) {
      console.warn(`[SMTP Warning] Transport "${name}" failed:`, err.message);
      lastError = err;
      // Continue to next fallback
    }
  }

  // If all transports failed, throw formatted classified error
  const classifiedMsg = classifySmtpError(lastError);
  const error = new Error(classifiedMsg);
  error.originalError = lastError;
  error.code = lastError?.code || 'SMTP_SEND_FAILED';
  throw error;
}

module.exports = {
  createTransporters,
  isSmtpConfigured,
  classifySmtpError,
  testSmtpConnection,
  sendAdminLoginOtp
};

const nodemailer = require('nodemailer');
const config = require('./config');

/**
 * Checks if any email delivery service (SMTP or HTTPS API) is configured.
 */
function isSmtpConfigured() {
  return Boolean(
    config.RESEND_API_KEY ||
    config.BREVO_API_KEY ||
    config.SENDGRID_API_KEY ||
    (config.SMTP_USER && config.SMTP_PASS)
  );
}

/**
 * Builds list of prioritized transporters with aggressive timeouts and fallbacks.
 */
function createTransporters() {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    return [];
  }

  const host = config.SMTP_HOST || 'smtp.gmail.com';
  const isGmail = host.toLowerCase().includes('gmail.com');
  const transports = [];

  // Strategy 1: Port 587 STARTTLS (The standard submission port)
  transports.push({
    name: `SMTP Port 587 STARTTLS (${host}:587)`,
    transporter: nodemailer.createTransport({
      host: host,
      port: 587,
      secure: false,
      requireTLS: true,
      family: 4,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 5000,
      tls: {
        rejectUnauthorized: false
      }
    })
  });

  // Strategy 2: Port 465 SSL Direct
  transports.push({
    name: `SMTP Port 465 SSL (${host}:465)`,
    transporter: nodemailer.createTransport({
      host: host,
      port: 465,
      secure: true,
      family: 4,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 5000,
      tls: {
        rejectUnauthorized: false
      }
    })
  });

  // Strategy 3: Gmail Service Preset
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
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 5000
      })
    });
  }

  return transports;
}

/**
 * Sends email via Resend HTTPS REST API (Port 443 - never blocked by cloud hosts).
 */
async function sendViaResend(toEmail, subject, htmlContent, textContent) {
  const from = config.SMTP_FROM || 'CodeLibrary Security <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: from.includes('<') ? from : `CodeLibrary <${from}>`,
      to: [toEmail],
      subject: subject,
      html: htmlContent,
      text: textContent
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Resend API error (${res.status})`);
  }
  return { messageId: data.id, provider: 'resend' };
}

/**
 * Sends email via Brevo (Sendinblue) HTTPS REST API (Port 443).
 */
async function sendViaBrevo(toEmail, subject, htmlContent, textContent) {
  const senderEmail = config.SMTP_USER || 'security@codelibrary.in';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'CodeLibrary Security', email: senderEmail },
      to: [{ email: toEmail }],
      subject: subject,
      htmlContent: htmlContent,
      textContent: textContent
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Brevo API error (${res.status})`);
  }
  return { messageId: data.messageId, provider: 'brevo' };
}

/**
 * Classifies raw SMTP/API error into a safe, human-actionable message.
 */
function classifySmtpError(err) {
  if (!err) return 'Unknown email delivery error';
  const msg = String(err.message || err);
  const code = String(err.code || '');

  if (code === 'EAUTH' || msg.includes('535') || msg.includes('Username and Password not accepted') || msg.includes('BadCredentials')) {
    return 'Gmail authentication failed. Please verify that SMTP_USER is correct and that SMTP_PASS is a valid 16-character Gmail App Password (generated in Google Account > Security > 2-Step Verification > App passwords).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
    return 'Outbound SMTP connection timed out on Render. Outbound SMTP ports (587/465) are blocked on Render free tier. To enable instant delivery, configure RESEND_API_KEY or BREVO_API_KEY in Render Environment Variables.';
  }
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
    return 'Could not connect to mail server. Please verify SMTP_HOST and network configuration in Render.';
  }
  return `Email delivery error: ${msg}`;
}

/**
 * Safe diagnostics function to test SMTP and API connectivity without exposing secrets.
 */
async function testSmtpConnection() {
  if (!isSmtpConfigured()) {
    return {
      configured: false,
      message: 'No email delivery credentials configured. Please set RESEND_API_KEY, BREVO_API_KEY, or SMTP_USER & SMTP_PASS in Render Environment Variables.'
    };
  }

  // If HTTPS API is configured
  if (config.RESEND_API_KEY) {
    return {
      configured: true,
      provider: 'Resend HTTPS API (Port 443)',
      status: 'Active (Unrestricted by cloud firewalls)'
    };
  }

  if (config.BREVO_API_KEY) {
    return {
      configured: true,
      provider: 'Brevo HTTPS API (Port 443)',
      status: 'Active (Unrestricted by cloud firewalls)'
    };
  }

  // Test Nodemailer transports
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
        userSanitized: config.SMTP_USER ? config.SMTP_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3') : ''
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
    userSanitized: config.SMTP_USER ? config.SMTP_USER.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
    errors: results,
    classifiedSummary: classifySmtpError(results[0]?.error)
  };
}

/**
 * Sends a 6-digit OTP email to the admin for secure login verification.
 * 
 * @param {string} toEmail - Recipient email address
 * @param {string} otpCode - 6-digit numeric verification code
 * @returns {Promise<Object>} Send result
 */
async function sendAdminLoginOtp(toEmail, otpCode) {
  // Mock mode for local tests
  if (process.env.NODE_ENV === 'test' && !config.SMTP_USER && !config.RESEND_API_KEY && !config.BREVO_API_KEY) {
    return { messageId: 'test-mock-id-' + Date.now(), accepted: [toEmail] };
  }

  if (!isSmtpConfigured()) {
    const error = new Error('Email service is not configured on the server. Please configure RESEND_API_KEY or SMTP_USER & SMTP_PASS in Render Environment Variables.');
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
          <tr>
            <td style="padding: 30px 30px 20px 30px; text-align: center; background: linear-gradient(180deg, rgba(59, 130, 246, 0.12) 0%, transparent 100%);">
              <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #ffffff; font-size: 24px; font-weight: bold; margin-bottom: 12px;">
                &#128274;
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">CodeLibrary</h1>
              <p style="margin: 5px 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">Secure Admin Management Portal</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 35px 30px 35px;">
              <p style="margin: 0 0 15px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                Hello Admin,
              </p>
              <p style="margin: 0 0 22px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                Use the following 6-digit one-time verification code to complete your login to the CodeLibrary Admin Panel.
              </p>
              <div style="background-color: #0b0f19; border: 1px solid #3b82f6; border-radius: 8px; padding: 18px 10px; text-align: center; margin: 0 0 22px 0;">
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #60a5fa;">
                  ${otpCode}
                </div>
              </div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 12px 15px; font-size: 13px; color: #fbbf24; line-height: 1.5;">
                    &#9201; <strong>Code expires in 5 minutes.</strong><br>
                    &#128737; Never share this code with anyone. CodeLibrary staff will never ask for your verification code.
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                If you did not initiate this login request, please review your account settings immediately.
              </p>
            </td>
          </tr>
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

  const subject = `Your CodeLibrary Admin Verification Code: ${otpCode}`;

  // 1. If Resend API Key is available, deliver via HTTPS (Port 443 - zero blockages)
  if (config.RESEND_API_KEY) {
    try {
      return await sendViaResend(toEmail, subject, htmlContent, textContent);
    } catch (err) {
      console.warn('[Resend Warning]:', err.message);
    }
  }

  // 2. If Brevo API Key is available, deliver via HTTPS (Port 443)
  if (config.BREVO_API_KEY) {
    try {
      return await sendViaBrevo(toEmail, subject, htmlContent, textContent);
    } catch (err) {
      console.warn('[Brevo Warning]:', err.message);
    }
  }

  // 3. Deliver via Nodemailer SMTP transports with fallbacks
  const transports = createTransporters();
  let lastError = null;

  for (const { name, transporter } of transports) {
    try {
      const mailOptions = {
        from: config.SMTP_FROM || (config.SMTP_USER ? `CodeLibrary <${config.SMTP_USER}>` : 'CodeLibrary Security <no-reply@codelibrary.in>'),
        to: toEmail,
        subject: subject,
        text: textContent,
        html: htmlContent
      };
      const result = await transporter.sendMail(mailOptions);
      return result;
    } catch (err) {
      console.warn(`[SMTP Transport "${name}" Error]:`, err.message);
      lastError = err;
    }
  }

  // If all failed, throw classified safe error
  const classifiedMsg = classifySmtpError(lastError);
  const error = new Error(classifiedMsg);
  error.originalError = lastError;
  error.code = lastError?.code || 'EMAIL_SEND_FAILED';
  throw error;
}

module.exports = {
  createTransporters,
  isSmtpConfigured,
  classifySmtpError,
  testSmtpConnection,
  sendAdminLoginOtp
};

const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const config = require('./config');

/**
 * Resolves verified or default sender address for Resend.
 * Default: 'CodeLibrary Security <onboarding@resend.dev>' (works out of the box on free tier)
 * Custom verified domain: e.g. 'CodeLibrary Security <security@codelibrary.in>'
 */
function resolveResendFromAddress() {
  let from = config.RESEND_FROM || config.SMTP_FROM || '';
  if (!from || from.includes('smtp.gmail.com') || from.includes('no-reply@codelibrary.in')) {
    // If no custom domain sender is set, use Resend's default verified sandbox sender
    return 'CodeLibrary Security <onboarding@resend.dev>';
  }
  if (!from.includes('<')) {
    return `CodeLibrary Security <${from}>`;
  }
  return from;
}

/**
 * Checks if any email delivery service (Resend API or SMTP) is configured.
 */
function isSmtpConfigured() {
  return Boolean(
    config.RESEND_API_KEY ||
    config.BREVO_API_KEY ||
    (config.SMTP_USER && config.SMTP_PASS)
  );
}

/**
 * Classifies raw email/API errors into safe, human-actionable instructions.
 */
function classifyEmailError(err) {
  if (!err) return 'Unknown email delivery error';
  const msg = String(err.message || err);
  const code = String(err.code || '');

  if (msg.includes('domain is not verified') || msg.includes('Domain not found')) {
    return 'Resend Error: The sender domain is not verified. To send OTPs immediately without domain verification, set RESEND_FROM to CodeLibrary <onboarding@resend.dev> in Render.';
  }
  if (msg.includes('testing emails') || msg.includes('only send testing emails') || msg.includes('validation_error')) {
    return `Resend Sandbox Notice: ${msg}. On unverified domains, Resend only sends to the email registered with your Resend account. To send to other emails, verify your domain in Resend Dashboard.`;
  }
  if (msg.includes('API key') || msg.includes('restricted_api_key') || msg.includes('401') || code === 'EAUTH') {
    return 'Resend Authentication Error: Invalid API key. Please check the RESEND_API_KEY configured in Render Environment Variables.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
    return 'Email delivery timed out. Please check your network or email service configuration in Render.';
  }
  return `Email delivery error: ${msg}`;
}

/**
 * Sends OTP email via Resend API (HTTPS Port 443 - zero cloud firewall blockages).
 */
async function sendViaResend(toEmail, subject, htmlContent, textContent) {
  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured in environment variables.');
  }

  const fromAddress = resolveResendFromAddress();

  // 1. Try Official Resend Node.js SDK
  try {
    const resend = new Resend(config.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [toEmail],
      subject: subject,
      html: htmlContent,
      text: textContent
    });

    if (error) {
      console.warn('[Resend SDK Warning]:', error);
      throw new Error(error.message || 'Resend SDK delivery failed');
    }

    return { messageId: data?.id || 'resend-id-' + Date.now(), provider: 'resend-sdk' };
  } catch (sdkErr) {
    console.warn('[Resend SDK Fallback to HTTPS API]:', sdkErr.message);

    // 2. Direct HTTPS REST API Fallback
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject: subject,
        html: htmlContent,
        text: textContent
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMsg = body.message || body.error || `HTTP ${response.status} from Resend API`;
      throw new Error(errorMsg);
    }

    return { messageId: body.id, provider: 'resend-https' };
  }
}

/**
 * Builds list of prioritized transporters with aggressive timeouts for SMTP fallback.
 */
function createTransporters() {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    return [];
  }

  const host = config.SMTP_HOST || 'smtp.gmail.com';
  const transports = [];

  // Port 587 STARTTLS
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

  return transports;
}

/**
 * Safe diagnostics function to test delivery connectivity without exposing secrets.
 */
async function testSmtpConnection() {
  if (!isSmtpConfigured()) {
    return {
      configured: false,
      message: 'No email delivery credentials configured. Please set RESEND_API_KEY in Render Environment Variables.'
    };
  }

  // If Resend API is configured
  if (config.RESEND_API_KEY) {
    const keyPreview = config.RESEND_API_KEY.startsWith('re_') 
      ? `re_${config.RESEND_API_KEY.substring(3, 7)}...` 
      : 're_***';
    return {
      configured: true,
      provider: 'Resend HTTP API (Port 443 HTTPS - Cloud Unrestricted)',
      sender: resolveResendFromAddress(),
      apiKeyConfigured: true,
      apiKeyPrefix: keyPreview,
      status: 'Active & Ready for OTP Delivery'
    };
  }

  // Test SMTP fallback
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
    errors: results,
    classifiedSummary: classifyEmailError(results[0]?.error)
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
  if (process.env.NODE_ENV === 'test' && !config.SMTP_USER && !config.RESEND_API_KEY) {
    return { messageId: 'test-mock-id-' + Date.now(), accepted: [toEmail] };
  }

  if (!isSmtpConfigured()) {
    const error = new Error('Email delivery service is not configured on the server. Please set RESEND_API_KEY in Render Environment Variables.');
    error.code = 'EMAIL_NOT_CONFIGURED';
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

  // 1. Primary: Deliver via Resend HTTP API (Port 443 - zero blockages on Render)
  if (config.RESEND_API_KEY) {
    try {
      const result = await sendViaResend(toEmail, subject, htmlContent, textContent);
      return result;
    } catch (err) {
      console.error('[Resend Delivery Error]:', err.message);
      const classifiedMsg = classifyEmailError(err);
      const error = new Error(classifiedMsg);
      error.originalError = err;
      throw error;
    }
  }

  // 2. Fallback: SMTP Transports
  const transports = createTransporters();
  let lastError = null;

  for (const { name, transporter } of transports) {
    try {
      const mailOptions = {
        from: config.SMTP_FROM || 'CodeLibrary Security <no-reply@codelibrary.in>',
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

  const classifiedMsg = classifyEmailError(lastError);
  const error = new Error(classifiedMsg);
  error.originalError = lastError;
  error.code = lastError?.code || 'EMAIL_SEND_FAILED';
  throw error;
}

module.exports = {
  createTransporters,
  isSmtpConfigured,
  resolveResendFromAddress,
  classifyEmailError,
  testSmtpConnection,
  sendViaResend,
  sendAdminLoginOtp
};

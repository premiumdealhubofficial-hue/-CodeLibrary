const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { apiLimiter } = require('../middleware/rateLimiter');

/**
 * GET /api/settings
 * Public endpoint returning customer-facing contact info and enabled social media links.
 * No sensitive/secret configurations are exposed.
 */
router.get('/', apiLimiter, (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }

    // Helper to sanitize phone for WhatsApp click-to-chat
    const whatsappNum = (settingsMap.contact_whatsapp || '+91 7808202338').replace(/[^0-9]/g, '');
    const whatsappMsg = settingsMap.whatsapp_message || 'Hello CodeLibrary Support, I need help with my eBook/order.';
    const whatsappUrl = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(whatsappMsg)}`;

    const publicSettings = {
      contact: {
        phone: settingsMap.contact_phone || '+91 7808202338',
        whatsapp: settingsMap.contact_whatsapp || '+91 7808202338',
        whatsapp_message: whatsappMsg,
        whatsapp_url: whatsappUrl,
        support_email: settingsMap.support_email || 'support@codelibrary.in',
        business_email: settingsMap.business_email || 'contact@codelibrary.in',
        address: settingsMap.contact_address || 'India'
      },
      social: {
        whatsapp: {
          enabled: settingsMap.social_whatsapp_enabled === '1' || settingsMap.social_whatsapp_enabled === 1,
          url: settingsMap.social_whatsapp_url || whatsappUrl
        },
        instagram: {
          enabled: settingsMap.social_instagram_enabled === '1' || settingsMap.social_instagram_enabled === 1,
          url: settingsMap.social_instagram_url || ''
        },
        facebook: {
          enabled: settingsMap.social_facebook_enabled === '1' || settingsMap.social_facebook_enabled === 1,
          url: settingsMap.social_facebook_url || ''
        },
        youtube: {
          enabled: settingsMap.social_youtube_enabled === '1' || settingsMap.social_youtube_enabled === 1,
          url: settingsMap.social_youtube_url || ''
        },
        twitter: {
          enabled: settingsMap.social_twitter_enabled === '1' || settingsMap.social_twitter_enabled === 1,
          url: settingsMap.social_twitter_url || ''
        },
        telegram: {
          enabled: settingsMap.social_telegram_enabled === '1' || settingsMap.social_telegram_enabled === 1,
          url: settingsMap.social_telegram_url || ''
        },
        linkedin: {
          enabled: settingsMap.social_linkedin_enabled === '1' || settingsMap.social_linkedin_enabled === 1,
          url: settingsMap.social_linkedin_url || ''
        },
        pinterest: {
          enabled: settingsMap.social_pinterest_enabled === '1' || settingsMap.social_pinterest_enabled === 1,
          url: settingsMap.social_pinterest_url || ''
        },
        discord: {
          enabled: settingsMap.social_discord_enabled === '1' || settingsMap.social_discord_enabled === 1,
          url: settingsMap.social_discord_url || ''
        }
      }
    };

    res.json(publicSettings);
  } catch (err) {
    console.error('Fetch public settings error:', err);
    res.status(500).json({ error: 'Failed to load public settings' });
  }
});

module.exports = router;

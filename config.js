module.exports = {
    // MongoDB Connection
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://ntando:ih2T2UfoPwWrAZzJ@ladybug2017.xcgevpw.mongodb.net/?appName=Ladybug2017',

    // Bot Configuration
    PREFIX: process.env.PREFIX || '.',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '263776509966',
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 5,
    OTP_EXPIRY: parseInt(process.env.OTP_EXPIRY) || 300000, // 5 minutes

    // Paths
    SESSION_BASE_PATH: process.env.SESSION_BASE_PATH || './sessions',
    NUMBER_LIST_PATH: process.env.NUMBER_LIST_PATH || './numbers.json',
    ADMIN_LIST_PATH: process.env.ADMIN_LIST_PATH || './admins.json',

    // Auto Features
    AUTO_RECORDING: process.env.AUTO_RECORDING === 'true' || false,
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS === 'true' || false,
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS === 'true' || false,
    AUTO_LIKE_EMOJI: (process.env.AUTO_LIKE_EMOJI || '👍,❤️,🔥,😂,😮,😢').split(','),

    // Links
    GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://chat.whatsapp.com/YourGroupLink',
    CHANNEL_LINK: process.env.CHANNEL_LINK || 'https://whatsapp.com/channel/YourChannelLink',
    NEWSLETTER_JID: process.env.NEWSLETTER_JID || '120363423219732186@newsletter',

    // Media
    RCD_IMAGE_PATH: process.env.RCD_IMAGE_PATH || 'https://i.imgur.com/default.jpg',
    CAPTION: process.env.CAPTION || 'Powered by Ladybug Bot',

    // API Configuration
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    
    // Server Configuration
    PORT: process.env.PORT || 3000,
    PM2_NAME: process.env.PM2_NAME || 'ladybug-bot',

    // Feature Toggles
    ENABLE_AUTO_BIO: process.env.ENABLE_AUTO_BIO === 'true' || true,
    ENABLE_AUTO_TYPING: process.env.ENABLE_AUTO_TYPING === 'true' || true,
    ENABLE_AUTO_REACT: process.env.ENABLE_AUTO_REACT === 'true' || true,
    ENABLE_ANTI_DELETE: process.env.ENABLE_ANTI_DELETE === 'true' || true,

    // Download Limits
    MAX_DOWNLOAD_SIZE: 64, // MB
    MAX_BOMB_MESSAGES: 20,
    MAX_APK_SIZE: 500, // MB

    // Timezone
    TIMEZONE: process.env.TIMEZONE || 'Africa/Harare',

    // Default Settings
    DEFAULT_AUTO_BIO_INTERVAL: 300000, // 5 minutes
    DEFAULT_AUTO_TYPING_DELAY: 2000, // 2 seconds
    DEFAULT_AUTO_REACT_EMOJIS: ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏']
};

require('dotenv').config();

const parseList = (envVar, fallback) => {
  if (!envVar) return fallback;
  try {
    return JSON.parse(envVar);
  } catch {
    return envVar.split(',').map(s => s.trim()).filter(Boolean);
  }
};

module.exports = {
  // MongoDB configuration (replaces GitHub)
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://ntando:ih2T2UfoPwWrAZzJ@ladybug2017.xcgevpw.mongodb.net/?appName=Ladybug2017',
  
  // Bot behavior
  AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS || 'true',
  AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS || 'true',
  AUTO_RECORDING: process.env.AUTO_RECORDING || 'true',
  AUTO_LIKE_EMOJI: parseList(process.env.AUTO_LIKE_EMOJI, ['💋', '🍬', '🫆', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭']),
  PREFIX: process.env.PREFIX || '.',
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),

  // Paths
  ADMIN_LIST_PATH: process.env.ADMIN_LIST_PATH || './admin.json',
  SESSION_BASE_PATH: process.env.SESSION_BASE_PATH || './session',
  NUMBER_LIST_PATH: process.env.NUMBER_LIST_PATH || './numbers.json',

  // Images / UI
  RCD_IMAGE_PATH: process.env.RCD_IMAGE_PATH || 'https://files.catbox.moe/7k4awc.jpeg',
  CAPTION: process.env.CAPTION || 'ʟᴀᴅʏʙᴜɢ ʙᴏᴛ ᴍɪɴɪ',

  // Newsletter / channels
  NEWSLETTER_JID: (process.env.NEWSLETTER_JID || '120363417440480101@newsletter').trim(),
  CHANNEL_LINK: process.env.CHANNEL_LINK || 'https://chat.whatsapp.com/LdogfpeSy9AJkvT78WZ9AD',

  // OTP & owner
  OTP_EXPIRY: parseInt(process.env.OTP_EXPIRY || '300000', 10), // ms
  OWNER_NUMBER: process.env.OWNER_NUMBER || '263771629199',

  // Misc
  GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://chat.whatsapp.com/Ir5dLLFsZVaEXklBsYeHSe?mode=wwt',
  PM2_NAME: process.env.PM2_NAME || 'LADYBUG-MINI-main'
};

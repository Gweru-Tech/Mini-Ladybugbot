require('dotenv').config();
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const FileType = require('file-type');
const os = require('os');
const yts = require('yt-search');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = require('./config');

// MongoDB Connection
const connectMongoDB = async () => {
    try {
        await mongoose.connect(config.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        console.log('✅ Connected to MongoDB successfully');
        
        await mongoose.connection.db.collection('sessions').createIndex({ number: 1 }, { unique: true });
        await mongoose.connection.db.collection('sessions').createIndex({ updatedAt: 1 });
        
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        process.exit(1);
    }
};

connectMongoDB();

// Session Schema with auto features
const sessionSchema = new mongoose.Schema({
    number: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        match: /^\d+$/
    },
    creds: { 
        type: mongoose.Schema.Types.Mixed, 
        required: true 
    },
    config: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    },
    autobio: {
        enabled: { type: Boolean, default: false },
        texts: { type: [String], default: [] },
        currentIndex: { type: Number, default: 0 },
        lastUpdate: { type: Date, default: null }
    },
    autotyping: {
        enabled: { type: Boolean, default: false },
        targets: { type: [String], default: [] }
    },
    autoreact: {
        enabled: { type: Boolean, default: false },
        emojis: { type: [String], default: ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏'] }
    },
    lastActive: { 
        type: Date, 
        default: Date.now 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

sessionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Session = mongoose.model('Session', sessionSchema);

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = config.SESSION_BASE_PATH;
const NUMBER_LIST_PATH = config.NUMBER_LIST_PATH;
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Harare').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    console.log(`Session management for ${number} handled by MongoDB`);
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9-_]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message && error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message && error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message && error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        'LADYBUG MINI',
        `📞 Number: ${number}\n🩵 Status: Connected\n📢 Group: ${groupStatus}`,
        '𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 LADYBUG'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in ${Math.floor(config.OTP_EXPIRY / 60000)} minutes.`,
        '𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 LADYBUG'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🔥', '😀', '👍', '🐞'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message || err);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message || error);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            'LADYBUG MINI'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
};

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (isOwner) {  
        try {
            const akuru = sender;
            const quot = msg;
            if (quot) {
                if (quot.imageMessage?.viewOnce) {
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage){
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage){
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }        
        } catch (error) {
            console.error('oneViewmeg error:', error);
        }
    }
}

// Auto Bio Handler
async function autoBioHandler(socket, number) {
    try {
        const session = await Session.findOne({ number });
        if (!session || !session.autobio.enabled || !session.autobio.texts.length) return;

        const now = Date.now();
        const lastUpdate = session.autobio.lastUpdate ? new Date(session.autobio.lastUpdate).getTime() : 0;
        const interval = config.DEFAULT_AUTO_BIO_INTERVAL;

        if (now - lastUpdate < interval) return;

        const currentText = session.autobio.texts[session.autobio.currentIndex];
        
        try {
            await socket.query({
                tag: 'iq',
                attrs: {
                    to: S_WHATSAPP_NET,
                    type: 'set',
                    xmlns: 'w:profile:picture'
                },
                content: [{
                    tag: 'picture',
                    attrs: {},
                    content: Buffer.from([]) 
                }]
            });

            await socket.updateProfileStatus(currentText);
            
            const nextIndex = (session.autobio.currentIndex + 1) % session.autobio.texts.length;
            await Session.findOneAndUpdate(
                { number },
                { 
                    'autobio.currentIndex': nextIndex,
                    'autobio.lastUpdate': new Date()
                }
            );
            
            console.log(`✅ Auto bio updated for ${number}: ${currentText}`);
        } catch (error) {
            console.error('Failed to update bio:', error);
        }
    } catch (error) {
        console.error('Auto bio handler error:', error);
    }
}

// Auto Typing Handler
async function autoTypingHandler(socket, number, from, isGroup) {
    try {
        const session = await Session.findOne({ number });
        if (!session || !session.autotyping.enabled || !isGroup) return;

        if (session.autotyping.targets.length > 0 && !session.autotyping.targets.includes(from)) {
            return;
        }

        await socket.sendPresenceUpdate('composing', from);
        await delay(config.DEFAULT_AUTO_TYPING_DELAY);
        await socket.sendPresenceUpdate('available', from);
    } catch (error) {
        console.error('Auto typing handler error:', error);
    }
}

// Auto React Handler
async function autoReactHandler(socket, number, msgKey) {
    try {
        const session = await Session.findOne({ number });
        if (!session || !session.autoreact.enabled) return;

        const emojis = session.autoreact.emojis || config.DEFAULT_AUTO_REACT_EMOJIS;
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        await socket.sendMessage(msgKey.remoteJid, {
            react: { text: randomEmoji, key: msgKey }
        });
    } catch (error) {
        console.error('Auto react handler error:', error);
    }
}

function setupCommandHandlers(socket, number) {
    const verifiedContact = {
        key: {
            fromMe: false,
            participant: `0@s.whatsapp.net`,
            remoteJid: "status@broadcast"
        },
        message: {
            contactMessage: {
                displayName: "Ladybug✅",
                vcard: "BEGIN:VCARD\nVERSION:3.0\nFN: Ladybug✅\nORG:Ladybug;\nTEL;type=CELL;type=VOICE;waid=263776509966:+263776509966\nEND:VCARD"
            }
        }
    };

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
            ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
            ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
            ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
            ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
            ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
            ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
            ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
            ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
            ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                || msg.text) 
            : (type === 'viewOnceMessage') 
            ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
            ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = (body || '').startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = (body || '').trim().split(/ +/).slice(1);

        socket.downloadAndSaveMediaMessage = async(message, filename = (Date.now()).toString(), attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            const trueFileName = attachExtension ? (filename + '.' + (type ? type.ext : 'bin')) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        }

        // Run auto features
        if (!isCmd && config.ENABLE_AUTO_TYPING) {
            await autoTypingHandler(socket, sanitizedNumber, from, isGroup);
        }
        if (!isCmd && config.ENABLE_AUTO_REACT) {
            await autoReactHandler(socket, sanitizedNumber, msg.key);
        }

        if (!command) return;

        try {
            switch (command) {
                case 'button': {
                    const buttons = [
                        {
                            buttonId: 'button1',
                            buttonText: { displayText: 'Button 1' },
                            type: 1
                        },
                        {
                            buttonId: 'button2',
                            buttonText: { displayText: 'Button 2' },
                            type: 1
                        }
                    ];

                    const captionText = '𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 Ladybug';
                    const footerText = '*LADYBUG* 𝗠𝗜𝗡𝗜';

                    const buttonMessage = {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: captionText,
                        footer: footerText,
                        buttons,
                        headerType: 1
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }

                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `
╭────◉◉◉────៚
⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s
🟢 Active Bots: ${activeSockets.size}
╰────◉◉◉────៚

🔢 Your Number: ${number}
`;

                    await socket.sendMessage(m.chat, {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: {
                                    displayText: '📂 Menu Options'
                                },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Click Here',
                                        sections: [
                                            {
                                                title: `LADYBUG`,
                                                highlight_label: '',
                                                rows: [
                                                    {
                                                        title: 'menu',
                                                        description: 'LADYBUG',
                                                        id: `${config.PREFIX}menu`,
                                                    },
                                                    {
                                                        title: 'Alive',
                                                        description: 'LADYBUG',
                                                        id: `${config.PREFIX}alive`,
                                                    },
                                                ],
                                            },
                                        ],
                                    }),
                                },
                            },
                        ],
                        headerType: 1,
                        viewOnce: true,
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: `LADYBUG\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    let menuText = `
┍━❑ ᴌᴀᴅʏʙᴜɢ ᴍɪɴɪ ❑━━∙∙⊶
┃➸╭──────────
┃❑│▸ *ʙᴏᴛɴᴀᴍᴇ:* *ʟᴀᴅʏʙᴜɢ ᴍɪɴɪ*
┃❑│▸ *ᴏᴡɴᴇʀ :* ᴋᴇɪᴛʜ ᴛᴇᴄʜ
┃❑│▸ ꜱᴛᴀᴛᴜꜱ: *ᴏɴʟɪɴᴇ*
┃❑│▸ ʀᴜɴᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
┃❑│▸ *ʜᴏꜱᴛ :* Heroku
┃❑│▸ *ᴍᴏᴅᴇ :* Public
┃❑│▸ *ᴀᴄᴛɪᴠᴇ ᴜꜱᴇʀꜱ:* ${activeSockets.size}
┃❑│▸ *ᴅᴇᴠᴇʟᴏᴘᴇʀ:* ᴋᴇɪᴛʜ ᴛᴇᴄʜ
┃➸╰──────────
┕━━━━━━━━━━━━━∙∙⊶

┎ ❑ *𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔* ❑
│▸ ${config.PREFIX}ᴀʟɪᴠᴇ
│▸ ${config.PREFIX}ᴀɪ
│▸ ${config.PREFIX}ꜰᴀɴᴄʏ
│▸ ${config.PREFIX}ʟᴏɢᴏ
│▸ ${config.PREFIX}ᴘɪɴɢ
│▸ ${config.PREFIX}ʙɪʙʟᴇ
┖❑

┎ ❑ *M𝐄𝐃𝐈𝐀 𝐌𝐄𝐍𝐔* ❑
│▸ ${config.PREFIX}ꜱᴏɴɢ
│▸ ${config.PREFIX}ᴠɪᴅᴇᴏ
│▸ ${config.PREFIX}ᴀɪɪᴍɢ
│▸ ${config.PREFIX}ᴛɪᴋᴛᴏᴋ
│▸ ${config.PREFIX}ꜰʙ
│▸ ${config.PREFIX}ɪɢ
│▸ ${config.PREFIX}ꜱᴛɪᴄᴋᴇʀ
│▸ ${config.PREFIX}ᴇᴍᴏᴊɪ
│▸ ${config.PREFIX}ᴇᴍᴏᴊɪᴍɪx
┖❑

┎ ❑ *𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 𝐌𝐄𝐍𝐔* ❑
│▸ ${config.PREFIX}ᴀᴘᴋ
│▸ ${config.PREFIX}ɢɪᴛᴄʟᴏɴᴇ
┖❑

┎ ❑ *I𝐍𝐅𝐎 𝐌𝐄𝐍𝐔* ❑
│▸ ${config.PREFIX}ɴᴇᴡꜱ
│▸ ${config.PREFIX}ɴᴀꜱᴀ
│▸ ${config.PREFIX}ᴄʀɪᴄᴋᴇᴛ
│▸ ${config.PREFIX}ᴡɪɴꜰᴏ
┖❑

┎ ❑ *T𝐎𝐎𝐋𝐒 𝐌𝐄𝐍𝐔* ❑
│▸ ${config.PREFIX}ᴛᴛᴘ
│▸ ${config.PREFIX}ᴀᴛᴛᴘ
│▸ ${config.PREFIX}ʙᴏᴍʙ
│▸ ${config.PREFIX}ᴍᴇɴᴛɪᴏɴᴀʟʟ
│▸ ${config.PREFIX}ᴘᴏʟʟ
┖❑

┎ ❑ *𝐏𝐑𝐄𝐌𝐈𝐔𝐌 𝐅𝐄𝐀𝐓𝐔𝐑𝐄𝐒* ❑
│▸ ${config.PREFIX}ᴀᴜᴛᴏʙɪᴏ
│▸ ${config.PREFIX}ᴀᴜᴛᴏᴛʏᴘɪɴɢ
│▸ ${config.PREFIX}ᴀᴜᴛᴏʀᴇᴀᴄᴛ
│▸ ${config.PREFIX}ᴀɴᴛɪᴅᴇʟᴇᴛᴇ
┖❑
`;

                    await socket.sendMessage(from, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '*L A D Y B U G  𝗠 𝗜 𝗡 𝗜*',
                            menuText,
                            'L A D Y B U G  𝗠 𝗜 𝗡 𝗜'
                        ),
                        contextInfo: {
                            mentionedJid: [msg.key.participant || sender],
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: (config.NEWSLETTER_JID || '').trim(),
                                newsletterName: 'L A D Y B U G  𝗠 𝗜 𝗡 𝗜',
                                serverMessageId: 143
                            }
                        }
                    }, { quoted: verifiedContact });

                    break;
                }

                // AUTO BIO COMMANDS
                case 'autobio': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command is only for the bot owner!'
                        }, { quoted: msg });
                    }

                    const action = args[0]?.toLowerCase();
                    const textsInput = args.slice(1).join(' ');

                    if (action === 'on') {
                        if (!textsInput) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Please provide texts separated by commas.\n\nExample:\n.autobio on Hello world,I am available,Free to chat'
                            }, { quoted: msg });
                        }

                        const texts = textsInput.split(',').map(t => t.trim()).filter(t => t);
                        if (texts.length === 0) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Invalid texts. Please provide at least one text.'
                            }, { quoted: msg });
                        }

                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 
                                'autobio.enabled': true,
                                'autobio.texts': texts,
                                'autobio.currentIndex': 0,
                                'autobio.lastUpdate': null
                            },
                            { upsert: true }
                        );

                        await socket.sendMessage(sender, {
                            text: `✅ Auto bio enabled!\n\nTexts (${texts.length}):\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nStatus will rotate every ${config.DEFAULT_AUTO_BIO_INTERVAL / 60000} minutes.`
                        }, { quoted: msg });

                    } else if (action === 'off') {
                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 'autobio.enabled': false }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Auto bio disabled!'
                        }, { quoted: msg });

                    } else if (action === 'status') {
                        const session = await Session.findOne({ number: sanitizedNumber });
                        if (!session || !session.autobio.enabled) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Auto bio is currently disabled.\n\nEnable with:\n.autobio on <text1>,<text2>,<text3>'
                            }, { quoted: msg });
                        }

                        const statusText = `*Auto Bio Status* 📝

🟢 Status: ${session.autobio.enabled ? 'ENABLED' : 'DISABLED'}
📝 Texts (${session.autobio.texts.length}):
${session.autobio.texts.map((t, i) => `${i + 1}. ${t}${i === session.autobio.currentIndex ? ' ◀️ Current' : ''}`).join('\n')}

🔄 Current Index: ${session.autobio.currentIndex + 1}/${session.autobio.texts.length}
⏱️ Interval: ${config.DEFAULT_AUTO_BIO_INTERVAL / 60000} minutes
📅 Last Update: ${session.autobio.lastUpdate ? moment(session.autobio.lastUpdate).tz('Africa/Harare').format('YYYY-MM-DD HH:mm:ss') : 'Never'}`;

                        await socket.sendMessage(sender, {
                            text: statusText
                        }, { quoted: msg });

                    } else {
                        await socket.sendMessage(sender, {
                            text: `*Auto Bio Commands*\n\n${config.PREFIX}autobio on <text1>,<text2>,<text3>\n  - Enable auto bio with custom texts\n\n${config.PREFIX}autobio off\n  - Disable auto bio\n\n${config.PREFIX}autobio status\n  - Check auto bio status`
                        }, { quoted: msg });
                    }
                    break;
                }

                // AUTO TYPING COMMANDS
                case 'autotyping': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command is only for the bot owner!'
                        }, { quoted: msg });
                    }

                    const action = args[0]?.toLowerCase();

                    if (action === 'on') {
                        if (!isGroup) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Auto typing only works in groups!'
                            }, { quoted: msg });
                        }

                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 
                                'autotyping.enabled': true,
                                $addToSet: { 'autotyping.targets': from }
                            },
                            { upsert: true }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Auto typing enabled in this group!\n\nBot will show typing indicator when messages are received.'
                        }, { quoted: msg });

                    } else if (action === 'off') {
                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 'autotyping.enabled': false, 'autotyping.targets': [] }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Auto typing disabled!'
                        }, { quoted: msg });

                    } else if (action === 'status') {
                        const session = await Session.findOne({ number: sanitizedNumber });
                        const enabled = session?.autotyping?.enabled || false;
                        const targets = session?.autotyping?.targets || [];

                        const statusText = `*Auto Typing Status* ⌨️

🟢 Status: ${enabled ? 'ENABLED' : 'DISABLED'}
👥 Active Groups: ${targets.length}
${targets.length > 0 ? `\n📍 Target Groups:\n${targets.map(t => `• ${t}`).join('\n')}` : ''}

⏱️ Delay: ${config.DEFAULT_AUTO_TYPING_DELAY / 1000} seconds`;

                        await socket.sendMessage(sender, {
                            text: statusText
                        }, { quoted: msg });

                    } else {
                        await socket.sendMessage(sender, {
                            text: `*Auto Typing Commands*\n\n${config.PREFIX}autotyping on\n  - Enable auto typing in current group\n\n${config.PREFIX}autotyping off\n  - Disable auto typing\n\n${config.PREFIX}autotyping status\n  - Check auto typing status`
                        }, { quoted: msg });
                    }
                    break;
                }

                // AUTO REACT COMMANDS
                case 'autoreact': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command is only for the bot owner!'
                        }, { quoted: msg });
                    }

                    const action = args[0]?.toLowerCase();
                    const customEmojis = args.slice(1).join('').split('');

                    if (action === 'on') {
                        const emojis = customEmojis.length > 0 ? customEmojis : config.DEFAULT_AUTO_REACT_EMOJIS;

                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 
                                'autoreact.enabled': true,
                                'autoreact.emojis': emojis
                            },
                            { upsert: true }
                        );

                        await socket.sendMessage(sender, {
                            text: `✅ Auto react enabled!\n\nEmojis to use:\n${emojis.map(e => `${e}`).join(' ')}\n\nBot will react to all messages with these emojis.`
                        }, { quoted: msg });

                    } else if (action === 'off') {
                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 'autoreact.enabled': false }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Auto react disabled!'
                        }, { quoted: msg });

                    } else if (action === 'status') {
                        const session = await Session.findOne({ number: sanitizedNumber });
                        const enabled = session?.autoreact?.enabled || false;
                        const emojis = session?.autoreact?.emojis || [];

                        const statusText = `*Auto React Status* 😊

🟢 Status: ${enabled ? 'ENABLED' : 'DISABLED'}
😀 Emojis (${emojis.length}):
${emojis.map(e => e).join(' ') || 'None'}`;

                        await socket.sendMessage(sender, {
                            text: statusText
                        }, { quoted: msg });

                    } else {
                        await socket.sendMessage(sender, {
                            text: `*Auto React Commands*\n\n${config.PREFIX}autoreact on [emojis]\n  - Enable auto react with custom emojis\n  - Example: .autoreact on 👍 ❤️ 🔥\n\n${config.PREFIX}autoreact off\n  - Disable auto react\n\n${config.PREFIX}autoreact status\n  - Check auto react status`
                        }, { quoted: msg });
                    }
                    break;
                }

                // ANTI-DELETE COMMANDS
                case 'antidelete': {
                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command is only for the bot owner!'
                        }, { quoted: msg });
                    }

                    const action = args[0]?.toLowerCase();

                    if (action === 'on') {
                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 'config.antidelete': true },
                            { upsert: true }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Anti-delete enabled!\n\nYou will be notified when messages are deleted in your chats.'
                        }, { quoted: msg });

                    } else if (action === 'off') {
                        await Session.findOneAndUpdate(
                            { number: sanitizedNumber },
                            { 'config.antidelete': false }
                        );

                        await socket.sendMessage(sender, {
                            text: '✅ Anti-delete disabled!'
                        }, { quoted: msg });

                    } else if (action === 'status') {
                        const session = await Session.findOne({ number: sanitizedNumber });
                        const enabled = session?.config?.antidelete || false;

                        await socket.sendMessage(sender, {
                            text: `*Anti-Delete Status* 🗑️

🟢 Status: ${enabled ? 'ENABLED' : 'DISABLED'}

${enabled ? '✅ You will receive notifications when messages are deleted.' : '❌ Anti-delete is currently disabled.'}`
                        }, { quoted: msg });

                    } else {
                        await socket.sendMessage(sender, {
                            text: `*Anti-Delete Commands*\n\n${config.PREFIX}antidelete on\n  - Enable anti-delete\n\n${config.PREFIX}antidelete off\n  - Disable anti-delete\n\n${config.PREFIX}antidelete status\n  - Check anti-delete status`
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'pair': {
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const pairNumber = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!pairNumber) {
                        return await socket.sendMessage(sender, {
                            text: '*📌 Usage:* .pair 263xxx'
                        }, { quoted: msg });
                    }

                    try {
                        const url = `http://206.189.94.231:8000/code?number=${encodeURIComponent(pairNumber)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        console.log("🌐 API Response:", bodyText);

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            console.error("❌ JSON Parse Error:", e);
                            return await socket.sendMessage(sender, {
                                text: '❌ Invalid response from server. Please contact support.'
                            }, { quoted: msg });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to retrieve pairing code. Please check the number.'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            text: `> *L A D Y B U G  𝐌𝙸𝙽𝙸 𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
                        }, { quoted: msg });

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ An error occurred while processing your request. Please try again later.'
                        }, { quoted: msg });
                    }

                    break;
                }

                case 'viewonce':
                case 'rvo':
                case 'vv': {
                    await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });
                    try{
                        if (!msg.quoted) return socket.sendMessage(sender, { text: "🚩 *Please reply to a viewonce message*" });
                        let quotedmsg = msg?.msg?.contextInfo?.quotedMessage;
                        await oneViewmeg(socket, isOwner, quotedmsg, sender);
                    }catch(e){
                        console.log(e);
                        await socket.sendMessage(sender, { text: `${e}` });
                    }
                    break;
                }

                case 'logo': { 
                    const q = args.join(" ");

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: '*`Need a name for logo`*' });
                    }

                    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                    const list = await axios.get('https://raw.githubusercontent.com/md2839pv404/anony0808/refs/heads/main/ep.json');

                    const rows = list.data.map((v) => ({
                        title: v.name,
                        description: 'Tap to generate logo',
                        id: `${prefix}dllogo https://api-pink-venom.vercel.app/api/logo?url=${v.url}&name=${q}`
                    }));

                    const buttonMessage = {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: { displayText: '🎨 Select Text Effect' },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Available Text Effects',
                                        sections: [
                                            {
                                                title: 'Choose your logo style',
                                                rows
                                            }
                                        ]
                                    })
                                }
                            }
                        ],
                        headerType: 1,
                        viewOnce: true,
                        caption: '*LOGO MAKER*',
                        image: { url: config.RCD_IMAGE_PATH },
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: msg });
                    break;
                }

                case 'dllogo': {
                    const q = args.join(" ");
                    if (!q) return socket.sendMessage(from, { text: "Please give me url for capture the screenshot !!" });

                    try {
                        const res = await axios.get(q);
                        const images = res.data.result?.download_url || res.data.result;
                        await socket.sendMessage(m.chat, {
                            image: { url: images },
                            caption: config.CAPTION
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await socket.sendMessage(from, {
                            text: `❌ Error:\n${e.message || e}`
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'aiimg': {
                    const q =
                      msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text ||
                      msg.message?.imageMessage?.caption ||
                      msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim().replace(/^\.aiimg\s*/i, '');

                    if (!prompt) {
                      return await socket.sendMessage(sender, {
                        text: '🎨 *Please provide a prompt to generate an AI image.*'
                      });
                    }

                    try {
                      await socket.sendMessage(sender, { text: '🧠 *Creating your AI image...*' });

                      const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                      const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                      if (!response || !response.data) {
                        return await socket.sendMessage(sender, {
                          text: '❌ *API did not return a valid image. Please try again later.*'
                        });
                      }

                      const imageBuffer = Buffer.from(response.data, 'binary');

                      await socket.sendMessage(sender, {
                        image: imageBuffer,
                        caption: `🧠 *L A D Y B U G   AI IMAGE*\n\n📌 Prompt: ${prompt}`
                      }, { quoted: msg });

                    } catch (err) {
                      console.error('AI Image Error:', err);
                      await socket.sendMessage(sender, {
                        text: `❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`
                      });
                    }

                    break;
                }

                case 'fancy': {
                    const q =
                      msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text ||
                      msg.message?.imageMessage?.caption ||
                      msg.message?.videoMessage?.caption || '';

                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                      return await socket.sendMessage(sender, {
                        text: "❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Ladybug`"
                      });
                    }

                    try {
                      const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                      const response = await axios.get(apiUrl);

                      if (!response.data.status || !response.data.result) {
                        return await socket.sendMessage(sender, {
                          text: "❌ *Error fetching fonts from API. Please try again later.*"
                        });
                      }

                      const fontList = response.data.result
                        .map(font => `*${font.name}:*\n${font.result}`)
                        .join("\n\n");

                      const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 L A D Y B U G_`;

                      await socket.sendMessage(sender, { text: finalMessage }, { quoted: msg });

                    } catch (err) {
                      console.error("Fancy Font Error:", err);
                      await socket.sendMessage(sender, { text: "⚠️ *An error occurred while converting to fancy fonts.*" });
                    }
                    break;
                }

                case 'ts': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const query = q.replace(/^[.\/!]ts\s*/i, '').trim();

                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: '[❗] TikTok search failed'
                        }, { quoted: msg });
                    }

                    async function tiktokSearch(query) {
                        try {
                            const searchParams = new URLSearchParams({
                                keywords: query,
                                count: '10',
                                cursor: '0',
                                HD: '1'
                            });

                            const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
                                headers: {
                                    'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
                                    'Cookie': "current_language=en",
                                    'User-Agent': "Mozilla/5.0"
                                }
                            });

                            const videos = response.data?.data?.videos;
                            if (!videos || videos.length === 0) {
                                return { status: false, result: "No videos found." };
                            }

                            return {
                                status: true,
                                result: videos.map(video => ({
                                    description: video.title || "No description",
                                    videoUrl: video.play || ""
                                }))
                            };
                        } catch (err) {
                            return { status: false, result: err.message };
                        }
                    }

                    function shuffleArray(array) {
                        for (let i = array.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [array[i], array[j]] = [array[j], array[i]];
                        }
                    }

                    try {
                        const searchResults = await tiktokSearch(query);
                        if (!searchResults.status) throw new Error(searchResults.result);

                        const results = searchResults.result;
                        shuffleArray(results);

                        const selected = results.slice(0, 6);

                        const cards = await Promise.all(selected.map(async (vid) => {
                            const videoBuffer = await axios.get(vid.videoUrl, { responseType: "arraybuffer" });
                            const media = await prepareWAMessageMedia({ video: videoBuffer.data }, {
                                upload: socket.waUploadToServer
                            });

                            return {
                                body: proto.Message.InteractiveMessage.Body.fromObject({ text: '' }),
                                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: "L A D Y B U G" }),
                                header: proto.Message.InteractiveMessage.Header.fromObject({
                                    title: vid.description,
                                    hasMediaAttachment: true,
                                    videoMessage: media.videoMessage
                                }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                    buttons: []
                                })
                            };
                        }));

                        const msgContent = generateWAMessageFromContent(sender, {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    },
                                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                                        body: { text: `🔎 *TikTok Search:* ${query}` },
                                        footer: { text: "> 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 *L A D Y B U G*" },
                                        header: { hasMediaAttachment: false },
                                        carouselMessage: { cards }
                                    })
                                }
                            }
                        }, { quoted: msg });

                        await socket.relayMessage(sender, msgContent.message, { messageId: msgContent.key.id });

                    } catch (err) {
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${err.message}`
                        }, { quoted: msg });
                    }

                    break;
                }

                case 'bomb': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const parsed = q.split(',').map(x => x?.trim());
                    const target = parsed[1];
                    const text = parsed[2];
                    const countRaw = parsed[3];

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb .bomb 263xx,Hi 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Limit is 20 messages per bomb.*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}x`
                    }, { quoted: msg });

                    break;
                }

                case 'tiktok': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const link = q.replace(/^[.\/!]tiktok(dl)?|tt(dl)?\s*/i, '').trim();

                    if (!link) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .tiktok <link>'
                        }, { quoted: msg });
                    }

                    if (!link.includes('tiktok.com')) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Invalid TikTok link.*'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '⏳ Downloading video, please wait...'
                        }, { quoted: msg });

                        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to fetch TikTok video.'
                            }, { quoted: msg });
                        }

                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta.media.find(v => v.type === "video");

                        if (!video || !video.org) {
                            return await socket.sendMessage(sender, {
                                text: '❌ No downloadable video found.'
                            }, { quoted: msg });
                        }

                        const caption = `🎵 *TikTok Video*\n\n` +
                                        `👤 *User:* ${author.nickname} (@${author.username})\n` +
                                        `📖 *Title:* ${title}\n` +
                                        `👍 *Likes:* ${like}\n💬 *Comments:* ${comment}\n🔁 *Shares:* ${share}`;

                        await socket.sendMessage(sender, {
                            video: { url: video.org },
                            caption: caption,
                            contextInfo: { mentionedJid: [msg.key.participant || sender] }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("TikTok command error:", err);
                        await socket.sendMessage(sender, {
                            text: `❌ An error occurred:\n${err.message}`
                        }, { quoted: msg });
                    }

                    break;
                }

                case 'fb': {
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const fbUrl = q?.trim().replace(/^\.fb\s*/i, '');

                    if (!/facebook\.com|fb\.watch/.test(fbUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Please provide a valid Facebook video link.*' });
                    }

                    try {
                        const res = await axios.get(`https://suhas-bro-api.vercel.app/download/fbdown?url=${encodeURIComponent(fbUrl)}`);
                        const result = res.data.result;

                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        await socket.sendMessage(sender, {
                            video: { url: result.sd },
                            mimetype: 'video/mp4',
                            caption: '> 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 *L A D Y B U G*'
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });

                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Error downloading video.*' });
                    }

                    break;
                }

                case 'gossip': {
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API returned error');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;

                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape failed for ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 * LADYBUG   GOSSIP  📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'Unknown'}\n🌐 *Link*: ${link}`,
                                'L A D Y B U G  𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message || error}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Failed to fetch gossip news.'
                        });
                    }
                    break;
                }

                case 'nasa': {
                    try {
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url) {
                            throw new Error('Invalid APOD data received');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 L A D Y B U G  𝐍𝐀𝐒𝐀 𝐍𝐄𝐖𝐒',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *Date*: ${date}\n${copyright ? `📝 *Credit*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                '> L A D Y B U G  𝐌𝙸𝙽𝙸 𝐁𝙾𝚃'
                            )
                        });

                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message || error}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ NASA fetch failed.'
                        });
                    }
                    break;
                }

                case 'news': {
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 L A D Y B U G 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date}\n🌐 *Link*: ${link}`,
                                '> L A D Y B U G'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message || error}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ news fetch failed.'
                        });
                    }
                    break;
                }

                case 'cricket': {
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
                        }

                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🏏 L A D Y B U G  CRICKET NEWS🏏',
                                `📢 *${title}*\n\n` +
                                `🏆 *Mark*: ${score}\n` +
                                `🎯 *To Win*: ${to_win}\n` +
                                `📈 *Current Rate*: ${crr}\n\n` +
                                `🌐 *Link*: ${link}`,
                                '> L A D Y B U G'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message || error}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Cricket fetch failed.'
                        });
                    }
                    break;
                }

                case 'apk': {
                    const appName = args.join(" ");

                    if (!appName) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Please provide the app name!*\n\n*Usage:* .apk <app name>\n*Example:* .apk WhatsApp'
                        }, { quoted: msg });
                    }

                    await socket.sendMessage(sender, {
                        react: { text: '⬇️', key: msg.key }
                    });

                    try {
                        const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(appName)}/limit=1`;
                        const response = await axios.get(apiUrl);
                        const data = response.data;

                        if (!data || !data.datalist || !data.datalist.list.length) {
                            await socket.sendMessage(sender, {
                                react: { text: '❌', key: msg.key }
                            });
                            return await socket.sendMessage(sender, {
                                text: '⚠️ *No results found for the given app name.*\n\nPlease try a different search term.'
                            }, { quoted: msg });
                        }

                        const app = data.datalist.list[0];
                        const appSize = (app.size / 1048576).toFixed(2);

                        const caption = `
🌙 *L A D Y B U G  Aᴘᴋ* 🌙

📦 *Nᴀᴍᴇ:* ${app.name}

🏋 *Sɪᴢᴇ:* ${appSize} MB

📦 *Pᴀᴄᴋᴀɢᴇ:* ${app.package}

📅 *Uᴘᴅᴀᴛᴇᴅ ᴏɴ:* ${app.updated}

👨‍💻 *Dᴇᴠᴇʟᴏᴘᴇʀ:* ${app.developer.name}

> ⏳ *ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ᴀᴘᴋ...*

> *© L A D Y B U G*`;

                        if (app.icon) {
                            await socket.sendMessage(sender, {
                                image: { url: app.icon },
                                caption: caption,
                                contextInfo: {
                                    forwardingScore: 1,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: config.NEWSLETTER_JID || '120363423219732186@newsletter',
                                        newsletterName: 'L A D Y B U G',
                                        serverMessageId: -1
                                    }
                                }
                            }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, {
                                text: caption,
                                contextInfo: {
                                    forwardingScore: 1,
                                    isForwarded: true,
                                    forwardedNewsletterMessageInfo: {
                                        newsletterJid: config.NEWSLETTER_JID || '120363423219732186@newsletter',
                                        newsletterName: 'L A D Y B U G',
                                        serverMessageId: -1
                                    }
                                }
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            react: { text: '⬆️', key: msg.key }
                        });

                        await socket.sendMessage(sender, {
                            document: { url: app.file.path_alt },
                            fileName: `${app.name}.apk`,
                            mimetype: 'application/vnd.android.package-archive',
                            caption: `✅ *Aᴘᴋ Dᴏᴡɴʟᴏᴀᴅᴇᴅ Sᴜᴄᴄᴇꜰꜰᴜʟʟʏ!*\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *L A D Y B U G 🌙*`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: config.NEWSLETTER_JID || '120363423219732186@newsletter',
                                    newsletterName: 'L A D Y B U G',
                                    serverMessageId: -1
                                }
                            }
                        }, { quoted: msg });

                        await socket.sendMessage(sender, {
                            react: { text: '✅', key: msg.key }
                        });

                    } catch (error) {
                        console.error('Error in APK command:', error);
                        
                        await socket.sendMessage(sender, {
                            react: { text: '❌', key: msg.key }
                        });
                        
                        await socket.sendMessage(sender, {
                            text: '❌ *An error occurred while fetching the APK.*\n\nPlease try again later or use a different app name.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'ping': {
                    try {
                        const start = Date.now();
                        
                        const sentMsg = await socket.sendMessage(sender, { 
                            text: '```Pinging...```' 
                        }, { quoted: msg });
                        
                        const responseTime = Date.now() - start;
                        const formattedTime = responseTime.toFixed(3);
                        const pinginfo = `🔸️ *Response:* ${formattedTime} ms`.trim();

                        await socket.sendMessage(sender, { 
                            text: pinginfo,
                            edit: sentMsg.key 
                        });

                    } catch (error) {
                        console.error('❌ Error in ping command:', error);
                        await socket.sendMessage(sender, { 
                            text: '❌ Failed to get response speed.' 
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'bible': {
                    try {
                        const reference = args.join(" ");

                        if (!reference) {
                            await socket.sendMessage(sender, {
                                text: `⚠️ *Please provide a Bible reference.*\n\n📝 *Example:*\n.bible John 1:1\n\n💡 *Other examples:*\n.bible Genesis 1:1\n.bible Psalm 23\n.bible Matthew 5:3-10\n.bible Romans 8:28`
                            }, { quoted: msg });
                            break;
                        }

                        const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}`;
                        const response = await axios.get(apiUrl, { timeout: 10000 });

                        if (response.status === 200 && response.data && response.data.text) {
                            const { reference: ref, text, translation_name, verses } = response.data;

                            let verseText = text;
                            
                            if (verses && verses.length > 0) {
                                verseText = verses.map(v => 
                                    `${v.book_name} ${v.chapter}:${v.verse} - ${v.text}`
                                ).join('\n\n');
                            }

                            await socket.sendMessage(sender, {
                                text: `📖 *BIBLE VERSE*\n\n` +
                                      `📚 *Reference:* ${ref}\n\n` +
                                      `📜 *Text:*\n${verseText}\n\n` +
                                      `🔄 *Translation:* ${translation_name}\n\n` +
                                      `> ✨ *Powered by L a d y b u g*`
                            }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, {
                                text: `❌ *Verse not found.*\n\nPlease check if the reference is valid.\n\n📋 *Valid format examples:*\n- John 3:16\n- Psalm 23:1-6\n- Genesis 1:1-5\n- Matthew 5:3-10`
                            }, { quoted: msg });
                        }
                    } catch (error) {
                        console.error("Bible command error:", error.message);
                        
                        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                            await socket.sendMessage(sender, {
                                text: "⏰ *Request timeout.* Please try again in a moment."
                            }, { quoted: msg });
                        } else if (error.response) {
                            await socket.sendMessage(sender, {
                                text: `❌ *API Error:* ${error.response.status}\n\nCould not fetch the Bible verse. Please try a different reference.`
                            }, { quoted: msg });
                        } else if (error.request) {
                            await socket.sendMessage(sender, {
                                text: "🌐 *Network error.* Please check your internet connection and try again."
                            }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, {
                                text: "⚠️ *An error occurred while fetching the Bible verse.*\n\nPlease try again or use a different reference."
                            }, { quoted: msg });
                        }
                    }
                    break;
                }

                case 'gitclone':
                case 'git': {
                    try {
                        const repoUrl = args.join(" ");
                        
                        if (!repoUrl) {
                            return await socket.sendMessage(sender, {
                                text: '📌 *Usage:* .gitclone <github-repository-url>\n\n*Example:*\n.gitclone https://github.com/username/repository'
                            }, { quoted: msg });
                        }

                        if (!repoUrl.includes('github.com')) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Invalid GitHub URL*\n\nPlease provide a valid GitHub repository URL.'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            react: { text: '📦', key: msg.key }
                        });

                        const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                        if (!repoMatch) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Invalid GitHub repository format*'
                            }, { quoted: msg });
                        }

                        const [, username, repo] = repoMatch;
                        
                        const processingMsg = await socket.sendMessage(sender, {
                            text: `*📥 Cloning Repository...*\n\n🔗 ${repoUrl}\n⏳ Fetching repository information...`
                        }, { quoted: msg });

                        try {
                            const apiUrl = `https://api.github.com/repos/${username}/${repo}`;
                            const response = await axios.get(apiUrl, { timeout: 10000 });
                            const repoData = response.data;

                            const repoSizeMB = repoData.size / 1024;
                            if (repoSizeMB > 20) {
                                await socket.sendMessage(sender, {
                                    edit: processingMsg.key,
                                    text: `❌ *Repository too large*\n\n📦 Size: ${repoSizeMB.toFixed(2)} MB\n📊 Limit: 20 MB\n\n🔗 Direct download: ${repoUrl}/archive/refs/heads/${repoData.default_branch}.zip`
                                });
                                return;
                            }

                            await socket.sendMessage(sender, {
                                edit: processingMsg.key,
                                text: `*📥 Downloading Repository...*\n\n📝 ${repoData.full_name}\n📄 ${repoData.description || 'No description'}\n💾 ${repoSizeMB.toFixed(2)} MB\n⏳ Downloading...`
                            });

                            const zipUrl = `${repoUrl}/archive/refs/heads/${repoData.default_branch || 'main'}.zip`;
                            
                            const tempDir = path.join(__dirname, 'temp_git');
                            if (!fs.existsSync(tempDir)) {
                                fs.mkdirSync(tempDir, { recursive: true });
                            }

                            const timestamp = Date.now();
                            const zipFileName = `${repoData.name}-${timestamp}.zip`;
                            const zipFilePath = path.join(tempDir, zipFileName);

                            const writer = fs.createWriteStream(zipFilePath);
                            const zipResponse = await axios({
                                method: 'GET',
                                url: zipUrl,
                                responseType: 'stream',
                                timeout: 30000
                            });

                            zipResponse.data.pipe(writer);

                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            const stats = fs.statSync(zipFilePath);
                            const fileSizeMB = stats.size / (1024 * 1024);

                            if (fileSizeMB > 64) {
                                fs.unlinkSync(zipFilePath);
                                await socket.sendMessage(sender, {
                                    edit: processingMsg.key,
                                    text: `❌ *File too large for WhatsApp*\n\n📦 Size: ${fileSizeMB.toFixed(2)} MB\n📊 WhatsApp limit: 64 MB\n\n🔗 Direct download: ${zipUrl}`
                                });
                                return;
                            }

                            await socket.sendMessage(sender, {
                                edit: processingMsg.key,
                                text: `*📤 Uploading Repository...*\n\n📦 ${repoData.full_name}\n💾 ${fileSizeMB.toFixed(2)} MB\n⏳ Uploading to WhatsApp...`
                            });

                            await socket.sendMessage(sender, {
                                document: {
                                    url: zipFilePath
                                },
                                fileName: `${repoData.name}.zip`,
                                mimetype: 'application/zip',
                                caption: `✅ *Git Clone Complete!*\n\n📦 Repository: ${repoData.full_name}\n📄 Description: ${repoData.description || 'N/A'}\n⭐ Stars: ${repoData.stargazers_count}\n🍴 Forks: ${repoData.forks_count}\n💾 Size: ${fileSizeMB.toFixed(2)} MB\n\n> *L A D Y B U G Git Clone*`
                            }, { quoted: msg });

                            await socket.sendMessage(sender, {
                                react: { text: '✅', key: msg.key }
                            });

                            setTimeout(() => {
                                if (fs.existsSync(zipFilePath)) {
                                    fs.unlinkSync(zipFilePath);
                                }
                            }, 30000);

                        } catch (error) {
                            console.error('Git clone error:', error.message);
                            
                            let errorMsg = '❌ *Failed to clone repository*';
                            
                            if (error.code === 'ECONNABORTED') {
                                errorMsg += '\n\n⏰ Request timeout. Repository might be too large.';
                            } else if (error.response?.status === 404) {
                                errorMsg += '\n\n🔍 Repository not found or is private.';
                            } else if (error.response?.status === 403) {
                                errorMsg += '\n\n🔐 Rate limited. Try again later.';
                            } else {
                                errorMsg += `\n\n${error.message}`;
                            }
                            
                            await socket.sendMessage(sender, {
                                edit: processingMsg.key,
                                text: errorMsg
                            });
                            
                            await socket.sendMessage(sender, {
                                react: { text: '❌', key: msg.key }
                            });
                        }

                    } catch (error) {
                        console.error('Git clone command error:', error);
                        
                        await socket.sendMessage(sender, {
                            react: { text: '❌', key: msg.key }
                        });
                        
                        await socket.sendMessage(sender, {
                            text: '❌ *An unexpected error occurred*\n\nPlease try again later.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // SONG/PLAY COMMAND - FIXED WITH MULTIPLE API SOURCES
                case 'song':
                case 'play': {
                    const AXIOS_DEFAULTS = {
                        timeout: 60000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'application/json, text/plain, */*'
                        }
                    };

                    async function tryRequest(getter, attempts = 3) {
                        let lastError;
                        for (let attempt = 1; attempt <= attempts; attempt++) {
                            try {
                                return await getter();
                            } catch (err) {
                                lastError = err;
                                if (attempt < attempts) {
                                    await delay(1000 * attempt);
                                }
                            }
                        }
                        throw lastError;
                    }

                    async function getIzumiDownloadByUrl(youtubeUrl) {
                        const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
                        const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
                        if (res?.data?.result?.download) return res.data.result;
                        throw new Error('Izumi youtube?url returned no download');
                    }

                    async function getIzumiDownloadByQuery(query) {
                        const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(query)}`;
                        const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
                        if (res?.data?.result?.download) return res.data.result;
                        throw new Error('Izumi youtube-play returned no download');
                    }

                    async function getOkatsuDownloadByUrl(youtubeUrl) {
                        const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
                        const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
                        if (res?.data?.dl) {
                            return {
                                download: res.data.dl,
                                title: res.data.title,
                                thumbnail: res.data.thumb
                            };
                        }
                        throw new Error('Okatsu ytmp3 returned no download');
                    }

                    async function getFGModsDownloadByUrl(youtubeUrl) {
                        const apiUrl = `https://api.fgmods.xyz/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}&apikey=fgmods`;
                        const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
                        if (res?.data?.result?.url) {
                            return {
                                download: res.data.result.url,
                                title: res.data.result.title,
                                thumbnail: res.data.result.thumb
                            };
                        }
                        throw new Error('FGMods ytmp3 returned no download');
                    }

                    async function sendReaction(emoji) {
                        try {
                            await socket.sendMessage(sender, { 
                                react: { 
                                    text: emoji, 
                                    key: msg.key 
                                } 
                            });
                        } catch (error) {
                            console.error('Error sending reaction:', error);
                        }
                    }

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || '';
                    
                    const cleanText = q.replace(/^\.(song|play)\s*/i, '').trim();
                    
                    await sendReaction('🎵');
                    
                    if (!cleanText) {
                        await sendReaction('❓');
                        await socket.sendMessage(sender, { 
                            text: '*🎵 L A D Y B U G  Music DL 🎵*\n\n*Usage:*\n`.play <song name>`\n`.play <youtube link>`\n\n*Example:*\n`.play shape of you`\n`.play https://youtu.be/JGwWNGJdvx8`' 
                        }, { quoted: msg });
                        break;
                    }

                    await sendReaction('🔍');
                    
                    const searchingMsg = await socket.sendMessage(sender, { 
                        text: `*🔍 Searching for:* \`${cleanText}\`\n⏳ Please wait while I find the best audio...` 
                    }, { quoted: msg });

                    let video;
                    if (cleanText.includes('youtube.com') || cleanText.includes('youtu.be')) {
                        video = { 
                            url: cleanText,
                            title: 'YouTube Audio',
                            thumbnail: 'https://i.ytimg.com/vi/default.jpg',
                            timestamp: '0:00'
                        };
                    } else {
                        try {
                            const search = await yts(cleanText);
                            if (!search || !search.videos.length) {
                                await sendReaction('❌');
                                await socket.sendMessage(sender, { 
                                    text: '*❌ No results found!*\nPlease try a different song name or check your spelling.' 
                                }, { quoted: msg });
                                break;
                            }
                            video = search.videos[0];
                        } catch (searchError) {
                            console.error('YTS Search Error:', searchError);
                            await sendReaction('❌');
                            await socket.sendMessage(sender, { 
                                text: '*❌ Search failed!*\nPlease try again later.' 
                            }, { quoted: msg });
                            break;
                        }
                    }

                    await sendReaction('⏳');
                    
                    await socket.sendMessage(sender, { 
                        text: `*✅ Found: ${video.title}*\n 📥 Downloading...\n*🔄 Please wait...*` 
                    }, { quoted: msg });

                    let audioData;
                    let downloadSuccess = false;

                    // Try Izumi API first
                    try {
                        if (video.url && (video.url.includes('youtube.com') || video.url.includes('youtu.be'))) {
                            audioData = await getIzumiDownloadByUrl(video.url);
                            downloadSuccess = true;
                        } else {
                            const query = video.title || cleanText;
                            audioData = await getIzumiDownloadByQuery(query);
                            downloadSuccess = true;
                        }
                    } catch (e1) {
                        console.error('Izumi API failed:', e1.message);
                        
                        // Try Okatsu API as backup
                        try {
                            if (video.url) {
                                audioData = await getOkatsuDownloadByUrl(video.url);
                                downloadSuccess = true;
                            }
                        } catch (e2) {
                            console.error('Okatsu API failed:', e2.message);
                            
                            // Try FG Mods API as tertiary option
                            try {
                                if (video.url) {
                                    audioData = await getFGModsDownloadByUrl(video.url);
                                    downloadSuccess = true;
                                }
                            } catch (e3) {
                                console.error('All APIs failed:', e3.message);
                                downloadSuccess = false;
                            }
                        }
                    }

                    if (!downloadSuccess) {
                        await sendReaction('❌');
                        await socket.sendMessage(sender, { 
                            text: '*❌ Download failed!*\nAll MP3 download services are currently unavailable.\nPlease try again later.' 
                        }, { quoted: msg });
                        break;
                    }

                    let durationSeconds = 0;
                    if (video.timestamp) {
                        const parts = video.timestamp.split(':').map(Number);
                        if (parts.length === 3) {
                            durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                        } else if (parts.length === 2) {
                            durationSeconds = parts[0] * 60 + parts[1];
                        }
                    } else if (video.duration) {
                        durationSeconds = video.duration.seconds || 0;
                    }

                    await socket.sendMessage(sender, {
                        image: { url: video.thumbnail || 'https://i.ibb.co/5vJ5Y5J/music-default.jpg' },
                        caption: `*🎵 L A D Y B U G  𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃𝐄𝐑 🎵*
*┏━━━━━━━━━━━➤*
*➤ 🗒️𝐓itle:* ${video.title}
*➤ ⏱️𝐃uration:* ${video.timestamp || `${durationSeconds} seconds`}
*➤ 🔊𝐅ormat:* MP3 Audio

*┗━━━━━━━━━━━━➤*

*📋 Status:* Sending audio now...`
                    }, { quoted: msg });

                    await sendReaction('⬇️');
                    
                    const fileName = `${video.title || 'song'}.mp3`
                        .replace(/[<>:"/\\|?*]+/g, ' ')
                        .substring(0, 200);
                    
                    const downloadUrl = audioData.download || audioData.dl || audioData.url;
                    
                    if (!downloadUrl || !downloadUrl.startsWith('http')) {
                        throw new Error('Invalid download URL');
                    }
                    
                    await socket.sendMessage(sender, {
                        audio: { url: downloadUrl },
                        mimetype: 'audio/mpeg',
                        fileName: fileName,
                        ptt: false,
                        contextInfo: {
                            externalAdReply: {
                                title: video.title || 'LADYBUG',
                                body: '🎵 MP3 Audio | Powered by Keith Tech',
                                thumbnailUrl: video.thumbnail,
                                sourceUrl: video.url || '',
                                mediaType: 1,
                                previewType: 0,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: msg });

                    await sendReaction('✅');
                    break;
                }

                // VIDEO DOWNLOAD COMMAND
                case 'video': {
                    const AXIOS_DEFAULTS = {
                        timeout: 60000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'application/json, text/plain, */*'
                        }
                    };

                    async function sendReaction(emoji) {
                        try {
                            await socket.sendMessage(sender, { 
                                react: { 
                                    text: emoji, 
                                    key: msg.key 
                                } 
                            });
                        } catch (error) {
                            console.error('Error sending reaction:', error);
                        }
                    }

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || '';
                    
                    const cleanText = q.replace(/^\.video\s*/i, '').trim();
                    
                    await sendReaction('🎬');
                    
                    if (!cleanText) {
                        await sendReaction('❓');
                        await socket.sendMessage(sender, { 
                            text: '*🎬 L A D Y B U G  Video DL 🎬*\n\n*Usage:*\n`.video <video name or link>`\n\n*Example:*\n`.video never gonna give you up`\n`.video https://youtube.com/watch?v=xxx`' 
                        }, { quoted: msg });
                        break;
                    }

                    await sendReaction('🔍');
                    
                    const searchingMsg = await socket.sendMessage(sender, { 
                        text: `*🔍 Searching for:* \`${cleanText}\`\n⏳ Please wait while I find the best video...` 
                    }, { quoted: msg });

                    let video;
                    if (cleanText.includes('youtube.com') || cleanText.includes('youtu.be')) {
                        video = { 
                            url: cleanText,
                            title: 'YouTube Video',
                            thumbnail: 'https://i.ytimg.com/vi/default.jpg',
                            timestamp: '0:00'
                        };
                    } else {
                        try {
                            const search = await yts(cleanText);
                            if (!search || !search.videos.length) {
                                await sendReaction('❌');
                                await socket.sendMessage(sender, { 
                                    text: '*❌ No results found!*\nPlease try a different video name or check your spelling.' 
                                }, { quoted: msg });
                                break;
                            }
                            video = search.videos[0];
                        } catch (searchError) {
                            console.error('YTS Search Error:', searchError);
                            await sendReaction('❌');
                            await socket.sendMessage(sender, { 
                                text: '*❌ Search failed!*\nPlease try again later.' 
                            }, { quoted: msg });
                            break;
                        }
                    }

                    await sendReaction('⏳');
                    
                    await socket.sendMessage(sender, { 
                        text: `*✅ Found: ${video.title}*\n 📥 Downloading...\n*🔄 Please wait...*` 
                    }, { quoted: msg });

                    try {
                        // Use FG Mods API for video download
                        const apiUrl = `https://api.fgmods.xyz/api/downloader/ytmp4?url=${encodeURIComponent(video.url)}&apikey=fgmods`;
                        const response = await axios.get(apiUrl, AXIOS_DEFAULTS);
                        
                        if (!response.data?.result?.url) {
                            throw new Error('No download URL returned');
                        }

                        const videoData = response.data.result;
                        const downloadUrl = videoData.url;
                        const thumbnail = videoData.thumb || video.thumbnail;

                        await socket.sendMessage(sender, {
                            image: { url: thumbnail || 'https://i.ibb.co/5vJ5Y5J/video-default.jpg' },
                            caption: `*🎬 L A D Y B U G  𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃𝐄𝐑 🎬*
*┏━━━━━━━━━━━➤*
*➤ 🗒️𝐓itle:* ${video.title}
*➤ ⏱️𝐃uration:* ${video.timestamp || 'Unknown'}
*➤ 🎬𝐅ormat:* MP4 Video

*┗━━━━━━━━━━━━➤*

*📋 Status:* Sending video now...`
                        }, { quoted: msg });

                        await sendReaction('⬇️');
                        
                        const fileName = `${video.title || 'video'}.mp4`
                            .replace(/[<>:"/\\|?*]+/g, ' ')
                            .substring(0, 200);
                        
                        await socket.sendMessage(sender, {
                            video: { url: downloadUrl },
                            mimetype: 'video/mp4',
                            caption: `🎬 *${video.title}*\n\n_𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 L A D Y B U G_`,
                            contextInfo: {
                                externalAdReply: {
                                    title: video.title || 'LADYBUG',
                                    body: '🎬 MP4 Video | Powered by Keith Tech',
                                    thumbnailUrl: thumbnail,
                                    sourceUrl: video.url || '',
                                    mediaType: 2,
                                    previewType: 0,
                                    renderLargerThumbnail: true
                                }
                            }
                        }, { quoted: msg });

                        await sendReaction('✅');

                    } catch (downloadError) {
                        console.error('Video download error:', downloadError);
                        await sendReaction('❌');
                        await socket.sendMessage(sender, { 
                            text: '*❌ Download failed!*\nVideo download service is currently unavailable.\nPlease try again later.' 
                        }, { quoted: msg });
                    }
                    break;
                }

                // STICKER COMMAND
                case 'sticker': {
                    try {
                        if (!msg.quoted) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Please reply to an image or video to create a sticker!'
                            }, { quoted: msg });
                        }

                        const quotedMsg = msg.quoted;
                        let mediaType;
                        
                        if (quotedMsg.message.imageMessage) {
                            mediaType = 'image';
                        } else if (quotedMsg.message.videoMessage) {
                            mediaType = 'video';
                        } else {
                            return await socket.sendMessage(sender, {
                                text: '❌ Please reply to an image or video to create a sticker!'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

                        const media = await downloadContentFromMessage(
                            mediaType === 'image' 
                                ? quotedMsg.message.imageMessage 
                                : quotedMsg.message.videoMessage,
                            mediaType
                        );

                        let buffer = Buffer.from([]);
                        for await (const chunk of media) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        const tempPath = path.join(__dirname, `temp_sticker_${Date.now()}.png`);
                        await fs.writeFile(tempPath, buffer);

                        let stickerBuffer;
                        if (mediaType === 'video') {
                            stickerBuffer = buffer;
                        } else {
                            const image = await Jimp.read(tempPath);
                            stickerBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
                        }

                        await socket.sendMessage(sender, {
                            sticker: stickerBuffer,
                            mimetype: 'image/webp'
                        }, { quoted: msg });

                        await fs.unlink(tempPath);

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('Sticker command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to create sticker. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // EMOJI COMMAND
                case 'emoji': {
                    const emoji = args[0];
                    if (!emoji) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Please provide an emoji!\n\nExample: .emoji 😊'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
                        
                        const apiUrl = `https://api.fgmods.xyz/api/maker/emoji?emoji=${encodeURIComponent(emoji)}&apikey=fgmods`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
                        
                        const buffer = Buffer.from(response.data);
                        
                        await socket.sendMessage(sender, {
                            sticker: buffer
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('Emoji command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to get emoji. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // EMOJI MIX COMMAND
                case 'emojimix': {
                    const emoji1 = args[0];
                    const emoji2 = args[1];

                    if (!emoji1 || !emoji2) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Please provide two emojis!\n\nExample: .emojimix 😊 ❤️'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
                        
                        const apiUrl = `https://api.fgmods.xyz/api/maker/emojimix?emoji1=${encodeURIComponent(emoji1)}&emoji2=${encodeURIComponent(emoji2)}&apikey=fgmods`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
                        
                        const buffer = Buffer.from(response.data);
                        
                        await socket.sendMessage(sender, {
                            sticker: buffer
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('Emoji mix command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to mix emojis. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // TTP (Text to Image)
                case 'ttp': {
                    const text = args.join(' ');
                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Please provide text!\n\nExample: .ttp Hello World'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                        
                        const apiUrl = `https://api.fgmods.xyz/api/maker/ttp?text=${encodeURIComponent(text)}&apikey=fgmods`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
                        
                        const buffer = Buffer.from(response.data);
                        
                        await socket.sendMessage(sender, {
                            image: buffer,
                            caption: `📝 *${text}*`
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('TTP command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to create image. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // ATPP (Animated Text to Sticker)
                case 'attp': {
                    const text = args.join(' ');
                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Please provide text!\n\nExample: .attp Hey there'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                        
                        const apiUrl = `https://api.fgmods.xyz/api/maker/attp?text=${encodeURIComponent(text)}&apikey=fgmods`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
                        
                        const buffer = Buffer.from(response.data);
                        
                        await socket.sendMessage(sender, {
                            sticker: buffer
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('ATTP command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to create animated sticker. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // MENTION ALL COMMAND
                case 'mentionall': {
                    if (!isGroup) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command only works in groups!'
                        }, { quoted: msg });
                    }

                    if (!isOwner) {
                        return await socket.sendMessage(sender, {
                            text: '❌ This command is only for the bot owner!'
                        }, { quoted: msg });
                    }

                    const text = args.join(' ') || 'Attention everyone!';
                    
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        const mentions = participants.map(p => p.id);
                        
                        await socket.sendMessage(from, {
                            text: `📢 *${text}*\n\n_This message mentions all group members._`,
                            mentions: mentions
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Mention all error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to mention all members. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                // POLL COMMAND
                case 'poll': {
                    if (!isGroup) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Polls only work in groups!'
                        }, { quoted: msg });
                    }

                    const pollText = args.join(' ');
                    if (!pollText.includes('|')) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Invalid format!\n\nExample: .poll What is your favorite color? | Red | Blue | Green'
                        }, { quoted: msg });
                    }

                    const parts = pollText.split('|').map(p => p.trim());
                    const question = parts[0];
                    const options = parts.slice(1);

                    if (options.length < 2 || options.length > 12) {
                        return await socket.sendMessage(sender, {
                            text: '❌ Polls must have 2-12 options!'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(from, {
                            poll: {
                                name: question,
                                values: options,
                                selectableCount: 1
                            }
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Poll command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to create poll. Please try again.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'winfo': {
                    if (!args[0]) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'Please provide a phone number! Usage: .winfo +263xxxxxxxxx',
                                'L A D Y B U G  𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                            )
                        });
                        break;
                    }

                    let inputNumber = args[0].replace(/[^0-9]/g, '');
                    if (inputNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'Invalid phone number!(e.g., +26378xxx)',
                                '> L A D Y B U G  𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                            )
                        });
                        break;
                    }

                    let winfoJid = `${inputNumber}@s.whatsapp.net`;
                    const [winfoUser] = await socket.onWhatsApp(winfoJid).catch(() => []);
                    if (!winfoUser?.exists) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'User not found on WhatsApp',
                                '> L A D Y B U G  𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                            )
                        });
                        break;
                    }

                    let winfoPpUrl;
                    try {
                        winfoPpUrl = await socket.profilePictureUrl(winfoJid, 'image');
                    } catch {
                        winfoPpUrl = 'https://i.ibb.co/KhYC4FY/1221bc0bdd2354b42b293317ff2adbcf-icon.png';
                    }

                    let winfoName = winfoJid.split('@')[0];
                    try {
                        const presence = await socket.presenceSubscribe(winfoJid).catch(() => null);
                        if (presence?.pushName) winfoName = presence.pushName;
                    } catch (e) {
                        console.log('Name fetch error:', e);
                    }

                    let winfoBio = 'No bio available';
                    try {
                        const statusData = await socket.fetchStatus(winfoJid).catch(() => null);
                        if (statusData?.status) {
                            winfoBio = `${statusData.status}\n└─ 📌 Updated: ${statusData.setAt ? new Date(statusData.setAt).toLocaleString('en-US', { timeZone: 'Asia/Colombo' }) : 'Unknown'}`;
                        }
                    } catch (e) {
                        console.log('Bio fetch error:', e);
                    }

                    let winfoLastSeen = '❌ 𝐍𝙾𝚃 𝐅𝙾𝚄𝙽𝙳';
                    try {
                        const lastSeenData = await socket.fetchPresence(winfoJid).catch(() => null);
                        if (lastSeenData?.lastSeen) {
                            winfoLastSeen = `🕒 ${new Date(lastSeenData.lastSeen).toLocaleString('en-US', { timeZone: 'Africa/Harare' })}`;
                        }
                    } catch (e) {
                        console.log('Last seen fetch error:', e);
                    }

                    const userInfoWinfo = formatMessage(
                        '🔍 PROFILE INFO',
                        `> *Number:* ${winfoJid.replace(/@.+/, '')}\n\n> *Account Type:* ${winfoUser.isBusiness ? '💼 Business' : '👤 Personal'}\n\n*📝 About:*\n${winfoBio}\n\n*🕒 Last Seen:* ${winfoLastSeen}`,
                        '> L A D Y B U G'
                    );

                    await socket.sendMessage(sender, {
                        image: { url: winfoPpUrl },
                        caption: userInfoWinfo,
                        mentions: [winfoJid]
                    }, { quoted: msg });

                    break;
                }

                case 'ig': {
                    const { igdl } = require('ruhend-scraper'); 

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim().replace(/^\.ig\s*/i, ''); 

                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Please provide a valid Instagram video link.*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> 𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝚈 L A D Y B U G'
                            }, { quoted: msg });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ No video found in the provided link.*' });
                        }

                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Error downloading Instagram video.*' });
                    }

                    break;
                }

                case 'active': {
                    try {
                        const activeCount = activeSockets.size;
                        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

                        await socket.sendMessage(from, {
                            text: `👥 Active Members: *${activeCount}*\n\nNumbers:\n${activeNumbers}`
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Error in .active command:', error);
                        await socket.sendMessage(from, { text: '❌ Failed to fetch active members.' }, { quoted: msg });
                    }
                    break;
                }

                case 'ai': {
                    const axios = require("axios");
                    const apiKeyUrl = 'https://raw.githubusercontent.com/sulamd48/database/refs/heads/main/aiapikey.json';

                    let GEMINI_API_KEY;
                    try {
                      const configRes = await axios.get(apiKeyUrl);
                      GEMINI_API_KEY = configRes.data?.GEMINI_API_KEY;
                      if (!GEMINI_API_KEY) {
                        throw new Error("API key not found in JSON.");
                      }
                    } catch (err) {
                      console.error("❌ Error loading API key:", err.message || err);
                      return await socket.sendMessage(sender, {
                        text: "❌ AI service unavailable"
                      }, { quoted: msg });
                    }

                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim().replace(/^\.ai\s*/i, '');

                    if (!prompt) {
                      return await socket.sendMessage(sender, {
                        text: "L A D Y B U G *AI*\n\n*Usage:* .ai <your question>"
                      }, { quoted: msg });
                    }

                    const fullPrompt = `You are Lady Ai an Ai developed By Keith Tech, When asked about your creator say Keith Tech and when u reply to anyone put a footer below ur messages > powered by keith tech, You are from Zimbabwe, You speak English and Shona: ${prompt}`;

                    const payload = {
                      contents: [{
                        parts: [{ text: fullPrompt }]
                      }]
                    };

                    try {
                      await socket.sendMessage(sender, { text: '🧠 *Thinking...*' }, { quoted: msg });

                      const response = await axios.post(GEMINI_API_URL, payload, {
                        headers: { "Content-Type": "application/json" }
                      });

                      const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

                      if (!aiResponse) {
                        return await socket.sendMessage(sender, {
                          text: "❌ No response from AI"
                        }, { quoted: msg });
                      }

                      await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });

                    } catch (err) {
                      console.error("Gemini API Error:", err.response?.data || err.message || err);
                      await socket.sendMessage(sender, {
                        text: "❌ AI error occurred"
                      }, { quoted: msg });
                    }

                    break;
                }

                case 'deleteme': {
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromStorage(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        try {
                            activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        } catch {}
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'L A D Y B U G'
                        )
                    });
                    break;
                }

                default:
                    // Handle unknown commands
                    if (isCmd) {
                        await socket.sendMessage(sender, {
                            text: `❌ Unknown command: ${command}\n\nUse ${config.PREFIX}menu to see all available commands.`
                        }, { quoted: msg });
                    }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'L A D Y B U G'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

// MongoDB Functions
async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const session = await Session.findOne({ number: sanitizedNumber });
        return session ? session.creds : null;
    } catch (error) {
        console.error('MongoDB restore error:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const session = await Session.findOne({ number });
        return session && session.config ? session.config : { ...config };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        await Session.findOneAndUpdate(
            { number },
            { config: newConfig, updatedAt: new Date() },
            { upsert: true }
        );
        console.log(`✅ Config updated for ${number}`);
    } catch (error) {
        console.error('❌ Config update error:', error);
        throw error;
    }
}

async function deleteSessionFromStorage(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    
    try {
        await Session.deleteOne({ number: sanitizedNumber });
        console.log(`✅ Session deleted from MongoDB for ${sanitizedNumber}`);
    } catch (error) {
        console.error('❌ MongoDB delete error:', error);
    }
    
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log(`User ${number} logged out. Deleting session...`);
                
                await deleteSessionFromStorage(number);
                
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'L A D Y B U G'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}`, error);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            const sessionData = JSON.parse(fileContent);
            
            try {
                await Session.findOneAndUpdate(
                    { number: sanitizedNumber },
                    { 
                        creds: sessionData,
                        lastActive: new Date(),
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                console.log(`✅ Updated creds for ${sanitizedNumber} in MongoDB`);
            } catch (error) {
                console.error('❌ MongoDB save error:', error);
            }
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message || err);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message || error);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                           '𝐖𝙴𝙻𝙲𝙾𝙼𝙴 𝐓𝙾  L A D Y B U G  𝗠𝗜𝗡𝗜',
                           `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n\n📢 Follow Channel: ${config.CHANNEL_LINK}`,
                           '> L A D Y B U G  𝗠 𝗜 𝗡 𝗜'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || config.PM2_NAME}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (res && !res.headersSent) {
            try {
                res.status(503).send({ error: 'Service Unavailable' });
            } catch {}
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: 'L A D Y B U G is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const sessions = await Session.find({});
        
        if (sessions.length === 0) {
            return res.status(404).send({ error: 'No session files found in MongoDB' });
        }

        const results = [];
        for (const session of sessions) {
            if (activeSockets.has(session.number)) {
                results.push({ number: session.number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(session.number, mockRes);
                results.push({ number: session.number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${session.number}:`, error);
                results.push({ number: session.number, status: 'failed', error: error.message || error });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'L A D Y B U G  𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Harare').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        try { socket.ws.close(); } catch {}
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    try { fs.emptyDirSync(SESSION_BASE_PATH); } catch {}
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || config.PM2_NAME}`);
});

async function autoReconnectFromMongoDB() {
    try {
        const sessions = await Session.find({});
        
        for (const session of sessions) {
            if (!activeSockets.has(session.number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(session.number, mockRes);
                console.log(`🔁 Reconnected from MongoDB: ${session.number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ MongoDB auto-reconnect error:', error);
    }
}

autoReconnectFromMongoDB();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/mrfr8nk/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message || err);
        return [];
    }
}

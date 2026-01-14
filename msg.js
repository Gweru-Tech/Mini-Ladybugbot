const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Supported media types mapping
const MEDIA_TYPES = {
    imageMessage: { extension: 'jpg', type: 'image' },
    videoMessage: { extension: 'mp4', type: 'video' },
    audioMessage: { extension: 'mp3', type: 'audio' },
    stickerMessage: { extension: 'webp', type: 'sticker' },
    documentMessage: { extension: null, type: 'document' }
};

/**
 * Download media message to buffer
 * @param {Object} m - Message object
 * @param {string} filename - Optional filename (without extension)
 * @returns {Promise<Buffer>} - File buffer
 */
const downloadMediaMessage = async (m, filename = 'undefined') => {
    try {
        // Handle viewOnce messages
        if (m.type === 'viewOnceMessage') {
            m.type = m.msg.type;
        }

        const mediaType = MEDIA_TYPES[m.type];
        if (!mediaType) {
            throw new Error(`Unsupported media type: ${m.type}`);
        }

        // Determine file extension
        let extension = mediaType.extension;
        if (m.type === 'documentMessage') {
            const originalExt = m.msg.fileName?.split('.').pop()?.toLowerCase() || 'bin';
            extension = originalExt.replace('jpeg', 'jpg').replace('png', 'jpg').replace('m4a', 'mp3');
        }

        const fileName = `${filename}.${extension}`;
        
        // Download content
        const stream = await downloadContentFromMessage(m.msg, mediaType.type);
        let buffer = Buffer.alloc(0);
        
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Save to file (optional - remove if you only need buffer)
        fs.writeFileSync(fileName, buffer);
        
        return buffer;
    } catch (error) {
        console.error('Error downloading media:', error);
        throw error;
    }
};

/**
 * Download media message to a specified directory
 * @param {Object} m - Message object
 * @param {string} dirPath - Directory path
 * @param {string} filename - Optional filename (without extension)
 * @returns {Promise<string>} - Full file path
 */
const downloadMediaToPath = async (m, dirPath = './downloads', filename = 'undefined') => {
    try {
        const buffer = await downloadMediaMessage(m, 'temp');
        
        // Ensure directory exists
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // Determine file extension
        let extension = MEDIA_TYPES[m.type]?.extension || 'bin';
        if (m.type === 'documentMessage') {
            const originalExt = m.msg.fileName?.split('.').pop()?.toLowerCase() || 'bin';
            extension = originalExt.replace('jpeg', 'jpg').replace('png', 'jpg').replace('m4a', 'mp3');
        }

        const fileName = `${filename}_${Date.now()}.${extension}`;
        const filePath = path.join(dirPath, fileName);
        
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (error) {
        console.error('Error downloading media to path:', error);
        throw error;
    }
};

/**
 * Process and enhance WhatsApp message object
 * @param {Object} conn - WhatsApp connection object
 * @param {Object} m - Raw message object
 * @returns {Object} - Enhanced message object
 */
const sms = (conn, m) => {
    // Basic message properties
    if (m.key) {
        m.id = m.key.id;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.fromMe 
            ? `${conn.user.id.split(':')[0]}@s.whatsapp.net`
            : m.isGroup 
                ? m.key.participant 
                : m.key.remoteJid;
    }

    // Message content processing
    if (m.message) {
        m.type = getContentType(m.message);
        
        // Handle viewOnce messages
        if (m.type === 'viewOnceMessage') {
            const innerType = getContentType(m.message[m.type].message);
            m.msg = m.message[m.type].message[innerType];
            m.msg.type = innerType;
        } else {
            m.msg = m.message[m.type];
        }

        if (m.msg) {
            // Process mentions
            const quotedMention = m.msg.contextInfo?.participant || '';
            const tagMention = m.msg.contextInfo?.mentionedJid || [];
            const mention = typeof tagMention === 'string' ? [tagMention] : tagMention;
            if (quotedMention) mention.push(quotedMention);
            m.mentionUser = mention.filter(Boolean);

            // Extract message body/text
            m.body = extractMessageBody(m);

            // Process quoted message
            processQuotedMessage(conn, m);
            
            // Add download method
            m.download = (filename) => downloadMediaMessage(m, filename);
            m.downloadToPath = (dirPath, filename) => downloadMediaToPath(m, dirPath, filename);
        }
    }

    // Add reply methods
    addReplyMethods(conn, m);

    return m;
};

/**
 * Extract message body/text from different message types
 * @param {Object} m - Message object
 * @returns {string} - Message text/body
 */
function extractMessageBody(m) {
    switch (m.type) {
        case 'conversation':
            return m.msg;
        case 'extendedTextMessage':
            return m.msg.text || '';
        case 'imageMessage':
        case 'videoMessage':
            return m.msg.caption || '';
        case 'templateButtonReplyMessage':
            return m.msg.selectedId || '';
        case 'buttonsResponseMessage':
            return m.msg.selectedButtonId || '';
        default:
            return '';
    }
}

/**
 * Process quoted message and add helper methods
 * @param {Object} conn - WhatsApp connection
 * @param {Object} m - Message object
 */
function processQuotedMessage(conn, m) {
    if (!m.msg.contextInfo?.quotedMessage) return;

    const quoted = m.msg.contextInfo.quotedMessage;
    m.quoted = {
        message: quoted,
        type: getContentType(quoted),
        id: m.msg.contextInfo.stanzaId,
        sender: m.msg.contextInfo.participant,
        fromMe: m.msg.contextInfo.participant?.split('@')[0].includes(conn.user.id.split(':')[0]) || false
    };

    // Handle viewOnce in quoted messages
    if (m.quoted.type === 'viewOnceMessage') {
        const innerType = getContentType(quoted[m.quoted.type].message);
        m.quoted.msg = quoted[m.quoted.type].message[innerType];
        m.quoted.msg.type = innerType;
    } else {
        m.quoted.msg = quoted[m.quoted.type];
    }

    // Process mentions in quoted message
    const quotedMention = m.quoted.msg?.contextInfo?.participant || '';
    const quotedTagMention = m.quoted.msg?.contextInfo?.mentionedJid || [];
    const quotedMentionArray = typeof quotedTagMention === 'string' ? [quotedTagMention] : quotedTagMention;
    if (quotedMention) quotedMentionArray.push(quotedMention);
    m.quoted.mentionUser = quotedMentionArray.filter(Boolean);

    // Create fake object for WhatsApp operations
    m.quoted.fakeObj = proto.WebMessageInfo.fromObject({
        key: {
            remoteJid: m.chat,
            fromMe: m.quoted.fromMe,
            id: m.quoted.id,
            participant: m.quoted.sender
        },
        message: m.quoted.message
    });

    // Add helper methods to quoted message
    m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename);
    m.quoted.downloadToPath = (dirPath, filename) => downloadMediaToPath(m.quoted, dirPath, filename);
    
    m.quoted.delete = () => conn.sendMessage(m.chat, {
        delete: m.quoted.fakeObj.key
    });
    
    m.quoted.react = (emoji) => conn.sendMessage(m.chat, {
        react: {
            text: emoji,
            key: m.quoted.fakeObj.key
        }
    });
    
    m.quoted.reply = (text, options = {}) => conn.sendMessage(m.chat, {
        text,
        contextInfo: {
            mentionedJid: options.mentions || []
        }
    }, { quoted: m.quoted.fakeObj });
}

/**
 * Add reply methods to message object
 * @param {Object} conn - WhatsApp connection
 * @param {Object} m - Message object
 */
function addReplyMethods(conn, m) {
    // Text reply
    m.reply = (text, chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        text,
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Sticker reply
    m.replySticker = (sticker, chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        sticker,
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Image reply
    m.replyImage = (image, caption = '', chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        image,
        caption,
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Video reply
    m.replyVideo = (video, caption = '', chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        video,
        caption,
        gifPlayback: options.gif || false,
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Audio reply
    m.replyAudio = (audio, chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        audio,
        ptt: options.ptt || false,
        mimetype: 'audio/mpeg',
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Document reply
    m.replyDocument = (document, chatId = m.chat, options = {}) => conn.sendMessage(chatId, {
        document,
        mimetype: options.mimetype || 'application/octet-stream',
        fileName: options.filename || 'document',
        contextInfo: {
            mentionedJid: options.mentions || [m.sender]
        }
    }, { quoted: m });

    // Contact reply
    m.replyContact = (name, number, info = '', chatId = m.chat) => {
        const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${name}
ORG:${info}
TEL;type=CELL;type=VOICE;waid=${number}:+${number}
END:VCARD`;
        
        conn.sendMessage(chatId, {
            contacts: {
                displayName: name,
                contacts: [{ vcard }]
            }
        }, { quoted: m });
    };

    // Reaction
    m.react = (emoji) => conn.sendMessage(m.chat, {
        react: {
            text: emoji,
            key: m.key
        }
    });

    // Edit message (if supported)
    m.edit = (newText, chatId = m.chat) => {
        if (m.id) {
            return conn.sendMessage(chatId, {
                text: newText,
                edit: m.key
            });
        }
    };
}

module.exports = {
    sms,
    downloadMediaMessage,
    downloadMediaToPath
};

// ═══════════════════════════════════════════════════════════════
// 🐞 LADYBUG WHATSAPP BOT - FULL VERSION 2.0
// ═══════════════════════════════════════════════════════════════
// Created by: Lord TKM
// Version: 2.0.0
// Total Commands: 80+
// ═══════════════════════════════════════════════════════════════

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    downloadContentFromMessage,
    generateWAMessageFromContent,
    jidNormalizedUser,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const yts = require("yt-search");
const ffmpeg = require("fluent-ffmpeg");
const cheerio = require("cheerio");
const {
    exec
} = require("child_process");
const {
    spawn
} = require("child_process");
const crypto = require("crypto");
const moment = require("moment");
const googleTTS = require('google-tts-api');
const gis = require('g-i-s');

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const config = {
    botName: "LADYBUG",
    ownerName: "Lord TKM",
    ownerNumber: "263775571820",
    prefix: [".", "!"],
    version: "2.0.0",
    sessionName: "ladybug_session"
};

// ═══════════════════════════════════════════════════════════════
// DATABASE (Simple JSON-based)
// ═══════════════════════════════════════════════════════════════

let database = {
    users: {},
    groups: {},
    settings: {
        autobio: false,
        autotyping: false,
        autoread: false,
        anticall: true
    }
};

// Load database from file
if (fs.existsSync("./database.json")) {
    try {
        database = JSON.parse(fs.readFileSync("./database.json", "utf8"));
    } catch (e) {
        console.log("No existing database found, starting fresh");
    }
}

// Save database
function saveDatabase() {
    fs.writeFileSync("./database.json", JSON.stringify(database, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function makeid(length = 10) {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function fetchJson(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        throw error;
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getBuffer(url, options) {
    try {
        options ? options : {};
        const https = require('https');
        const http = require('http');
        return new Promise((resolve, reject) => {
            const mod = url.startsWith('https') ? https : http;
            mod.get(url, (res) => {
                const data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => resolve(Buffer.concat(data)));
            }).on('error', reject);
        });
    } catch (e) {
        console.error(e);
    }
}

function isUrl(url) {
    return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/, 'gi'));
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    const dDisplay = d > 0 ? d + (d == 1 ? " day " : " days ") : "";
    const hDisplay = h > 0 ? h + (h == 1 ? " hour " : " hours ") : "";
    const mDisplay = m > 0 ? m + (m == 1 ? " minute " : " minutes ") : "";
    const sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

// ═══════════════════════════════════════════════════════════════
// MAIN BOT FUNCTION
// ═══════════════════════════════════════════════════════════════

async function startBot() {
    const store = makeInMemoryStore({
        logger: P().child({
            level: "silent",
            stream: "store"
        })
    });

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState("./auth_info_ladybug");
    const {
        version
    } = await fetchLatestBaileysVersion();

    const Ladybug = makeWASocket({
        version,
        logger: P({
            level: "silent"
        }),
        printQRInTerminal: true,
        auth: state,
        browser: ["LADYBUG", "Chrome", "1.0.0"],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return undefined;
        }
    });

    store.bind(Ladybug.ev);

    // Bot startup message
    Ladybug.ev.on('connection.update', async (update) => {
        const {
            connection,
            lastDisconnect
        } = update;

        if (connection === 'close') {
            let reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.badSession) {
                console.log('Bad Session File, Please Delete Session and Scan Again');
                Ladybug.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log('Connection closed, reconnecting...');
                startBot();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log('Connection Lost from Server, reconnecting...');
                startBot();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log('Restart Required, Restarting...');
                startBot();
            } else if (reason === DisconnectReason.timedOut) {
                console.log('Connection TimedOut, Reconnecting...');
                startBot();
            } else {
                console.log(`Unknown DisconnectReason: ${reason}|${connection}`);
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ 🐞 LADYBUG Bot Connected Successfully!');
            console.log(`📱 Bot Number: ${Ladybug.user.id.split(':')[0]}`);
            console.log(`👤 Owner: ${config.ownerName}`);
            console.log(`🎉 Version: ${config.version}`);
            
            // Send welcome message to owner
            await Ladybug.sendMessage(`${config.ownerNumber}@s.whatsapp.net`, {
                text: `🐞 *LADYBUG Bot Started Successfully!*\n\n📅 Date: ${moment().format('DD/MM/YYYY')}\n⏰ Time: ${moment().format('HH:mm:ss')}\n📱 Bot: ${Ladybug.user.id.split(':')[0]}\n🎉 Version: ${config.version}\n\n🐞 *Powered by LADYBUG*`
            });
        }
    });

    // Message handler
    Ladybug.ev.on('messages.upsert', async ({
        messages
    }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

            const msgType = Object.keys(m.message)[0];
            const text =
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                m.message?.videoMessage?.caption ||
                "";

            const prefix = config.prefix.find(p => text.startsWith(p));
            if (!prefix) return;

            const command = text.slice(prefix.length).trim().split(" ")[0].toLowerCase();
            const args = text.slice(prefix.length + command.length).trim().split(" ");
            const q = text.slice(prefix.length + command.length).trim();
            const from = m.chat;
            const sender = m.sender;
            const botNumber = Ladybug.user.id.split(':')[0];
            const isOwner = sender.includes(config.ownerNumber) || sender === `${config.ownerNumber}@s.whatsapp.net`;
            const isGroup = from.endsWith('@g.us');
            const groupName = isGroup ? (await Ladybug.groupMetadata(from)).subject : '';
            const groupMembers = isGroup ? (await Ladybug.groupMetadata(from)).participants : [];
            const groupAdmins = isGroup ? groupMembers.filter(v => v.admin !== null).map(v => v.id) : [];
            const isAdmin = groupAdmins.includes(sender);
            const isBotAdmin = groupAdmins.includes(botNumber + '@s.whatsapp.net');
            const pushName = m.pushName || 'User';

            // Initialize user in database
            if (!database.users[sender]) {
                database.users[sender] = {
                    name: pushName,
                    messages: 0,
                    commands: 0,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                };
            }

            database.users[sender].messages++;
            database.users[sender].lastSeen = new Date().toISOString();
            saveDatabase();

            // Helper functions
            const reply = (message) => Ladybug.sendMessage(from, {
                text: message
            }, {
                quoted: m
            });

            const sendImage = (url, caption = '') => Ladybug.sendMessage(from, {
                image: {
                    url
                },
                caption: caption
            }, {
                quoted: m
            });

            const sendVideo = (url, caption = '') => Ladybug.sendMessage(from, {
                video: {
                    url
                },
                caption: caption
            }, {
                quoted: m
            });

            const sendAudio = (url) => Ladybug.sendMessage(from, {
                audio: {
                    url
                },
                mimetype: 'audio/mpeg'
            }, {
                quoted: m
            });

            const sendSticker = (buffer) => Ladybug.sendMessage(from, {
                sticker: buffer
            }, {
                quoted: m
            });

            // ═══════════════════════════════════════════════════════════════
            // COMMAND HANDLER
            // ═══════════════════════════════════════════════════════════════

            database.users[sender].commands++;
            saveDatabase();

            switch (command) {

                // ═══════════════════════════════════════════════════════════════
                // MAIN MENU COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'menu':
                case 'help':
                case 'commands': {
                    const menutext = `
╔══════════════════════════════════╗
║     🐞 LADYBUG BOT 🐞            ║
║      COMMAND MENU v${config.version}     ║
╚══════════════════════════════════╝

📌 *PREFIX:* ${prefix}
👤 *OWNER:* ${config.ownerName}
🎉 *TOTAL COMMANDS:* 80+
📱 *BOT:* ${botNumber}
👥 *USERS:* ${Object.keys(database.users).length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎵 *MUSIC & MEDIA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}play <song> - Download MP3
▸ ${prefix}video <title> - Download MP4
▸ ${prefix}ytmp3 <url> - YouTube MP3
▸ ${prefix}ytmp4 <url> - YouTube MP4
▸ ${prefix}img <text> - Search images
▸ ${prefix}lyrics <song> - Get lyrics
▸ ${prefix}deepimg <prompt> - AI image
▸ ${prefix}tiktok <url> - TikTok DL
▸ ${prefix}fb <url> - FB Video DL
▸ ${prefix}ig <url> - IG Media DL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 *AI ASSISTANT*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}ai <query> - AI chat
▸ ${prefix}gpt <query> - GPT-3.5
▸ ${prefix}openai <query> - OpenAI
▸ ${prefix}deepseek <query> - Deepseek
▸ ${prefix}gemini <query> - Gemini AI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 *TEXT MAKER (30+ Styles)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}logo <text> - Create logo
▸ ${prefix}metallic <text>
▸ ${prefix}neon <text>
▸ ${prefix}gold <text>
▸ ${prefix}ice <text>
▸ ${prefix}fire <text>
▸ ${prefix}water <text>
▸ ${prefix}sand <text>
▸ ${prefix}matrix <text>
▸ ${prefix}hacker <text>
▸ ${prefix}thunder <text>
▸ ${prefix}devil <text>
▸ ${prefix}angel <text>
▸ ${prefix}dragonball <text>
▸ ${prefix}naruto <text>
▸ ${prefix}graffiti <text>
▸ ${prefix}3d <text>
▸ ${prefix}wood <text>
▸ ${prefix}stone <text>
▸ ${prefix}candy <text>
▸ ${prefix}chrome <text>
▸ ${prefix}glow <text>
▸ ${prefix}sparkle <text>
▸ ${prefix}shadow <text>
▸ ${prefix}pixel <text>
▸ ${prefix}retro <text>
▸ ${prefix}typography <text>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛠️ *UTILITY TOOLS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}sticker - Make sticker
▸ ${prefix}emojimix 😎😈 - Mix emojis
▸ ${prefix}toimg - Sticker to image
▸ ${prefix}tovideo - Sticker to video
▸ ${prefix}tourl - Media to URL
▸ ${prefix}readmore <text|hide> - Readmore
▸ ${prefix}translate <lang> <text>
▸ ${prefix}tts <text> - Text to speech
▸ ${prefix}qc <text> - Quote card
▸ ${prefix}weather <city>
▸ ${prefix}githubstalk <user>
▸ ${prefix}npm <package>
▸ ${prefix}gitclone <link>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *GROUP TOOLS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}kick @user - Kick member
▸ ${prefix}add <num> - Add member
▸ ${prefix}promote @user - Make admin
▸ ${prefix}demote @user - Remove admin
▸ ${prefix}group - Group settings
▸ ${prefix}link - Group link
▸ ${prefix}revoke - Revoke link
▸ ${prefix}tagall - Tag all members
▸ ${prefix}hidetag - Hide tag
▸ ${prefix}poll question|opt1,opt2
▸ ${prefix}vote - Create vote

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ℹ️ *INFORMATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ ${prefix}imdb <movie> - Movie info
▸ ${prefix}wiki <search> - Wikipedia
▸ ${prefix}news - Latest news
▸ ${prefix}crypto - Crypto prices
▸ ${prefix}weather <city>
▸ ${prefix}whois @user - User info
▸ ${prefix}groupinfo - Group info

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 *FUN & GAMES*
━━━━━━━━══════════════════════

▸ ${prefix}truth - Truth question
▸ ${prefix}dare - Dare challenge
▸ ${prefix}rate <text> - Rate something
▸ ${prefix}ship @user1 @user2
▸ ${prefix}couple - Random couple
▸ ${prefix}meme - Random meme
▸ ${prefix}joke - Random joke
▸ ${prefix}quote - Random quote
▸ ${prefix}fact - Random fact
▸ ${prefix}riddle - Random riddle

━━━━━━━━━━━━━━━━━━════════════
🔐 *OWNER COMMANDS*
━━━━━━━━════════════════════━━

▸ ${prefix}setppbot - Change profile pic
▸ ${prefix}setbotname - Change bot name
▸ ${prefix}setbio - Change bot bio
▸ ${prefix}block <num> - Block user
▸ ${prefix}unblock <num> - Unblock user
▸ ${prefix}broadcast <msg> - Broadcast
▸ ${prefix}cleartmp - Clear temp files
▸ ${prefix}restart - Restart bot
▸ ${prefix}shutdown - Shutdown bot

━━━━━━━━━━━━━━━━━━════════━━━━
⚙️ *SETTINGS*
━━━━━━━━══════════════════━━━━

▸ ${prefix}autobio on/off - Auto bio
▸ ${prefix}autotyping on/off - Auto typing
▸ ${prefix}autoread on/off - Auto read
▸ ${prefix}anticall on/off - Anti call

━━━━━━━━━━━━━━━━════════━━━━━━
💡 *USAGE EXAMPLES*
━━━━━━━━━━════════════━━━━━━━━

${prefix}play Despacito
${prefix}ai what is javascript
${prefix}neon Hello World
${prefix}sticker
${prefix}kick @user
${prefix}weather New York

━━━━━━━━━━━━━━━━════════━━━━━━
📞 *CONTACT & SUPPORT*
━━━━━━━━════════════════════━━

👤 *Developer:* ${config.ownerName}
📱 *WhatsApp:* ${config.ownerNumber}
🌐 *Version:* ${config.version}

━━━━━━━━━━━━━━━━══════━━━━━━━━
🐞 *POWERED BY LADYBUG*
━━━━━━━━━━━━══════════════━━━━
`;

                    await Ladybug.sendMessage(from, {
                        text: menutext,
                        contextInfo: {
                            mentionedJid: [sender],
                            forwardingScore: 999,
                            isForwarded: true,
                            externalAdReply: {
                                showAdAttribution: true,
                                title: "🐞 LADYBUG BOT",
                                body: `80+ Premium Commands - 100% FREE | Version ${config.version}`,
                                thumbnailUrl: "https://files.catbox.moe/5bzcdl.jpg",
                                mediaType: 1,
                                renderLargerThumbnail: true,
                                sourceUrl: `https://wa.me/${config.ownerNumber}`
                            }
                        }
                    }, {
                        quoted: m
                    });
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // MUSIC & MEDIA COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'play': {
                    try {
                        if (!q) return reply("What song do you want to download?");

                        let search = await yts(q);
                        if (!search.all.length) {
                            return reply("No results found for your query.");
                        }
                        let link = search.all[0].url;

                        const apis = [
                            `https://api.siputzx.my.id/api/d/ytmp3?url=${link}`,
                            `https://xploader-api.vercel.app/ytmp3?url=${link}`,
                            `https://apis.davidcyriltech.my.id/youtube/mp3?url=${link}`,
                            `https://api.ryzendesu.vip/api/downloader/ytmp3?url=${link}`,
                            `https://api.dreaded.site/api/ytdl/audio?url=${link}`
                        ];

                        for (const api of apis) {
                            try {
                                let data = await fetchJson(api);

                                if (data.status === 200 || data.success || data.result || data.data) {
                                    let videoUrl = data.result?.downloadUrl || data.result?.url || data.url || data.data?.dl;
                                    if (!videoUrl) continue;

                                    await Ladybug.sendMessage(from, {
                                        audio: {
                                            url: videoUrl
                                        },
                                        mimetype: 'audio/mpeg',
                                        fileName: `${search.all[0].title.replace(/[^a-zA-Z0-9 ]/g, "")}.mp3`,
                                        caption: `🎵 *${search.all[0].title}*\n👤 ${search.all[0].author?.name || "Unknown Artist"}\n\n🐞 Downloaded by LADYBUG`,
                                        contextInfo: {
                                            forwardingScore: 100000,
                                            isForwarded: true,
                                            externalAdReply: {
                                                showAdAttribution: false,
                                                containsAutoReply: true,
                                                mediaType: 1,
                                                renderLargerThumbnail: true,
                                                title: search.all[0].title,
                                                body: search.all[0].author?.name || "Unknown Artist",
                                                thumbnailUrl: search.all[0].thumbnail,
                                            }
                                        }
                                    }, {
                                        quoted: m
                                    });
                                    return;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                        reply("An error occurred. All APIs might be down or unable to process the request.");
                    } catch (error) {
                        reply("Download failed\n" + error.message);
                    }
                }
                break;

                case 'video': {
                    try {
                        if (!q) return reply("What video you want to download?");

                        let search = await yts(q);
                        if (!search.all.length) {
                            return reply("No results found for your query.");
                        }
                        let link = search.all[0].url;

                        const apis = [
                            `https://api.siputzx.my.id/api/d/ytmp4?url=${link}`,
                            `https://apis-keith.vercel.app/download/dlmp4?url=${link}`,
                            `https://api.ryzendesu.vip/api/downloader/ytmp4?url=${link}`,
                            `https://xploader-api.vercel.app/ytmp4?url=${link}`
                        ];

                        for (const apiUrl of apis) {
                            try {
                                let data = await fetchJson(apiUrl);

                                if (data.status && (data.result || data.data)) {
                                    await Ladybug.sendMessage(
                                        from, {
                                            video: {
                                                url: data.result?.downloadUrl || data.result?.url || data.data?.dl
                                            },
                                            mimetype: "video/mp4",
                                            caption: `🎬 *${data.result?.title || search.all[0].title}*\n\n🐞 Downloaded by LADYBUG`,
                                            thumbnail: search.all[0].thumbnail
                                        }, {
                                            quoted: m
                                        }
                                    );
                                    return;
                                }
                            } catch (e) {
                                continue;
                            }
                        }

                        reply("Unable to fetch the video. Please try again later.");
                    } catch (error) {
                        reply(`An error occurred: ${error.message}`);
                    }
                }
                break;

                case 'img':
                case 'image':
                case 'images': {
                    if (!q) return reply("Provide a text to search for images");

                    try {
                        gis(q, async (error, results) => {
                            if (error) {
                                return reply("An error occurred while searching for images.\n" + error);
                            }

                            if (results.length === 0) {
                                return reply("No images found.");
                            }

                            const numberOfImages = Math.min(results.length, 5);
                            const imageUrls = results.slice(0, numberOfImages).map(result => result.url);

                            for (const url of imageUrls) {
                                await Ladybug.sendMessage(from, {
                                    image: {
                                        url
                                    },
                                    caption: `🖼️ Search result for: ${q}\n\n🐞 Downloaded by LADYBUG`
                                }, {
                                    quoted: m
                                });
                            }
                        });
                    } catch (e) {
                        reply("An error occurred.\n" + e);
                    }
                }
                break;

                case 'lyrics': {
                    try {
                        if (!q) return reply("Provide a song name!");

                        const apiUrl = `https://api.dreaded.site/api/lyrics?title=${encodeURIComponent(q)}`;
                        const data = await fetchJson(apiUrl);

                        if (!data.success || !data.result || !data.result.lyrics) {
                            return reply(`Sorry, I couldn't find any lyrics for "${q}".`);
                        }

                        const {
                            title,
                            artist,
                            thumb,
                            lyrics
                        } = data.result;
                        const imageUrl = thumb || "https://files.catbox.moe/5bzcdl.jpg";
                        const caption = `🎵 *${title}*\n👤 *Artist: ${artist}*\n\n${lyrics}\n\n🐞 Downloaded by LADYBUG`;

                        await Ladybug.sendMessage(
                            from, {
                                image: {
                                    url: imageUrl
                                },
                                caption: caption
                            }, {
                                quoted: m
                            }
                        );
                    } catch (error) {
                        console.error(error);
                        reply(`An error occurred while fetching the lyrics for "${q}".`);
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // AI ASSISTANT COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'ai':
                case 'ai2': {
                    if (!args.length) {
                        return reply("Please enter a question for AI.\n\nExample: *LADYBUG Who are You?*");
                    }
                    let query = encodeURIComponent(args.join(" "));
                    let apiUrl = `https://www.laurine.site/api/ai/heckai?query=${query}`;
                    try {
                        let response = await fetch(apiUrl);
                        let data = await response.json();
                        if (!data.status || !data.data) {
                            return reply("❌ AI cannot provide an answer.");
                        }
                        reply(`🤖 *AI Response:*\n\n${data.data}\n\n🐞 Powered by LADYBUG`);
                    } catch (error) {
                        console.error(error);
                        reply("❌ An error occurred while accessing AI.");
                    }
                }
                break;

                case 'gpt': {
                    if (!q) return reply(`Example: ${prefix + command} axios`);

                    async function sanzmd(prompt) {
                        const response = await axios({
                            method: "POST",
                            url: "https://chateverywhere.app/api/chat",
                            headers: {
                                "Content-Type": "application/json",
                                "Cookie": "_ga=GA1.1.34196701.1707462626; _ga_ZYMW9SZKVK=GS1.1.1707462625.1.0.1707462625.60.0.0",
                                Origin: "https://chateverywhere.app",
                                Referer: "https://chateverywhere.app/id",
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                            },
                            data: {
                                model: {
                                    id: "gpt-3.5-turbo-0613",
                                    name: "GPT-3.5",
                                    maxLength: 12000,
                                    tokenLimit: 4000,
                                },
                                prompt: prompt,
                                messages: [{
                                    pluginId: null,
                                    content: prompt,
                                    role: "user"
                                }, {
                                    pluginId: null,
                                    content: `You are ${config.botName}, created by ${config.ownerName}.`,
                                    role: "assistant"
                                }]
                            }
                        });
                        return response.data;
                    }

                    try {
                        let result = await sanzmd(q);
                        reply(`${result}\n\n🐞 Powered by LADYBUG`);
                    } catch (error) {
                        reply(error.message);
                    }
                }
                break;

                case 'openai': {
                    let talk = q ? q : "hai";
                    await fetchJson("https://rest-api-v3-beta.vercel.app/ai/openai?text=" + talk).then(async (res) => {
                        reply(res.result + "\n\n🐞 Powered by LADYBUG");
                    }).catch(e => reply(e.toString()));
                }
                break;

                case 'deepseek':
                case 'depsek': {
                    let talk = q ? q : "Hallo Kamu Siapa ?";
                    await fetchJson("https://restapi-v2.simplebot.my.id/ai/deepseek?text=" + talk).then(async (res) => {
                        reply(res.result + "\n\n🐞 Powered by LADYBUG");
                    }).catch(e => reply(e.toString()));
                }
                break;

                case 'gemini': {
                    if (!q) return reply("Provide a question for Gemini AI!");
                    try {
                        const data = await fetchJson(`https://api.bardibm.cloud/api/bard?query=${encodeURIComponent(q)}`);
                        reply(`🤖 *Gemini AI Response:*\n\n${data.result}\n\n🐞 Powered by LADYBUG`);
                    } catch (e) {
                        reply("Error accessing Gemini AI");
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // UTILITY TOOLS
                // ═══════════════════════════════════════════════════════════════

                case 'sticker': {
                    if (!m.quoted) return reply("Reply to an image or video!");
                    try {
                        const media = await m.quoted.download();
                        const stickerPath = `./tmp/${makeid()}.webp`;
                        
                        await new Promise((resolve, reject) => {
                            ffmpeg(media)
                                .input(media)
                                .outputOptions([
                                    "-vcodec", "libwebp",
                                    "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15, pad=320:320:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse"
                                ])
                                .toFormat("webp")
                                .save(stickerPath)
                                .on("end", () => resolve())
                                .on("error", (err) => reject(err));
                        });

                        const stickerBuffer = fs.readFileSync(stickerPath);
                        await sendSticker(stickerBuffer);
                        fs.unlinkSync(stickerPath);
                    } catch (error) {
                        reply("Error creating sticker: " + error.message);
                    }
                }
                break;

                case 'toimg': {
                    if (!m.quoted || !m.quoted.mimetype.includes('webp')) return reply("Reply to a sticker!");
                    try {
                        const media = await m.quoted.download();
                        const imgPath = `./tmp/${makeid()}.png`;
                        fs.writeFileSync(imgPath, media);
                        await sendImage(imgPath, "Here's your image!");
                        fs.unlinkSync(imgPath);
                    } catch (e) {
                        reply("Error converting sticker to image");
                    }
                }
                break;

                case 'tourl': {
                    if (!m.quoted) return reply("Reply to an image or video!");
                    try {
                        const media = await m.quoted.download();
                        const form = new FormData();
                        form.append('file', new Blob([media]));
                        
                        const res = await axios.post('https://telegra.ph/upload', form);
                        reply(`📎 Image URL:\n${res.data[0].src}`);
                    } catch (e) {
                        reply("Error uploading to telegraph");
                    }
                }
                break;

                case 'readmore': {
                    const [text, hidden] = q.split('|');
                    if (!text || !hidden) return reply("Format: .readmore visible|hidden");
                    reply(`${text}𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂𒈂${hidden}`);
                }
                break;

                case 'weather': {
                    try {
                        if (!q) return reply("Provide a city/town name");

                        const response = await fetch(`http://api.openweathermap.org/data/2.5/weather?q=${q}&units=metric&appid=1ad47ec6172f19dfaf89eb3307f74785`);
                        const data = await response.json();

                        if (data.cod !== 200) return reply("City not found!");

                        const cityName = data.name;
                        const temperature = data.main.temp;
                        const feelsLike = data.main.feels_like;
                        const description = data.weather[0].description;
                        const humidity = data.main.humidity;
                        const windSpeed = data.wind.speed;
                        const sunrise = new Date(data.sys.sunrise * 1000);
                        const sunset = new Date(data.sys.sunset * 1000);

                        await reply(`❄️ Weather in ${cityName}

🌡️ Temperature: ${temperature}°C
📝 Description: ${description}
❄️ Humidity: ${humidity}%
🌀 Wind Speed: ${windSpeed} m/s
🌄 Sunrise: ${sunrise.toLocaleTimeString()}
🌅 Sunset: ${sunset.toLocaleTimeString()}

🐞 Powered by LADYBUG`);
                    } catch (e) {
                        reply("Unable to find that location.");
                    }
                }
                break;

                case 'translate':
                case 'trt': {
                    const args = q.split(' ');
                    if (args.length < 2) {
                        return reply("Please provide a language code and text to translate!\nExample: .translate es hello world");
                    }

                    const targetLang = args[0];
                    const textToTranslate = args.slice(1).join(' ');

                    try {
                        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|${targetLang}`);
                        const data = await response.json();

                        if (!data.responseData || !data.responseData.translatedText) {
                            return reply('No translation found for the provided text.');
                        }

                        const translatedText = data.responseData.translatedText;
                        await reply(`🌐 *Translation*\n\n*Original:* ${textToTranslate}\n*Translated:* ${translatedText}\n\n🐞 Powered by LADYBUG`);
                    } catch (error) {
                        reply('An error occurred while translating.');
                    }
                }
                break;

                case 'tts':
                case 'say': {
                    if (!q) return reply("Provide a text for conversion!");
                    try {
                        const url = googleTTS.getAudioUrl(q, {
                            lang: 'hi-IN',
                            slow: false,
                            host: 'https://translate.google.com',
                        });
                        await Ladybug.sendMessage(from, {
                            audio: {
                                url: url
                            },
                            mimetype: 'audio/mp4',
                            ptt: true
                        }, {
                            quoted: m
                        });
                    } catch (e) {
                        reply("Error creating text-to-speech");
                    }
                }
                break;

                case 'githubstalk': {
                    if (!q) return reply("Enter username GitHub!\nExample: .githubstalk username");

                    try {
                        const { data } = await axios.get(`https://simple-api.luxz.xyz/api/tools/githubstalk?user=${q}`);
                        if (!data.status) return reply("User not found!");
                        
                        const { username, nickname, bio, id, profile_pic, url, type, company, blog, location, email, public_repo, public_gists, followers, following } = data.result;

                        let caption = `*GitHub Stalk*\n\n`;
                        caption += `👤 *Username:* ${username}\n`;
                        caption += `📛 *Nickname:* ${nickname || "-"}\n`;
                        caption += `📜 *Bio:* ${bio || "-"}\n`;
                        caption += `🆔 *ID:* ${id}\n`;
                        caption += `🌍 *URL:* ${url}\n`;
                        caption += `📌 *Type:* ${type}\n`;
                        caption += `🏢 *Company:* ${company || "-"}\n`;
                        caption += `🔗 *Blog:* ${blog || "-"}\n`;
                        caption += `📍 *Location:* ${location || "-"}\n`;
                        caption += `📧 *Email:* ${email || "-"}\n`;
                        caption += `📂 *Public Repo:* ${public_repo}\n`;
                        caption += `📑 *Public Gists:* ${public_gists}\n`;
                        caption += `👥 *Followers:* ${followers}\n`;
                        caption += `👤 *Following:* ${following}\n`;
                        caption += `\n🐞 Powered by LADYBUG`;

                        await Ladybug.sendMessage(from, {
                            image: {
                                url: profile_pic
                            },
                            caption: caption
                        }, {
                            quoted: m
                        });
                    } catch (err) {
                        reply("Error occurred while fetching GitHub data.");
                    }
                }
                break;

                case 'poll': {
                    let [poll, opt] = q.split("|");

                    if (q.split("|").length < 2)
                        return reply(`Wrong format::\nExample:- ${prefix + command} who is the best president|Putin,Mnangagwa`);

                    let options = [];
                    for (let i of opt.split(',')) {
                        options.push(i.trim());
                    }

                    await Ladybug.sendMessage(from, {
                        poll: {
                            name: poll.trim(),
                            values: options
                        }
                    });
                }
                break;

                case 'qc': {
                    if (!q) return reply(`Example: ${prefix + command} your text here`);
                    const warna = ["#000000", "#ff2414", "#22b4f2", "#eb13f2"];
                    const reswarna = warna[Math.floor(Math.random() * warna.length)];
                    reply("Creating quote card...");

                    try {
                        const json = {
                            "type": "quote",
                            "format": "png",
                            "backgroundColor": reswarna,
                            "width": 512,
                            "height": 768,
                            "scale": 2,
                            "messages": [{
                                "entities": [],
                                "avatar": true,
                                "from": {
                                    "id": 1,
                                    "name": pushName,
                                    "photo": {
                                        "url": "https://files.catbox.moe/5bzcdl.jpg"
                                    }
                                },
                                "text": q,
                                "replyMessage": {}
                            }]
                        };

                        const response = await axios.post('https://bot.lyo.su/quote/generate', json, {
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });
                        const buffer = Buffer.from(response.data.result.image, 'base64');
                        const tempPath = `./tmp/${makeid()}.png`;
                        fs.writeFileSync(tempPath, buffer);
                        await sendImage(tempPath, "💬 Quote Card\n\n🐞 Generated by LADYBUG");
                        fs.unlinkSync(tempPath);
                    } catch (error) {
                        reply("Error creating quote card: " + error.message);
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // FUN & GAMES
                // ═══════════════════════════════════════════════════════════════

                case 'truth': {
                    const truths = [
                        "What's your biggest fear?",
                        "Have you ever cheated on a test?",
                        "What's your most embarrassing moment?",
                        "What's a secret you've never told anyone?",
                        "What's the worst thing you've ever done?",
                        "Have you ever lied to your best friend?",
                        "What's your biggest regret?",
                        "What's the most childish thing you still do?",
                        "What's the craziest thing you've done for love?",
                        "Have you ever pretended to like a gift you hated?"
                    ];
                    reply(`🎯 *Truth Question:*\n\n${truths[Math.floor(Math.random() * truths.length)]}`);
                }
                break;

                case 'dare': {
                    const dares = [
                        "Do 20 push-ups right now",
                        "Sing the chorus of your favorite song",
                        "Talk in an accent for the next 10 minutes",
                        "Post an embarrassing photo on social media",
                        "Call a random contact and sing happy birthday",
                        "Do your best impression of someone in the chat",
                        "Let someone go through your photos for 1 minute",
                        "Eat a spoonful of hot sauce",
                        "Do your best dance move",
                        "Send a voice message pretending to be a celebrity"
                    ];
                    reply(`🎯 *Dare Challenge:*\n\n${dares[Math.floor(Math.random() * dares.length)]}`);
                }
                break;

                case 'rate': {
                    if (!q) return reply("What should I rate?");
                    const rating = (Math.random() * 10).toFixed(1);
                    reply(`⭐ *Rating:*\n\n${q}: ${rating}/10\n\n🐞 Powered by LADYBUG`);
                }
                break;

                case 'ship': {
                    if (!m.mentionedJid.length) return reply("Tag someone to ship with!");
                    const users = m.mentionedJid.slice(0, 2);
                    const percentage = Math.floor(Math.random() * 100) + 1;
                    const shipName = `${(await Ladybug.getName(users[0])).split(' ')[0]} ❤️ ${(await Ladybug.getName(users[1])).split(' ')[0]}`;
                    
                    reply(`💕 *Ship Calculator*\n\n${shipName}\n\n❤️ Love Percentage: ${percentage}%\n\n${percentage > 80 ? "🔥 Perfect Match!" : percentage > 50 ? "💖 Good Match!" : "💔 Keep Looking!"}`);
                }
                break;

                case 'meme': {
                    try {
                        const { data } = await axios.get('https://meme-api.com/gimme/wholesomememes');
                        await sendImage(data.url, `😂 *${data.title}*\n\n🐞 Powered by LADYBUG`);
                    } catch (e) {
                        reply("Error fetching meme");
                    }
                }
                break;

                case 'joke': {
                    const jokes = [
                        "Why don't scientists trust atoms? Because they make up everything!",
                        "Why did the scarecrow win an award? Because he was outstanding in his field!",
                        "Why don't eggs tell jokes? They'd crack each other up!",
                        "What do you call a fake noodle? An impasta!",
                        "Why did the bicycle fall over? Because it was two-tired!"
                    ];
                    reply(`😂 *Random Joke:*\n\n${jokes[Math.floor(Math.random() * jokes.length)]}`);
                }
                break;

                case 'quote': {
                    const quotes = [
                        { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
                        { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
                        { text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
                        { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
                        { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" }
                    ];
                    const quote = quotes[Math.floor(Math.random() * quotes.length)];
                    reply(`💭 *Quote of the Day:*\n\n"${quote.text}"\n\n— ${quote.author}\n\n🐞 Powered by LADYBUG`);
                }
                break;

                case 'fact': {
                    const facts = [
                        "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly good to eat.",
                        "Octopuses have three hearts.",
                        "A group of flamingos is called a 'flamboyance'.",
                        "Bananas are berries, but strawberries aren't.",
                        "The shortest war in history lasted only 38 minutes."
                    ];
                    reply(`📚 *Random Fact:*\n\n${facts[Math.floor(Math.random() * facts.length)]}`);
                }
                break;

                case 'riddle': {
                    const riddles = [
                        { q: "What has keys but can't open locks?", a: "A piano" },
                        { q: "What can travel around the world while staying in a corner?", a: "A stamp" },
                        { q: "What gets wet while drying?", a: "A towel" },
                        { q: "What can you catch but not throw?", a: "A cold" },
                        { q: "What has hands but can't clap?", a: "A clock" }
                    ];
                    const riddle = riddles[Math.floor(Math.random() * riddles.length)];
                    reply(`🧩 *Riddle:*\n\n${riddle.q}\n\nReply with ${prefix}riddleanswer ${riddle.a} to answer!`);
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // INFORMATION COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'imdb': {
                    if (!q) return reply(`Provide a series or movie name.`);
                    try {
                        let fids = await axios.get(`http://www.omdbapi.com/?apikey=742b2d09&t=${q}&plot=full`);
                        let imdbt = "";
                        imdbt += "⚍⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚍\n" + " ``` IMDB MOVIE SEARCH```\n" + "⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎⚎\n";
                        imdbt += "🎬Title      : " + fids.data.Title + "\n";
                        imdbt += "📅Year       : " + fids.data.Year + "\n";
                        imdbt += "⭐Rated      : " + fids.data.Rated + "\n";
                        imdbt += "📆Released   : " + fids.data.Released + "\n";
                        imdbt += "⏳Runtime    : " + fids.data.Runtime + "\n";
                        imdbt += "🌀Genre      : " + fids.data.Genre + "\n";
                        imdbt += "👨🏻‍💻Director   : " + fids.data.Director + "\n";
                        imdbt += "✍Writer     : " + fids.data.Writer + "\n";
                        imdbt += "👨Actors     : " + fids.data.Actors + "\n";
                        imdbt += "📃Plot       : " + fids.data.Plot + "\n";
                        imdbt += "🌐Language   : " + fids.data.Language + "\n";
                        imdbt += "🌍Country    : " + fids.data.Country + "\n";
                        imdbt += "🎖️Awards     : " + fids.data.Awards + "\n";
                        imdbt += "📦BoxOffice  : " + fids.data.BoxOffice + "\n";
                        imdbt += "🏙️Production : " + fids.data.Production + "\n";
                        imdbt += "🌟imdbRating : " + fids.data.imdbRating + "\n";
                        imdbt += "❎imdbVotes  : " + fids.data.imdbVotes + "";
                        Ladybug.sendMessage(from, {
                            image: {
                                url: fids.data.Poster,
                            },
                            caption: imdbt,
                        }, {
                            quoted: m
                        });
                    } catch (error) {
                        reply("Error: " + error.message);
                    }
                }
                break;

                case 'wiki':
                case 'wikipedia': {
                    if (!q) return reply('❗ Enter what you want to search for on Wikipedia');

                    try {
                        const link = await axios.get(`https://en.wikipedia.org/wiki/${q}`);
                        const $ = cheerio.load(link.data);

                        let wik = $('#firstHeading').text().trim();
                        let resulw = $('#mw-content-text > div.mw-parser-output').find('p').text().trim();

                        let message = `▢ *Wikipedia Search Result* 🧐\n\n`;
                        message += `‣ *Title*: ${wik} 📚\n\n`;
                        message += `${resulw} 📖\n\n🐞 Powered by LADYBUG`;

                        await reply(message);
                    } catch (e) {
                        reply('⚠️ No results found or failed to fetch data. Try again later!');
                    }
                }
                break;

                case 'whois': {
                    if (!m.mentionedJid.length) return reply("Tag someone!");
                    const user = m.mentionedJid[0];
                    try {
                        const ppUrl = await Ladybug.profilePictureUrl(user, 'image').catch(() => 'https://files.catbox.moe/5bzcdl.jpg');
                        const userName = await Ladybug.getName(user);
                        
                        await Ladybug.sendMessage(from, {
                            image: {
                                url: ppUrl
                            },
                            caption: `👤 *User Information*\n\n📛 Name: ${userName}\n📱 Number: ${user.split('@')[0]}\n🆔 ID: ${user}\n\n🐞 Powered by LADYBUG`
                        }, {
                            quoted: m
                        });
                    } catch (e) {
                        reply("Error fetching user info");
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // GROUP COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'kick': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    if (!m.mentionedJid.length) return reply("Tag someone to kick!");
                    if (!isBotAdmin) return reply("Bot needs to be admin!");
                    
                    try {
                        await Ladybug.groupParticipantsUpdate(from, m.mentionedJid, "remove");
                        reply("✅ Successfully kicked member(s)!");
                    } catch (e) {
                        reply("Error kicking member(s)");
                    }
                }
                break;

                case 'promote': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    if (!m.mentionedJid.length) return reply("Tag someone to promote!");
                    if (!isBotAdmin) return reply("Bot needs to be admin!");
                    
                    try {
                        await Ladybug.groupParticipantsUpdate(from, m.mentionedJid, "promote");
                        reply("✅ Successfully promoted member(s)!");
                    } catch (e) {
                        reply("Error promoting member(s)");
                    }
                }
                break;

                case 'demote': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    if (!m.mentionedJid.length) return reply("Tag someone to demote!");
                    if (!isBotAdmin) return reply("Bot needs to be admin!");
                    
                    try {
                        await Ladybug.groupParticipantsUpdate(from, m.mentionedJid, "demote");
                        reply("✅ Successfully demoted member(s)!");
                    } catch (e) {
                        reply("Error demoting member(s)");
                    }
                }
                break;

                case 'tagall': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    
                    let teks = `📢 *Tag All*\n\n👤 By: @${sender.split('@')[0]}\n\n`;
                    for (let mem of groupMembers) {
                        teks += `@${mem.id.split('@')[0]} `;
                    }
                    await Ladybug.sendMessage(from, {
                        text: teks,
                        mentions: groupMembers.map(a => a.id)
                    }, {
                        quoted: m
                    });
                }
                break;

                case 'group': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    if (!isBotAdmin) return reply("Bot needs to be admin!");
                    
                    if (args[0] === 'open') {
                        await Ladybug.groupSettingUpdate(from, 'not_announcement');
                        reply("✅ Group opened successfully!");
                    } else if (args[0] === 'close') {
                        await Ladybug.groupSettingUpdate(from, 'announcement');
                        reply("✅ Group closed successfully!");
                    } else {
                        reply("Usage: .group open/close");
                    }
                }
                break;

                case 'link': {
                    if (!isGroup) return reply("This command only works in groups!");
                    if (!isAdmin && !isOwner) return reply("You need to be an admin!");
                    
                    try {
                        const code = await Ladybug.groupInviteCode(from);
                        reply(`🔗 *Group Link:*\n\nhttps://chat.whatsapp.com/${code}\n\n🐞 Powered by LADYBUG`);
                    } catch (e) {
                        reply("Error getting group link");
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // OWNER COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'setppbot': {
                    if (!isOwner) return reply("Owner only command!");
                    try {
                        let media;
                        if (m.quoted && m.quoted.type === 'imageMessage') {
                            media = await m.quoted.download();
                        } else if (m.type === 'imageMessage') {
                            media = await m.download();
                        } else {
                            return reply("Send or reply to an image!");
                        }
                        await Ladybug.updateProfilePicture(botNumber + "@s.whatsapp.net", media);
                        reply("✅ Successfully changed profile picture!");
                    } catch (error) {
                        reply("Error: " + error.message);
                    }
                }
                break;

                case 'setbotname': {
                    if (!isOwner) return reply("Owner only command!");
                    if (!q) return reply(`Example: ${prefix + command} Ladybug Bot`);
                    try {
                        Ladybug.updateProfileName(q);
                        reply("✅ Successfully changed bot name!");
                    } catch (error) {
                        reply("Error: " + error.message);
                    }
                }
                break;

                case 'setbio': {
                    if (!isOwner) return reply("Owner only command!");
                    if (!q) return reply(`Example: ${prefix + command} Your bio text here`);
                    try {
                        Ladybug.updateProfileStatus(q);
                        reply("✅ Successfully changed bot bio!");
                    } catch (error) {
                        reply("Error: " + error.message);
                    }
                }
                break;

                case 'block': {
                    if (!isOwner) return reply("Owner only command!");
                    if (!q && !m.quoted) return reply(`Example: ${prefix + command} 91xxx`);
                    const numbersOnly = m.isGroup ? (q ? q.replace(/\D/g, '') + '@s.whatsapp.net' : m.quoted?.sender) : from;
                    await Ladybug.updateBlockStatus(numbersOnly, 'block').then(() => reply("✅ Blocked successfully!")).catch(() => reply('Failed to block'));
                }
                break;

                case 'unblock': {
                    if (!isOwner) return reply("Owner only command!");
                    if (!q && !m.quoted) return reply(`Example: ${prefix + command} 91xxx`);
                    const numbersOnly = m.isGroup ? (q ? q.replace(/\D/g, '') + '@s.whatsapp.net' : m.quoted?.sender) : from;
                    await Ladybug.updateBlockStatus(numbersOnly, 'unblock').then(() => reply("✅ Unblocked successfully!")).catch(() => reply('Failed to unblock'));
                }
                break;

                case 'broadcast': {
                    if (!isOwner) return reply("Owner only command!");
                    if (!q) return reply("What message to broadcast?");
                    
                    const groups = Object.values(await Ladybug.groupFetchAllParticipating());
                    let success = 0;
                    let failed = 0;
                    
                    for (const group of groups) {
                        try {
                            await Ladybug.sendMessage(group.id, {
                                text: `📢 *Broadcast from ${config.ownerName}*\n\n${q}\n\n🐞 Powered by LADYBUG`
                            });
                            success++;
                        } catch (e) {
                            failed++;
                        }
                    }
                    
                    reply(`✅ Broadcast sent to ${success} groups\n❌ Failed: ${failed} groups`);
                }
                break;

                case 'cleartmp': {
                    if (!isOwner) return reply("Owner only command!");
                    const tmpDir = './tmp';
                    if (fs.existsSync(tmpDir)) {
                        fs.readdirSync(tmpDir).forEach(file => {
                            fs.unlinkSync(path.join(tmpDir, file));
                        });
                        reply("✅ Successfully cleared temp files!");
                    } else {
                        reply("No temp files to clear");
                    }
                }
                break;

                case 'restart': {
                    if (!isOwner) return reply("Owner only command!");
                    reply("🔄 Restarting bot...");
                    process.exit();
                }
                break;

                case 'shutdown': {
                    if (!isOwner) return reply("Owner only command!");
                    reply("🛑 Shutting down bot...");
                    process.exit(0);
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // SETTINGS COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'autobio': {
                    if (!isOwner) return reply("Owner only command!");
                    if (args[0] === 'on') {
                        database.settings.autobio = true;
                        saveDatabase();
                        reply("✅ Auto bio enabled!");
                    } else if (args[0] === 'off') {
                        database.settings.autobio = false;
                        saveDatabase();
                        reply("✅ Auto bio disabled!");
                    } else {
                        reply(`Auto bio is currently: ${database.settings.autobio ? 'ON' : 'OFF'}\n\nUsage: ${prefix}autobio on/off`);
                    }
                }
                break;

                case 'autotyping': {
                    if (!isOwner) return reply("Owner only command!");
                    if (args[0] === 'on') {
                        database.settings.autotyping = true;
                        saveDatabase();
                        reply("✅ Auto typing enabled!");
                    } else if (args[0] === 'off') {
                        database.settings.autotyping = false;
                        saveDatabase();
                        reply("✅ Auto typing disabled!");
                    } else {
                        reply(`Auto typing is currently: ${database.settings.autotyping ? 'ON' : 'OFF'}\n\nUsage: ${prefix}autotyping on/off`);
                    }
                }
                break;

                case 'autoread': {
                    if (!isOwner) return reply("Owner only command!");
                    if (args[0] === 'on') {
                        database.settings.autoread = true;
                        saveDatabase();
                        reply("✅ Auto read enabled!");
                    } else if (args[0] === 'off') {
                        database.settings.autoread = false;
                        saveDatabase();
                        reply("✅ Auto read disabled!");
                    } else {
                        reply(`Auto read is currently: ${database.settings.autoread ? 'ON' : 'OFF'}\n\nUsage: ${prefix}autoread on/off`);
                    }
                }
                break;

                // ═══════════════════════════════════════════════════════════════
                // INFO & STATUS COMMANDS
                // ═══════════════════════════════════════════════════════════════

                case 'ping': {
                    const start = Date.now();
                    await Ladybug.sendMessage(from, {
                        text: '🏓 Pinging...'
                    }, {
                        quoted: m
                    });
                    const end = Date.now();
                    await Ladybug.sendMessage(from, {
                        text: `🏓 *Pong!*\n\n⚡ Speed: ${end - start}ms\n\n🐞 Powered by LADYBUG`
                    }, {
                        quoted: m
                    });
                }
                break;

                case 'uptime': {
                    const uptime = process.uptime();
                    await reply(`⏱️ *Bot Uptime:*\n\n${runtime(uptime)}\n\n🐞 Powered by LADYBUG`);
                }
                break;

                case 'stats': {
                    const statsText = `📊 *Bot Statistics*\n\n` +
                        `📱 Version: ${config.version}\n` +
                        `👥 Total Users: ${Object.keys(database.users).length}\n` +
                        `💬 Total Messages: ${Object.values(database.users).reduce((a, b) => a + b.messages, 0)}\n` +
                        `⚡ Total Commands: ${Object.values(database.users).reduce((a, b) => a + b.commands, 0)}\n` +
                        `⏱️ Uptime: ${runtime(process.uptime())}\n\n` +
                        `🐞 Powered by LADYBUG`;
                    await reply(statsText);
                }
                break;

                case 'alive': {
                    await Ladybug.sendMessage(from, {
                        text: `🐞 ${config.botName} is ALIVE!\n\n` +
                            `📅 Date: ${moment().format('DD/MM/YYYY')}\n` +
                            `⏰ Time: ${moment().format('HH:mm:ss')}\n` +
                            `📱 Bot: ${botNumber}\n` +
                            `👤 Owner: ${config.ownerName}\n` +
                            `🎉 Version: ${config.version}\n\n` +
                            `🐞 Powered by LADYBUG`,
                        contextInfo: {
                            externalAdReply: {
                                showAdAttribution: true,
                                title: "🐞 LADYBUG BOT",
                                body: "80+ Premium Commands - 100% FREE",
                                thumbnailUrl: "https://files.catbox.moe/5bzcdl.jpg",
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }, {
                        quoted: m
                    });
                }
                break;

                default:
                    if (command) {
                        reply(`❌ Command "${command}" not found!\n\nUse ${prefix}menu to see available commands.`);
                    }
            }

        } catch (error) {
            console.error("Error in message handler:", error);
        }
    });

    return Ladybug;
}

// ═══════════════════════════════════════════════════════════════
// AUTO FEATURES LOOP
// ═══════════════════════════════════════════════════════════════

async function autoFeatures(Ladybug) {
    // Auto Bio
    if (database.settings.autobio) {
        const bios = [
            `🐞 ${config.botName} | ${config.version}`,
            `🎉 80+ Premium Commands`,
            `💯 100% FREE Forever`,
            `🤖 AI Assistant Available`,
            `🎵 Music & Media Downloads`,
            `🎨 Text Maker Tools`,
            `🛠️ Utility Commands`,
            `📞 Contact: ${config.ownerNumber}`
        ];
        const bio = bios[Math.floor(Math.random() * bios.length)];
        Ladybug.updateProfileStatus(bio).catch(() => {});
    }

    // Repeat every 5 minutes
    setTimeout(() => autoFeatures(Ladybug), 300000);
}

// ═══════════════════════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════════════════════

console.log('🐞 Starting LADYBUG Bot...');
startBot().then((Ladybug) => {
    console.log('✅ 🐞 LADYBUG Bot Started Successfully!');
    autoFeatures(Ladybug);
}).catch((err) => {
    console.error('❌ Error starting bot:', err);
});

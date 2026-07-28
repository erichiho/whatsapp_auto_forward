// whatsapp_auto_forward.js
// Updated & more stable version - July 2026

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.File({ filename: 'bot.log' }),
        new winston.transports.Console()
    ]
});

// ================== CONFIG ==================
const SOURCE_GROUP = process.env.SOURCE_GROUP || '120363207329024564@g.us';
const TARGET_GROUP = process.env.TARGET_GROUP || '120363400999239738@g.us';
const KEYWORDS = ['升降機故障', '扶手梯故障'];

const FORWARDED = new Set();
const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const CSV_FILE = 'forwarded_messages.csv';

if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');
}

// ================== CLIENT SETUP ==================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'tke-forwarder',
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--disable-software-rasterizer'
        ]
    },
    webVersionCache: {
        type: 'none'
    }
});

// ================== EVENTS ==================
client.on('qr', (qr) => {
    logger.info('QR Code received - Please scan now');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    logger.info('✅ Bot is ready and monitoring keywords...');
});

client.on('message', async (message) => {
    try {
        // Ignore status / broadcast
        if (message.from === 'status@broadcast') return;

        const text = (message.body || '').toLowerCase();
        const key = `${message.id._serialized || message.id.id}:${message.from}`;

        // Only process messages from the source group
        if (message.from !== SOURCE_GROUP) return;

        // Check keywords
        if (!KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return;

        // Prevent duplicate forwarding
        if (FORWARDED.has(key)) return;
        FORWARDED.add(key);
        setTimeout(() => FORWARDED.delete(key), TIMEOUT);

        logger.info(`Keyword detected: ${message.body}`);

        const targetChat = await client.getChatById(TARGET_GROUP);

        // ===== Forwarding with fallback =====
        let forwarded = false;

        // Method 1: Native forward
        try {
            await message.forward(TARGET_GROUP);
            logger.info('✅ Forwarded successfully (native method)');
            forwarded = true;
        } catch (err) {
            logger.warn(`Native forward failed: ${err.message}`);
        }

        // Method 2: Fallback - send as new message
        if (!forwarded) {
            try {
                const contact = await message.getContact().catch(() => null);
                const name = contact?.pushname || contact?.number || 'Unknown';
                await targetChat.sendMessage(`[Forwarded from ${name}]:\n${message.body}`);
                logger.info('✅ Fallback send successful');
                forwarded = true;
            } catch (err2) {
                logger.error(`Fallback also failed: ${err2.message}`);
            }
        }

        // Log to CSV
        if (forwarded) {
            const timestamp = new Date().toISOString();
            const sender = (await message.getContact().catch(() => ({}))).pushname || 'Unknown';
            const safeBody = (message.body || '').replace(/"/g, '""');
            const line = `"${timestamp}","${message.from}","${safeBody}","${sender}"\n`;
            fs.appendFileSync(CSV_FILE, line);

            // Reply to original message
            await message.reply('Your message has been forwarded to the TKE maintenance team.').catch(() => {});
        }

    } catch (error) {
        logger.error(`Error processing message: ${error.message}`);
    }
});

// Error handlers
client.on('auth_failure', (msg) => {
    logger.error(`Auth failure: ${msg}`);
});

client.on('disconnected', (reason) => {
    logger.warn(`Disconnected: ${reason}. Trying to reconnect...`);
    setTimeout(() => {
        client.initialize().catch(err => logger.error(`Re-init failed: ${err.message}`));
    }, 5000);
});

// Start
logger.info('Starting WhatsApp bot...');
client.initialize().catch(err => {
    logger.error(`Init failed: ${err.message}`);
});

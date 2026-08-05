// whatsapp_auto_forward.js
// More robust version - handles LOGOUT + destroy safely
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// ================== LOGGER ==================
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
const AUTH_PATH = path.join(__dirname, '.wwebjs_auth');

if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');
}

// ================== CLIENT ==================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'tke-forwarder',
        dataPath: AUTH_PATH
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
    }
});

// ================== EVENTS ==================
client.on('qr', (qr) => {
    logger.info('QR Code received – please scan');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    logger.info('✅ Bot is ready and monitoring keywords...');
});

client.on('auth_failure', (msg) => {
    logger.error(`Auth failure: ${msg}`);
});

client.on('disconnected', async (reason) => {
    logger.warn(`Disconnected: ${reason}`);

    // If it was a real LOGOUT, clear the session so next start asks for QR again
    if (reason === 'LOGOUT') {
        logger.warn('Session was logged out. Clearing auth folder...');
        try {
            fs.rmSync(path.join(AUTH_PATH, 'session-tke-forwarder'), { recursive: true, force: true });
        } catch (e) {
            // ignore
        }
    }

    // Destroy safely
    try {
        await client.destroy();
    } catch (e) {
        // ignore destroy errors
    }

    // Exit so the process can be restarted cleanly
    process.exit(1);
});

client.on('message', async (message) => {
    try {
        if (message.from === 'status@broadcast') return;
        if (message.from !== SOURCE_GROUP) return;

        const text = (message.body || '').toLowerCase();
        if (!KEYWORDS.some(kw => text.includes(kw.toLowerCase()))) return;

        const key = `${message.id._serialized || message.id.id}:${message.from}`;
        if (FORWARDED.has(key)) return;

        FORWARDED.add(key);
        setTimeout(() => FORWARDED.delete(key), TIMEOUT);

        logger.info(`Keyword detected: ${message.body}`);

        let forwarded = false;

        // Method 1: Native forward
        try {
            await message.forward(TARGET_GROUP);
            logger.info('✅ Forwarded successfully (native)');
            forwarded = true;
        } catch (err) {
            logger.warn(`Native forward failed: ${err.message}`);
            logger.warn(`Full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
        }

        // Method 2: Fallback
        if (!forwarded) {
            try {
                const contact = await message.getContact().catch(() => null);
                const name = contact?.pushname || contact?.number || 'Unknown';
                const targetChat = await client.getChatById(TARGET_GROUP);

                if (!targetChat) {
                    throw new Error('Target group not found / bot is not in the group');
                }
                
                await targetChat.sendMessage(`[Forwarded from ${name}]:\n${message.body}`);
                logger.info('✅ Fallback send successful');
                forwarded = true;
            } catch (err2) {
                logger.error(`Fallback also failed: ${err2.message}`);
                logger.error(`Full fallback error: ${JSON.stringify(err2, Object.getOwnPropertyNames(err2))}`);
            }
        }

        if (forwarded) {
            const timestamp = new Date().toISOString();
            const contact = await message.getContact().catch(() => ({}));
            const sender = contact.pushname || contact.number || 'Unknown';
            const safeBody = (message.body || '').replace(/"/g, '""');
            fs.appendFileSync(CSV_FILE, `"${timestamp}","${message.from}","${safeBody}","${sender}"\n`);

            await message.reply('Your message has been forwarded to the TKE maintenance team.').catch(() => {});
        }
    } catch (error) {
        logger.error(`Error processing message: ${error.message}`);
    }
});

// ================== SAFETY NET ==================
process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`);
    // Don't exit immediately on every uncaught error
});

// ================== GRACEFUL SHUTDOWN ==================
async function shutdown(signal) {
    logger.info(`Received ${signal}. Shutting down...`);
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ================== START ==================
logger.info('Starting WhatsApp bot...');
client.initialize().catch(err => {
    logger.error(`Init failed: ${err.message}`);
    process.exit(1);
});

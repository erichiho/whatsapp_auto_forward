// whatsapp_auto_forward.js
// Stable version for Linux - Dec 2025

require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'bot.log' }),
        new winston.transports.Console()
    ]
});

// Config
const SOURCE_GROUP = process.env.SOURCE_GROUP || '120363207329024564@g.us';
const TARGET_GROUP = process.env.TARGET_GROUP || '120363400999239738@g.us';
const KEYWORDS = ['升降機故障', '扶手梯故障'];

const FORWARDED = new Set();
const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const CSV_FILE = 'forwarded_messages.csv';

if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');
}

// Client setup optimized for Linux
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
            '--no-zygote'
        ]
    },
    webVersionCache: { type: 'none' }   // Critical for recent updates
});

// Events
client.on('qr', (qr) => {
    logger.info('QR Code received - Scan now');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    logger.info('✅ Bot is ready and monitoring keywords...');
});

client.on('message', async (message) => {
    try {
        const text = (message.body || '').toLowerCase();
        const key = `${message.id.id}:${message.from}`;

        // Only process messages from source group with keywords
        if (message.from !== SOURCE_GROUP) return;
        if (!KEYWORDS.some(kw => text.includes(kw))) return;
        if (FORWARDED.has(key)) return;

        FORWARDED.add(key);
        setTimeout(() => FORWARDED.delete(key), TIMEOUT);

        logger.info(`Keyword detected: ${message.body}`);

        const targetChat = await client.getChatById(TARGET_GROUP);

        // Try forward first
        try {
            await message.forward(TARGET_GROUP);
            logger.info('Forwarded successfully using native method');
        } catch (err) {
            logger.warn(`Native forward failed: ${err.message} → Using fallback`);
            const contact = await message.getContact().catch(() => ({}));
            const name = contact.pushname || contact.number || 'Unknown';
            await targetChat.sendMessage(`[Forwarded from ${name}]: ${message.body}`);
            logger.info('Fallback send successful');
        }

        // Log to CSV
        const timestamp = new Date().toISOString();
        const sender = (await message.getContact().catch(() => ({}))).pushname || 'Unknown';
        const line = `"${timestamp}","${message.from}","${message.body.replace(/"/g, '""')}","${sender}"\n`;
        fs.appendFileSync(CSV_FILE, line);

        await message.reply('Your message has been forwarded to the TKE maintenance team.');

    } catch (error) {
        logger.error(`Error: ${error.message}`);
        message.reply('Failed to forward your message. Please try again later.').catch(() => {});
    }
});

// Error handlers
client.on('auth_failure', (msg) => logger.error(`Auth failure: ${msg}`));
client.on('disconnected', (reason) => {
    logger.warn(`Disconnected: ${reason}`);
    client.initialize();
});

// Start
client.initialize().catch(err => logger.error(`Init failed: ${err.message}`));

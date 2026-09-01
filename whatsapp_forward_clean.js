// whatsapp_auto_forward.js
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

const SOURCE_GROUP = process.env.SOURCE_GROUP || '120363207329024564@g.us';
const TARGET_GROUP = process.env.TARGET_GROUP || '120363400999239738@g.us';
const KEYWORDS = ['升降機故障', '扶手梯故障'];
const FORWARDED = new Set();
const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const CSV_FILE = 'forwarded_messages.csv';

if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'tke-forwarder',
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        protocolTimeout: 120000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-accelerated-2d-canvas',
            '--single-process' // helps reduce CPU on low-resource machines
        ]
    }
});

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
    try {
        await client.destroy();
    } catch (e) {}
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

        const contact = await message.getContact().catch(() => null);
        const name = contact?.pushname || contact?.number || 'Unknown';

        await client.sendMessage(
            TARGET_GROUP,
            `*[Forwarded from ${name}]*\n\n${message.body}`
        );

        logger.info('✅ Message forwarded successfully');

        // CSV log
        const timestamp = new Date().toISOString();
        const sender = contact?.pushname || contact?.number || 'Unknown';
        const safeBody = (message.body || '').replace(/"/g, '""');
        fs.appendFileSync(CSV_FILE, `"${timestamp}","${message.from}","${safeBody}","${sender}"\n`);

        // Reply confirmation
        await message.reply('Your message has been forwarded to the TKE maintenance team.').catch(() => {});
    } catch (error) {
        logger.error(`Error: ${error.message}`);
        logger.error(JSON.stringify(error, Object.getOwnPropertyNames(error)));
    }
});

process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
});

logger.info('Starting WhatsApp bot...');
client.initialize().catch(err => {
    logger.error(`Init failed: ${err.message}`);
    process.exit(1);
});

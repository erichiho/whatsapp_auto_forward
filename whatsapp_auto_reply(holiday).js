require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({ filename: 'bot.log' }),
        new winston.transports.Console()
    ]
});

// Configuration
const ALLOWED_SENDER = process.env.ALLOWED_SENDER || '120363207329024564@g.us';
const TARGET_GROUP = process.env.TARGET_GROUP || '120363400999239738@g.us';
const KEYWORDS = ['升降機故障', '扶手梯故障'];
const FORWARDED_MESSAGES = new Set();
const FORWARD_TIMEOUT = 60 * 60 * 1000; // 1 hour timeout for duplicates
const OUT_OF_TOWN_NAME = 'Eric'; // Name or tag to detect
const OUT_OF_TOWN_MESSAGE = 'I am out of town from 25 to 28 Sep and will reply you once back HK';
const OUT_OF_TOWN_START = new Date('2025-09-25T00:00:00+08:00'); // Start date (Hong Kong time)
const OUT_OF_TOWN_END = new Date('2025-09-28T23:59:59+08:00'); // End date (Hong Kong time)

// Validate IDs
if (!ALLOWED_SENDER.endsWith('@g.us') || !TARGET_GROUP.endsWith('@g.us')) {
    logger.error('Invalid sender or target group ID. Must end with @g.us');
    process.exit(1);
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: process.env.NODE_ENV === 'production',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Improve compatibility
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' // Stable version
    }
});

// QR code for authentication
client.on('qr', qr => {
    logger.info('Scan the QR code with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

// Client ready
client.on('ready', () => {
    logger.info('WhatsApp client is ready! Monitoring for lift-related messages and out-of-town replies...');
});

// Handle incoming messages
client.on('message', async message => {
    try {
        const messageText = message.body.toLowerCase();
        const messageKey = `${message.id.id}:${message.from}`; // Use message ID for uniqueness
        logger.info(`Received message from ${message.from} in group ${message.from}: ${message.body}`);

        // Out-of-town reply logic (September 25–28, 2025)
        const currentDate = new Date();
        if (currentDate >= OUT_OF_TOWN_START && currentDate <= OUT_OF_TOWN_END) {
            if (messageText.includes(OUT_OF_TOWN_NAME.toLowerCase()) || messageText.includes(`@${OUT_OF_TOWN_NAME.toLowerCase()}`)) {
                await message.reply(OUT_OF_TOWN_MESSAGE);
                logger.info(`Sent out-of-town reply to ${message.from} for mentioning ${OUT_OF_TOWN_NAME}`);
            } else {
                logger.info(`No mention of ${OUT_OF_TOWN_NAME} in message from ${message.from}`);
            }
        }

        // Lift-related forwarding logic (no lift number check)
        if (message.from === ALLOWED_SENDER && 
            KEYWORDS.some(keyword => messageText.includes(keyword.toLowerCase())) &&
            !FORWARDED_MESSAGES.has(messageKey)) {
            
            FORWARDED_MESSAGES.add(messageKey);
            setTimeout(() => FORWARDED_MESSAGES.delete(messageKey), FORWARD_TIMEOUT);

            // Forward to target group
            const chat = await client.getChatById(TARGET_GROUP);
            if (!chat) throw new Error(`Target group ${TARGET_GROUP} not found`);

            await message.forward(TARGET_GROUP);
            logger.info(`Message about lift/escalator issue forwarded to ${TARGET_GROUP}`);

            // Reply to sender
            await message.reply('Your message about a lift/escalator breakdown has been forwarded to the maintenance team.');
            logger.info(`Replied to sender about lift/escalator issue`);
        } else {
            logger.info(`Message ignored: ${message.from !== ALLOWED_SENDER ? 'Not from allowed sender' : 'No keywords or already forwarded'}`);
        }
    } catch (error) {
        logger.error(`Error processing message from ${message.from}: ${error.message}`);
        await message.reply('Failed to forward your message. Please contact the maintenance team directly.');
    }
});

// Handle authentication failure
client.on('auth_failure', msg => {
    logger.error(`Authentication failed: ${msg}. Please scan QR code again.`);
});

// Handle disconnection with reconnection
client.on('disconnected', reason => {
    logger.warn(`Client disconnected: ${reason}. Attempting to reconnect...`);
    client.initialize().catch(err => logger.error(`Reconnection failed: ${err.message}`));
});

// Start the client
client.initialize().catch(err => logger.error(`Failed to initialize client: ${err.message}`));

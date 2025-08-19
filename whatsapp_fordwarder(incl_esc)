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
const allowedSender = process.env.ALLOWED_SENDER || '120363207329024564@g.us';
const targetGroup = process.env.TARGET_GROUP || '120363400999239738@g.us';
const keywords = ['升降機故障', '扶手梯故障'];
const forwardedMessages = new Set();

// Validate IDs
if (!allowedSender.endsWith('@g.us') || !targetGroup.endsWith('@g.us')) {
    logger.error('Invalid sender or group ID');
    process.exit(1);
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: process.env.NODE_ENV === 'production' } // Headless in production
});

// QR code for authentication
client.on('qr', qr => {
    logger.info('Scan the QR code with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

// Client ready
client.on('ready', () => {
    logger.info('WhatsApp client is ready!');
});

// Handle incoming messages
client.on('message', async message => {
    try {
        const messageText = message.body.toLowerCase();
        const messageKey = `${message.from}:${message.body}`;
        logger.info(`Received message from ${message.from}: ${message.body}`);

        // Check if message contains any of the specified keywords
        if (message.from === allowedSender && keywords.some(keyword => messageText.includes(keyword)) && !forwardedMessages.has(messageKey)) {
            forwardedMessages.add(messageKey);
            setTimeout(() => forwardedMessages.delete(messageKey), 60 * 60 * 1000); // Clear after 1 hour

            const chat = await client.getChatById(targetGroup);
            if (!chat) throw new Error('Target group not found');

            await message.forward(targetGroup);
            logger.info(`Message forwarded to ${targetGroup}`);
            await message.reply('Your message about an escalator breakdown has been forwarded to the maintenance team.');
        }
    } catch (error) {
        logger.error('Error processing message:', error);
        await message.reply('Failed to forward your message. Please try again later.');
    }
});

// Handle authentication failure
client.on('auth_failure', msg => {
    logger.error('Authentication failed:', msg);
});

// Handle disconnection with reconnection
client.on('disconnected', reason => {
    logger.warn('Client disconnected:', reason);
    logger.info('Attempting to reconnect...');
    client.initialize().catch(err => logger.error('Reconnection failed:', err));
});

// Start the client
client.initialize().catch(err => logger.error('Failed to initialize client:', err));

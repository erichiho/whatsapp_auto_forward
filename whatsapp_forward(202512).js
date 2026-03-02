// whatsapp_auto_forward.js

// Auto-forwards messages containing keywords from a specific group to a target group

// Handles recent WhatsApp Web updates (Dec 2025) with fallback sending

// Keywords: '升降機故障', '扶手梯故障' (customize as needed)

// Logs to CSV for Excel analysis

 

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');

const qrcode = require('qrcode-terminal');

const winston = require('winston');

const fs = require('fs');

 

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

const ALLOWED_SENDER = process.env.ALLOWED_SENDER || '120363207329024564@g.us'; // Source group ID

const TARGET_GROUP = process.env.TARGET_GROUP || '120363400999239738@g.us'; // Target group ID

const KEYWORDS = ['升降機故障', '扶手梯故障']; // Predefined keywords

const FORWARDED_MESSAGES = new Set();

const FORWARD_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours timeout for duplicates

const CSV_FILE = 'forwarded_messages.csv'; // CSV for logging

 

// Initialize CSV file

if (!fs.existsSync(CSV_FILE)) {

    fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');

}

 

// Validate group IDs

if (!ALLOWED_SENDER.endsWith('@g.us') || !TARGET_GROUP.endsWith('@g.us')) {

    logger.error('Invalid source or target group ID. Must end with @g.us');

    process.exit(1);

}

 

// Initialize WhatsApp client

const client = new Client({

    authStrategy: new LocalAuth(),

    puppeteer: {

        headless: process.env.NODE_ENV === 'production',

        args: ['--no-sandbox', '--disable-setuid-sandbox']

    },

    webVersionCache: {

        type: 'none' // Use latest WhatsApp Web to handle Dec 2025 updates

    }

});

 

// QR code for authentication

client.on('qr', qr => {

    logger.info('Scan the QR code with your WhatsApp app:');

    qrcode.generate(qr, { small: true });

});

 

// Client ready

client.on('ready', () => {

    logger.info('WhatsApp client is ready! Monitoring for keyword messages...');

});

 

// Handle incoming messages

client.on('message', async message => {

    try {

        const messageText = message.body.toLowerCase();

        const messageKey = `${message.id.id}:${message.from}`;

        logger.info(`Received message from ${message.from}: ${message.body} (ID: ${message.id.id})`);

 

        // Check if message is from the source group and contains keyword

        if (message.from === ALLOWED_SENDER &&

            KEYWORDS.some(keyword => messageText.includes(keyword.toLowerCase())) &&

            !FORWARDED_MESSAGES.has(messageKey)) {

           

            FORWARDED_MESSAGES.add(messageKey);

            setTimeout(() => FORWARDED_MESSAGES.delete(messageKey), FORWARD_TIMEOUT);

 

            logger.info(`Keyword detected. Attempting to access target group ${TARGET_GROUP}`);

            const chat = await client.getChatById(TARGET_GROUP);

            if (!chat) throw new Error(`Target group ${TARGET_GROUP} not found`);

            logger.info(`Target group accessed: ${chat.name}`);

 

            // Try forwarding the message (handles recent update issues)

            try {

                logger.info(`Attempting to forward message to ${TARGET_GROUP}`);

                await message.forward(TARGET_GROUP);

                logger.info(`Message forwarded to ${TARGET_GROUP}`);

            } catch (forwardError) {

                logger.warn(`Forwarding failed (WhatsApp update issue?): ${forwardError.message}. Sending message content instead.`);

                const senderInfo = await message.getContact();

                const senderName = senderInfo.pushname || senderInfo.number || 'Unknown';

                await chat.sendMessage(`[Forwarded from ${message.from} by ${senderName}]: ${message.body}`);

                logger.info(`Message content sent to ${TARGET_GROUP}`);

            }

 

            // Log to CSV

            const timestamp = new Date().toISOString();

            const senderInfo = await message.getContact();

            const senderName = senderInfo.pushname || senderInfo.number || 'Unknown';

            fs.appendFileSync(CSV_FILE, `"${timestamp}","${message.from}","${message.body.replace(/"/g, '""')}","${senderName}"\n`);

            logger.info(`Logged forwarded message to ${CSV_FILE}`);

 

            // Reply to sender

            await message.reply('Your message has been forwarded to the TKE maintenance team.');

            logger.info(`Replied to sender`);

        } else {

            logger.info(`Message ignored: ${message.from !== ALLOWED_SENDER ? 'Not from allowed sender' : 'No keyword or already forwarded'}`);

        }

    } catch (error) {

        logger.error(`Error processing message from ${message.from}: ${error.message}`);

        await message.reply('Failed to forward your message. Please try again later.');

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

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Initialize WhatsApp client with local authentication
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: false } // Set to true for headless mode after testing
});

// Display QR code for authentication
client.on('qr', qr => {
    console.log('Scan the QR code with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

// Log when client is ready
client.on('ready', () => {
    console.log('WhatsApp client is ready!');
});

// Handle incoming messages
client.on('message', async message => {
    try {
        // Define the specific sender and target group
        const allowedSender = '120363207329024564@g.us'; // Replace with sender's phone number (e.g., 1234567890@c.us)
        const targetGroup = '120363400999239738@g.us'; // Replace with target group ID

        // Check if message is from the allowed sender and contains "escalator breakdown"
        const messageText = message.body.toLowerCase();
        if (message.from === allowedSender && messageText.includes('升降機故障')) {
            console.log(`Message with keyword detected from ${message.from}: ${message.body}`);

            // Forward the message to the target group
            await message.forward(targetGroup);
            console.log(`Message forwarded to ${targetGroup}`);

            // Optional: Notify the sender that the message was forwarded
            await message.reply('Your message about an escalator breakdown has been forwarded to the maintenance team.');
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

// Handle authentication failure
client.on('auth_failure', msg => {
    console.error('Authentication failed:', msg);
});

// Handle disconnection
client.on('disconnected', reason => {
    console.log('Client disconnected:', reason);
});

// Start the client
client.initialize().catch(err => console.error('Failed to initialize client:', err));
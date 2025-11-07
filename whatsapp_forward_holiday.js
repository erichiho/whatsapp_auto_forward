// whatsapp_tke_bot.js  (save as this name)
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');
const fs = require('fs');

// ───── Logger ─────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'bot.log' }), new winston.transports.Console()]
});

// ───── Config ─────
const ALLOWED_SENDER = process.env.ALLOWED_SENDER || '120363207329024564@g.us';
const TARGET_GROUP   = '120363400999239738@g.us';
const KEYWORDS       = ['升降機故障', '扶手梯故障'];
const FORWARDED      = new Set();
const TIMEOUT        = 2 * 60 * 60 * 1000;   // 2 h dedupe
const CSV_FILE       = 'escalator_issues.csv';

// Eric out-of-town
const ERIC_NAMES     = ['eric', '@eric yip mtr'];
const ERIC_REPLY     = 'Thank you for your message. I am out of town from 9 to 12 Nov and will reply you once available';
const OOO_START      = new Date('2025-11-09T00:00:00+08:00'); // HKT
const OOO_END        = new Date('2025-11-12T23:59:59+08:00');

// CSV header
if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, 'Timestamp,SourceGroup,Message,Sender\n');

// Validate IDs
if (!ALLOWED_SENDER.endsWith('@g.us') || !TARGET_GROUP.endsWith('@g.us')) {
  logger.error('Invalid group ID'); process.exit(1);
}

// ───── WhatsApp Client ─────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    headless: process.env.NODE_ENV === 'production',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  },
  webVersionCache: { type: 'none' }   // survives WhatsApp updates
});

// ───── Events ─────
client.on('qr', qr => { logger.info('SCAN QR'); qrcode.generate(qr, {small:true}); });
client.on('ready', () => logger.info('Bot ready – monitoring lift/escalator + Eric OOO'));

client.on('message', async msg => {
  try {
    const text = (msg.body || '').toLowerCase();
    const key  = `${msg.id.id}:${msg.from}`;
    const now  = new Date();

    // ── 1. Eric Out-of-Office (any chat) ──
    if (now >= OOO_START && now <= OOO_END) {
      const mentioned = ERIC_NAMES.some(n => text.includes(n)) || msg.isStatus === false && msg.to === 'you';
      if (mentioned && !msg.fromMe) {                 // ignore own messages
        await msg.reply(ERIC_REPLY);
        logger.info(`Sent OOO to ${msg.from}`);
        return;                                       // stop further processing
      }
    }

    // ── 2. Lift / Escalator forward ──
    if (msg.from !== ALLOWED_SENDER) return;

    const hasKeyword = KEYWORDS.some(k => text.includes(k.toLowerCase()));
    if (!hasKeyword || FORWARDED.has(key)) return;

    FORWARDED.add(key);
    setTimeout(() => FORWARDED.delete(key), TIMEOUT);

    const target = await client.getChatById(TARGET_GROUP);
    if (!target) throw new Error('Target group missing');

    // Forward or fallback
    try {
      await msg.forward(TARGET_GROUP);
      logger.info(`Forwarded to ${TARGET_GROUP}`);
    } catch {
      const contact = await msg.getContact();
      const name = contact.pushname || contact.number || 'Unknown';
      await target.sendMessage(`[Forwarded by ${name}]: ${msg.body}`);
      logger.warn(`Fallback send used`);
    }

    // CSV log
    const contact = await msg.getContact();
    const name = contact.pushname || contact.number || 'Unknown';
    fs.appendFileSync(CSV_FILE,
      `"${new Date().toISOString()}","${msg.from}","${msg.body.replace(/"/g,'""')}","${name}"\n`
    );

    await msg.reply('Your message about a lift / escalator breakdown has been forwarded to the TKE maintenance team.');
    logger.info(`Replied to ${msg.from}`);

  } catch (e) {
    logger.error(`Error: ${e.message}`);
    try { await msg.reply('Failed to forward. Try again later.'); } catch {}
  }
});

// ───── Error handling ─────
client.on('auth_failure', () => logger.error('Auth failed – delete .wwebjs_auth and rescan QR'));
client.on('disconnected', r => { logger.warn(`Disconnected: ${r}`); client.initialize(); });

client.initialize();

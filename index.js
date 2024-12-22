require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const OpenAI = require('openai');
const functions = require('./functions');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const calendly = require('./calendly');

const ADMIN_NUMBERS = ['923499490427'];
global.ADMIN_NUMBERS = ADMIN_NUMBERS;

const assistant = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
    }
});

let isBotActive = true;
let lastBotMessage = '';
let lastHumanMessage = '';
let botNumber = '';
let lastProcessedMessageTime = 0;
const processedMessageIds = new Set();

const picsFolder = path.join(__dirname, 'pics');
if (!fs.existsSync(picsFolder)) {
    fs.mkdirSync(picsFolder);
}

let isResetMode = false;
let isInitialized = false;
let isCheckingMessages = false;
let calendlyCheckInterval;

function stopBot() {
    isBotActive = false;
}

function startBot() {
    isBotActive = true;
}

client.on('qr', (qr) => {
    qrcode.toFile('qr_code.png', qr, {
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, (err) => {
        if (err) {
            console.error('Error generating QR code:', err);
        }
    });
});

client.on('ready', async () => {
    botNumber = client.info.wid.user;

    if (!ADMIN_NUMBERS.includes(botNumber)) {
        ADMIN_NUMBERS.push(botNumber);
    }

    functions.loadIgnoreList();
    
    if (calendlyCheckInterval) {
        clearInterval(calendlyCheckInterval);
    }

    await calendly.checkNewAppointments(client, ADMIN_NUMBERS);
    
    calendlyCheckInterval = setInterval(async () => {
        await calendly.checkNewAppointments(client, ADMIN_NUMBERS);
    }, 60 * 1000);

    if (!isCheckingMessages) {
        setInterval(checkForNewMessages, 1000);
        isCheckingMessages = true;
    }

    fetch('http://0.0.0.0:0/set_bot_connected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    .then(response => response.json())
    .catch(error => console.error('Error updating bot status:', error));

    setInterval(async () => {
        await calendly.checkAndSendReminders(client);
    }, 60000);
});

async function checkForNewMessages() {
    try {
        const chat = await client.getChatById(`${botNumber}@c.us`);
        const messages = await chat.fetchMessages({ limit: 1 });

        if (messages.length > 0) {
            const latestMessage = messages[0];

            if (latestMessage.from === `${botNumber}@c.us`) {
                if (latestMessage.timestamp > lastProcessedMessageTime && !processedMessageIds.has(latestMessage.id._serialized)) {
                    lastProcessedMessageTime = latestMessage.timestamp;
                    await processMessage(latestMessage);
                }
            }
        }
    } catch (error) {
        console.error('Error checking for new messages:', error);
    }
}

async function processMessage(message) {
    const ignoredTypes = [
        'e2e_notification',
        'security_notification',
        'call_log',
        'protocol',
        'gp2',
        'notification_template'
    ];

    if (ignoredTypes.includes(message.type)) {
        return;
    }

    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body || '';

    const isAdmin = ADMIN_NUMBERS.includes(senderNumber);
    const isModerator = functions.isModerator(senderNumber);
    const isBot = senderNumber === botNumber;

    if (messageText.toLowerCase().startsWith('!!')) {
        const response = await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator, stopBot, startBot);
        if (response && !isBot) {
            await client.sendMessage(senderId, response);
        }
    } else if (isBotActive && !isBot && !functions.isIgnored(senderNumber)) {
        const response = await functions.storeUserMessage(client, assistant, senderNumber, message);
        if (response) {
            await client.sendMessage(senderId, response);
        }
    }
}

client.on('message_create', async (message) => {
    await processMessage(message);
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.on('disconnected', (reason) => {
    if (calendlyCheckInterval) {
        clearInterval(calendlyCheckInterval);
    }
    
    if (fs.existsSync('.wwebjs_auth')) {
        try {
            fs.rmSync('.wwebjs_auth', { recursive: true, force: true });
        } catch (error) {
            console.error('Error removing auth folder:', error);
        }
    }
    
    fetch('http://0.0.0.0:0/set_bot_disconnected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    }).catch(error => {
        console.error('Error updating disconnected status:', error);
    });
});

if (!isInitialized) {
    client.initialize();
    isInitialized = true;
}

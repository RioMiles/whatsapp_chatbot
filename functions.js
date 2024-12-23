const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const moderators = new Set();
let assistantKey = 'asst_ZMeUIKZN5fMsLXxxTO6r0DdI';
const userThreads = {};
const userMessages = {};
const userMessageQueue = {};
const userProcessingStatus = {};
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');

const userMessageQueues = {};
const userProcessingTimers = {};

const IGNORE_LIST_FILE = path.join(__dirname, 'ignore_list.json');
const ignoreList = new Set();

function saveIgnoreList() {
    const ignoreArray = Array.from(ignoreList);
    fs.writeFileSync(IGNORE_LIST_FILE, JSON.stringify(ignoreArray, null, 2), 'utf8');
}

function loadIgnoreList() {
    try {
        if (fs.existsSync(IGNORE_LIST_FILE)) {
            const data = fs.readFileSync(IGNORE_LIST_FILE, 'utf8');
            if (data.trim() === '') {
                ignoreList.clear();
                saveIgnoreList();
            } else {
                const ignoreArray = JSON.parse(data);
                ignoreList.clear();
                ignoreArray.forEach(number => ignoreList.add(number));
            }
        } else {
            ignoreList.clear();
            saveIgnoreList();
        }
    } catch (error) {
        console.error('Error loading ignore list:', error);
        ignoreList.clear();
        saveIgnoreList();
    }
}

function addToIgnoreList(number) {
    ignoreList.add(number);
    saveIgnoreList();
}

function removeFromIgnoreList(number) {
    ignoreList.delete(number);
    saveIgnoreList();
}

function isIgnored(number) {
    return ignoreList.has(number);
}

function formatMexicanNumber(number) {
    if (number.startsWith('52') && number.length === 12 && !number.startsWith('521')) {
        return `521${number.slice(2)}`;
    }
    return number;
}

async function sendMessageWithValidation(client, recipientNumber, message, senderNumber) {
    try {
        const formattedRecipient = formatMexicanNumber(recipientNumber);
        const formattedNumber = `${formattedRecipient}@c.us`;

        const isRegistered = await client.isRegisteredUser(formattedNumber);
        if (!isRegistered) {
            throw new Error('This number is not registered on WhatsApp');
        }

        await client.sendMessage(formattedNumber, message);

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Failed to send message to ${recipientNumber}: ${error.message}`);
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

function parseTimeString(timeString) {
    try {
        const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
        if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
            throw new Error('Invalid time format.');
        }
        return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);
    } catch (error) {
        console.error(`Error in parseTimeString: ${error.message}`);
        return 0;
    }
}

function clearAllThreads() {
    try {
        for (let user in userThreads) {
            delete userThreads[user];
        }
    } catch (error) {
        console.error(`Error in clearAllThreads: ${error.message}`);
    }
}

async function generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, client) {
    try {
        if (!userMessage) {
            throw new Error('Empty message received.');
        }

        let threadId;
        if (userThreads[senderNumber]) {
            threadId = userThreads[senderNumber];
        } else {
            const chat = await assistant.beta.threads.create();
            threadId = chat.id;
            userThreads[senderNumber] = threadId;
        }

        await assistant.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage
        });

        const tools = [{
            type: "function",
            function: {
                name: "handle_human_request",
                description: "ONLY call this function when a user EXPLICITLY requests to speak with a human representative or customer service agent. Do NOT call this for general greetings or questions that you can handle.",
                parameters: {
                    type: "object",
                    properties: {
                        intent_confirmed: {
                            type: "boolean",
                            description: "Set to true ONLY if the user has clearly and explicitly expressed wanting to talk to a human representative (e.g., 'I want to talk to a human', 'connect me to customer service'). Set to false for general conversation."
                        },
                        user_query: {
                            type: "string",
                            description: "The user's original query or request"
                        }
                    },
                    required: ["intent_confirmed", "user_query"]
                }
            }
        }];

        const run = await assistant.beta.threads.runs.create(threadId, {
            assistant_id: assistantKey,
            tools: tools
        });

        while (true) {
            const runStatus = await assistant.beta.threads.runs.retrieve(threadId, run.id);

            if (runStatus.status === 'completed') {
                break;
            } else if (runStatus.status === 'requires_action') {
                const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
                const toolOutputs = [];

                for (const toolCall of toolCalls) {
                    if (toolCall.function.name === 'handle_human_request') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            if (args.intent_confirmed) {
                                const result = await handleHumanRequest(senderNumber, client, global.ADMIN_NUMBERS);
                                toolOutputs.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({
                                        status: "success",
                                        message: result
                                    })
                                });
                            } else {
                                toolOutputs.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({
                                        status: "skipped",
                                        message: "Intent not confirmed as human request"
                                    })
                                });
                            }
                        } catch (error) {
                            console.error(`Error processing tool call: ${error.message}`);
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    status: "error",
                                    message: "Failed to process human request"
                                })
                            });
                        }
                    }
                }

                if (toolOutputs.length > 0) {
                    await assistant.beta.threads.runs.submitToolOutputs(threadId, run.id, {
                        tool_outputs: toolOutputs
                    });
                }
            } else if (runStatus.status === 'failed') {
                throw new Error('Run failed');
            }

            await sleep(1000);
        }

        const messages = await assistant.beta.threads.messages.list(threadId);
        const latestMessage = messages.data[0];

        let response = '';
        if (latestMessage.content && latestMessage.content.length > 0) {
            for (const content of latestMessage.content) {
                if (content.type === 'text') {
                    response += content.text.value.trim() + ' ';
                }
            }
        }

        return response.trim() || "I'm sorry, I couldn't generate a response.";
    } catch (error) {
        console.error(`Error in generateResponseOpenAI: ${error.message}`);
        return "Sorry, something went wrong while processing your request.";
    }
}

async function pollRunStatus(client, threadId, runId) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const run = await client.beta.threads.runs.retrieve(threadId, runId);
            if (run.status === "completed") {
                return;
            } else if (run.status === "failed" || run.status === "cancelled") {
                throw new Error(`Run ${runId} ${run.status}`);
            }
            await sleep(POLLING_INTERVAL);
            retries++;
        } catch (error) {
            console.error(`Error polling run status: ${error.message}`);
            throw new Error(`Error polling run status: ${error.message}`);
        }
    }
    throw new Error(`Run ${runId} timed out after ${MAX_RETRIES} attempts`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to add as moderator.');
        }
        moderators.add(number);
    } catch (error) {
        console.error(`Error in addModerator: ${error.message}`);
    }
}

function removeModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to remove as moderator.');
        }
        moderators.delete(number);
    } catch (error) {
        console.error(`Error in removeModerator: ${error.message}`);
    }
}

function isModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to check moderator status.');
        }
        return moderators.has(number);
    } catch (error) {
        console.error(`Error in isModerator: ${error.message}`);
        return false;
    }
}

function checkModerators() {
    try {
        return Array.from(moderators);
    } catch (error) {
        console.error(`Error in checkModerators: ${error.message}`);
        return [];
    }
}

function hasPermission(senderNumber, command, isAdmin, isModerator) {
    const unrestrictedCommands = ['!!un-sub', '!!live-chat', '!!sub', '!!bot'];
    if (unrestrictedCommands.includes(command)) {
        return true;
    }
    if (isAdmin || isModerator) {
        return true;
    }
    return false;
}

async function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator, stopBot, startBot) {
    try {
        let messageText = message.body.trim();
        const [command, ...args] = messageText.split(' ');
        const lowerCommand = command.toLowerCase();

        if (lowerCommand.startsWith('!!')) {
            if (lowerCommand === '!!show-menu') {
                return showMenu(isAdmin, isModerator);
            } else if (hasPermission(senderNumber, lowerCommand, isAdmin, isModerator)) {
                switch (lowerCommand) {
                    case '!!set-key':
                        const newAssistantKey = extractQuotedString(args.join(' '));
                        if (newAssistantKey) {
                            assistantKey = newAssistantKey;
                            return 'Assistant key has been updated.';
                        } else {
                            return 'Please provide a valid assistant key using !!set-key "YourKey".';
                        }

                    case '!!add-mod':
                        const newModerator = extractQuotedString(args.join(' '));
                        if (newModerator) {
                            addModerator(newModerator);
                            return `${newModerator} is now a moderator.`;
                        } else {
                            return 'Please specify the number to add as a moderator: !!add-mod "number".';
                        }

                    case '!!remove-mod':
                        const moderatorToRemove = extractQuotedString(args.join(' '));
                        if (moderatorToRemove) {
                            removeModerator(moderatorToRemove);
                            return `${moderatorToRemove} is no longer a moderator.`;
                        } else {
                            return 'Please specify the number to remove as a moderator: !!remove-mod "number".';
                        }

                    case '!!list-mods':
                        const moderatorsList = checkModerators();
                        return `Current moderators are: ${moderatorsList.join(', ')}`;

                    case '!!clear-threads':
                        clearAllThreads();
                        return 'All threads have been cleared.';

                    case '!!show-menu':
                        if (isAdmin) {
                            return showMenu(true, false);
                        } else if (isModerator) {
                            return showMenu(false, true);
                        } else {
                            return showMenu(false, false);
                        }

                    case '!!pause':
                        if (isAdmin || isModerator) {
                            stopBot();
                            return 'Bot has been paused.';
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!start':
                        if (isAdmin || isModerator) {
                            startBot();
                            return 'Bot has been started.';
                        } else {
                            return "You don't have permission to use this command.";
                        }
                    case '!!no-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            addToIgnoreList(recipientNumber);
                            return `AI assistance disabled for ${recipientNumber}.`;
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!ai-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            removeFromIgnoreList(recipientNumber);
                            return getTemplateMessage(recipientNumber);
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!respond':
                        if (!isAdmin && !isModerator) {
                            return "You don't have permission to use this command.";
                        }
                        
                        try {
                            const quotedStrings = extractMultipleQuotedStrings(args.join(' '));
                            if (quotedStrings.length !== 2) {
                                return 'Please use the format: !!respond "recipient_number" "your message"';
                            }

                            const [recipientNumber, responseMessage] = quotedStrings;
                            
                            if (!recipientNumber.match(/^\d+$/)) {
                                return 'Invalid phone number format. Please provide only numbers without any special characters.';
                            }

                            await sendMessageWithValidation(client, recipientNumber, responseMessage, senderNumber);
                            
                            return `Response sent to ${recipientNumber}`;
                        } catch (error) {
                            console.error('Error in respond command:', error);
                            return 'Failed to send response. Please check the number and try again.';
                        }

                    default:
                        return "Unknown command. Please check the available commands using !!show-menu.";
                }
            } else {
                return "You don't have permission to use this command.";
            }
        } else {
            const response = await storeUserMessage(client, assistantOrOpenAI, senderNumber, message);
            return response;
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        return "An error occurred while processing your message. Our team has been notified.";
    }
}

function extractQuotedString(text) {
    try {
        const match = text.match(/"([^"]+)"/);
        return match ? match[1] : null;
    } catch (error) {
        console.error(`Error in extractQuotedString: ${error.message}`);
        return null;
    }
}

function extractMultipleQuotedStrings(text) {
    try {
        const matches = [...text.matchAll(/"([^"]+)"/g)];
        return matches.map(match => match[1]);
    } catch (error) {
        console.error(`Error in extractMultipleQuotedStrings: ${error.message}`);
        return [];
    }
}

function showMenu(isAdmin, isModerator) {
    try {
        if (isAdmin) {
            return `
*Commands Menu (Admin):*
- !!set-key: Update the assistant key
- !!add-mod: Add a moderator
- !!remove-mod: Remove a moderator
- !!list-mods: List all current moderators
- !!clear-threads: Clear all threads
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else {
            return `
*Commands Menu (User):*
- !!show-menu: Show the command menu
            `;
        }
    } catch (error) {
        console.error(`Error in showMenu: ${error.message}`);
        return "Sorry, unable to display the menu at this time.";
    }
}

const messageQueues = {};
const processingStatus = {};

async function queueMessage(client, assistantOrOpenAI, senderNumber, message) {
    if (!messageQueues[senderNumber]) {
        messageQueues[senderNumber] = [];
    }

    messageQueues[senderNumber].push(message);

    if (!processingStatus[senderNumber]) {
        await processMessageQueue(client, assistantOrOpenAI, senderNumber);
    }
}

async function processMessageQueue(client, assistantOrOpenAI, senderNumber) {
    if (processingStatus[senderNumber] || !messageQueues[senderNumber]?.length) {
        return;
    }

    processingStatus[senderNumber] = true;

    try {
        while (messageQueues[senderNumber].length > 0) {
            const message = messageQueues[senderNumber][0];
            await processUserMessages(client, assistantOrOpenAI, senderNumber, message);
            messageQueues[senderNumber].shift();
            
            await sleep(1000);
        }
    } catch (error) {
        console.error(`Error processing message queue for ${senderNumber}:`, error);
    } finally {
        processingStatus[senderNumber] = false;
    }
}

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === client.info.wid.user) {
        return null;
    }

    if (isIgnored(senderNumber)) {
        return null;
    }

    let messageToStore = '';

    try {
        if (message.type === 'ptt' || message.type === 'audio') {
            const media = await message.downloadMedia();
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcription = await transcribeAudio(assistantOrOpenAI, audioBuffer);
            messageToStore = `Transcribed voice message: ${transcription}`;
        } else if (message.type === 'document') {
            return "As a vision model, I can only process images at the moment. Please send your document as an image if possible.";
        } else if (message.type === 'image') {
            const media = await message.downloadMedia();
            
            const fileSizeInMB = Buffer.from(media.data, 'base64').length / (1024 * 1024);
            if (fileSizeInMB > 10) {
                return "The image is too large to process. Please send an image smaller than 10MB.";
            }

            const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

            if (!supportedTypes.includes(media.mimetype)) {
                return "Please send images in JPEG, PNG, GIF, or WEBP format.";
            }

            const response = await processImageOrDocument(assistantOrOpenAI, media, message.body);
            return response;
        } else {
            messageToStore = message.body || `A message of type ${message.type} was received`;
        }

        await queueMessage(client, assistantOrOpenAI, senderNumber, messageToStore);
        return null;
    } catch (error) {
        console.error(`Error processing message: ${error.message}`);
        return "I encountered an issue processing your message. I can handle images and text messages - please try again!";
    }
}

async function processImageOrDocument(assistantOrOpenAI, media, text) {
    try {
        if (!media.mimetype.startsWith('image/')) {
            return "I can only analyze images at the moment.";
        }

        const base64Data = media.data;
        const defaultPrompt = "What's in this image?";

        const messages = [
            {
                role: "user",
                content: [
                    { type: "text", text: text || defaultPrompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${media.mimetype};base64,${base64Data}`
                        }
                    }
                ]
            }
        ];

        const response = await assistantOrOpenAI.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error in processImageOrDocument:', error);
        return "I can analyze images for you. Please send me an image and I'll describe what I see!";
    }
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === 'status' || !senderNumber) return null;

    const isVoiceMessage = message.startsWith('Transcribed voice message:');

    try {
        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, message, assistantKey, client);

        const formattedSender = formatMexicanNumber(senderNumber);
        const formattedSenderNumber = `${formattedSender}@c.us`;
        
        if (!formattedSenderNumber.match(/^\d+@c\.us$/)) {
            throw new Error(`Invalid sender number format: ${formattedSenderNumber}`);
        }

        if (isVoiceMessage) {
            const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
            const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
            await client.sendMessage(formattedSenderNumber, media, { sendAudioAsVoice: true });
        } else {
            await client.sendMessage(formattedSenderNumber, response);
        }

        return null;

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error with ${senderNumber}: ${error.message}`);
        if (error.message.includes('invalid wid')) {
            console.warn(`Invalid WID error for ${senderNumber}: ${error.message}`);
        } else {
            const errorResponse = "Sorry, an error occurred while processing your messages.";
            const formattedSender = formatMexicanNumber(senderNumber);
            await client.sendMessage(`${formattedSender}@c.us`, errorResponse);
            return null;
        }
    }
}

async function transcribeAudio(assistantOrOpenAI, audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.ogg' });
    formData.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
    });

    return response.data.text;
}

async function generateAudioResponse(assistantOrOpenAI, text) {
    const response = await assistantOrOpenAI.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
}

async function handleHumanRequest(senderNumber, client, adminNumbers) {
    try {
        if (!senderNumber || typeof senderNumber !== 'string') {
            console.error('Invalid sender number:', senderNumber);
            throw new Error('Invalid sender number');
        }

        if (!client) {
            console.error('WhatsApp client not provided');
            throw new Error('WhatsApp client not provided');
        }

        if (!adminNumbers || !Array.isArray(adminNumbers) || adminNumbers.length === 0) {
            console.error('No admin numbers available');
            throw new Error('No admin numbers configured');
        }

        const timestamp = new Date().toLocaleString();
        
        const notificationMessage = `
🔔 *Human Representative Request*
---------------------------
From: ${senderNumber}
Time: ${timestamp}
Status: Awaiting response
---------------------------
To respond, use: !!respond "${senderNumber}" "your message"`;
        
        let notifiedAdmins = 0;
        let failedNotifications = [];
        
        for (const adminNumber of adminNumbers) {
            try {
                const formattedAdminNumber = `${adminNumber}@c.us`;
                await client.sendMessage(formattedAdminNumber, notificationMessage);
                notifiedAdmins++;
            } catch (error) {
                failedNotifications.push(adminNumber);
                console.error(`❌ Failed to notify admin ${adminNumber}: ${error.message}`);
            }
        }

        if (notifiedAdmins === 0) {
            console.error('Failed to notify any admins about human request');
            throw new Error('Failed to reach customer service team');
        }
        
        return `I've forwarded your request to our customer service team. A human representative will contact you shortly. Your request has been logged at ${timestamp}. Thank you for your patience.`;
    } catch (error) {
        console.error('Error in handleHumanRequest:', error);
        return "I apologize, but I'm having trouble reaching our customer service team. Please try again in a few minutes.";
    }
}

module.exports = {
    showMenu,
    parseTimeString,
    generateResponseOpenAI,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    sleep,
    clearAllThreads,
    storeUserMessage,
    processUserMessages,
    transcribeAudio,
    generateAudioResponse,
    loadIgnoreList,
    isIgnored,
    addToIgnoreList,
    removeFromIgnoreList,
    handleHumanRequest,
    queueMessage,
    processMessageQueue,
    sendMessageWithValidation,
};

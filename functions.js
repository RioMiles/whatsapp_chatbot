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

const activeThreads = new Set();

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
        activeThreads.clear();
    } catch (error) {
        console.error(`Error in clearAllThreads: ${error.message}`);
    }
}

async function generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, client) {
    try {
        // Extract the actual message content
        const messageContent = typeof userMessage === 'object' ? userMessage.content : userMessage;

        if (!messageContent) {
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
            content: messageContent
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
                console.error('Run failed with error:', runStatus.last_error);
                throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
            } else if (runStatus.status === 'expired') {
                throw new Error('Run expired');
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
        throw error; // Let the caller handle the error
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

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === client.info.wid.user) {
        return null;
    }

    if (isIgnored(senderNumber)) {
        return null;
    }

    try {
        if (message.type === 'ptt' || message.type === 'audio') {
            const media = await message.downloadMedia();
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcription = await transcribeAudio(assistantOrOpenAI, audioBuffer);
            return await processUserMessages(client, assistantOrOpenAI, senderNumber, {
                type: 'voice',
                content: `Transcribed voice message: ${transcription}`,
                originalMessage: message
            });
        } else if (message.type === 'document') {
            return message.reply("As a vision model, I can only process images at the moment. Please send your document as an image if possible.");
        } else if (message.type === 'image') {
            const media = await message.downloadMedia();

            const fileSizeInMB = Buffer.from(media.data, 'base64').length / (1024 * 1024);
            if (fileSizeInMB > 10) {
                return message.reply("The image is too large to process. Please send an image smaller than 10MB.");
            }

            const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!supportedTypes.includes(media.mimetype)) {
                return message.reply("Please send images in JPEG, PNG, GIF, or WEBP format.");
            }

            return await processUserMessages(client, assistantOrOpenAI, senderNumber, {
                type: 'image',
                media: media,
                caption: message.body,
                originalMessage: message
            });
        } else {
            return await processUserMessages(client, assistantOrOpenAI, senderNumber, {
                type: 'text',
                content: message.body || `A message of type ${message.type} was received`,
                originalMessage: message
            });
        }
    } catch (error) {
        console.error(`Error processing message: ${error.message}`);
        return message.reply("I encountered an issue processing your message. I can handle images and text messages - please try again!");
    }
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === 'status' || !senderNumber) return null;

    // Check if thread is active
    if (activeThreads.has(senderNumber)) {
        await message.originalMessage.reply("I'm still processing your previous message. Please wait a moment.");
        return null;
    }

    try {
        // Mark thread as active
        activeThreads.add(senderNumber);

        let response;
        if (message.type === 'image') {
            response = await processImageOrDocument(assistantOrOpenAI, message.media, message.caption, senderNumber);
        } else {
            try {
                response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, message.content, assistantKey, client);
            } catch (error) {
                console.error('Error in generateResponseOpenAI:', error);
                // If the thread is failing, clear it and try again
                delete userThreads[senderNumber];
                response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, message.content, assistantKey, client);
            }

            if (message.type === 'voice') {
                const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
                const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
                await message.originalMessage.reply(media, null, { sendAudioAsVoice: true });
                return null;
            }
        }

        // Reply to the original message
        await message.originalMessage.reply(response);
        return null;

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error with ${senderNumber}: ${error.message}`);
        const errorResponse = "I encountered an unexpected error. Let me start a fresh conversation.";
        await message.originalMessage.reply(errorResponse);
        // Clear the thread to start fresh
        delete userThreads[senderNumber];
        return null;
    } finally {
        // Always remove from active threads when done
        activeThreads.delete(senderNumber);
    }
}

async function processImageOrDocument(assistantOrOpenAI, media, text, senderNumber) {
    try {
        if (!media.mimetype.startsWith('image/')) {
            return "I can only analyze images at the moment.";
        }

        let threadId;
        if (userThreads[senderNumber]) {
            threadId = userThreads[senderNumber];
        } else {
            const chat = await assistantOrOpenAI.beta.threads.create();
            threadId = chat.id;
            userThreads[senderNumber] = threadId;
        }

        const base64Data = media.data;
        const defaultPrompt = "What's in this image?";

        // Create a temporary file
        const tempFilePath = path.join(__dirname, `temp_${Date.now()}.${media.mimetype.split('/')[1]}`);

        try {
            // Write the buffer to a temporary file
            fs.writeFileSync(tempFilePath, Buffer.from(base64Data, 'base64'));

            // Create a ReadStream for the file
            const fileStream = fs.createReadStream(tempFilePath);

            // Upload the file to OpenAI
            const uploadResponse = await assistantOrOpenAI.files.create({
                file: fileStream,
                purpose: 'assistants'
            });

            // Wait for file to be fully processed
            let fileStatus;
            do {
                await sleep(1000);
                fileStatus = await assistantOrOpenAI.files.retrieve(uploadResponse.id);
            } while (fileStatus.status === 'processing');

            if (fileStatus.status !== 'processed') {
                throw new Error('File processing failed');
            }

            // Create message with the uploaded file
            await assistantOrOpenAI.beta.threads.messages.create(threadId, {
                role: 'user',
                content: [
                    {
                        type: "text",
                        text: text || defaultPrompt
                    },
                    {
                        type: "image_file",
                        image_file: {
                            file_id: uploadResponse.id
                        }
                    }
                ]
            });

            // Create and wait for run
            const run = await assistantOrOpenAI.beta.threads.runs.create(threadId, {
                assistant_id: assistantKey
            });

            // Poll run status with timeout
            let runStatus;
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds timeout

            while (attempts < maxAttempts) {
                runStatus = await assistantOrOpenAI.beta.threads.runs.retrieve(threadId, run.id);

                if (runStatus.status === 'completed') {
                    break;
                }

                if (runStatus.status === 'failed' || runStatus.status === 'expired') {
                    throw new Error(`Run ${runStatus.status}: ${runStatus.last_error?.message || 'Unknown error'}`);
                }

                await sleep(1000);
                attempts++;
            }

            if (attempts >= maxAttempts) {
                throw new Error('Run timed out');
            }

            // Get the response
            const messages = await assistantOrOpenAI.beta.threads.messages.list(threadId);
            const latestMessage = messages.data[0];

            let response = '';
            if (latestMessage.content && latestMessage.content.length > 0) {
                for (const content of latestMessage.content) {
                    if (content.type === 'text') {
                        response += content.text.value.trim() + ' ';
                    }
                }
            }

            return response.trim() || "I'm sorry, I couldn't analyze the image properly.";
        } finally {
            // Clean up
            try {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temporary file:', cleanupError);
            }
        }
    } catch (error) {
        console.error('Error in processImageOrDocument:', error);
        return "I encountered an error while analyzing the image. Please try again!";
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
    sendMessageWithValidation,
};

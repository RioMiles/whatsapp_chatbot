const axios = require('axios');
const fs = require('fs');

const CALENDLY_API_KEY = process.env.CALENDLY_API_KEY || '';
if (!CALENDLY_API_KEY) {
    throw new Error('CALENDLY_API_KEY environment variable is required');
}

const BASE_URL = 'https://api.calendly.com';
const PROCESSED_EVENTS_FILE = 'processed_events.json';
const REMINDER_FILE = 'appointment_reminders.json';
const REMINDER_HOURS = 24;

function loadProcessedEvents() {
    try {
        if (fs.existsSync(PROCESSED_EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(PROCESSED_EVENTS_FILE, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading processed events:', error);
        return [];
    }
}

function saveProcessedEvents(events) {
    try {
        fs.writeFileSync(PROCESSED_EVENTS_FILE, JSON.stringify(events, null, 2));
    } catch (error) {
        console.error('Error saving processed events:', error);
    }
}

async function getCurrentUser() {
    try {
        const response = await axios.get(`${BASE_URL}/users/me`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.resource.uri;
    } catch (error) {
        console.error('Failed to fetch user information:', error.message);
        return null;
    }
}

async function getEventDetails(eventUri) {
    try {
        const response = await axios.get(eventUri, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const event = response.data.resource;

        // Change default timezone to CET
        const eventTimezone = event.event_type?.scheduling_preferences?.timezone ||
            event.event_type?.timezone ||
            event.event_memberships?.[0]?.user?.timezone ||
            'Europe/Paris'; // Default to CET timezone if none specified

        console.log('Event Timezone:', eventTimezone);
        console.log('Event Details:', {
            name: event.name,
            start_time: event.start_time,
            end_time: event.end_time,
            timezone: eventTimezone
        });

        return {
            ...event,
            timezone: eventTimezone
        };
    } catch (error) {
        console.error('Failed to fetch event details:', error);
        return {
            timezone: 'Europe/Paris', // Fallback to CET
            start_time: null,
            end_time: null,
            name: 'N/A'
        };
    }
}

async function getInviteeDetails(eventUri) {
    try {
        const response = await axios.get(`${eventUri}/invitees`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const invitees = response.data.collection;
        if (invitees.length === 0) return {};
        const invitee = invitees[0];
        let phoneNumber = null;
        let message = null;
        if (invitee.questions_and_answers) {
            for (const qa of invitee.questions_and_answers) {
                if (qa.question.toLowerCase().includes('phone') ||
                    qa.question.toLowerCase().includes('whatsapp') ||
                    qa.question.toLowerCase().includes('número')) {
                    phoneNumber = qa.answer.replace(/\D/g, '');
                }
                if (qa.question.toLowerCase().includes('message') ||
                    qa.question.toLowerCase().includes('mensaje') ||
                    qa.question.toLowerCase().includes('notes')) {
                    message = qa.answer;
                }
            }
        }
        return {
            ...invitee,
            phoneNumber,
            message
        };
    } catch (error) {
        console.error('Failed to fetch invitee details:', error.message);
        return {};
    }
}

function formatEventMessage(event, invitee, isPatient = false) {
    // Configure date formatting options with timezone
    const dateOptions = {
        timeZone: event.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short' // This will add the timezone abbreviation
    };

    // Add safety checks for date conversion
    let startTime, endTime;
    try {
        const startDate = new Date(event.start_time);
        const endDate = new Date(event.end_time);

        startTime = startDate.toLocaleString('en-US', dateOptions);
        endTime = endDate.toLocaleString('en-US', dateOptions);

        // Log the conversion for debugging
        console.log('Time Conversion:', {
            original_start: event.start_time,
            original_end: event.end_time,
            converted_start: startTime,
            converted_end: endTime,
            timezone: event.timezone
        });
    } catch (error) {
        console.error('Error formatting dates:', error);
        startTime = 'Time conversion error';
        endTime = 'Time conversion error';
    }

    if (isPatient) {
        let message = `🗓️ *Your Appointment Confirmation*\n\n` +
            `Thank you for scheduling an appointment!\n\n` +
            `📝 *Event Type:* ${event.name || 'N/A'}\n` +
            `🕒 *Start:* ${startTime} (${event.timezone})\n` +
            `🕕 *End:* ${endTime} (${event.timezone})\n` +
            `🔗 *Cancellation Link:* ${invitee.cancel_url || 'N/A'}\n\n`;

        if (invitee.message) {
            message += `📝 *Your Message:* ${invitee.message}\n\n`;
        }
        message += `Please arrive 10 minutes before your scheduled time. If you need to reschedule, please use the cancellation link above.`;
        return message;
    }

    let message = `🗓️ *New Appointment Scheduled!*\n\n` +
        `👤 *Invitee Name:* ${invitee.name || 'N/A'}\n` +
        `📧 *Email:* ${invitee.email || 'N/A'}\n` +
        `📱 *Phone:* ${invitee.phoneNumber || 'N/A'}\n` +
        `🕒 *Start:* ${startTime} (${event.timezone})\n` +
        `🕕 *End:* ${endTime} (${event.timezone})\n` +
        `📝 *Event Type:* ${event.name || 'N/A'}\n` +
        `🔗 *Cancellation Link:* ${invitee.cancel_url || 'N/A'}`;

    if (invitee.message) {
        message += `\n\n💬 *Client Message:* ${invitee.message}`;
    }
    return message;
}

function loadReminders() {
    try {
        if (fs.existsSync(REMINDER_FILE)) {
            return JSON.parse(fs.readFileSync(REMINDER_FILE, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading reminders:', error);
        return [];
    }
}

function saveReminders(reminders) {
    try {
        fs.writeFileSync(REMINDER_FILE, JSON.stringify(reminders, null, 2));
    } catch (error) {
        console.error('Error saving reminders:', error);
    }
}

function formatReminderMessage(event, invitee) {
    const dateOptions = {
        timeZone: event.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };

    const startTime = new Date(event.start_time).toLocaleString('en-US', dateOptions);

    return `🔔 *Appointment Reminder*\n\n` +
        `This is a reminder of your upcoming appointment:\n\n` +
        `📝 *Event Type:* ${event.name || 'N/A'}\n` +
        `🕒 *Time:* ${startTime} (${event.timezone})\n` +
        `📍 *Location:* ${event.location || 'To be confirmed'}\n\n` +
        `If you need to reschedule, please use this link:\n` +
        `${invitee.cancel_url || 'N/A'}\n\n` +
        `Please arrive 10 minutes before your scheduled time.`;
}

async function checkAndSendReminders(client) {
    try {
        const reminders = loadReminders();
        const now = new Date();
        const remindersToSend = reminders.filter(reminder => {
            const appointmentTime = new Date(reminder.start_time);
            const timeDiff = appointmentTime - now;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            const bookingTime = new Date(reminder.created_at);
            const timeFromBooking = appointmentTime - bookingTime;
            const hoursFromBooking = timeFromBooking / (1000 * 60 * 60);
            return hoursDiff <= REMINDER_HOURS &&
                hoursDiff > (REMINDER_HOURS - 1) &&
                !reminder.reminderSent &&
                hoursFromBooking > 24;
        });

        for (const reminder of remindersToSend) {
            try {
                const formattedPhoneNumber = formatMexicanNumber(reminder.phoneNumber);
                const formattedNumber = `${formattedPhoneNumber}@c.us`;
                const reminderMessage = formatReminderMessage(reminder.event, reminder.invitee);
                const isRegistered = await client.isRegisteredUser(formattedNumber);
                if (isRegistered) {
                    await client.sendMessage(formattedNumber, reminderMessage);
                    reminder.reminderSent = true;
                }
            } catch (error) {
                console.error(`Error sending reminder to ${reminder.phoneNumber}:`, error);
            }
        }

        saveReminders(reminders);
        const activeReminders = reminders.filter(reminder => {
            const appointmentTime = new Date(reminder.start_time);
            return appointmentTime > now;
        });
        saveReminders(activeReminders);
    } catch (error) {
        console.error('Error checking reminders:', error);
    }
}

async function checkNewAppointments(client, adminNumbers) {
    try {
        const userUri = await getCurrentUser();
        if (!userUri) {
            console.error('Unable to fetch user information');
            return 0;
        }

        const now = new Date();
        const endTime = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

        const response = await axios.get(`${BASE_URL}/scheduled_events`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: {
                min_start_time: now.toISOString(),
                max_start_time: endTime.toISOString(),
                status: 'active',
                user: userUri,
                timezone: 'Europe/Paris'
            }
        });

        const processedEvents = loadProcessedEvents();
        const events = response.data.collection;
        const newEvents = events.filter(event => !processedEvents.includes(event.uri));

        // Save new appointments to appointments.json
        for (const event of newEvents) {
            try {
                const eventDetails = await getEventDetails(event.uri);
                const inviteeDetails = await getInviteeDetails(event.uri);

                // Create appointment object
                const appointment = {
                    invitee_name: inviteeDetails.name,
                    invitee_email: inviteeDetails.email,
                    start_time: eventDetails.start_time,
                    end_time: eventDetails.end_time,
                    event_type: eventDetails.name,
                    status: 'active',
                    cancel_url: inviteeDetails.cancel_url,
                    created_at: new Date().toISOString()
                };

                // Save appointment using dashboard API
                try {
                    await axios.post('http://0.0.0.0:8080/save_appointment', appointment, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log('Appointment saved successfully:', appointment.invitee_name);
                } catch (saveError) {
                    console.error('Error saving appointment:', saveError);
                }

                // Send notifications
                const adminMessage = formatEventMessage(eventDetails, inviteeDetails, false);
                const userMessage = formatEventMessage(eventDetails, inviteeDetails, true);

                // Send to admins
                for (const adminNumber of adminNumbers) {
                    try {
                        const formattedAdminNumber = `${adminNumber}@c.us`;
                        await client.sendMessage(formattedAdminNumber, adminMessage);
                    } catch (error) {
                        console.error(`Error sending admin message to ${adminNumber}:`, error);
                    }
                }

                // Send to user if phone number exists
                if (inviteeDetails.phoneNumber) {
                    try {
                        const formattedPhoneNumber = formatMexicanNumber(inviteeDetails.phoneNumber);
                        const formattedUserNumber = `${formattedPhoneNumber}@c.us`;
                        const isRegistered = await client.isRegisteredUser(formattedUserNumber);

                        if (isRegistered) {
                            await client.sendMessage(formattedUserNumber, userMessage);
                            console.log(`Sent booking confirmation to user: ${formattedPhoneNumber}`);
                        }
                    } catch (error) {
                        console.error(`Error sending user message to ${inviteeDetails.phoneNumber}:`, error);
                    }
                }

                // Handle reminders
                if (inviteeDetails.phoneNumber) {
                    try {
                        const formattedPhoneNumber = formatMexicanNumber(inviteeDetails.phoneNumber);
                        const reminders = loadReminders();
                        reminders.push({
                            phoneNumber: formattedPhoneNumber,
                            event: eventDetails,
                            invitee: inviteeDetails,
                            start_time: eventDetails.start_time,
                            reminderSent: false,
                            created_at: new Date().toISOString()
                        });
                        saveReminders(reminders);
                        console.log(`Added reminder for ${formattedPhoneNumber}`);
                    } catch (error) {
                        console.error('Error adding reminder:', error);
                    }
                }
            } catch (error) {
                console.error('Error processing event:', error);
            }
            processedEvents.push(event.uri);
        }

        saveProcessedEvents(processedEvents);
        return newEvents.length;
    } catch (error) {
        console.error('Error checking for new appointments:', error);
        return 0;
    }
}

function extractPhoneNumber(inviteeDetails) {
    try {
        if (inviteeDetails.questions_and_answers) {
            const phoneQuestion = inviteeDetails.questions_and_answers.find(q =>
                q.question.toLowerCase().includes('phone') ||
                q.question.toLowerCase().includes('mobile') ||
                q.question.toLowerCase().includes('whatsapp')
            );

            if (phoneQuestion) {
                let phone = phoneQuestion.answer.replace(/[\s\-\(\)]/g, '');
                if (phone.startsWith('+')) {
                    phone = phone.substring(1);
                }
                return phone;
            }
        }

        if (inviteeDetails.custom_fields) {
            const phoneField = inviteeDetails.custom_fields.find(f =>
                f.name.toLowerCase().includes('phone') ||
                f.name.toLowerCase().includes('mobile') ||
                f.name.toLowerCase().includes('whatsapp')
            );

            if (phoneField) {
                let phone = phoneField.value.replace(/[\s\-\(\)]/g, '');
                if (phone.startsWith('+')) {
                    phone = phone.substring(1);
                }
                return phone;
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting phone number:', error);
        return null;
    }
}

function formatMexicanNumber(number) {
    if (number.startsWith('52') && number.length === 12 && !number.startsWith('521')) {
        return `521${number.slice(2)}`;
    }
    return number;
}

module.exports = {
    checkNewAppointments,
    checkAndSendReminders
}; 

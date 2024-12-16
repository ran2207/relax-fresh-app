const axios = require('axios');
const { SERVICES, DURATIONS } = require('../utils/constants');
const { generateBookingId, capitalize } = require('../utils/helpers');

/**
 * @typedef {Object} WhatsAppMessage
 * @property {string} from - The sender's phone number
 * @property {string} type - The type of the message (text/interactive)
 * @property {Object} [text]
 * @property {Object} [interactive]
 */

// This object can track user states in memory (session). For a production system,
// consider a persistent store or Redis.
const bookingData = {};

/**
 * Send a text message to WhatsApp.
 * @param {string} to - Recipient phone number
 * @param {string} message - Text message body
 */
async function sendTextMessage(to, message) {
  const url = `https://graph.facebook.com/v16.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    text: { body: message }
  };

  try {
    await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// Similar functions for sending interactive messages can be here...

/**
 * Handle an incoming WhatsApp message.
 * @param {WhatsAppMessage} message - The incoming message object
 */
async function handleWhatsAppMessage(message) {
  const from = message.from;
  let text = '';
  
  if (message.type === 'text') {
    text = message.text.body.trim().toLowerCase();
  }

  // Simple example: If user says "hi", show service list.
  if (!bookingData[from]) bookingData[from] = { step: 0 };

  const state = bookingData[from];
  if (state.step === 0 && text.includes('hi')) {
    state.step = 1;
    await sendTextMessage(from, "Hello! Please select a service."); 
    // You would implement sendServicesList() similar to your previous code.
  } else {
    // Handle other steps similarly...
  }
}

module.exports = { handleWhatsAppMessage };

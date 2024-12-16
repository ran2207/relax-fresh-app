const { handleWhatsAppMessage } = require('../handlers/whatsappHandler');

/**
 * @function verifyWebhook
 * @description Verifies the WhatsApp webhook subscription
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

/**
 * @function receiveMessage
 * @description Receives messages from WhatsApp and delegates to the handler.
 */
async function receiveMessage(req, res) {
  const body = req.body;
  if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    await handleWhatsAppMessage(message);
    return res.sendStatus(200);
  }
  return res.sendStatus(200);
}

module.exports = { verifyWebhook, receiveMessage };

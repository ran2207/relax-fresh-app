const express = require('express');
const { testController } = require('../controllers/telegramController');

const router = express.Router();

// If you had Telegram webhooks, you'd use something like:
// router.post('/webhook', telegramWebhookHandler);

router.get('/test', testController);

module.exports = router;

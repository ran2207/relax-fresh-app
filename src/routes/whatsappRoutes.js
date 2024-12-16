const express = require('express');
const { verifyWebhook, receiveMessage } = require('../controllers/whatsappController');

const router = express.Router();

router.get('/', verifyWebhook);
router.post('/', receiveMessage);

module.exports = router;

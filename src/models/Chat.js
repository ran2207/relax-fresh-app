const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: String, // "client" or "bot"
  message: String,
  timestamp: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  messages: [messageSchema]
}, {
    timestamps: true
});

chatSchema.index({ phone: 1 });

module.exports = mongoose.model('Chat', chatSchema);

const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true },
  name: { type: String, default: '' },    // Optional, can be skipped
  email: { type: String },                // Optional
  gender: { type: String, default: '' },  // Optional ("Male", "Female", or "")
  address: { type: String, required: true },
  mapLink: { type: String, default: '' }, // Optional, can be skipped
}, {
    timestamps: true
});

// Indexes
clientSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model('Client', clientSchema);

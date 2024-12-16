const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, unique: true },
  role: String,
  availabilityStatus: { type: String, default: 'free' }, // "free" or "busy"
  salary: Number,
  joiningDate: Date,
  documents: {
    emiratesId: String,
    passport: String,
    visa: String,
    labourCard: String
  }
}, {
    timestamps: true
});

staffSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model('Staff', staffSchema);

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true },
  clientPhone: { type: String, required: true },
  serviceType: { type: String, required: true },
  duration: { type: Number, required: true },
  requestedDate: { type: Date, required: true },
  requestedTimeSlot: {
    start: { type: Date, required: true },
    end: { type: Date, required: true }
  },
  amount: { type: Number, default: 0 },
  shared: { type: Boolean, default: false },
  status: { type: String, default: 'Pending' },
  assignedStaff: { type: String, default: null },
  source: { type: String, default: 'staff' }, 
  groupMessageId: { type: Number, default: null },
  groupChatId: { type: Number, default: null }
}, {
  timestamps: true
});

bookingSchema.index({ clientPhone: 1 });
bookingSchema.index({ bookingId: 1 }, { unique: true });

module.exports = mongoose.model('Booking', bookingSchema);

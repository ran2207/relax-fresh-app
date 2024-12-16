const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  category: String,
  description: String,
  amount: Number,
  date: { type: Date, default: Date.now },
}, {
    timestamps: true
});

expenseSchema.index({ date: 1 });

module.exports = mongoose.model('Expense', expenseSchema);

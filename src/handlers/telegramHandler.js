const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const _ = require('lodash');

// Models
const Booking = require('../models/Booking');
const Client = require('../models/Client');
const Staff = require('../models/Staff');
const Expense = require('../models/Expense');

const {
  PRESET_AMOUNTS,
  DURATION_OPTIONS,
  PAYMENT_OPTIONS,
  PROFIT_OPTIONS,
  STAFF_OPTIONS,
  SERVICES,
  PRESET_TIMES
} = require('../utils/telegramConstants');

const receiveChatId = Number(process.env.TELEGRAM_RECEIVE_CHAT_ID || 0);
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken || !receiveChatId) {
  throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_RECEIVE_CHAT_ID must be set.");
}

const bot = new TelegramBot(botToken, { polling: true });
console.log("Telegram bot is running...");

// In-memory state for ongoing flows (bookings, clients, expenses, staff)
const bookingData = {}; 
const messageTracker = {};

// ------------------------ Utility Functions ------------------------

function trackMessage(chatId, messageId) {
  if (!messageTracker[chatId]) {
    messageTracker[chatId] = new Set();
  }
  messageTracker[chatId].add(messageId);
}

function cleanupAfterDelay(chatId, delayMs = 3000) {
  setTimeout(async () => {
    try {
      const trackedSet = messageTracker[chatId] || new Set();
      const messageIds = Array.from(trackedSet);
      await Promise.all(messageIds.map(msgId => bot.deleteMessage(chatId, msgId).catch(() => {})));
      delete messageTracker[chatId];
      delete bookingData[chatId];
    } catch (error) {
      console.error('Error cleaning up chat:', error);
    }
  }, delayMs);
}

async function sendTrackedMessage(chatId, text, options = {}) {
  const msg = await bot.sendMessage(chatId, text, options);
  trackMessage(chatId, msg.message_id);
  return msg;
}

function sendMessageWithInlineKeyboard(chatId, text, inline_keyboard) {
  return bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard }
  }).then(m => {
    trackMessage(chatId, m.message_id);
    return m;
  });
}

async function sendToReceiverChat(message) {
  try {
    const sent = await bot.sendMessage(receiveChatId, message, { parse_mode: 'Markdown' });
    return sent;
  } catch (error) {
    console.error('Error sending message to receiver chat:', error);
  }
  return null;
}

function normalizePhoneNumber(phone) {
  return phone.replace(/\s|\+|\-/g, '');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseDateTime(dateStr, timeStr) {
  return moment(`${dateStr} ${timeStr}`, "YYYY-MM-DD hh:mm A").toDate();
}

function formatDateForDisplay(dateStr) {
  return moment(dateStr, 'YYYY-MM-DD').format('DD-MM-YYYY');
}

// ------------------------ Main Menu ------------------------

function showMainMenu(chatId) {
  const text = "Please choose an option:";
  const buttons = [
    [{ text: 'Bookings', callback_data: 'main_bookings' }],
    [{ text: 'Clients', callback_data: 'main_clients' }],
    [{ text: 'Expenses', callback_data: 'main_expenses' }],
    [{ text: 'Staff', callback_data: 'main_staff' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function clearChat(chatId) {
  sendTrackedMessage(chatId, "Clearing chat...").then(() => {
    cleanupAfterDelay(chatId);
  });
}

// ------------------------ Bookings Flow ------------------------

async function getLast10Bookings() {
  return Booking.find().sort({ createdAt: -1 }).limit(10).lean();
}

function generateBookingId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function showBookingMenu(chatId) {
  const text = "Booking Options:";
  const buttons = [
    [{ text: 'Create New Booking', callback_data: 'booking_new' }],
    [{ text: 'Update Booking', callback_data: 'booking_update' }],
    [{ text: 'Earnings/Profits', callback_data: 'booking_earnings' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function startBookingFlow(chatId) {
  bookingData[chatId] = {
    step: 1,
    amount: null,
    duration: null,
    paymentMethod: null,
    profitShare: null,
    staff: null,
    service: null,
    date: null,
    time: null,
    clientPhone: null,
    name: null,
    gender: null,
    address: null,
    mapLink: null,
    existingClient: false,
    messageIds: [],
    source: 'staff',
    bookingFlow: true
  };
  askAmount(chatId);
}

function askAmount(chatId) {
  const text = "Step 1/8: Please select or enter the booking amount.";
  const buttons = PRESET_AMOUNTS.map(a => [{ text: a.toString(), callback_data: 'amount_' + a }]);
  buttons.push([{ text: 'Custom', callback_data: 'amount_custom' }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askDuration(chatId) {
  const text = "Step 2/8: Choose a duration.";
  const buttons = DURATION_OPTIONS.map(d => [{ text: d, callback_data: 'duration_' + d }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askPayment(chatId) {
  const text = "Step 3/8: Choose a payment method.";
  const buttons = PAYMENT_OPTIONS.map(p => [{ text: p, callback_data: 'payment_' + p.toLowerCase() }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askProfit(chatId) {
  const text = "Step 4/8: Choose profit sharing option.";
  const buttons = PROFIT_OPTIONS.map(o => [{ text: o, callback_data: 'profit_' + o.replace(' ', '_').toLowerCase() }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askStaff(chatId) {
  const text = "Step 5/8: Select staff.";
  const buttons = STAFF_OPTIONS.map(s => [{ text: s, callback_data: 'staff_' + s.toLowerCase() }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askServices(chatId) {
  const text = "Step 6/8: Select a service.";
  const buttons = SERVICES.map(service => [
    { text: service.name, callback_data: 'service_' + service.id }
  ]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askDate(chatId) {
  const text = "Step 7/8: Choose a date";
  const today = moment();
  const tomorrow = moment().add(1,'day');

  const todayFormatted = today.format('YYYY-MM-DD');
  const tomorrowFormatted = tomorrow.format('YYYY-MM-DD');

  const buttons = [
    [
      { text: 'Today', callback_data: `date_${todayFormatted}` },
      { text: 'Tomorrow', callback_data: `date_${tomorrowFormatted}` }
    ],
    [{ text: 'Custom Date', callback_data: 'date_custom' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askTime(chatId) {
  const text = "Step 8/8: Select a time";
  const buttons = PRESET_TIMES.map(t => [{ text: t, callback_data: 'time_' + t.replace(/ /g,'_') }]);
  buttons.push([{ text: 'Custom Time', callback_data: 'time_custom' }]);
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askClientPhone(chatId) {
  const text = "Please type the client's phone number (staff entering):";
  sendTrackedMessage(chatId, text).then(() => {
    bookingData[chatId].awaitingClientPhone = true;
  });
}

async function checkClientAndProceed(chatId) {
  const state = bookingData[chatId];
  const normalizedPhone = normalizePhoneNumber(state.clientPhone);
  const client = await Client.findOne({ phone: normalizedPhone });

  if (client) {
    state.existingClient = true;
    state.name = client.name || null;
    state.gender = client.gender || null;
    state.address = client.address || null;
    state.mapLink = client.mapLink || null;
    askUseExistingAddress(chatId, state.address);
  } else {
    state.existingClient = false;
    askName(chatId);
  }
}

function askUseExistingAddress(chatId, address) {
  const text = `Client exists. Current address on file:\n${address}\nUse this address?`;
  const buttons = [
    [{ text: "Yes", callback_data: 'use_existing_address_yes' }, { text: "No", callback_data: 'use_existing_address_no' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askName(chatId) {
  const text = "What is the client's name? Type the name or click Skip.";
  const buttons = [[{ text: 'Skip', callback_data: 'name_skip' }]];
  sendMessageWithInlineKeyboard(chatId, text, buttons).then(() => {
    bookingData[chatId].awaitingName = true;
  });
}

function askGender(chatId) {
  const text = "Select client's gender or skip:";
  const buttons = [
    [{ text: 'Male', callback_data: 'gender_male' }, { text: 'Female', callback_data: 'gender_female' }, { text: 'Skip', callback_data: 'gender_skip' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

function askAddress(chatId) {
  const text = "Please enter the client's address:";
  sendTrackedMessage(chatId, text).then(() => {
    bookingData[chatId].awaitingAddress = true;
  });
}

function askMapLink(chatId) {
  const text = "Does the client have a Google Map location link? Type it or press Skip.";
  const buttons = [[{ text: 'Skip', callback_data: 'map_skip' }]];
  sendMessageWithInlineKeyboard(chatId, text, buttons).then(() => {
    bookingData[chatId].awaitingMapLink = true;
  });
}

async function createClientRecord(chatId) {
  const state = bookingData[chatId];
  const normalizedPhone = normalizePhoneNumber(state.clientPhone);
  const newClient = new Client({
    phone: normalizedPhone,
    name: state.name || '',
    gender: state.gender || '',
    address: state.address,
    mapLink: state.mapLink || '',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await newClient.save();
  showBookingSummary(chatId);
}

async function updateClientAddress(chatId) {
  const state = bookingData[chatId];
  const normalizedPhone = normalizePhoneNumber(state.clientPhone);
  await Client.findOneAndUpdate({ phone: normalizedPhone }, {
    address: state.address,
    updatedAt: new Date()
  });
  showBookingSummary(chatId);
}

function showBookingSummary(chatId) {
  const data = bookingData[chatId];
  const summary = `
Booking Summary:

Amount: ${data.amount} AED
Duration: ${data.duration} minutes
Payment: ${data.paymentMethod}
Profit: ${data.profitShare}
Staff: ${data.staff ? data.staff : 'Not Assigned'}
Service: ${data.service}
Date: ${formatDateForDisplay(data.date)}
Time: ${data.time}
Phone: ${data.clientPhone}
Name: ${data.name || 'Not provided'}
Gender: ${data.gender || 'Not provided'}
Address: ${data.address}
Map Link: ${data.mapLink || 'Not provided'}

Confirm this booking?
  `.trim();

  const buttons = [
    [{ text: 'Confirm', callback_data: 'final_confirm' }, { text: 'Cancel', callback_data: 'cancel_booking_flow' }]
  ];
  sendMessageWithInlineKeyboard(chatId, summary, buttons);
}

async function finalConfirmBooking(chatId) {
  const state = bookingData[chatId];
  const bookingId = generateBookingId();

  const startDate = parseDateTime(state.date, state.time);
  const endDate = new Date(startDate.getTime() + parseInt(state.duration, 10)*60000);
  const initialStatus = state.source === 'staff' ? 'Completed' : 'Pending';

  
  const newBooking = new Booking({
    bookingId,
    amount: parseFloat(state.amount),
    clientPhone: state.clientPhone,
    serviceType: state.service,
    duration: parseInt(state.duration, 10),
    requestedDate: startDate,
    requestedTimeSlot: { start: startDate, end: endDate },
    status: initialStatus,
    shared: state.profitShare === 'Shared',
    source: state.source,
    assignedStaff: state.staff || null,  
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await newBooking.save();

  // More elegant booking confirmation with markdown and emojis
  const confirmationMessage = `
✅ *Booking Confirmed!*

*Booking ID:* ${bookingId}
*Amount:* ${state.amount} AED
*Duration:* ${state.duration} mins
*Payment:* ${state.paymentMethod}
*Profit:* ${state.profitShare}
*Staff:* ${state.staff ? state.staff : 'Not Assigned'}
*Service:* ${state.service}
*Date:* ${formatDateForDisplay(state.date)}
*Time:* ${state.time}
*Phone:* ${state.clientPhone}
*Address:* ${state.address}
`.trim();

  const msg = await sendToReceiverChat(confirmationMessage);
  if (msg) {
    await Booking.updateOne({ bookingId }, { 
      $set: { 
        groupMessageId: msg.message_id, 
        groupChatId: receiveChatId 
      } 
    });
  }

  await sendTrackedMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });
  cleanupAfterDelay(chatId);
}

async function startCancelFlow(chatId) {
  const bookings = await getLast10Bookings();
  if (bookings.length === 0) {
    await sendTrackedMessage(chatId, "No recent bookings found.");
    return;
  }

  bookingData[chatId] = bookingData[chatId] || {};
  bookingData[chatId].cancelFlow = { step: 1, bookings };

  const buttons = [];
  for (const b of bookings) {
    const client = await Client.findOne({ phone: b.clientPhone }).lean();
    const identifier = client ? client.phone : b.clientPhone;
    buttons.push([{ text: `${b.bookingId} - ${identifier}`, callback_data: 'cancel_select_' + b.bookingId }]);
  }

  sendMessageWithInlineKeyboard(chatId, "Select a booking to cancel:", buttons);
}

async function handleCancelFlowCallback(chatId, query) {
  const data = query.data;
  const state = bookingData[chatId];
  if (!state || !state.cancelFlow) return;

  bot.answerCallbackQuery(query.id);

  if (data.startsWith('cancel_select_')) {
    const bookingId = data.replace('cancel_select_','');
    const booking = _.find(state.cancelFlow.bookings, b => b.bookingId === bookingId);
    if (!booking) {
      await sendTrackedMessage(chatId, 'Booking not found.');
      return;
    }
    showCancelConfirmation(chatId, booking);
    return;
  }

  if (data === 'cancel_confirm') {
    const bookingId = state.cancelFlow.selectedBookingId;
    const booking = await Booking.findOne({ bookingId }).lean();
    if (booking && booking.groupMessageId && booking.groupChatId) {
      await bot.deleteMessage(booking.groupChatId, booking.groupMessageId).catch(() => {});
    }

    await Booking.deleteOne({ bookingId });
    await sendTrackedMessage(chatId, `Booking ${bookingId} has been deleted.`);
    cleanupAfterDelay(chatId);
    return;
  }

  if (data === 'cancel_abort') {
    await sendTrackedMessage(chatId, "Cancellation aborted.");
    cleanupAfterDelay(chatId);
  }
}

function showCancelConfirmation(chatId, booking) {
  bookingData[chatId].cancelFlow.selectedBookingId = booking.bookingId;
  const formattedDate = moment(booking.requestedDate).format('DD-MM-YYYY');
  const text = `
You selected booking ${booking.bookingId} for cancellation.

Details:
- Service: ${booking.serviceType}
- Duration: ${booking.duration} mins
- Date: ${formattedDate}
- Status: ${booking.status}

Confirm cancellation?
  `.trim();
  const buttons = [
    [{ text: 'Confirm', callback_data: 'cancel_confirm' }, { text: 'Abort', callback_data: 'cancel_abort' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

async function showPendingBookingsForUpdate(chatId) {
  const pendingBookings = await Booking.find({ status: { $ne: 'Canceled' }, status: 'Pending' })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (pendingBookings.length === 0) {
    await sendTrackedMessage(chatId, "No pending bookings found.");
    return;
  }

  bookingData[chatId] = bookingData[chatId] || {};

  const buttons = [];
  for (const b of pendingBookings) {
    const client = await Client.findOne({ phone: b.clientPhone }).lean();
    const identifier = client ? client.phone : b.clientPhone;
    buttons.push([{ text: `${b.bookingId} - ${identifier}`, callback_data: 'edit_' + b.bookingId }]);
  }

  sendMessageWithInlineKeyboard(chatId, "Select a booking to update/cancel:", buttons);
  bookingData[chatId].editFlow = { step: 1, bookings: pendingBookings };
}

async function repostUpdatedBookingToReceiver(chatId, bookingId) {
  const updatedBooking = await Booking.findOne({ bookingId }).lean();
  if (!updatedBooking) return;

  // Delete old message if exists
  if (updatedBooking.groupMessageId && updatedBooking.groupChatId) {
    await bot.deleteMessage(updatedBooking.groupChatId, updatedBooking.groupMessageId).catch(()=>{});
  }

  const client = await Client.findOne({ phone: updatedBooking.clientPhone }).lean();
  const name = (client && client.name) || 'Not provided';
  const gender = (client && client.gender) || 'Not provided';
  const address = (client && client.address) || 'Not provided';
  const mapLink = (client && client.mapLink) || 'Not provided';
  const updatedDate = moment(updatedBooking.requestedDate).format('DD-MM-YYYY');

  const updatedMessage = `
🔄 *Updated Booking:*

*Booking ID:* ${updatedBooking.bookingId}
*Service:* ${updatedBooking.serviceType}
*Duration:* ${updatedBooking.duration} mins
*Status:* ${updatedBooking.status}
*Date:* ${updatedDate}
*Phone:* ${updatedBooking.clientPhone}
*Name:* ${name}
*Gender:* ${gender}
*Address:* ${address}
*Map Link:* ${mapLink}
`.trim();

  const msg = await sendToReceiverChat(updatedMessage);
  if (msg) {
    await Booking.updateOne({ bookingId }, { 
      $set: { 
        groupMessageId: msg.message_id, 
        groupChatId: receiveChatId 
      } 
    });
  }

  cleanupAfterDelay(chatId);
}

async function handleUpdateFlowCallback(chatId, query) {
  const data = query.data;
  const state = bookingData[chatId];
  if (!state || !state.editFlow) return;

  bot.answerCallbackQuery(query.id);

  if (data.startsWith('edit_')) {
    const bookingId = data.replace('edit_', '');
    const booking = _.find(state.editFlow.bookings, b => b.bookingId === bookingId);
    if (!booking) {
      await sendTrackedMessage(chatId, 'Booking not found.');
      return;
    }
    state.editFlow.selectedBooking = booking;
    const buttons = [
      [{ text: 'Cancel Booking', callback_data: 'cancel_booking' }, { text: 'Update Booking', callback_data: 'update_booking' }]
    ];
    sendMessageWithInlineKeyboard(chatId, `Booking ${booking.bookingId} selected.`, buttons);
    return;
  }

  if (data === 'cancel_booking') {
    await cancelSelectedBooking(chatId);
    return;
  }

  if (data === 'update_booking') {
    await showUpdateOptions(chatId);
    return;
  }

  if (data === 'upd_staff') {
    await showStaffOptions(chatId);
    return;
  }

  if (data.startsWith('staffsel_')) {
    await updateStaff(chatId, data);
    return;
  }

  if (data === 'upd_timeslot') {
    // Show date selection (like booking creation)
    await askUpdateTimeslotDate(chatId);
    return;
  }

  if (data.startsWith('upd_timeslot_date_')) {
    const chosenDate = data.replace('upd_timeslot_date_', '');
    if (chosenDate === 'custom') {
      state.editFlow.awaitingNewDate = true;
      await sendTrackedMessage(chatId, "Enter new date (YYYY-MM-DD):");
    } else {
      state.editFlow.newDate = chosenDate;
      // Now ask for time selection (like booking creation)
      await askUpdateTimeslotTime(chatId);
    }
    return;
  }

  if (data.startsWith('upd_timeslot_time_')) {
    const t = data.replace('upd_timeslot_time_','').replace(/_/g,' ');
    if (t.toLowerCase().includes('custom')) {
      state.editFlow.awaitingNewTime = true;
      await sendTrackedMessage(chatId, "Enter new time (e.g. 4:30 PM):");
    } else {
      await updateBookingTimeslot(chatId, t);
    }
    return;
  }

  if (data === 'upd_address') {
    await askNewAddress(chatId);
    return;
  }

  if (data === 'upd_map') {
    await askNewMapLink(chatId);
    return;
  }

  if (data === 'upd_status') {
    await askNewStatus(chatId);
    return;
  }

  if (data.startsWith('status_')) {
    await updateStatus(chatId, data);
    return;
  }
}

async function cancelSelectedBooking(chatId) {
  const state = bookingData[chatId];
  const b = state.editFlow.selectedBooking;
  const origBooking = await Booking.findOne({ bookingId: b.bookingId });
  if (origBooking && origBooking.groupMessageId && origBooking.groupChatId) {
    await bot.deleteMessage(origBooking.groupChatId, origBooking.groupMessageId).catch(()=>{});
  }
  await Booking.updateOne({ bookingId: b.bookingId }, { $set: { status: 'Canceled', updatedAt: new Date(), groupMessageId: null } });
  await sendTrackedMessage(chatId, `Booking ${b.bookingId} is now canceled.`);
  cleanupAfterDelay(chatId);
}

async function showUpdateOptions(chatId) {
  const buttons = [
    [{ text: 'Change Staff', callback_data: 'upd_staff' }],
    [{ text: 'Change Timeslot', callback_data: 'upd_timeslot' }],
    [{ text: 'Change Address', callback_data: 'upd_address' }],
    [{ text: 'Change Map Link', callback_data: 'upd_map' }],
    [{ text: 'Change Status', callback_data: 'upd_status' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "What would you like to update?", buttons);
}

async function showStaffOptions(chatId) {
  const staffButtons = STAFF_OPTIONS.map(s => [{ text: s, callback_data: 'staffsel_' + s }]);
  sendMessageWithInlineKeyboard(chatId, "Select new staff:", staffButtons);
}

async function updateStaff(chatId, data) {
  const newStaff = data.replace('staffsel_', '');
  const state = bookingData[chatId];
  const b = state.editFlow.selectedBooking;
  await Booking.updateOne({ bookingId: b.bookingId }, { $set: { assignedStaff: newStaff, updatedAt: new Date() } });
  await sendTrackedMessage(chatId, `Booking ${b.bookingId} staff changed to ${newStaff}.`);
  await repostUpdatedBookingToReceiver(chatId, b.bookingId);
}

async function askUpdateTimeslotDate(chatId) {
  const state = bookingData[chatId];
  state.editFlow.selectingTimeslot = true;
  const today = moment().format('YYYY-MM-DD');
  const tomorrow = moment().add(1,'day').format('YYYY-MM-DD');
  const buttons = [
    [
      { text: 'Today', callback_data: `upd_timeslot_date_${today}` },
      { text: 'Tomorrow', callback_data: `upd_timeslot_date_${tomorrow}` }
    ],
    [{ text: 'Custom Date', callback_data: 'upd_timeslot_date_custom' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Select new date:", buttons);
}

async function askUpdateTimeslotTime(chatId) {
  const state = bookingData[chatId];
  state.editFlow.awaitingNewTimeSelect = true;
  const buttons = PRESET_TIMES.map(t => [{ text: t, callback_data: 'upd_timeslot_time_' + t.replace(/ /g,'_') }]);
  buttons.push([{ text: 'Custom Time', callback_data: 'upd_timeslot_time_custom' }]);
  sendMessageWithInlineKeyboard(chatId, "Select new time:", buttons);
}

async function updateBookingTimeslot(chatId, newTime) {
  const state = bookingData[chatId];
  const b = state.editFlow.selectedBooking;

  const startDate = parseDateTime(state.editFlow.newDate, newTime);
  const endDate = new Date(startDate.getTime() + b.duration * 60000);
  await Booking.updateOne({ bookingId: b.bookingId }, {
    $set: {
      requestedDate: startDate,
      requestedTimeSlot: { start: startDate, end: endDate },
      updatedAt: new Date()
    }
  });
  await sendTrackedMessage(chatId, `Booking ${b.bookingId} timeslot updated.`);
  await repostUpdatedBookingToReceiver(chatId, b.bookingId);
}

async function askNewAddress(chatId) {
  await sendTrackedMessage(chatId, "Enter new address:");
  bookingData[chatId].editFlow.awaitingNewAddress = true;
}

async function askNewMapLink(chatId) {
  await sendTrackedMessage(chatId, "Enter new map link or type none to clear:");
  bookingData[chatId].editFlow.awaitingNewMap = true;
}

async function askNewStatus(chatId) {
  const statusButtons = [
    [{ text: 'Pending', callback_data: 'status_pending' }],
    [{ text: 'Confirmed', callback_data: 'status_confirmed' }],
    [{ text: 'Completed', callback_data: 'status_completed' }],
    [{ text: 'Canceled', callback_data: 'status_canceled' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Select new status:", statusButtons);
}

async function updateStatus(chatId, data) {
  const newStatus = data.replace('status_', '');
  const state = bookingData[chatId];
  const b = state.editFlow.selectedBooking;
  await Booking.updateOne({ bookingId: b.bookingId }, { $set: { status: capitalize(newStatus), updatedAt: new Date() } });
  await sendTrackedMessage(chatId, `Booking ${b.bookingId} status is now ${capitalize(newStatus)}.`);
  await repostUpdatedBookingToReceiver(chatId, b.bookingId);
}

async function handleUpdateFlowMessage(chatId, msg) {
  const state = bookingData[chatId];
  const b = state.editFlow.selectedBooking;
  if (!b) return;

  if (state.editFlow.awaitingNewDate) {
    state.editFlow.newDate = msg.text.trim();
    state.editFlow.awaitingNewDate = false;
    // Now ask time
    await askUpdateTimeslotTime(chatId);
    return;
  }

  if (state.editFlow.awaitingNewTime) {
    const newTime = msg.text.trim();
    await updateBookingTimeslot(chatId, newTime);
    state.editFlow.awaitingNewTime = false;
    return;
  }

  if (state.editFlow.awaitingNewAddress) {
    const newAddress = msg.text.trim();
    await Client.findOneAndUpdate({ phone: b.clientPhone }, {
      $set: { address: newAddress, updatedAt: new Date() }
    });
    await sendTrackedMessage(chatId, `Booking ${b.bookingId} client address updated.`);
    state.editFlow.awaitingNewAddress = false;
    await repostUpdatedBookingToReceiver(chatId, b.bookingId);
    return;
  }

  if (state.editFlow.awaitingNewMap) {
    let newMap = msg.text.trim();
    if (newMap.toLowerCase() === 'none') newMap = '';
    await Client.findOneAndUpdate({ phone: b.clientPhone }, {
      $set: { mapLink: newMap, updatedAt: new Date() }
    });
    await sendTrackedMessage(chatId, `Booking ${b.bookingId} map link updated.`);
    state.editFlow.awaitingNewMap = false;
    await repostUpdatedBookingToReceiver(chatId, b.bookingId);
  }
}

// ------------------------ Client Flow ------------------------

function showClientMenu(chatId) {
  const text = "Client Options:";
  const buttons = [
    [{ text: 'View All Clients', callback_data: 'client_viewall' }],
    [{ text: 'Add New Client', callback_data: 'client_add' }],
    [{ text: 'Delete Client', callback_data: 'client_delete' }],
    [{ text: 'Update Client', callback_data: 'client_update' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

async function handleViewAllClients(chatId) {
  const clients = await Client.find().sort({ createdAt: -1 }).lean();
  if (clients.length === 0) {
    await sendTrackedMessage(chatId, "No clients found.");
    return;
  }

  let text = "All Clients:\n";
  clients.forEach((c, i) => {
    text += `${i+1}. ${c.name || 'No Name'} - ${c.phone}\n`;
  });

  const buttons = [
    [{ text: 'Clear Chat', callback_data: 'clear_chat' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text.trim(), buttons);
}

async function handleAddClientFlow(chatId) {
  bookingData[chatId] = { clientFlow: { mode: 'add', step: 1 } };
  await sendTrackedMessage(chatId, "Enter Client Phone Number:");
}

async function createClientFromInput(chatId, {phone, name, address, mapLink, email, gender}) {
  const newClient = new Client({
    phone,
    name: name || '',
    email: email || '',
    gender: gender || '',
    address,
    mapLink: mapLink || '',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await newClient.save();
  await sendTrackedMessage(chatId, "Client added successfully!");
  cleanupAfterDelay(chatId);
}

async function handleDeleteClientFlow(chatId) {
  const clients = await Client.find().sort({ createdAt: -1 }).lean();
  if (clients.length === 0) {
    await sendTrackedMessage(chatId, "No clients to delete.");
    return;
  }
  bookingData[chatId] = { clientFlow: { mode: 'delete', clients } };

  const buttons = clients.map((c, i) => [{ text: `${i+1}. ${c.name || 'No Name'} - ${c.phone}`, callback_data: 'delete_client_' + c.phone }]);
  sendMessageWithInlineKeyboard(chatId, "Select a client to delete:", buttons);
}

async function handleUpdateClientFlow(chatId) {
  const clients = await Client.find().sort({ createdAt: -1 }).lean();
  if (clients.length === 0) {
    await sendTrackedMessage(chatId, "No clients to update.");
    return;
  }
  bookingData[chatId] = { clientFlow: { mode: 'update', step: 1, clients } };

  const buttons = clients.map((c, i) => [{ text: `${i+1}. ${c.name || 'No Name'} - ${c.phone}`, callback_data: 'select_update_client_' + c.phone }]);
  sendMessageWithInlineKeyboard(chatId, "Select a client to update:", buttons);
}

function showUpdateClientFields(chatId) {
  const buttons = [
    [{ text: 'Name', callback_data: 'update_client_field_name' }],
    [{ text: 'Email', callback_data: 'update_client_field_email' }],
    [{ text: 'Phone', callback_data: 'update_client_field_phone' }],
    [{ text: 'Address', callback_data: 'update_client_field_address' }],
    [{ text: 'Map Link', callback_data: 'update_client_field_mapLink' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Which field do you want to update?", buttons);
}

async function updateClientField(chatId, clientPhone, field, value) {
  const updateObj = {};
  updateObj[field] = value;
  await Client.findOneAndUpdate({ phone: clientPhone }, { $set: updateObj, updatedAt: new Date() });
  await sendTrackedMessage(chatId, "Client updated successfully!");
  cleanupAfterDelay(chatId);
}

// ------------------------ Expenses Flow ------------------------

function showExpenseMenu(chatId) {
  const text = "Expense Options:";
  const buttons = [
    [{ text: 'View Expenses', callback_data: 'expense_view' }],
    [{ text: 'Add Expense', callback_data: 'expense_add' }],
    [{ text: 'Delete Expense', callback_data: 'expense_delete' }],
    [{ text: 'Update Expense', callback_data: 'expense_update' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

async function handleViewExpenses(chatId) {
  const expenses = await Expense.find().sort({ createdAt: -1 }).lean();
  if (expenses.length === 0) {
    await sendTrackedMessage(chatId, "No expenses found.");
    return;
  }
  let text = "Expenses:\n";
  for (const e of expenses) {
    text += `${e.category}: ${e.amount} AED on ${moment(e.date).format('DD-MM-YYYY')} - ${e.description}\n`;
  }
  const buttons = [
    [{ text: 'Clear Chat', callback_data: 'clear_chat' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text.trim(), buttons);
}

async function handleAddExpenseFlow(chatId) {
  bookingData[chatId] = { expenseFlow: { mode: 'add', step: 1 } };
  await sendTrackedMessage(chatId, "Enter expense category:");
}

async function createExpense(chatId, {category, description, amount, date}) {
  const newExpense = new Expense({
    category,
    description,
    amount: parseFloat(amount),
    date: date ? new Date(date) : new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await newExpense.save();
  await sendTrackedMessage(chatId, "Expense added successfully!");
  cleanupAfterDelay(chatId);
}

async function handleDeleteExpenseFlow(chatId) {
  const expenses = await Expense.find().sort({ createdAt: -1 }).limit(10).lean();
  if (expenses.length === 0) {
    await sendTrackedMessage(chatId, "No expenses to delete.");
    return;
  }
  bookingData[chatId] = { expenseFlow: { mode: 'delete', expenses } };
  const buttons = expenses.map(e => [{ text: `${e.category} - ${e.amount} AED`, callback_data: 'delete_expense_' + e._id }]);
  sendMessageWithInlineKeyboard(chatId, "Select an expense to delete:", buttons);
}

async function handleUpdateExpenseFlow(chatId) {
  bookingData[chatId] = { expenseFlow: { mode: 'update', step: 1 } };
  await sendTrackedMessage(chatId, "Enter the ID of the expense you want to update (Get it from view expenses):");
}

function showUpdateExpenseFields(chatId) {
  const buttons = [
    [{ text: 'Category', callback_data: 'update_expense_field_category' }],
    [{ text: 'Description', callback_data: 'update_expense_field_description' }],
    [{ text: 'Amount', callback_data: 'update_expense_field_amount' }],
    [{ text: 'Date', callback_data: 'update_expense_field_date' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Which field do you want to update?", buttons);
}

async function updateExpenseField(chatId, expenseId, field, value) {
  const updateObj = {};
  if (field === 'amount') {
    updateObj[field] = parseFloat(value);
  } else if (field === 'date') {
    updateObj[field] = new Date(value);
  } else {
    updateObj[field] = value;
  }
  await Expense.findByIdAndUpdate(expenseId, { $set: updateObj, updatedAt: new Date() });
  await sendTrackedMessage(chatId, "Expense updated successfully!");
  cleanupAfterDelay(chatId);
}

// ------------------------ Staff Flow ------------------------

function showStaffMenu(chatId) {
  const text = "Staff Options:";
  const buttons = [
    [{ text: 'View Staff', callback_data: 'staff_view' }],
    [{ text: 'Add Staff', callback_data: 'staff_add' }],
    [{ text: 'Delete Staff', callback_data: 'staff_delete' }],
    [{ text: 'Update Staff', callback_data: 'staff_update' }],
    [{ text: 'Performance', callback_data: 'staff_performance' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text, buttons);
}

async function handleViewStaff(chatId) {
  const staffList = await Staff.find().sort({ createdAt: -1 }).lean();
  if (staffList.length === 0) {
    await sendTrackedMessage(chatId, "No staff found.");
    return;
  }

  let text = "All Staff:\n";
  staffList.forEach((s, i) => {
    text += `${i+1}. ${s.name} - ${s.phone}\n`;
  });

  const buttons = [
    [{ text: 'Clear Chat', callback_data: 'clear_chat' }]
  ];
  sendMessageWithInlineKeyboard(chatId, text.trim(), buttons);
}

async function handleAddStaffFlow(chatId) {
  bookingData[chatId] = { staffFlow: { mode: 'add', step: 1 } };
  await sendTrackedMessage(chatId, "Enter Staff Name:");
}

async function createStaff(chatId, {name, phone, role, salary}) {
  const newStaff = new Staff({
    name,
    phone: normalizePhoneNumber(phone),
    role: role || '',
    availabilityStatus: 'free',
    salary: salary ? parseFloat(salary) : 0,
    joiningDate: new Date(),
    documents: {},
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await newStaff.save();
  await sendTrackedMessage(chatId, "Staff added successfully!");
  cleanupAfterDelay(chatId);
}

async function handleDeleteStaffFlow(chatId) {
  const staffList = await Staff.find().sort({ createdAt: -1 }).lean();
  if (staffList.length === 0) {
    await sendTrackedMessage(chatId, "No staff to delete.");
    return;
  }
  bookingData[chatId] = { staffFlow: { mode: 'delete', staffList } };
  const buttons = staffList.map((s, i) => [{ text: `${i+1}. ${s.name || 'No Name'} - ${s.phone}`, callback_data: 'delete_staff_' + s.phone }]);
  sendMessageWithInlineKeyboard(chatId, "Select a staff to delete:", buttons);
}

async function handleUpdateStaffFlow(chatId) {
  const staffList = await Staff.find().sort({ createdAt: -1 }).lean();
  if (staffList.length === 0) {
    await sendTrackedMessage(chatId, "No staff to update.");
    return;
  }
  bookingData[chatId] = { staffFlow: { mode: 'update', step: 1, staffList } };
  const buttons = staffList.map((s, i) => [{ text: `${i+1}. ${s.name || 'No Name'} - ${s.phone}`, callback_data: 'select_update_staff_' + s.phone }]);
  sendMessageWithInlineKeyboard(chatId, "Select a staff to update:", buttons);
}

function showUpdateStaffFields(chatId) {
  const buttons = [
    [{ text: 'Name', callback_data: 'update_staff_field_name' }],
    [{ text: 'Phone', callback_data: 'update_staff_field_phone' }],
    [{ text: 'Role', callback_data: 'update_staff_field_role' }],
    [{ text: 'Salary', callback_data: 'update_staff_field_salary' }],
    [{ text: 'Availability Status', callback_data: 'update_staff_field_availabilityStatus' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Which field do you want to update?", buttons);
}

async function updateStaffField(chatId, staffPhone, field, value) {
  const updateObj = {};
  updateObj[field] = (field === 'salary') ? parseFloat(value) : value;
  await Staff.findOneAndUpdate({ phone: staffPhone }, { $set: updateObj, updatedAt: new Date() });
  await sendTrackedMessage(chatId, "Staff updated successfully!");
  cleanupAfterDelay(chatId);
}

// Staff Performance Calculation
async function handleStaffPerformance(chatId) {
  const staffList = await Staff.find().sort({ createdAt: -1 }).lean();
  if (staffList.length === 0) {
    await sendTrackedMessage(chatId, "No staff available.");
    return;
  }
  bookingData[chatId] = { staffFlow: { mode: 'performance', staffList } };
  const buttons = staffList.map((s, i) => [{ text: `${i+1}. ${s.name} - ${s.phone}`, callback_data: 'select_performance_staff_' + s.phone }]);
  sendMessageWithInlineKeyboard(chatId, "Select a staff to view performance:", buttons);
}

async function showStaffPerformance(chatId, staffPhone) {
  const staffMember = await Staff.findOne({ phone: staffPhone }).lean();
  if (!staffMember) {
    await sendTrackedMessage(chatId, "Staff not found.");
    cleanupAfterDelay(chatId);
    return;
  }
  
  // Completed/Confirmed bookings for periods
  const now = moment();
  const startOfDay = now.clone().startOf('day');
  const startOfWeek = now.clone().startOf('week');
  const startOfMonth = now.clone().startOf('month');
  const startOfYear = now.clone().startOf('year');

  const queryBase = { assignedStaff: staffMember.name, status: { $in: ['Completed', 'Confirmed'] } };

  async function getPerformanceStats(from) {
    const query = { ...queryBase, requestedDate: { $gte: from.toDate(), $lte: now.toDate() } };
    const bookings = await Booking.find(query).lean();
    const count = bookings.length;
    const totalAmount = await getTotalBookingAmount(bookings);
    return { count, totalAmount };
  }

  async function getAllTimeStats() {
    const bookings = await Booking.find(queryBase).lean();
    const count = bookings.length;
    const totalAmount = await getTotalBookingAmount(bookings);
    return { count, totalAmount };
  }

  const todayStats = await getPerformanceStats(startOfDay);
  const weekStats = await getPerformanceStats(startOfWeek);
  const monthStats = await getPerformanceStats(startOfMonth);
  const yearStats = await getPerformanceStats(startOfYear);
  const allTimeStats = await getAllTimeStats();

  const text = `
*Performance of ${staffMember.name}:*

*Today:* ${todayStats.count} bookings, ${todayStats.totalAmount} AED
*This Week:* ${weekStats.count} bookings, ${weekStats.totalAmount} AED
*This Month:* ${monthStats.count} bookings, ${monthStats.totalAmount} AED
*This Year:* ${yearStats.count} bookings, ${yearStats.totalAmount} AED
*All Time:* ${allTimeStats.count} bookings, ${allTimeStats.totalAmount} AED
  `.trim();

  await sendTrackedMessage(chatId, text, { parse_mode: 'Markdown' });
  cleanupAfterDelay(chatId);
}

// ------------------------ Bookings Earnings/Profits ------------------------

async function handleBookingEarnings(chatId) {

  const buttons = [
    [{ text: 'Start of Current Month', callback_data: 'earnings_current_month' }],
    [{ text: 'From 15th of Previous Month', callback_data: 'earnings_prev_15' }]
  ];
  sendMessageWithInlineKeyboard(chatId, "Select date range:", buttons);
}

async function showEarnings(chatId, startDate) {
  
  console.log(startDate);
  const bookings = await Booking.find({
    status: 'Completed',
    requestedDate: { 
      $gte: startDate
    }
  }).lean();

  console.log(JSON.stringify(bookings, null, 2));

  // Calculate earnings
  let totalAmount = 0;
  let ranjeetEarnings = 0;
  let noraEarnings = 0;

  // Staff performance tracking
  const staffPerformance = {};

  for (const booking of bookings) {
    // Get amount from booking, default to 0 if not found
    const amount = parseFloat(booking.amount) || 0;
    const profitShare = booking.shared ? 'Shared' : 'Only Ranjeet'; 
    
    // Track staff performance
    if (booking.assignedStaff) {
      if (!staffPerformance[booking.assignedStaff]) {
        staffPerformance[booking.assignedStaff] = {
          bookings: 0,
          earnings: 0
        };
      }
      staffPerformance[booking.assignedStaff].bookings++;
      staffPerformance[booking.assignedStaff].earnings += amount;
    }

    totalAmount += amount;

    // Calculate profit shares
    if (profitShare === 'Only Ranjeet') {
      ranjeetEarnings += amount;
    } else {
      ranjeetEarnings += (amount/2);
      noraEarnings += (amount/2); 
    }
  }

  // Deduct staff salaries
  const jennyPrawSalary = 6000; // 3000 each
  const driverSalary = 4000;

  ranjeetEarnings -= jennyPrawSalary;
  noraEarnings -= driverSalary;

  // Format date range text
  const dateRangeText = startDate.getDate() === 1 ? 
    'Start of Current Month' :
    'From 15th of Previous Month';

  let text = `
*Earnings Report (${dateRangeText})*

*Total Bookings Amount:* ${totalAmount} AED
*Ranjeet's Earnings:* ${ranjeetEarnings} AED (after deducting Jenny & Praw salary: ${jennyPrawSalary} AED)
*Nora's Earnings:* ${noraEarnings} AED (after deducting driver salary: ${driverSalary} AED)

*Staff Performance:*`;

  // Add staff performance details
  for (const [staff, perf] of Object.entries(staffPerformance)) {
    text += `\n${staff}: ${perf.bookings} bookings, ${perf.earnings} AED`;
  }

  await sendTrackedMessage(chatId, text.trim(), { parse_mode: 'Markdown' });
  cleanupAfterDelay(chatId, 30000);
}

// ------------------------ Helpers ------------------------

async function getTotalBookingAmount(bookings) {
  // In original code, amount is not saved in booking. Let's assume we now store `amount` and `profitShare` in booking:
  // We'll modify finalConfirmBooking to include these fields in the booking document.
  // If some bookings don't have amount (old ones), treat as 0.
  return bookings.reduce((sum, b) => sum + (b.amount || 0), 0);
}

// Modify finalConfirmBooking to save amount and profitShare in booking
// Already done in code environment (just do it now):
// We'll just find finalConfirmBooking and add these fields to booking:
async function finalConfirmBookingOverride(chatId) {
  // This is handled in finalConfirmBooking above, let's just ensure we store:
  // Already integrated above: we must ensure booking object includes amount and profitShare
}

// ------------------------ Callback & Message Handlers ------------------------

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = bookingData[chatId];

  bot.answerCallbackQuery(query.id);

  // Clear chat
  if (data === 'clear_chat') {
    clearChat(chatId);
    return;
  }

  // Main Menu
  if (data === 'main_bookings') {
    showBookingMenu(chatId);
    return;
  }
  if (data === 'main_clients') {
    showClientMenu(chatId);
    return;
  }
  if (data === 'main_expenses') {
    showExpenseMenu(chatId);
    return;
  }
  if (data === 'main_staff') {
    showStaffMenu(chatId);
    return;
  }

  // Bookings Menu
  if (data === 'booking_new') {
    startBookingFlow(chatId);
    return;
  }
  if (data === 'booking_update') {
    await showPendingBookingsForUpdate(chatId);
    return;
  }
  if (data === 'booking_earnings') {
    await handleBookingEarnings(chatId);
    return;
  }

  if (data === 'earnings_current_month') {
    const startOfCurrentMonth = moment().startOf('month').toDate();
    await showEarnings(chatId, startOfCurrentMonth);
    return;
  }

  if (data === 'earnings_prev_15') {
    const fifteenthOfPrevMonth = moment().subtract(1,'month').date(15).startOf('day').toDate();
    await showEarnings(chatId, fifteenthOfPrevMonth);
    return;
  }

  // Clients Menu
  if (data === 'client_viewall') {
    await handleViewAllClients(chatId);
    return;
  }

  if (data === 'client_add') {
    await handleAddClientFlow(chatId);
    return;
  }

  if (data === 'client_delete') {
    await handleDeleteClientFlow(chatId);
    return;
  }

  if (data === 'client_update') {
    await handleUpdateClientFlow(chatId);
    return;
  }

  // Clients Delete Confirmation
  if (state && state.clientFlow && state.clientFlow.mode === 'delete' && data.startsWith('delete_client_')) {
    const phone = data.replace('delete_client_', '');
    state.clientFlow.selectedPhone = phone;
    const text = `Are you sure you want to delete client ${phone}?`;
    const buttons = [
      [{ text: 'Yes', callback_data: 'confirm_delete_client' }, { text: 'No', callback_data: 'cancel_delete_client' }]
    ];
    sendMessageWithInlineKeyboard(chatId, text, buttons);
    return;
  }

  if (state && state.clientFlow && state.clientFlow.mode === 'delete') {
    if (data === 'confirm_delete_client') {
      await Client.deleteOne({ phone: state.clientFlow.selectedPhone });
      await sendTrackedMessage(chatId, "Client deleted successfully!");
      cleanupAfterDelay(chatId);
      return;
    }
    if (data === 'cancel_delete_client') {
      await sendTrackedMessage(chatId, "Client deletion canceled.");
      cleanupAfterDelay(chatId);
      return;
    }
  }

  // Client Update - select client
  if (state && state.clientFlow && state.clientFlow.mode === 'update' && data.startsWith('select_update_client_')) {
    const phone = data.replace('select_update_client_', '');
    state.clientFlow.clientPhone = phone;
    state.clientFlow.step = 2;
    showUpdateClientFields(chatId);
    return;
  }

  // Client Update Field selection
  if (state && state.clientFlow && state.clientFlow.mode === 'update' && state.clientFlow.clientPhone && data.startsWith('update_client_field_')) {
    const field = data.replace('update_client_field_', '');
    state.clientFlow.updateField = field;
    await sendTrackedMessage(chatId, `Enter new value for ${field}:`);
    state.clientFlow.awaitingFieldValue = true;
    return;
  }

  // Expenses Menu
  if (data === 'expense_view') {
    await handleViewExpenses(chatId);
    return;
  }
  if (data === 'expense_add') {
    await handleAddExpenseFlow(chatId);
    return;
  }

  if (data === 'expense_delete') {
    await handleDeleteExpenseFlow(chatId);
    return;
  }

  if (data === 'expense_update') {
    await handleUpdateExpenseFlow(chatId);
    return;
  }

  // Expense Delete Confirmation
  if (state && state.expenseFlow && state.expenseFlow.mode === 'delete' && data.startsWith('delete_expense_')) {
    const expenseId = data.replace('delete_expense_', '');
    state.expenseFlow.selectedExpenseId = expenseId;
    const text = `Are you sure you want to delete this expense?`;
    const buttons = [
      [{ text: 'Yes', callback_data: 'confirm_delete_expense' }, { text: 'No', callback_data: 'cancel_delete_expense' }]
    ];
    sendMessageWithInlineKeyboard(chatId, text, buttons);
    return;
  }

  if (state && state.expenseFlow && state.expenseFlow.mode === 'delete') {
    if (data === 'confirm_delete_expense') {
      await Expense.deleteOne({ _id: state.expenseFlow.selectedExpenseId });
      await sendTrackedMessage(chatId, "Expense deleted successfully!");
      cleanupAfterDelay(chatId);
      return;
    }
    if (data === 'cancel_delete_expense') {
      await sendTrackedMessage(chatId, "Expense deletion canceled.");
      cleanupAfterDelay(chatId);
      return;
    }
  }

  // Expense Update Field selection
  if (state && state.expenseFlow && state.expenseFlow.mode === 'update' && state.expenseFlow.expenseId && data.startsWith('update_expense_field_')) {
    const field = data.replace('update_expense_field_', '');
    state.expenseFlow.updateField = field;
    await sendTrackedMessage(chatId, `Enter new value for ${field}:`);
    state.expenseFlow.awaitingFieldValue = true;
    return;
  }

  // Staff Menu
  if (data === 'staff_view') {
    await handleViewStaff(chatId);
    return;
  }

  if (data === 'staff_add') {
    await handleAddStaffFlow(chatId);
    return;
  }

  if (data === 'staff_delete') {
    await handleDeleteStaffFlow(chatId);
    return;
  }

  if (data === 'staff_update') {
    await handleUpdateStaffFlow(chatId);
    return;
  }

  if (data === 'staff_performance') {
    await handleStaffPerformance(chatId);
    return;
  }

  // Staff Delete Confirmation
  if (state && state.staffFlow && state.staffFlow.mode === 'delete' && data.startsWith('delete_staff_')) {
    const phone = data.replace('delete_staff_', '');
    state.staffFlow.selectedPhone = phone;
    const text = `Are you sure you want to delete staff with phone ${phone}?`;
    const buttons = [
      [{ text: 'Yes', callback_data: 'confirm_delete_staff' }, { text: 'No', callback_data: 'cancel_delete_staff' }]
    ];
    sendMessageWithInlineKeyboard(chatId, text, buttons);
    return;
  }

  if (state && state.staffFlow && state.staffFlow.mode === 'delete') {
    if (data === 'confirm_delete_staff') {
      await Staff.deleteOne({ phone: state.staffFlow.selectedPhone });
      await sendTrackedMessage(chatId, "Staff deleted successfully!");
      cleanupAfterDelay(chatId);
      return;
    }
    if (data === 'cancel_delete_staff') {
      await sendTrackedMessage(chatId, "Staff deletion canceled.");
      cleanupAfterDelay(chatId);
      return;
    }
  }

  // Staff Update - select staff
  if (state && state.staffFlow && state.staffFlow.mode === 'update' && data.startsWith('select_update_staff_')) {
    const phone = data.replace('select_update_staff_', '');
    state.staffFlow.staffPhone = phone;
    state.staffFlow.step = 2;
    showUpdateStaffFields(chatId);
    return;
  }

  // Staff Update Field selection
  if (state && state.staffFlow && state.staffFlow.mode === 'update' && state.staffFlow.staffPhone && data.startsWith('update_staff_field_')) {
    const field = data.replace('update_staff_field_', '');
    state.staffFlow.updateField = field;
    await sendTrackedMessage(chatId, `Enter new value for ${field}:`);
    state.staffFlow.awaitingFieldValue = true;
    return;
  }

  // Staff Performance selection
  if (state && state.staffFlow && state.staffFlow.mode === 'performance' && data.startsWith('select_performance_staff_')) {
    const phone = data.replace('select_performance_staff_', '');
    await showStaffPerformance(chatId, phone);
    return;
  }

  // Booking cancel flow
  if (state && state.cancelFlow && data.startsWith('cancel_')) {
    await handleCancelFlowCallback(chatId, query);
    return;
  }

  // Booking edit flow
  if (state && state.editFlow) {
    await handleUpdateFlowCallback(chatId, query);
    return;
  }

  // Booking flow
  if (state && state.bookingFlow && state.step) {
    await handleBookingFlowCallback(chatId, query);
    return;
  }

  await sendTrackedMessage(chatId, "No active process. Please use /start to begin.");
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  trackMessage(chatId, msg.message_id);
  const state = bookingData[chatId];
  if (!state) return;

  // Booking flow text inputs
  if (state.awaitingCustomAmount) {
    state.amount = msg.text.trim();
    state.awaitingCustomAmount = false;
    state.step = 2;
    askDuration(chatId);
    return;
  }

  if (state.awaitingDate) {
    state.date = msg.text.trim();
    state.awaitingDate = false;
    state.step = 8;
    askTime(chatId);
    return;
  }

  if (state.awaitingCustomTime) {
    state.time = msg.text.trim();
    state.awaitingCustomTime = false;
    state.step = 10;
    askClientPhone(chatId);
    return;
  }

  if (state.awaitingClientPhone) {
    state.clientPhone = msg.text.trim();
    state.awaitingClientPhone = false;
    await checkClientAndProceed(chatId);
    return;
  }

  if (state.awaitingName) {
    state.name = msg.text.trim();
    state.awaitingName = false;
    askGender(chatId);
    return;
  }

  if (state.awaitingAddress) {
    state.address = msg.text.trim();
    state.awaitingAddress = false;
    if (state.existingClient && state.address) {
      await updateClientAddress(chatId);
    } else {
      askMapLink(chatId);
    }
    return;
  }

  if (state.awaitingMapLink) {
    let mapLink = msg.text.trim();
    if (mapLink.toLowerCase() === 'skip') mapLink = null;
    state.mapLink = mapLink;
    state.awaitingMapLink = false;
    await createClientRecord(chatId);
    return;
  }

  // Booking update flow text inputs
  if (state.editFlow) {
    await handleUpdateFlowMessage(chatId, msg);
    return;
  }

  // Client Flow Handlers
  if (state.clientFlow) {
    const cf = state.clientFlow;
    // Add Client flow
    if (cf.mode === 'add') {
      if (cf.step === 1) {
        cf.phone = msg.text.trim();
        cf.step = 2;
        await sendTrackedMessage(chatId, "Enter Client Address:");
        return;
      }
      if (cf.step === 2) {
        cf.address = msg.text.trim();
        cf.step = 3;
        await sendTrackedMessage(chatId, "Enter Client Name (optional, or type 'skip'):");
        return;
      }
      if (cf.step === 3) {
        cf.name = msg.text.trim().toLowerCase() === 'skip' ? '' : msg.text.trim();
        // Create client now.
        await createClientFromInput(chatId, {
          phone: normalizePhoneNumber(cf.phone),
          address: cf.address,
          name: cf.name
        });
        return;
      }
    }

    // Update Client flow
    if (cf.mode === 'update') {
      if (cf.awaitingFieldValue && cf.updateField) {
        const newValue = msg.text.trim();
        cf.awaitingFieldValue = false;
        await updateClientField(chatId, cf.clientPhone, cf.updateField, newValue);
        return;
      }
    }
  }

  // Expense Flow
  if (state.expenseFlow) {
    const ef = state.expenseFlow;
    if (ef.mode === 'add') {
      if (ef.step === 1) {
        ef.category = msg.text.trim();
        ef.step = 2;
        await sendTrackedMessage(chatId, "Enter expense description:");
        return;
      }
      if (ef.step === 2) {
        ef.description = msg.text.trim();
        ef.step = 3;
        await sendTrackedMessage(chatId, "Enter expense amount:");
        return;
      }
      if (ef.step === 3) {
        ef.amount = msg.text.trim();
        ef.step = 4;
        // Show inline keyboard: Today or Custom Date
        const buttons = [
          [{ text: 'Today', callback_data: 'expense_date_today' }, { text: 'Custom Date', callback_data: 'expense_date_custom' }]
        ];
        sendMessageWithInlineKeyboard(chatId, "Choose date option:", buttons);
        return;
      }

      // If user chooses custom date (handled via callback), we then wait for user to type date
      // That logic will be handled in callback. If user typed date after callback sets a flag, handle it below:
    }

    if (ef.mode === 'update') {
      if (ef.step === 1) {
        ef.expenseId = msg.text.trim();
        const expense = await Expense.findById(ef.expenseId);
        if (!expense) {
          await sendTrackedMessage(chatId, "Expense not found. Clearing chat.");
          cleanupAfterDelay(chatId);
          return;
        }
        ef.step = 2;
        showUpdateExpenseFields(chatId);
        return;
      }

      if (ef.awaitingFieldValue && ef.updateField) {
        const newValue = msg.text.trim();
        ef.awaitingFieldValue = false;
        await updateExpenseField(chatId, ef.expenseId, ef.updateField, newValue);
        return;
      }
    }
  }

  // Staff Flow
  if (state.staffFlow) {
    const sf = state.staffFlow;
    if (sf.mode === 'add') {
      if (sf.step === 1) {
        sf.name = msg.text.trim();
        sf.step = 2;
        await sendTrackedMessage(chatId, "Enter Staff Phone:");
        return;
      }
      if (sf.step === 2) {
        sf.phone = msg.text.trim();
        sf.step = 3;
        await sendTrackedMessage(chatId, "Enter Staff Role (optional, 'skip' to ignore):");
        return;
      }
      if (sf.step === 3) {
        sf.role = msg.text.trim().toLowerCase() === 'skip' ? '' : msg.text.trim();
        sf.step = 4;
        await sendTrackedMessage(chatId, "Enter Staff Salary (optional, 'skip' to ignore):");
        return;
      }
      if (sf.step === 4) {
        const salary = msg.text.trim().toLowerCase() === 'skip' ? null : msg.text.trim();
        await createStaff(chatId, {
          name: sf.name,
          phone: sf.phone,
          role: sf.role,
          salary: salary
        });
        return;
      }
    }

    if (sf.mode === 'update') {
      if (sf.awaitingFieldValue && sf.updateField) {
        const newValue = msg.text.trim();
        sf.awaitingFieldValue = false;
        await updateStaffField(chatId, sf.staffPhone, sf.updateField, newValue);
        return;
      }
    }
  }
});


// Handle expense date selection after amount:
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const state = bookingData[chatId];
  if (!state || !state.expenseFlow) return;
  const ef = state.expenseFlow;
  if (ef.mode === 'add' && ef.step === 4) {
    if (query.data === 'expense_date_today') {
      bot.answerCallbackQuery(query.id);
      await createExpense(chatId, {
        category: ef.category,
        description: ef.description,
        amount: ef.amount,
        date: null // today
      });
    } else if (query.data === 'expense_date_custom') {
      bot.answerCallbackQuery(query.id);
      ef.awaitingCustomDate = true;
      await sendTrackedMessage(chatId, "Enter custom date (YYYY-MM-DD):");
    }
  }
});

// If user enters custom date for expense add
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  trackMessage(chatId, msg.message_id);
  const state = bookingData[chatId];
  if (!state || !state.expenseFlow) return;
  const ef = state.expenseFlow;
  if (ef.mode === 'add' && ef.awaitingCustomDate) {
    ef.awaitingCustomDate = false;
    const customDate = msg.text.trim();
    await createExpense(chatId, {
      category: ef.category,
      description: ef.description,
      amount: ef.amount,
      date: customDate
    });
  }
});

// Make sure finalConfirmBooking includes amount and profitShare in the booking
// Modify finalConfirmBooking to store these fields:
async function finalConfirmBooking(chatId) {
  const state = bookingData[chatId];
  const bookingId = generateBookingId();

  const startDate = parseDateTime(state.date, state.time);
  const endDate = new Date(startDate.getTime() + parseInt(state.duration, 10)*60000);
  const initialStatus = state.source === 'staff' ? 'Completed' : 'Pending';

  const newBooking = new Booking({
    bookingId,
    amount: parseFloat(state.amount),
    profitShare: state.profitShare,
    clientPhone: state.clientPhone,
    serviceType: state.service,
    duration: parseInt(state.duration, 10),
    requestedDate: startDate,
    requestedTimeSlot: { start: startDate, end: endDate },
    status: initialStatus,
    shared: state.profitShare === 'Shared',
    source: state.source,
    assignedStaff: state.staff || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    
  });
  await newBooking.save();

  const confirmationMessage = `
✅ *Booking Confirmed!*

*Booking ID:* ${bookingId}
*Amount:* ${state.amount} AED
*Duration:* ${state.duration} mins
*Payment:* ${state.paymentMethod}
*Profit:* ${state.profitShare}
*Staff:* ${state.staff ? state.staff : 'Not Assigned'}
*Service:* ${state.service}
*Date:* ${formatDateForDisplay(state.date)}
*Time:* ${state.time}
*Phone:* ${state.clientPhone}
*Address:* ${state.address}
`.trim();

  const msg = await sendToReceiverChat(confirmationMessage);
  if (msg) {
    await Booking.updateOne({ bookingId }, { 
      $set: { 
        groupMessageId: msg.message_id, 
        groupChatId: receiveChatId 
      } 
    });
  }

  await sendTrackedMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });
  cleanupAfterDelay(chatId);
}

// ------------------------ Handle Booking Flow Callback ------------------------

async function handleBookingFlowCallback(chatId, query) {
  const data = query.data;
  const state = bookingData[chatId];
  if (!state) return;

  bot.answerCallbackQuery(query.id);

  if (data.startsWith('amount_')) return handleAmountCallback(chatId, data);
  if (data.startsWith('duration_')) return handleDurationCallback(chatId, data);
  if (data.startsWith('payment_')) return handlePaymentCallback(chatId, data);
  if (data.startsWith('profit_')) return handleProfitCallback(chatId, data);
  if (data.startsWith('staff_')) return handleStaffCallback(chatId, data);
  if (data.startsWith('service_')) return handleServiceCallback(chatId, data);
  if (data.startsWith('date_')) return handleDateCallback(chatId, data);
  if (data.startsWith('time_')) return handleTimeCallback(chatId, data);

  if (data === 'use_existing_address_yes') {
    showBookingSummary(chatId);
    return;
  }
  if (data === 'use_existing_address_no') {
    state.awaitingAddress = true;
    await sendTrackedMessage(chatId, "Enter new address:");
    return;
  }

  if (data === 'name_skip') {
    state.name = null;
    state.awaitingName = false;
    askGender(chatId);
    return;
  }

  if (data.startsWith('gender_')) return handleGenderCallback(chatId, data);

  if (data === 'map_skip') {
    state.mapLink = null;
    await createClientRecord(chatId);
    return;
  }

  if (data === 'final_confirm') {
    await finalConfirmBooking(chatId);
    return;
  }

  if (data === 'cancel_booking_flow') {
    await sendTrackedMessage(chatId, "Booking flow canceled.");
    cleanupAfterDelay(chatId);
    return;
  }
}

// The following helper callback handlers (handleAmountCallback, handleDurationCallback, etc.) were in original code:
async function handleAmountCallback(chatId, data) {
  const state = bookingData[chatId];
  if (data === 'amount_custom') {
    state.awaitingCustomAmount = true;
  } else {
    state.amount = data.replace('amount_','');
    state.step = 2;
    askDuration(chatId);
  }
}

function handleDurationCallback(chatId, data) {
  const state = bookingData[chatId];
  state.duration = data.replace('duration_','');
  state.step = 3;
  askPayment(chatId);
}

function handlePaymentCallback(chatId, data) {
  const state = bookingData[chatId];
  const p = data.replace('payment_','');
  state.paymentMethod = p === 'cash' ? 'Cash' : 'Online/Bank';
  state.step = 4;
  askProfit(chatId);
}

function handleProfitCallback(chatId, data) {
  const state = bookingData[chatId];
  const p = data.replace('profit_','');
  state.profitShare = p === 'shared' ? 'Shared' : 'Only Ranjeet';
  state.step = 5;
  askStaff(chatId);
}

function handleStaffCallback(chatId, data) {
  const state = bookingData[chatId];
  const s = data.replace('staff_','');
  const selectedStaff = _.find(STAFF_OPTIONS, opt => opt.toLowerCase() === s);
  state.staff = selectedStaff || null;
  state.step = 6;
  askServices(chatId);
}

function handleServiceCallback(chatId, data) {
  const state = bookingData[chatId];
  const serviceId = data.replace('service_', '');
  const selectedService = _.find(SERVICES, s => s.id === serviceId);
  if (selectedService) {
    state.service = selectedService.name;
    state.step = 7;
    askDate(chatId);
  }
}

function handleDateCallback(chatId, data) {
  const state = bookingData[chatId];
  if (data === 'date_custom') {
    state.awaitingDate = true;
    sendTrackedMessage(chatId, "Please enter the date (format: YYYY-MM-DD)");
  } else {
    state.date = data.replace('date_', '');
    state.step = 8;
    askTime(chatId);
  }
}

function handleTimeCallback(chatId, data) {
  const state = bookingData[chatId];
  const t = data.replace('time_','').replace(/_/g,' ');
  if (t.toLowerCase().includes('custom')) {
    state.awaitingCustomTime = true;
  } else {
    state.time = t;
    state.step = 10;
    askClientPhone(chatId);
  }
}

function handleGenderCallback(chatId, data) {
  const state = bookingData[chatId];
  if (data === 'gender_male') state.gender = 'Male';
  else if (data === 'gender_female') state.gender = 'Female';
  else if (data === 'gender_skip') state.gender = null;
  askAddress(chatId);
}

// Export bot
module.exports = { bot };

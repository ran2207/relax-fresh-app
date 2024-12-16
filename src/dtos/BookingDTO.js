/**
 * @typedef {Object} BookingDTO
 * @property {string} clientPhone - Client's phone number (unique identifier)
 * @property {string} serviceType - Type of service booked
 * @property {number} duration - Duration of the service in minutes
 * @property {Date} requestedDate - Requested date for the booking
 * @property {Object} requestedTimeSlot - Start and end times
 * @property {Date} requestedTimeSlot.start
 * @property {Date} requestedTimeSlot.end
 * @property {string} status - Current booking status: "Pending", "Approved", "Cancelled", "Completed"
 * @property {string} [assignedStaff] - Which staff member is assigned
 */

module.exports = {};

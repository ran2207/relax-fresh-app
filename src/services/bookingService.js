const Booking = require('../models/Booking');
const Client = require('../models/Client');

/**
 * @typedef {import('../dtos/BookingDTO').BookingDTO} BookingDTO
 */

class BookingService {
  /**
   * Creates a new booking
   * @param {BookingDTO} bookingData 
   * @returns {Promise<any>}
   */
  async createBooking(bookingData) {
    // First ensure client exists
    const client = await Client.findOne({ phone: bookingData.clientPhone });
    if (!client) {
      throw new Error('Client not found');
    }

    const booking = new Booking({
      ...bookingData,
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return booking.save();
  }

  /**
   * Updates a booking status
   * @param {string} bookingId 
   * @param {string} status 
   * @returns {Promise<any>}
   */
  async updateBookingStatus(bookingId, status) {
    return Booking.findByIdAndUpdate(
      bookingId,
      { 
        status,
        updatedAt: new Date()
      },
      { new: true }
    );
  }
}

module.exports = new BookingService(); 
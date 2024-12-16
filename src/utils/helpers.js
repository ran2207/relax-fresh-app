/**
 * @function generateBookingId
 * @description Generates a random booking ID.
 * @returns {string} A random booking ID
 */
function generateBookingId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * @function formatDate
 * @param {Date} date
 * @returns {string} formatted date YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth()+1).padStart(2,'0');
  const day = String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}

/**
 * @function capitalize
 * @param {string} str
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  return str.split(' ').map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(' ');
}

module.exports = { generateBookingId, formatDate, capitalize };

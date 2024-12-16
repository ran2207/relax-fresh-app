// Minimal controller, since most logic is handled in the handler due to polling.
function testController(req, res) {
  res.send("Telegram endpoint working");
}

module.exports = { testController };

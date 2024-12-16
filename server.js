require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { connectDB } = require('./src/config/database');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const telegramRoutes = require('./src/routes/telegramRoutes');

require('./src/handlers/telegramHandler');


const app = express();

app.use(bodyParser.json());

// Connect to MongoDB
connectDB();

// Routes
app.use('/webhook', whatsappRoutes);
app.use('/telegram', telegramRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

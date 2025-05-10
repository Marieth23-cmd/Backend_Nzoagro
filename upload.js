// middleware/upload.js
const multer = require("multer");

const storage = multer.memoryStorage(); // armazena na RAM
const upload = multer({ storage });

module.exports = upload;

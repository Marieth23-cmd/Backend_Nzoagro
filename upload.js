//upload.js
const multer = require("multer");
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // limite de 5MB
  }
});

module.exports = upload;
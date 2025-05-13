// Código corrigido para o upload de imagens no Cloudinary
const multer = require("multer");
const { v2: cloudinary } = require('cloudinary');
const streamifier = require("streamifier");

// Configuração do Multer para armazenar arquivos temporariamente na memória
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // limite de 5MB
  }
});

// Função auxiliar para fazer upload de buffer para o Cloudinary
function uploadToCloudinary(buffer, folder = "produtos") {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

module.exports = {
  upload,
  uploadToCloudinary
};
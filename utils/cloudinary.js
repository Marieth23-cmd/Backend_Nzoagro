// cloudinaryUpload.js - Função separada para upload
const streamifier = require("streamifier");
const { cloudinary } = require("../cloudinaryConfig"); // Ajuste o caminho conforme necessário

/**
 * Função para fazer upload de um buffer para o Cloudinary
 * @param {Buffer} buffer - Buffer do arquivo a ser enviado
 * @param {string} folder - Pasta no Cloudinary onde o arquivo será armazenado
 * @returns {Promise<Object>} - Resultado do upload do Cloudinary
 */
function uploadToCloudinary(buffer, folder = "produtos") {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) {
          console.log("Erro no upload para o Cloudinary:", error);
          return reject(error);
        }
        console.log("Upload para o Cloudinary bem-sucedido:", result.secure_url);
        resolve(result);
      }
    );
    
    
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

module.exports = {
  uploadToCloudinary
};
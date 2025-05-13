// Configuração do Cloudinary
const { v2: cloudinary } = require('cloudinary');
const dotenv = require('dotenv');

dotenv.config();

// Verifica se as variáveis de ambiente estão configuradas
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
  console.error(`
    ⚠️ ATENÇÃO: Configurações do Cloudinary incompletas! 
    Verifique seu arquivo .env e certifique-se de que as seguintes variáveis estão definidas:
    - CLOUDINARY_CLOUD_NAME
    - CLOUDINARY_API_KEY
    - CLOUDINARY_API_SECRET
  `);
}

// Configuração do Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Função para testar conexão com o Cloudinary
async function testCloudinaryConnection() {
  try {
    const result = await cloudinary.api.ping();
    console.log('✅ Conexão com Cloudinary estabelecida com sucesso!', result);
    return true;
  } catch (error) {
    console.error('❌ Erro na conexão com Cloudinary:', error);
    return false;
  }
}

// Exporta cloudinary e função de teste
module.exports = {
  cloudinary,
  testCloudinaryConnection
};
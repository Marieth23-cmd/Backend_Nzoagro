require('dotenv').config();
const mysql = require('mysql2/promise');
  
// Criar pool de conexões
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, // Removi o 'e' extra aqui
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,   
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Função para testar a conexão
async function testarConexao() {
  try {
    const connection = await pool.getConnection();
    console.log("Conexão feita com sucesso");
    connection.release();
  } catch (error) {
    console.log("Erro na conexão", error);
  }
}

// Testar a conexão quando o arquivo for carregado
testarConexao();

// Exportar o pool para uso em outros arquivos
module.exports = pool;
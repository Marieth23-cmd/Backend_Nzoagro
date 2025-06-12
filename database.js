require('dotenv').config();
const mysql = require('mysql2');
  
// Criar pool de conexões
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,   
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

 pool.getConnection((error , connection) => {
  if (error) {
    console.error('Erro ao conectar ao banco de dados:', error);
    return;
  }else {
    console.log('Conexão com o banco de dados estabelecida com sucesso!');
  connection.release(); 
  }
  })
  
  
module.exports = pool;
 const mysql= require("mysql2");
  
 const pool=mysql.createPool({
    host:"localhost",
    user:"root",
    password:"",
    database:"nzoagro1",
    waitForConnections:true,
    connectionLimit:10,
    queueLimit:0,
    
  });
  


  pool.getConnection((err,connection)=>{
    if(err){
        console.log("erro na conexão" , err);
    }else{
        console.log("conexão feita com sucesso")
        connection.release();
    }
  })
  module.exports=pool;
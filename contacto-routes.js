const express = require("express");
const router = express.Router();
const conexao = require("./database"); 

router.use(express.json());


 router.delete( "/id" , async(req , res) => {
     
     const id= req.params.id;
     const sql= " DELETE FROM CONTACTO WHERE id_contacto=?  "
      try{
        const [result]=  await conexao.promise().query(sql ,[id])
     if( result.affectedRows===0){
        return res.status(400).json( "Contacto não encontrado")

    }
    res.status(201).json("Contacto deletado com sucesso!", result.insrtId )

    } catch(erro){
        res.status(500).json({Erro:"Erro ao deletar contacto" , detale:erro})
    }
 }








 )

 

   



module.exports = router;

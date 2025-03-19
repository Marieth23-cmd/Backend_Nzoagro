 const express = require("express")
const conexao= require("./database")
 const router= express.Router();

 router.use(express.json());

  router.get("/" , async( req , res) =>{

         const sql= "SELECT * FROM estoque"

         try{
             const [resultado] = await conexao.promise().query(sql);

             if( resultado.length===0){
                res.status(404).json({ erro:"Estoque indisponível" , detalhe:err.message})
             }
             res.json(resultado)
         } catch(erro){
            res.status(500).json({erro:"Erro ao buscar estoque" , detalhe:erro.message})
         }


  })
  module.exports=router;
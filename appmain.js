const express=require("express")
const usuarios=require("./user-routes")
const  app=express();
const produtos= require("./produtos-routes")
const notificacoes=require("./notificacoes-routes")
const pedidos= require("./pedidos-routes")
const pagamentos= require("./pagamentos-routes")
const entrega= require("./entrega-routes")
const estoque= require("./estoque-router")
const relatorio= require("./relatorio-routes")
app.use(express.json())

app.use("/usuarios" ,usuarios) ;
app.use("/estoque" ,estoque) ;
app.use("/produtos" ,produtos);
app.use("/notificacoes" ,notificacoes);
app.use("/pedidos" ,pedidos);
app.use("/entrega" ,entrega);
app.use("/relatorio" ,relatorio);
app.use("/pagamentos" ,pagamentos);


const Porta=4000;



app.listen(Porta ,() =>{
    console.log(` O servidor está rodando na ${Porta}`)
}
)


require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Inicializando o Express
const app = express();

// Configuração do CORS
app.use(cors({ 
    origin: "http://localhost:3000", 
    credentials: true 
}));

// Importando rotas
const usuarios = require("./user-routes");
const produtos = require("./produtos-routes");
const notificacoes = require("./notificacoes-routes");
const pedidos = require("./pedidos-routes");
const pagamentos = require("./pagamentos-routes");
const entrega = require("./entrega-routes");
const estoque = require("./estoque-router");
const relatorio = require("./relatorio-routes");
const login = require("./login");

// Middleware para permitir JSON
app.use(express.json());

// Definição das rotas
app.use("/usuarios", usuarios);
app.use("/estoque", estoque);
app.use("/produtos", produtos);
app.use("/notificacoes", notificacoes);
app.use("/pedidos", pedidos);
app.use("/entrega", entrega);
app.use("/relatorio", relatorio);
app.use("/pagamentos", pagamentos);
app.use("/login", login);

// Porta do servidor
const PORTA = 4000;

// Inicializando o servidor
app.listen(PORTA, () => {
    console.log(` O servidor está rodando na porta ${PORTA}`);
});

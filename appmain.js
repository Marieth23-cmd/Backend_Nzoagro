require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const { socketHandler } = require("./socket/socketHandler");


// Inicializando o Express
const app = express();

const allowedOrigins = [
    "http://localhost:3000",
    "https://nzo-agrofinal.vercel.app"
];

// Configuração do CORS
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            return callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true
}));

// Middleware para cookies
app.use(cookieParser());

// Middleware para JSON
app.use(express.json());

// Criação do servidor HTTP
const server = http.createServer(app);

// Configuração do Socket.io com CORS
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true
    }
});

// Mapa de usuários conectados
const usuariosConectados = new Map();

// Conexão com Socket.io
io.on("connection", (socket) => {
    console.log("Novo usuário conectado:", socket.id);

    socket.on("autenticar", (userId) => {
        usuariosConectados.set(userId, socket.id);
        console.log(`Usuário ${userId} autenticado com socket ${socket.id}`);
    });

    socket.on("disconnect", () => {
        for (let [id, sock] of usuariosConectados.entries()) {
            if (sock === socket.id) {
                usuariosConectados.delete(id);
                break;
            }
        }
        console.log("Usuário desconectado:", socket.id);
    });
});

// Importando rotas
const usuarios = require("./user-routes");
const produtos = require("./produtos-routes");
const notificacoes = require("./notificacoes-routes");
const pedidos = require("./pedidos-routes");
const pagamentos = require("./pagamentos-routes");
const estoque = require("./estoque-router");
const relatorio = require("./relatorio-routes");
const login = require("./login");
const carrinho = require("./carrinho");
const avaliacoes = require("./avaliacoes");


app.use((req, res, next) => {
    req.io = io;
    next();
  });
// Definindo as rotas
app.use("/usuarios", usuarios);
app.use("/estoque", estoque);
app.use("/produtos", produtos);
app.use("/notificacoes", notificacoes);
app.use("/pedidos", pedidos);
app.use("/relatorios", relatorio);
app.use("/pagamentos", pagamentos);
app.use("/login", login);
app.use("/carrinho", carrinho);
app.use("/avaliacoes", avaliacoes);

// Log de requisições
app.use((req, res, next) => {
    console.log(`Rota acessada: ${req.method} ${req.path}`);
    console.log(`Cookies presentes: ${req.cookies ? 'Sim' : 'Não'}`);
    next();
});

socketHandler(io);
// Porta do servidor
const PORTA = 4000;

// Inicializando o servidor HTTP com Socket.io
server.listen(PORTA, () => {
    console.log(`Servidor rodando na porta ${PORTA}`);
});

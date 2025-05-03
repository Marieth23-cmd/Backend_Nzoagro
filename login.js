require("dotenv").config();
const express = require("express");
const router = express.Router();
const conexao = require("./database");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");

const SECRET_KEY = process.env.SECRET_KEY || "chaveDeSegurancaPadrao";

// Middleware
router.use(express.json());
router.use(cookieParser());

// Rota de Login
router.post("/", async (req, res) => {
    console.log("Recebendo login:", req.body);
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ mensagem: "E-mail e senha são obrigatórios" });
    }

    try {
        const [usuarios] = await conexao.promise().query(
            `SELECT id_usuario, nome, senha, status, tipo_usuario , foto ,
             descricao FROM USUARIOS WHERE email = ?`
            ,
            [email]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({ mensagem: "Usuário não encontrado" });
        }

        const usuario = usuarios[0];

        if (usuario.status === "desativado") {
            return res.status(403).json({ mensagem: "Conta desativada. Contate o suporte." });
        }
       
            console.log("Senha digitada:",typeof senha);
            console.log("Senha do banco:", usuario.senha);               

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
        if (!senhaCorreta) {
            return res.status(401).json({ mensagem: "Senha incorreta!" });
        }

        const token = jwt.sign(
            { id_usuario: usuario.id_usuario, nome: usuario.nome, tipo_usuario: usuario.tipo_usuario },
            SECRET_KEY,
            { expiresIn: "1h" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: true,             
            sameSite: "None",         
            maxAge: 3600000,
            path: "/"
        });

        res.status(200).json({
            mensagem: "Sessão iniciada",
            token,
            usuario: { id: usuario.id_usuario, nome: usuario.nome, tipo_usuario: usuario.tipo_usuario }
        });

    } catch (error) {
        console.log("Erro ao iniciar sessão:", error);

        // Verifica se o erro veio do banco de dados e exibe a mensagem correta
        if (error.sqlMessage) {
            return res.status(500).json({ mensagem: "Erro no banco de dados", erro: error.sqlMessage });
        }

        res.status(500).json({ mensagem: "Erro ao iniciar sessão", erro: error.message });
    }
});

// Rota de Logout
router.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.status(200).json({ mensagem: "Sessão encerrada" });
});


router.get("/auth/verificar", autenticarToken, (req, res) => {
    res.json({ autenticado: true, usuario: req.usuario });
});

module.exports = router;

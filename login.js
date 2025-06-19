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


router.post("/", async (req, res) => {
    console.log("Recebendo login:", req.body);
    const { email, senha , contacto } = req.body;

    if ((!email && contacto) || !senha) {
        return res.status(400).json({ mensagem: "E-mail e senha são obrigatórios" });
    }

    try {
        // Primeiro, tenta encontrar na tabela usuarios
        const [usuarios] = await conexao.promise().query(
            `SELECT id_usuario as id, nome, senha, status, tipo_usuario, foto, 
             descricao FROM usuarios WHERE email = ? OR contacto =?`,
            [email , contacto]
        );

        // Se não encontrou na tabela usuarios, tenta na tabela transportadoras
        const [transportadoras] = await conexao.promise().query(
            `SELECT id, nome, senha_hash as senha, status, 
             NULL as foto, NULL as descricao FROM transportadoras WHERE email = ? OR contacto=?`,
            [email ,contacto]
        );

        // Verifica qual tabela retornou resultado e ajusta os dados
        let conta = null;
        let tipoUsuario = null;
        
        if (usuarios.length > 0) {
            conta = usuarios[0];
            tipoUsuario = conta.tipo_usuario; 
        } else if (transportadoras.length > 0) {
            conta = transportadoras[0];
            tipoUsuario = 'transportadora'; // Definido manualmente
        } else {
            return res.status(401).json({ mensagem: "Usuário não encontrado" });
        }

        // Verifica se a conta está ativa
        if (conta.status === "desativado" || conta.status === "inativo") {
            return res.status(403).json({ mensagem: "Conta desativada. Contate o suporte." });
        }

        console.log("Senha digitada:", typeof senha);
        console.log("Senha do banco:", conta.senha);

        // Verifica a senha
        const senhaCorreta = await bcrypt.compare(senha, conta.senha);
        if (!senhaCorreta) {
            return res.status(401).json({ mensagem: "Senha incorreta!" });
        }

        // Cria o token JWT
        const token = jwt.sign(
            { 
                id_usuario: conta.id, 
                nome: conta.nome, 
                tipo_usuario: tipoUsuario
            },
            SECRET_KEY,
            { expiresIn: "1h" }
        );

        // Define o cookie
        res.cookie("token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "None",
            maxAge: 3600000,
            path: "/"
        });

        // Retorna resposta de sucesso
        res.status(200).json({
            mensagem: "Sessão iniciada",
            token,
            usuario: { 
                id: conta.id, 
                nome: conta.nome, 
                tipo_usuario: tipoUsuario
            }
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


router.post("/logout", (req, res) => {
    try {
        // Limpar o cookie com as mesmas opções que foram usadas para criá-lo
        res.clearCookie("token", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production", // HTTPS em produção
            sameSite: "strict"
        });
        
        res.status(200).json({ 
            mensagem: "Sessão encerrada com sucesso",
            success: true 
        });
    } catch (error) {
        console.log("Erro ao fazer logout:", error);
        res.status(500).json({ 
            mensagem: "Erro ao encerrar sessão",
            success: false 
        });
    }
});


//verificar autenticação
router.get("/auth/verificar", autenticarToken, async (req, res) => {
    try {
        console.log("=== VERIFICANDO AUTENTICAÇÃO ===");
        console.log("req.usuario do token:", req.usuario);
        
        if (!req.usuario || !req.usuario.id_usuario) {
            console.log("❌ Usuário não encontrado no token");
            return res.status(401).json({ erro: "Usuário não autenticado" });
        }

        
        const [usuarios] = await conexao.promise().query(
            "SELECT id_usuario, nome, email, tipo_usuario FROM usuarios WHERE id_usuario = ?",
            [req.usuario.id_usuario]
        );

        if (usuarios.length === 0) {
            console.log("❌ Usuário não encontrado no banco");
            return res.status(404).json({ erro: "Usuário não encontrado" });
        }

        const usuarioCompleto = usuarios[0];
        console.log("✅ Usuário encontrado no banco:", usuarioCompleto);
        
        res.json({ 
            autenticado: true, 
            usuario: {
                id_usuario: usuarioCompleto.id_usuario,
                nome: usuarioCompleto.nome,
                email: usuarioCompleto.email,
                tipo_usuario: usuarioCompleto.tipo_usuario
            }
        });
        
    } catch (error) {
        console.log("❌ Erro ao verificar autenticação:", error);
        res.status(500).json({ erro: "Erro no servidor" , erro:error.message });
    }
});




module.exports = router;

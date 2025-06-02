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
// router.post("/", async (req, res) => {
//     console.log("Recebendo login:", req.body);
//     const { email, senha } = req.body;

//     if (!email || !senha) {
//         return res.status(400).json({ mensagem: "E-mail e senha são obrigatórios" });
//     }

//     try {
//         const [usuarios] = await conexao.promise().query(
//             `SELECT id_usuario, nome, senha, status, tipo_usuario , foto ,
//              descricao FROM usuarios WHERE email = ?`
//             ,
//             [email]
//         );

//         if (usuarios.length === 0) {
//             return res.status(401).json({ mensagem: "Usuário não encontrado" });
//         }

//         const usuario = usuarios[0];

//         if (usuario.status === "desativado") {
//             return res.status(403).json({ mensagem: "Conta desativada. Contate o suporte." });
//         }
       
//             console.log("Senha digitada:",typeof senha);
//             console.log("Senha do banco:", usuario.senha);               

//         const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
//         if (!senhaCorreta) {
//             return res.status(401).json({ mensagem: "Senha incorreta!" });
//         }

//         const token = jwt.sign(
//             { id_usuario: usuario.id_usuario, nome: usuario.nome, tipo_usuario: usuario.tipo_usuario },
//             SECRET_KEY,
//             { expiresIn: "1h" }
//         );

//         res.cookie("token", token, {
//             httpOnly: true,
//             secure: true,             
//             sameSite: "None",         
//             maxAge: 3600000,
//             path: "/"
//         });

//         res.status(200).json({
//             mensagem: "Sessão iniciada",
//             token,
//             usuario: { id: usuario.id_usuario, nome: usuario.nome, tipo_usuario: usuario.tipo_usuario }
//         });

//     } catch (error) {
//         console.log("Erro ao iniciar sessão:", error);

//         // Verifica se o erro veio do banco de dados e exibe a mensagem correta
//         if (error.sqlMessage) {
//             return res.status(500).json({ mensagem: "Erro no banco de dados", erro: error.sqlMessage });
//         }

//         res.status(500).json({ mensagem: "Erro ao iniciar sessão", erro: error.message });
//     }
// });






router.post("/", async (req, res) => {
    console.log("Recebendo login:", req.body);
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ mensagem: "E-mail e senha são obrigatórios" });
    }

    try {
        // Primeiro, tenta encontrar na tabela usuarios
        const [usuarios] = await conexao.promise().query(
            `SELECT id_usuario as id, nome, senha, status, tipo_usuario, foto, 
             descricao FROM usuarios WHERE email = ?`,
            [email]
        );

        // Se não encontrou na tabela usuarios, tenta na tabela transportadoras
        const [transportadoras] = await conexao.promise().query(
            `SELECT id_transportadora as id, nome, senha_hash as senha, status, 
             NULL as foto, NULL as descricao FROM transportadoras WHERE email = ?`,
            [email]
        );

        // Verifica qual tabela retornou resultado e ajusta os dados
        let conta = null;
        let tipoUsuario = null;
        
        if (usuarios.length > 0) {
            conta = usuarios[0];
            tipoUsuario = conta.tipo_usuario; // Vem da tabela usuarios
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












// Rota de Logout
router.post("/logout", (req, res) => {
    res.clearCookie("token");
    res.status(200).json({ mensagem: "Sessão encerrada" });
});


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

require("dotenv").config();
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SECRET_KEY || "chaveDeSegurancaPadrao";
const autenticarToken = (req, res, next) => {
    console.log("Cookies recebidos:", req.cookies);
    
    if (!req.cookies || !req.cookies.token) {
        console.log("Token não encontrado nos cookies");
        return res.status(401).json({ mensagem: "Acesso negado. Token não fornecido." });
    }

    const token = req.cookies.token || req.cookies.Token;
    console.log("Token encontrado:", token.substring(0, 15) + "...");

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        console.log("Token decodificado com sucesso:", decoded.id_usuario, decoded.tipo_usuario);
        req.usuario = decoded;
        next();
    } catch (error) {
        console.log("Erro ao verificar token:", error.message);
        return res.status(401).json({ mensagem: "Token inválido ou expirado" });
    }
};

// Middleware para autorização de usuários específicos
const autorizarUsuario = (tiposPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario || !tiposPermitidos.includes(req.usuario.tipo_usuario)) {
            return res.status(403).json({ mensagem: "Acesso negado. Permissão insuficiente." });
        }
        next();
    };
};

module.exports = { autenticarToken, autorizarUsuario };

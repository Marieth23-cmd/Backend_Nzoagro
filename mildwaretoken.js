require("dotenv").config();
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SECRET_KEY || "chaveDeSegurancaPadrao";

// Middleware para autenticação do token via Cookies
const autenticarToken = (req, res, next) => {
    if (!req.cookies || !req.cookies.token) {
        return res.status(401).json({ mensagem: "Acesso negado. Token não fornecido." });
    }

    const token = req.cookies.token;

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.usuario = decoded;
        next();
    } catch (error) {
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

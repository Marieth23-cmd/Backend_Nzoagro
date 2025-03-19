const express = require ("express");
const router = express.Router();
const conexao = require("./database"); 
const bcrypt= require("bcryptjs") ;


router.use(express.json());


router.post("/login", async (req, res) => {
    const { email, senha } = req.body;

    try {
        const [usuarios] = await conexao.promise().query(
            "SELECT id_usuario, nome, senha, status FROM USUARIOS WHERE email = ?", 
            [email]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({ mensagem: "Usuário não encontrado" });
        }

        const usuario = usuarios[0];

        if (usuario.status === "desativado") {
            return res.status(403).json({ mensagem: "Conta excluída. Para mais informações entre em contato com o suporte." });
        }

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

        if (!senhaCorreta) {
            return res.status(401).json({ mensagem: "Senha incorreta!" });
        }

        res.status(200).json({ mensagem: "Sessão iniciada", usuario });
        
    } catch (error) {
        console.error("Erro ao iniciar sessão:", error); 
        res.status(500).json({ mensagem: "Erro ao iniciar Sessão", erro: error.message });
    }
});

module.exports = router;

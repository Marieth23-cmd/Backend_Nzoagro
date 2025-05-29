const express = require("express");
const senhaValida = /^[a-zA-Z0-9]{6,12}$/; // Senha entre 6 e 12 caracteres alfanuméricos
const numeroAngola = /^9\d{8}$/; // Telefone angolano deve começar com 9 e ter 9 dígitos
const router = express.Router();
const conexao = require("./database");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.SECRET
const { autenticarToken } = require("./mildwaretoken");



router.post("/cadastrar", async (req, res) => {
    const { nome, nif, telefone, email, senha, provincia_base } = req.body;

    // Validação de campos obrigatórios
    if (!nome || !nif || !telefone || !email || !senha) {
        return res.status(400).json({
            mensagem: "Nome, NIF, Telefone, E-mail e Senha são obrigatórios"
        });
    }

    // Validação de senha
    if (!senhaValida.test(senha)) {
        return res.status(400).json({ mensagem: "A senha deve ter entre 6 e 12 caracteres" });
    }

    // Validação do telefone (contacto)
    if (!numeroAngola.test(String(telefone))) {
        return res.status(400).json({ mensagem: "O telefone deve ter 9 dígitos e começar com 9" });
    }

    try {
        // Verifica duplicidade de e-mail ou NIF
        const [existe] = await conexao.promise().query(
            "SELECT id FROM transportadoras WHERE email = ? OR nif = ?",
            [email, nif]
        );
        if (existe.length > 0) {
            return res.status(409).json({ mensagem: "E-mail ou NIF já cadastrados. Tente outros." });
        }

        // Criptografa a senha
        const salt = await bcrypt.genSalt(10);
        const senhaCriptografada = await bcrypt.hash(senha, salt);

        // Insere no banco
        const [resultado] = await conexao.promise().query(
            "INSERT INTO transportadoras (nome, nif, telefone, email, senha_hash, provincia_base, status, data_cadastro) VALUES (?, ?, ?, ?, ?, ?, 'ativo', NOW())",
            [nome, nif, telefone, email, senhaCriptografada, provincia_base || null]
        );

        const idTransportadora = resultado.insertId;

        // Cria o token JWT para a sessão
        const token = jwt.sign(
            { id_transportadora: idTransportadora, nome, tipo: "transportadora" },
            SECRET_KEY,
            { expiresIn: "2h" }
        );

        // Retorna resposta padronizada com token e dados básicos
        res.status(201).json({
            mensagem: "Cadastro realizado e sessão iniciada",
            token,
            transportadora: {
                id: idTransportadora,
                nome,
                email,
                telefone,
                provincia_base
            }
        });
    } catch (erro) {
        console.error("Erro ao cadastrar transportadora:", erro);
        res.status(500).json({ mensagem: "Erro ao cadastrar transportadora", erro });
    }
});


/**
 * Cadastro de filial de transportadora
 */
router.post("/cadastrar-filial", autenticarToken, async (req, res) => {
    const { provincia, bairro, descricao } = req.body;
    const transportadora_id = req.usuario.id_usuario; // id da transportadora autenticada

    if (!provincia) {
        return res.status(400).json({ mensagem: "Provincia é obrigatória." });
    }
    try {
        // Verifica se filial já existe para a transportadora nessa província e bairro
        const [existe] = await conexao.promise().query(
            "SELECT * FROM filiais_transportadora WHERE transportadora_id = ? AND provincia = ? AND bairro = ?",
            [transportadora_id, provincia, bairro || null]
        );
        if (existe.length > 0) {
            return res.status(400).json({ mensagem: "Filial já cadastrada para este local." });
        }
        await conexao.promise().query(
            `INSERT INTO filiais_transportadora (transportadora_id, provincia, bairro, descricao)
             VALUES (?, ?, ?, ?)`,
            [transportadora_id, provincia, bairro || null, descricao || null]
        );
        res.status(201).json({ mensagem: "Filial cadastrada com sucesso." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao cadastrar filial." });
    }
});

/**
 * Registrar entrega (Transportadora aceita um pedido)
 */
router.post("/aceitar-entrega", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    const { pedidos_id, endereco, contacto_cliente, filial_retirada_id } = req.body;

    if (!pedidos_id || !endereco || !contacto_cliente || !filial_retirada_id) {
        return res.status(400).json({ mensagem: "Todos os campos obrigatórios." });
    }
    try {
        // Verifica se pedido já está em entrega
        const [existe] = await conexao.promise().query(
            "SELECT * FROM entregas WHERE pedidos_id = ?",
            [pedidos_id]
        );
        if (existe.length > 0) {
            return res.status(400).json({ mensagem: "Este pedido já está sendo entregue." });
        }
        await conexao.promise().query(
            `INSERT INTO entregas 
                (data_entrega, estado_entrega, pedidos_id, endereco, contacto_cliente, transportadora_id, filial_retirada_id)
             VALUES 
                (NOW(), 'em rota', ?, ?, ?, ?, ?)`,
            [pedidos_id, endereco, contacto_cliente, transportadora_id, filial_retirada_id]
        );
        res.json({ mensagem: "Entrega registrada com sucesso." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao registrar entrega." });
    }
});

/**
 * Listar entregas da transportadora autenticada
 */
router.get("/minhas-entregas", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    try {
        const [entregas] = await conexao.promise().query(
            `SELECT e.*, p.* 
               FROM entregas e
               LEFT JOIN pedidos p ON e.pedidos_id = p.id
             WHERE e.transportadora_id = ?`,
            [transportadora_id]
        );
        res.json({ entregas });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar entregas." });
    }
});

/**
 * Listar entregas pendentes da transportadora autenticada
 */
router.get("/entregas-pendentes", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    try {
        const [entregas] = await conexao.promise().query(
            `SELECT e.*, p.*
               FROM entregas e
               LEFT JOIN pedidos p ON e.pedidos_id = p.id
             WHERE e.transportadora_id = ? AND e.estado_entrega = 'pendente'`,
            [transportadora_id]
        );
        if (entregas.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma entrega pendente encontrada." });
        }
        res.json({ entregas });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar entregas pendentes." });
    }
});

/**
 * Listar filiais da transportadora autenticada
 */
router.get("/minhas-filiais", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    try {
        const [filiais] = await conexao.promise().query(
            `SELECT * FROM filiais_transportadora WHERE transportadora_id = ?`,
            [transportadora_id]
        );
        if (filiais.length === 0) {
            return res.status(404).json({ mensagem: "Nenhuma filial encontrada." });
        }
        res.json({ filiais });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar filiais." });
    }
});

/**
 * Atualiza o status de uma entrega
 */
router.put("/entrega/:id_entrega/status", autenticarToken, async (req, res) => {
    const { id_entrega } = req.params;
    const { estado_entrega } = req.body;

    const estadosValidos = ["pendente", "em rota", "aguardando retirada", "entregue"];
    if (!estadosValidos.includes(estado_entrega)) {
        return res.status(400).json({ mensagem: "Estado de entrega inválido." });
    }
    try {
        await conexao.promise().query(
            `UPDATE entregas 
               SET estado_entrega = ? 
             WHERE id_entregas = ?`,
            [estado_entrega, id_entrega]
        );
        res.json({ mensagem: "Status da entrega atualizado com sucesso." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar status da entrega." });
    }
});

/**
 * Listar todas as filiais de uma transportadora pelo ID (extra)
 */
router.get("/filiais/:id_transportadora", autenticarToken, async (req, res) => {
    const { id_transportadora } = req.params;
    try {
        const [filiais] = await conexao.promise().query(
            `SELECT * FROM filiais_transportadora WHERE transportadora_id = ?`,
            [id_transportadora]
        );
        res.json({ filiais });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar filiais." });
    }
});


module.exports = router;
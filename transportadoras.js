const express = require("express");
const senhaValida = /^[a-zA-Z0-9]{6,12}$/; // Senha entre 6 e 12 caracteres alfanuméricos
const numeroAngola = /^9\d{8}$/; // Telefone angolano deve começar com 9 e ter 9 dígitos
const router = express.Router();
const conexao = require("./database");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { autenticarToken } = require("./mildwaretoken");
 const SECRET_KEY = process.env.SECRET_KEY || "chaveDeSegurancaPadrao";
 const notificar = require("./utils/notificar");


router.post("/cadastrar", async (req, res) => {
    const { nome, nif, telefone, email, senha, provincia_base } = req.body;
        console.log( "dados recebidos", req.body)
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
            "INSERT INTO transportadoras (nome, nif, contacto, email, senha_hash, provincia_base, status, data_cadastro) VALUES (?, ?, ?, ?, ?, ?, 'ativo', NOW())",
            [nome, nif, telefone, email, senhaCriptografada, provincia_base || null]
        );

        const idTransportadora = resultado.insertId;

        // Criar o token JWT para a sessão
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



router.get("/filiais-select", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    
    try {
        const [filiais] = await conexao.promise().query(`
            SELECT 
                id_filial,
                provincia,
                bairro,
                descricao,
                CONCAT(provincia, ' - ', COALESCE(bairro, 'Centro'), 
                       CASE WHEN descricao IS NOT NULL THEN CONCAT(' (', descricao, ')') ELSE '' END
                ) as nome_completo
            FROM filiais_transportadora 
            WHERE transportadora_id = ?
            ORDER BY provincia, bairro
        `, [transportadora_id]);

        if (filiais.length === 0) {
            return res.status(404).json({ 
                mensagem: "Nenhuma filial cadastrada. Cadastre pelo menos uma filial primeiro.",
                filiais: []
            });
        }

        res.json({ 
            mensagem: "Filiais carregadas com sucesso",
            total: filiais.length,
            filiais 
        });

    } catch (erro) {
        console.error("Erro ao buscar filiais:", erro);
        res.status(500).json({ erro: "Erro ao carregar filiais." });
    }
});

/**
 * Aceitar pedido e notificar cliente sobre filial de retirada
 */
router.post("/aceitar-pedido-notificar", autenticarToken, async (req, res) => {
    const transportadora_id = req.usuario.id_usuario;
    const { pedidos_id, filial_retirada_id, observacoes } = req.body;
    const io = req.io; // Socket.io para notificações em tempo real

    // Validações
    if (!pedidos_id || !filial_retirada_id) {
        return res.status(400).json({ 
            mensagem: "ID do pedido e filial de retirada são obrigatórios." 
        });
    }

    try {
        // Verificar se pedido existe e está disponível
        const [pedidoInfo] = await conexao.promise().query(`
            SELECT 
                p.id_pedido,
                p.id_usuario,
                p.valor_total,
                p.estado,
                u.nome as cliente_nome,
                u.email as cliente_email,
                u.contacto as cliente_telefone,
                ep.provincia as cliente_provincia,
                ep.municipio as cliente_municipio,
                ep.bairro as cliente_bairro
            FROM pedidos p
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            JOIN endereco_pedidos ep ON p.id_pedido = ep.id_pedido
            WHERE p.id_pedido = ? AND p.estado IN ('processado', 'enviado')
        `, [pedidos_id]);

        if (pedidoInfo.length === 0) {
            return res.status(404).json({ 
                mensagem: "Pedido não encontrado ou não está disponível para coleta." 
            });
        }

        // Verificar se pedido já está sendo entregue
        const [entregaExistente] = await conexao.promise().query(
            "SELECT id_entregas FROM entregas WHERE pedidos_id = ?",
            [pedidos_id]
        );

        if (entregaExistente.length > 0) {
            return res.status(400).json({ 
                mensagem: "Este pedido já está sendo entregue por outra transportadora." 
            });
        }

        // Buscar informações da filial escolhida
        const [filialInfo] = await conexao.promise().query(`
            SELECT 
                id_filial,
                provincia,
                bairro,
                descricao,
                CONCAT(provincia, ' - ', COALESCE(bairro, 'Centro'), 
                       CASE WHEN descricao IS NOT NULL THEN CONCAT(' (', descricao, ')') ELSE '' END
                ) as endereco_completo
            FROM filiais_transportadora 
            WHERE id_filial = ? AND transportadora_id = ?
        `, [filial_retirada_id, transportadora_id]);

        if (filialInfo.length === 0) {
            return res.status(404).json({ 
                mensagem: "Filial não encontrada ou não pertence à sua transportadora." 
            });
        }

        // Buscar nome da transportadora
        const [transportadoraInfo] = await conexao.promise().query(
            "SELECT nome, contacto FROM transportadoras WHERE id = ?",
            [transportadora_id]
        );

        const pedido = pedidoInfo[0];
        const filial = filialInfo[0];
        const transportadora = transportadoraInfo[0];

        // Registrar a entrega
        await conexao.promise().query(`
            INSERT INTO entregas 
            (data_entrega, estado_entrega, pedidos_id, endereco, contacto_cliente, 
             transportadora_id, filial_retirada_id, observacoes)
            VALUES 
            (NOW(), 'aguardando retirada', ?, ?, ?, ?, ?, ?)
        `, [
            pedidos_id,
            filial.endereco_completo,
            pedido.cliente_telefone,
            transportadora_id,
            filial_retirada_id,
            observacoes || null
        ]);

        // Atualizar estado do pedido
        await conexao.promise().query(
            "UPDATE pedidos SET estado = 'em trânsito' WHERE id_pedido = ?",
            [pedidos_id]
        );

        // ENVIAR NOTIFICAÇÃO PARA O CLIENTE
        const mensagemCliente = `🚚 Seu pedido #${pedidos_id} está pronto para retirada!\n` +
                        `📍 Local: ${filial.endereco_completo}\n` +
                        `🏢 Transportadora: ${transportadora.nome}\n` +
                        `📞 Contato: ${transportadora.contacto}` +
                        (observacoes ? `\n💬 Observações: ${observacoes}` : '');

// Notificação usando await notificar ao invés do Socket.io
await notificar(pedido.id_usuario, mensagemCliente, {
    pedido_id: pedidos_id,
    estado: "aguardando retirada",
    filial: {
        endereco: filial.endereco_completo,
        provincia: filial.provincia,
        bairro: filial.bairro,
        descricao: filial.descricao
    },
    transportadora: {
        nome: transportadora.nome,
        contacto: transportadora.contacto
    },
    observacoes: observacoes,
    timestamp: new Date().toISOString()
});

console.log(`✅ Cliente ${pedido.id_usuario} notificado sobre pedido ${pedidos_id} pronto para retirada`);

        // Salvar notificação no banco (para histórico)
        await conexao.promise().query(`
            INSERT INTO notificacoes (usuarios_id, tipo, titulo, mensagem, is_lida)
            VALUES (?, 'pedido_pronto', 'Pedido Pronto para Retirada', ?, 0)
        `, [pedido.id_usuario, mensagemCliente]);

        res.status(201).json({
            mensagem: "Pedido aceito e cliente notificado com sucesso!",
            detalhes: {
                pedido_id: pedidos_id,
                cliente: pedido.cliente_nome,
                filial_retirada: filial.endereco_completo,
                estado: "aguardando retirada",
                notificacao_enviada: true
            }
        });

    } catch (erro) {
        console.error("Erro ao aceitar pedido:", erro);
        res.status(500).json({ 
            mensagem: "Erro ao processar pedido.", 
            erro: erro.message 
        });
    }
});

/**
 * Finalizar entrega (quando cliente retirou o produto)
 */
router.put("/finalizar-entrega/:pedido_id", autenticarToken, async (req, res) => {
    const { pedido_id } = req.params;
    const { observacoes_finais } = req.body;
    const transportadora_id = req.usuario.id_usuario;
    const io = req.io;

    try {
        // Verificar se a entrega existe e pertence à transportadora
        const [entregaInfo] = await conexao.promise().query(`
            SELECT e.*, p.id_usuario, u.nome as cliente_nome
            FROM entregas e
            JOIN pedidos p ON e.pedidos_id = p.id_pedido
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE e.pedidos_id = ? AND e.transportadora_id = ?
        `, [pedido_id, transportadora_id]);

        if (entregaInfo.length === 0) {
            return res.status(404).json({ 
                mensagem: "Entrega não encontrada ou não autorizada." 
            });
        }

        const entrega = entregaInfo[0];

        // Atualizar estado da entrega
        await conexao.promise().query(`
            UPDATE entregas 
            SET estado_entrega = 'entregue', 
                data_finalizacao = NOW(),
                observacoes_finais = ?
            WHERE pedidos_id = ?
        `, [observacoes_finais || null, pedido_id]);

        // Atualizar estado do pedido
        await conexao.promise().query(
            "UPDATE pedidos SET estado = 'entregue' WHERE id_pedido = ?",
            [pedido_id]
        );

        // Notificar cliente
        const mensagemFinal = `✅ Pedido #${pedido_id} foi entregue com sucesso!\n` +
                             `Obrigado por escolher nossos serviços!`;

         await notificar(entrega.id_usuario, mensagemFinal, {
                pedido_id: pedido_id,
                estado: "entregue",
                timestamp: new Date().toISOString()
            });

console.log(`✅ Cliente ${entrega.id_usuario} notificado sobre entrega do pedido ${pedido_id}`);
        // Salvar notificação
        await conexao.promise().query(`
            INSERT INTO notificacoes (usuarios_id, tipo, titulo, mensagem, is_lida)
            VALUES (?, 'pedido_entregue', 'Pedido Entregue', ?, 0)
        `, [entrega.id_usuario, mensagemFinal]);

        res.json({
            mensagem: "Entrega finalizada com sucesso!",
            pedido_id: pedido_id,
            cliente: entrega.cliente_nome,
            estado: "entregue"
        });

    } catch (erro) {
        console.error("Erro ao finalizar entrega:", erro);
        res.status(500).json({ erro: "Erro ao finalizar entrega." });
    }
});

/**
 * Buscar notificações do cliente
 */
router.get("/minhas-notificacoes", autenticarToken, async (req, res) => {
    const usuario_id = req.usuario.id_usuario;
    
    try {
        const [notificacoes] = await conexao.promise().query(`
            SELECT 
                id_notificacoes,
                tipo,
                titulo,
                mensagem,
                is_lida,
                hora
            FROM notificacoes 
            WHERE usuarios_id = ?
            ORDER BY hora DESC
            LIMIT 50
        `, [usuario_id]);

        // Marcar como lidas
        if (notificacoes.length > 0) {
            await conexao.promise().query(
                "UPDATE notificacoes SET is_lida = 1 WHERE usuarios_id = ? AND is_lida = 0",
                [usuario_id]
            );
        }

        res.json({
            mensagem: "Notificações carregadas",
            total: notificacoes.length,
            notificacoes
        });

    } catch (erro) {
        console.error("Erro ao buscar notificações:", erro);
        res.status(500).json({ erro: "Erro ao carregar notificações." });
    }
});





router.get("/pedidos-prontos", autenticarToken, async (req, res) => {
    try {
        // Busca pedidos em trânsito para coleta nas províncias onde a transportadora tem filiais
        const transportadora_id = req.usuario.id_usuario;
        
        const [pedidosProntos] = await conexao.promise().query(`
            SELECT DISTINCT
                p.id_pedido,
                p.valor_total,
                p.estado,
                p.data_pedido,
                u.nome as cliente_nome,
                u.contacto as cliente_telefone,
                ep.rua,
                ep.bairro,
                ep.municipio,
                ep.provincia,
                ep.referencia,
                ep.numero as cliente_numero,
                COUNT(ip.id_item) as total_itens,
                SUM(ip.quantidade_comprada) as total_quantidade
            FROM pedidos p
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            JOIN endereco_pedidos ep ON p.id_pedido = ep.id_pedido
            JOIN itens_pedido ip ON p.id_pedido = ip.pedidos_id
            WHERE p.estado = 'em trânsito'  
            AND ep.provincia IN (
                SELECT DISTINCT provincia 
                FROM filiais_transportadora 
                WHERE transportadora_id = ?
            )
            AND p.id_pedido NOT IN (
                SELECT pedidos_id 
                FROM entregas 
                WHERE transportadora_id = ?
            )
            GROUP BY p.id_pedido
            ORDER BY p.data_pedido DESC
        `, [transportadora_id, transportadora_id]);

        if (pedidosProntos.length === 0) {
            return res.status(404).json({ 
                mensagem: "Nenhum pedido em trânsito encontrado.",
                pedidos: []
            });
        }

        res.json({ 
            mensagem: "Pedidos em trânsito para coleta",
            total: pedidosProntos.length,
            pedidos: pedidosProntos 
        });

    } catch (erro) {
        console.error("Erro ao buscar pedidos em trânsito:", erro);
        res.status(500).json({ erro: "Erro ao buscar pedidos em trânsito." });
    }
});







module.exports = router;
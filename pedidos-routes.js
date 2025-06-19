const express = require("express");
const router = express.Router();
const conexao = require("./database");
const numeroAngola=/^9\d{8}$/
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");
const notificar = require("./utils/notificar");




router.use(express.json());

router.get("/",autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;

    
    try {
        const [pedidos] = await conexao.promise().query(`
           SELECT 
        p.id_pedido, p.estado, p.valor_total, p.data_pedido,
        i.id_produto, i.quantidade_comprada, i.preco, i.subtotal,
        u.nome AS nome_usuario, u.id_usuario AS id_usuario_cliente
    FROM pedidos p
    LEFT JOIN itens_pedido i ON p.id_pedido = i.pedidos_id
    LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
    ORDER BY p.data_pedido DESC
`);

        if (pedidos.length === 0) {
            return res.status(404).json({ message: "Nenhum pedido encontrado." });
        }

       
        const pedidosAgrupados = {};
        pedidos.forEach(pedido => {
            if (!pedidosAgrupados[pedido.id_pedido]) {
                pedidosAgrupados[pedido.id_pedido] = {
                    id_pedido: pedido.id_pedido,
                    estado: pedido.estado,
                    valor_total: pedido.valor_total,
                    data_pedido: pedido.data_pedido,
                    nome_usuario: pedido.nome_usuario, 
                    itens: []
                };
            }
            if (pedido.id_produto) { 
                pedidosAgrupados[pedido.id_pedido].itens.push({
                    id_produto: pedido.id_produto,
                    quantidade_comprada: pedido.quantidade_comprada,
                    preco: pedido.preco,
                    subtotal: pedido.subtotal
                });
            }
        });

        res.status(200).json(Object.values(pedidosAgrupados));

    } catch (error) {
        console.log("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});



       router.get("/especifico", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
       
    try {
        const [pedidos] = await conexao.promise().query(`
            SELECT 
                p.id_pedido, p.estado, p.valor_total, p.data_pedido,
                ep.rua, ep.bairro, ep.pais, ep.municipio, ep.referencia, ep.provincia, ep.numero
            FROM pedidos p
            LEFT JOIN endereco_pedidos ep ON p.id_pedido = ep.id_pedido
            WHERE p.id_usuario = ?
            ORDER BY p.data_pedido DESC
        `, [id_usuario]);

        if (pedidos.length === 0) {
            return res.status(404).json({ message: "Nenhum pedido encontrado para este usuário." });
        }

        res.status(200).json(pedidos);

    } catch (error) {
        console.log("Erro ao buscar pedidos:", error);
        res.status(500).json({ message: "Erro ao buscar pedidos", error: error.message });
    }
});



const ESTADOS_PEDIDO = {
    PENDENTE: 'pendente',        // Aguardando pagamento (estoque NÃO reservado)
    CONFIRMADO: 'confirmado',    // Pagamento aprovado (estoque reservado)
    PROCESSADO: 'processado',    // Preparando pedido
    ENVIADO: 'enviado',          // Em transporte
    ENTREGUE: 'entregue',        // Finalizado
    CANCELADO: 'cancelado',      // Cancelado
    EXPIRADO: 'expirado'         // Pedido expirado
};

// ROTA PARA CRIAR PEDIDO
router.post("/criar", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { rua, bairro, pais, municipio, referencia, provincia, numero } = req.body;
    const io = req.io;
    
    try {
        // Validações básicas
        if (!id_usuario || id_usuario == 0) {
            return res.status(400).json({ message: "Usuário inválido" });
        }

        // Verificar pedidos pendentes do usuário
        const [pedidosPendentes] = await conexao.promise().query(`
            SELECT COUNT(*) as total_pendentes 
            FROM pedidos 
            WHERE id_usuario = ? AND estado = ?
        `, [id_usuario, ESTADOS_PEDIDO.PENDENTE]);

        if (pedidosPendentes[0].total_pendentes >= 3) {
            return res.status(400).json({ 
                message: "Você já possui 3 pedidos pendentes. Complete o pagamento ou cancele um pedido existente.",
                pedidos_pendentes: pedidosPendentes[0].total_pendentes
            });
        }

        // Limpar pedidos expirados automaticamente
        await conexao.promise().query(`
            UPDATE pedidos 
            SET estado = ? 
            WHERE estado = ? 
            AND (data_expiracao < NOW() OR data_pedido < DATE_SUB(NOW(), INTERVAL 24 HOUR))
        `, [ESTADOS_PEDIDO.EXPIRADO, ESTADOS_PEDIDO.PENDENTE]);

        // Validar campos de endereço
        if (!rua || !bairro || !pais || !municipio || !referencia || !provincia || !numero) {
            return res.status(400).json({ message: "Deve preencher os campos de localização" });
        }

        // Validar número de telefone
        const contactoString = String(numero);
        if (contactoString.length === 0) {
            return res.status(400).json({ message: "É necessário preencher o campo número" });
        }
        if (!numeroAngola.test(contactoString)) {
            return res.status(400).json({ message: "O contacto deve ter 9 dígitos e começar com 9" });
        }

        // BUSCAR DADOS DO CARRINHO
        const [itensCarrinho] = await conexao.promise().query(`
            SELECT 
                ci.quantidade as quantidade_desejada,
                ci.peso as peso_carrinho,
                ci.preco as preco_carrinho,
                ci.unidade as Unidade,
                p.id_produtos,
                p.nome,
                e.quantidade as quantidade_disponivel,
                p.peso_kg as peso_cadastrado,
                p.preco as preco_cadastrado
            FROM carrinho_itens ci
            JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
            JOIN estoque e ON ci.id_produto = e.produto_id
            JOIN produtos p ON ci.id_produto = p.id_produtos
            WHERE c.id_usuario = ?
        `, [id_usuario]);

        if (itensCarrinho.length === 0) {
            return res.status(400).json({ message: "Não há produtos no carrinho." });
        }

        // VERIFICAR ESTOQUE DISPONÍVEL EM TEMPO REAL
        const produtosSemEstoque = [];
        const itensValidos = [];

        for (const item of itensCarrinho) {
            // Verificar estoque disponível atual (descontando reservas)
            const [estoqueAtual] = await conexao.promise().query(`
                SELECT 
                    e.quantidade as estoque_total,
                    COALESCE(SUM(CASE 
                        WHEN p.estado IN (?, ?, ?) 
                        THEN ip.quantidade_comprada 
                        ELSE 0 
                    END), 0) as quantidade_reservada
                FROM estoque e
                LEFT JOIN itens_pedido ip ON e.produto_id = ip.id_produto
                LEFT JOIN pedidos p ON ip.pedidos_id = p.id_pedido
                WHERE e.produto_id = ?
                GROUP BY e.produto_id, e.quantidade
            `, [
                ESTADOS_PEDIDO.CONFIRMADO, 
                ESTADOS_PEDIDO.PROCESSADO, 
                ESTADOS_PEDIDO.ENVIADO,
                item.id_produtos
            ]);

            const estoque_disponivel = estoqueAtual[0].estoque_total - estoqueAtual[0].quantidade_reservada;

            if (item.quantidade_desejada > estoque_disponivel) {
                produtosSemEstoque.push({
                    nome: item.nome,
                    quantidade_desejada: item.quantidade_desejada,
                    quantidade_disponivel: estoque_disponivel
                });
            } else {
                itensValidos.push({
                    ...item,
                    estoque_disponivel
                });
            }
        }

        // Se houver produtos sem estoque, retornar erro detalhado
        if (produtosSemEstoque.length > 0) {
            return res.status(400).json({ 
                message: "Alguns produtos não têm estoque suficiente:",
                produtos_sem_estoque: produtosSemEstoque,
                acao_recomendada: "Ajuste as quantidades no carrinho ou remova os produtos sem estoque"
            });
        }

        // CALCULAR TOTAIS
        let subtotalProdutos = 0;
        let pesoTotal = 0;

        const itensCalculados = itensValidos.map(item => {
            const proporcao = item.quantidade_desejada / item.quantidade_disponivel;
            const preco_final = item.preco_cadastrado * proporcao;
            const peso_final = item.peso_cadastrado * proporcao;
            const subtotal_produto = preco_final;
            
            subtotalProdutos += subtotal_produto;
            pesoTotal += peso_final;
            
            return {
                id_produto: item.id_produtos,
                nome: item.nome,
                quantidade_comprada: item.quantidade_desejada,
                preco: Math.round(preco_final * 100) / 100,
                subtotal: Math.round(subtotal_produto * 100) / 100,
                peso_final: peso_final,
                estoque_disponivel: item.estoque_disponivel
            };
        });

        // Calcular frete
        const calcularFrete = (peso) => {
            if (peso >= 10 && peso <= 30) return { base: 10000, comissao: 1000 };
            if (peso >= 31 && peso <= 50) return { base: 15000, comissao: 1500 };
            if (peso >= 51 && peso <= 70) return { base: 20000, comissao: 2000 };
            if (peso >= 71 && peso <= 100) return { base: 25000, comissao: 2500 };
            if (peso >= 101 && peso <= 300) return { base: 35000, comissao: 3500 };
            if (peso >= 301 && peso <= 500) return { base: 50000, comissao: 5000 };
            if (peso >= 501 && peso <= 1000) return { base: 80000, comissao: 8000 };
            if (peso >= 1001 && peso <= 2000) return { base: 120000, comissao: 12000 };
            return { base: 0, comissao: 0 };
        };

        const frete = calcularFrete(pesoTotal);
        const valor_total = Math.round(subtotalProdutos + frete.base + frete.comissao);

        // CRIAR PEDIDO (ESTADO PENDENTE - ESTOQUE NÃO RESERVADO AINDA)
        const [pedidoresul] = await conexao.promise().query(`
            INSERT INTO pedidos (id_usuario, estado, valor_total, data_pedido, data_expiracao) 
            VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR))
        `, [id_usuario, ESTADOS_PEDIDO.PENDENTE, valor_total]);

        const id_pedido = pedidoresul.insertId;

        // INSERIR ENDEREÇO
        await conexao.promise().query(`
            INSERT INTO endereco_pedidos (id_pedido, rua, bairro, pais, municipio, referencia, provincia, numero) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id_pedido, rua, bairro, pais, municipio, referencia, provincia, numero]);

        // INSERIR ITENS DO PEDIDO
        for (let item of itensCalculados) {
            await conexao.promise().query(`
                INSERT INTO itens_pedido (quantidade_comprada, preco, subtotal, pedidos_id, id_produto)
                VALUES (?, ?, ?, ?, ?)
            `, [item.quantidade_comprada, item.preco, item.subtotal, id_pedido, item.id_produto]);
        }

        // NOTIFICAÇÃO
        io.to(`usuario_${id_usuario}`).emit("pedido_criado", {
            message: `Pedido criado! ID: ${id_pedido}. Complete o pagamento em até 24 horas.`,
            id_pedido,
            estado: ESTADOS_PEDIDO.PENDENTE,
            valor_total,
            tempo_expiracao: "24 horas",
            aviso: "Estoque será reservado apenas após confirmação do pagamento"
        });

        res.status(201).json({
            message: "Pedido criado com sucesso! Complete o pagamento em até 24 horas.",
            id_pedido,
            status: ESTADOS_PEDIDO.PENDENTE,
            tempo_expiracao: "24 horas",
            aviso_importante: "O estoque será reservado apenas após a confirmação do pagamento",
            dados_pagamento: {
                valor_total,
                subtotalProdutos: Math.round(subtotalProdutos),
                frete: frete.base,
                comissao: frete.comissao,
                itens: itensCalculados.length,
                peso_total: Math.round(pesoTotal * 100) / 100
            }
        });

    } catch (error) {
        console.log("Erro ao criar pedido:", error);
        res.status(500).json({ 
            message: "Erro ao criar pedido", 
            error: error.message 
        });
    }
});


router.post("/confirmar-pagamento/:id_pedido", autenticarToken, async (req, res) => {
    const id_pedido = req.params.id_pedido;
    const id_usuario = req.usuario.id_usuario;
    const io = req.io;
    
    try {
        // Verificar se o pedido existe e pertence ao usuário
        const [pedido] = await conexao.promise().query(`
            SELECT * FROM pedidos 
            WHERE id_pedido = ? AND id_usuario = ? AND estado = ?
        `, [id_pedido, id_usuario, ESTADOS_PEDIDO.PENDENTE]);

        if (pedido.length === 0) {
            return res.status(404).json({ 
                message: "Pedido não encontrado ou não pode ser confirmado" 
            });
        }

        // Verificar se o pedido não expirou
        const agora = new Date();
        const dataExpiracao = new Date(pedido[0].data_expiracao);
        
        if (agora > dataExpiracao) {
            // Marcar como expirado
            await conexao.promise().query(`
                UPDATE pedidos SET estado = ? WHERE id_pedido = ?
            `, [ESTADOS_PEDIDO.EXPIRADO, id_pedido]);
            
            return res.status(400).json({ 
                message: "Pedido expirado. Crie um novo pedido." 
            });
        }

        // VERIFICAR ESTOQUE NOVAMENTE NO MOMENTO DO PAGAMENTO
        const [itensPedido] = await conexao.promise().query(`
            SELECT 
                ip.id_produto,
                ip.quantidade_comprada,
                p.nome
            FROM itens_pedido ip
            JOIN produtos p ON ip.id_produto = p.id_produtos
            WHERE ip.pedidos_id = ?
        `, [id_pedido]);

        const produtosSemEstoque = [];
        
        await conexao.promise().query('START TRANSACTION');

        try {
            // Verificar e reservar estoque para cada produto
            for (const item of itensPedido) {
                const [estoqueAtual] = await conexao.promise().query(`
                    SELECT 
                        e.quantidade as estoque_total,
                        COALESCE(SUM(CASE 
                            WHEN p.estado IN (?, ?, ?) 
                            THEN ip.quantidade_comprada 
                            ELSE 0 
                        END), 0) as quantidade_reservada
                    FROM estoque e
                    LEFT JOIN itens_pedido ip ON e.produto_id = ip.id_produto
                    LEFT JOIN pedidos p ON ip.pedidos_id = p.id_pedido
                    WHERE e.produto_id = ?
                    GROUP BY e.produto_id, e.quantidade
                `, [
                    ESTADOS_PEDIDO.CONFIRMADO, 
                    ESTADOS_PEDIDO.PROCESSADO, 
                    ESTADOS_PEDIDO.ENVIADO,
                    item.id_produto
                ]);

                const estoque_disponivel = estoqueAtual[0].estoque_total - estoqueAtual[0].quantidade_reservada;

                if (item.quantidade_comprada > estoque_disponivel) {
                    produtosSemEstoque.push({
                        nome: item.nome,
                        quantidade_pedida: item.quantidade_comprada,
                        quantidade_disponivel: estoque_disponivel
                    });
                }
            }

            // Se houver produtos sem estoque, cancelar transação
            if (produtosSemEstoque.length > 0) {
                await conexao.promise().query('ROLLBACK');
                
                return res.status(400).json({
                    message: "Pagamento não pode ser processado. Alguns produtos ficaram sem estoque:",
                    produtos_sem_estoque: produtosSemEstoque,
                    acao_recomendada: "Crie um novo pedido com as quantidades disponíveis"
                });
            }

            // CONFIRMAR O PEDIDO (RESERVAR ESTOQUE)
            await conexao.promise().query(`
                UPDATE pedidos 
                SET estado = ?, data_confirmacao = NOW() 
                WHERE id_pedido = ?
            `, [ESTADOS_PEDIDO.CONFIRMADO, id_pedido]);

            // LIMPAR CARRINHO (agora que o pagamento foi confirmado)
            await conexao.promise().query(`
                DELETE ci FROM carrinho_itens ci
                JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
                WHERE c.id_usuario = ?
            `, [id_usuario]);

            await conexao.promise().query('COMMIT');

            // NOTIFICAÇÕES
            io.to(`usuario_${id_usuario}`).emit("pagamento_confirmado", {
                id_pedido,
                message: "Pagamento confirmado! Seu pedido está sendo processado.",
                estado: ESTADOS_PEDIDO.CONFIRMADO
            });

            // Notificar administradores sobre novo pedido confirmado
            const [admins] = await conexao.promise().query(`
                SELECT id_usuario FROM usuarios WHERE tipo_usuario = 'Administrador'
            `);

            admins.forEach((admin) => {
                io.to(`usuario_${admin.id_usuario}`).emit("novo_pedido_confirmado", {
                    id_pedido,
                    message: `Novo pedido confirmado #${id_pedido}`,
                    valor_total: pedido[0].valor_total
                });
            });

            res.json({
                message: "Pagamento confirmado com sucesso!",
                id_pedido,
                estado: ESTADOS_PEDIDO.CONFIRMADO,
                estoque_reservado: true
            });

        } catch (transactionError) {
            await conexao.promise().query('ROLLBACK');
            throw transactionError;
        }

    } catch (error) {
        console.log("Erro ao confirmar pagamento:", error);
        res.status(500).json({ 
            message: "Erro ao confirmar pagamento", 
            error: error.message 
        });
    }
});




// ROTA PARA LISTAR PEDIDOS PENDENTES
router.get("/pendentes", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    
    try {
        const [pedidosPendentes] = await conexao.promise().query(`
            SELECT 
                p.id_pedido,
                p.valor_total,
                p.data_pedido,
                p.data_expiracao,
                TIMESTAMPDIFF(MINUTE, NOW(), p.data_expiracao) as minutos_restantes,
                COUNT(ip.id_produto) as total_itens
            FROM pedidos p
            LEFT JOIN itens_pedido ip ON p.id_pedido = ip.pedidos_id
            WHERE p.id_usuario = ? AND p.estado = ?
            GROUP BY p.id_pedido
            ORDER BY p.data_pedido DESC
        `, [id_usuario, ESTADOS_PEDIDO.PENDENTE]);

        res.json({
            pedidos_pendentes: pedidosPendentes,
            total: pedidosPendentes.length,
            limite_maximo: 3,
            aviso: "Complete o pagamento antes que o pedido expire"
        });

    } catch (error) {
        res.status(500).json({ 
            message: "Erro ao buscar pedidos pendentes", 
            error: error.message 
        });
    }
});





router.delete("/:id_pedido", autenticarToken, async (req, res) => {
    const id_pedido = req.params.id_pedido;
    const id_usuario_atual = req.usuario.id_usuario;
    const tipo_usuario_atual = req.usuario.tipo_usuario;
    const io = req.io;
  
    try {
        // Buscar o pedido
        const [pedido] = await conexao.promise().query(`
            SELECT id_usuario, estado, valor_total 
            FROM pedidos 
            WHERE id_pedido = ?
        `, [id_pedido]);
  
        if (!pedido || pedido.length === 0) {
            return res.status(404).json({ message: "Pedido não encontrado." });
        }
  
        const id_cliente_dono_pedido = pedido[0].id_usuario;
        const estado_pedido = pedido[0].estado;

        // VALIDAÇÃO DE PERMISSÃO
        const eh_dono_do_pedido = id_usuario_atual === id_cliente_dono_pedido;
        const eh_administrador = tipo_usuario_atual === 'Administrador';

        if (!eh_dono_do_pedido && !eh_administrador) {
            return res.status(403).json({ 
                message: "Apenas o cliente que fez o pedido ou um administrador podem cancelá-lo." 
            });
        }

        // VALIDAÇÃO DE ESTADO
        const estados_nao_cancelaveis = [
            ESTADOS_PEDIDO.ENTREGUE, 
            ESTADOS_PEDIDO.CANCELADO,
            ESTADOS_PEDIDO.EXPIRADO
        ];
        
        if (estados_nao_cancelaveis.includes(estado_pedido)) {
            return res.status(400).json({ 
                message: `Não é possível cancelar pedidos com estado: ${estado_pedido}` 
            });
        }

        await conexao.promise().query('START TRANSACTION');

        try {
            // Cancelar o pedido
            await conexao.promise().query(`
                UPDATE pedidos 
                SET estado = ?, data_cancelamento = NOW() 
                WHERE id_pedido = ?
            `, [ESTADOS_PEDIDO.CANCELADO, id_pedido]);

            // DEVOLVER ESTOQUE (apenas se estava confirmado/processado/enviado)
            const estados_com_estoque_reservado = [
                ESTADOS_PEDIDO.CONFIRMADO, 
                ESTADOS_PEDIDO.PROCESSADO, 
                ESTADOS_PEDIDO.ENVIADO
            ];

            if (estados_com_estoque_reservado.includes(estado_pedido)) {
                console.log(`Devolvendo estoque do pedido ${id_pedido} que estava ${estado_pedido}`);
                // Estoque será automaticamente liberado pois o pedido não estará mais nos estados que reservam
            }

            await conexao.promise().query('COMMIT');

            // NOTIFICAÇÕES
            if (eh_dono_do_pedido) {
                io.to(`usuario_${id_cliente_dono_pedido}`).emit("pedido_cancelado", {
                    id_pedido,
                    message: "Seu pedido foi cancelado com sucesso."
                });
            } else {
                io.to(`usuario_${id_cliente_dono_pedido}`).emit("pedido_cancelado", {
                    id_pedido,
                    message: "Seu pedido foi cancelado por um administrador."
                });
            }

            res.status(200).json({ 
                message: "Pedido cancelado com sucesso!",
                id_pedido,
                estoque_liberado: estados_com_estoque_reservado.includes(estado_pedido)
            });

        } catch (transactionError) {
            await conexao.promise().query('ROLLBACK');
            throw transactionError;
        }

    } catch (error) {
        console.log("Erro ao cancelar pedido:", error);
        res.status(500).json({ 
            message: "Erro ao cancelar pedido", 
            error: error.message 
        });
    }
});



// JOB DE LIMPEZA AUTOMÁTICA
const limparPedidosExpirados = async () => {
    try {
        const [resultado] = await conexao.promise().query(`
            UPDATE pedidos 
            SET estado = ? 
            WHERE estado = ? 
            AND (data_expiracao < NOW() OR data_pedido < DATE_SUB(NOW(), INTERVAL 24 HOUR))
        `, [ESTADOS_PEDIDO.EXPIRADO, ESTADOS_PEDIDO.PENDENTE]);
        
        if (resultado.affectedRows > 0) {
            console.log(`${resultado.affectedRows} pedidos pendentes foram expirados`);
        }
    } catch (error) {
        console.log("Erro ao limpar pedidos expirados:", error);
    }
};

// Executar limpeza a cada 30 minutos
setInterval(limparPedidosExpirados, 30 * 60 * 1000);



router.delete("/:id_pedido", autenticarToken, async (req, res) => {
    const id_pedido = req.params.id_pedido;
    const id_usuario_que_excluiu = req.usuario.id_usuario;
  
    try {
      // Buscar o pedido antes de deletar para recuperar o id do destinatário
      const [pedido] = await conexao.promise().query(`
        SELECT id_usuario FROM pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      if (!pedido || pedido.length === 0) {
        return res.status(404).json({ message: "Pedido não encontrado." });
      }
  
      const id_destinatario = pedido[0].id_usuario;

      if (id_usuario_que_excluiu !== id_destinatario && req.usuario.tipo_usuario !== 'Administrador') {
        return res.status(403).json({ message: "Você não tem permissão para excluir este pedido." });
    }
    
      // Excluir itens relacionados
      await conexao.promise().query(`
        DELETE FROM itens_pedido WHERE pedidos_id = ?
      `, [id_pedido]);
  
      await conexao.promise().query(`
        DELETE FROM endereco_pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      // Excluir o pedido
      const [resultado] = await conexao.promise().query(`
        DELETE FROM pedidos WHERE id_pedido = ?
      `, [id_pedido]);
  
      if (resultado.affectedRows === 0) {
        return res.status(404).json({ message: "Pedido não encontrado ao tentar deletar." });
      }
  
      // Notificar o usuário que excluiu
      io.to(`usuario_${id_usuario_que_excluiu}`).emit("pedido_excluido", {
        id_pedido,
        message: "Você excluiu um pedido."
      });
  
      // Notificar o destinatário (agricultor ou fornecedor)
      io.to(`usuario_${id_destinatario}`).emit("pedido_excluido", {
        id_pedido,
        message: "Este pedido destinado a você foi excluído."
      });
  
      // Buscar todos os administradores
      const [admins] = await conexao.promise().query(`
        SELECT id_usuario FROM usuarios WHERE tipo_usuario = 'Administrador'
      `);
  
      // Notificar todos os administradores
      admins.forEach((admin) => {
        io.to(`usuario_${admin.id_usuario}`).emit("pedido_excluido", {
          id_pedido,
          message: "Este pedido foi excluído da plataforma."
        });
      });
  
      res.status(200).json({ message: "Pedido excluído com sucesso!" });
  
    } catch (error) {
      console.log("Erro ao excluir pedido:", error);
      res.status(500).json({ message: "Erro ao excluir pedido", error: error.message });
    }
  })


// Rota para buscar dados específicos do pedido para pagamento
router.get("/pagamento/:id_pedido", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_pedido } = req.params;
    
    try {
        // Buscar dados do pedido com endereço
        const [pedidoData] = await conexao.promise().query(`
            SELECT 
                p.id_pedido,
                p.valor_total,
                p.estado,
                p.data_pedido,
                ep.rua,
                ep.bairro,
                ep.municipio,
                ep.provincia,
                ep.numero
            FROM pedidos p
            LEFT JOIN endereco_pedidos ep ON p.id_pedido = ep.id_pedido
            WHERE p.id_pedido = ? AND p.id_usuario = ?
        `, [id_pedido, id_usuario]);

        if (pedidoData.length === 0) {
            return res.status(404).json({ message: "Pedido não encontrado ou não pertence ao usuário" });
        }

        // Buscar itens do pedido
        const [itens] = await conexao.promise().query(`
            SELECT 
                ip.quantidade_comprada,
                ip.preco,
                ip.subtotal,
                p.nome as nome_produto,
                p.peso_kg
            FROM itens_pedido ip
            JOIN produtos p ON ip.id_produto = p.id_produtos
            WHERE ip.pedidos_id = ?
        `, [id_pedido]);

        // Calcular valores para o pagamento
        const subtotalProdutos = itens.reduce((total, item) => total + parseFloat(item.subtotal), 0);
        const pesoTotal = itens.reduce((total, item) => total + (parseFloat(item.peso_kg) * item.quantidade_comprada), 0);
        
        // Função para calcular frete (mesma lógica do backend)
        const calcularFrete = (peso) => {
            if (peso >= 10 && peso <= 30) return { base: 10000, comissao: 1000 };
            if (peso >= 31 && peso <= 50) return { base: 15000, comissao: 1500 };
            if (peso >= 51 && peso <= 70) return { base: 20000, comissao: 2000 };
            if (peso >= 71 && peso <= 100) return { base: 25000, comissao: 2500 };
            if (peso >= 101 && peso <= 300) return { base: 35000, comissao: 3500 };
            if (peso >= 301 && peso <= 500) return { base: 50000, comissao: 5000 };
            if (peso >= 501 && peso <= 1000) return { base: 80000, comissao: 8000 };
            if (peso >= 1001 && peso <= 2000) return { base: 120000, comissao: 12000 };
            return { base: 0, comissao: 0 };
        };

        const frete = calcularFrete(pesoTotal);
        const valorFrete = frete.base + frete.comissao;

        res.status(200).json({
            pedido: pedidoData[0],
            itens: itens,
            valores: {
                subtotal: Math.round(subtotalProdutos),
                frete: valorFrete,
                total: pedidoData[0].valor_total,
                peso_total: Math.round(pesoTotal * 100) / 100
            }
        });

    } catch (error) {
        console.log("Erro ao buscar dados do pedido:", error);
        res.status(500).json({ 
            message: "Erro ao buscar dados do pedido", 
            error: error.message 
        });
    }
});



router.get("/pedidos-prontos", autenticarToken, async (req, res) => {
    try {
        // Busca pedidos prontos para coleta nas províncias onde a transportadora tem filiais
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
            WHERE p.estado IN ('processado', 'enviado')
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
                mensagem: "Nenhum pedido pronto para coleta encontrado.",
                pedidos: []
            });
        }

        res.json({ 
            mensagem: "Pedidos prontos para coleta",
            total: pedidosProntos.length,
            pedidos: pedidosProntos 
        });

    } catch (erro) {
        console.error("Erro ao buscar pedidos prontos:", erro);
        res.status(500).json({ erro: "Erro ao buscar pedidos prontos." });
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
            "UPDATE pedidos SET estado = 'aguardando retirada' WHERE id_pedido = ?",
            [pedidos_id]
        );

        // ENVIAR NOTIFICAÇÃO PARA O CLIENTE
        const mensagemCliente = `🚚 Seu pedido #${pedidos_id} está pronto para retirada!\n` +
                               `📍 Local: ${filial.endereco_completo}\n` +
                               `🏢 Transportadora: ${transportadora.nome}\n` +
                               `📞 Contato: ${transportadora.contacto}` +
                               (observacoes ? `\n💬 Observações: ${observacoes}` : '');

        // Notificação via Socket.io (tempo real)
        io.to(`usuario_${pedido.id_usuario}`).emit("pedido_pronto_retirada", {
            message: mensagemCliente,
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

        io.to(`usuario_${entrega.id_usuario}`).emit("pedido_entregue", {
            message: mensagemFinal,
            pedido_id: pedido_id,
            estado: "entregue",
            timestamp: new Date().toISOString()
        });

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

// ===== ROTA PARA CLIENTES CONSULTAREM NOTIFICAÇÕES =====

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




// ENDPOINT - Marcar produto como pronto para retirada
router.put("/marcar-pronto/:pedido_id", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor", "Administrador"]), async (req, res) => {
    const { pedido_id } = req.params;
    const { observacoes } = req.body; // observações opcionais
    const usuarioId = req.usuario.id_usuario;
    const tipoUsuario = req.usuario.tipo_usuario;
    
    try {
        console.log(`🔍 Tentando marcar pedido ${pedido_id} como pronto`);
        
        // 1. VERIFICAR SE O PEDIDO EXISTE E ESTÁ NO ESTADO CORRETO
        const [pedido] = await conexao.promise().query(
            `SELECT p.*, u.nome as cliente_nome, u.email as cliente_email
             FROM pedidos p 
             JOIN usuarios u ON p.id_usuario = u.id_usuario
             WHERE p.id_pedido = ? AND p.estado IN ('processado', 'confirmado')`,
            [pedido_id]
        );
        
        if (pedido.length === 0) {
            return res.status(404).json({ 
                message: "Pedido não encontrado ou não está em estado válido para ser marcado como pronto" 
            });
        }
        
        const pedidoInfo = pedido[0];
        
        // 2. VERIFICAR SE O USUÁRIO TEM PERMISSÃO (se não for admin, verificar se tem produtos no pedido)
        if (tipoUsuario !== "Administrador") {
            const [produtosUsuario] = await conexao.promise().query(
                `SELECT COUNT(*) as total 
                 FROM itens_pedido ip
                 JOIN produtos p ON ip.id_produto = p.id_produtos
                 WHERE ip.pedidos_id = ? AND p.id_usuario = ?`,
                [pedido_id, usuarioId]
            );
            
            if (produtosUsuario[0].total === 0) {
                return res.status(403).json({ 
                    message: "Você não tem produtos neste pedido" 
                });
            }
        }
        
        // 3. ATUALIZAR ESTADO DO PEDIDO
        await conexao.promise().query(
            `UPDATE pedidos 
             SET estado = 'aguardando retirada',
                 data_confirmacao = COALESCE(data_confirmacao, NOW())
             WHERE id_pedido = ?`,
            [pedido_id]
        );
        
        console.log(`✅ Pedido ${pedido_id} marcado como 'aguardando retirada'`);
        
        // 4. BUSCAR DETALHES DOS PRODUTOS NO PEDIDO E CALCULAR PESO TOTAL
        const [itensPedido] = await conexao.promise().query(
            `SELECT ip.*, p.nome as produto_nome, p.id_usuario as vendedor_id,
                    u.nome as vendedor_nome, p.peso_kg as peso_cadastrado,
                    e.quantidade as quantidade_cadastrada
             FROM itens_pedido ip
             JOIN produtos p ON ip.id_produto = p.id_produtos
             JOIN usuarios u ON p.id_usuario = u.id_usuario
             JOIN estoque e ON p.id_produtos = e.produto_id
             WHERE ip.pedidos_id = ?`,
            [pedido_id]
        );
        
        // 5. CALCULAR PESO TOTAL E COMISSÃO DA TRANSPORTADORA
        let pesoTotal = 0;
        
        itensPedido.forEach(item => {
            // Calcular proporção baseada na quantidade comprada vs cadastrada
            const proporcao = item.quantidade_comprada / item.quantidade_cadastrada;
            // Calcular peso proporcional
            const peso_final = item.peso_cadastrado * proporcao;
            pesoTotal += peso_final;
        });
        
        // Função para calcular frete baseado no peso total
        const calcularFrete = (peso) => {
            if (peso >= 10 && peso <= 30) return { base: 10000, comissao: 1000 };
            if (peso >= 31 && peso <= 50) return { base: 15000, comissao: 1500 };
            if (peso >= 51 && peso <= 70) return { base: 20000, comissao: 2000 };
            if (peso >= 71 && peso <= 100) return { base: 25000, comissao: 2500 };
            if (peso >= 101 && peso <= 300) return { base: 35000, comissao: 3500 };
            if (peso >= 301 && peso <= 500) return { base: 50000, comissao: 5000 };
            if (peso >= 501 && peso <= 1000) return { base: 80000, comissao: 8000 };
            if (peso >= 1001 && peso <= 2000) return { base: 120000, comissao: 12000 };
            return { base: 0, comissao: 0 };
        };
        
        const frete = calcularFrete(pesoTotal);
        
        // 6. BUSCAR ENDEREÇO DO VENDEDOR
        const [vendedorInfo] = await conexao.promise().query(
            `SELECT u.nome, u.contato, e.rua, e.bairro, e.provincia, e.municipio
             FROM usuarios u
             JOIN produtos p ON u.id_usuario = p.id_usuario
             JOIN itens_pedido ip ON p.id_produtos = ip.id_produto
             LEFT JOIN endereco e ON u.id_usuario = e.id_usuario
             WHERE ip.pedidos_id = ?
             LIMIT 1`,
            [pedido_id]
        );
        
        const enderecoVendedor = vendedorInfo.length > 0 && vendedorInfo[0].rua ? 
            `${vendedorInfo[0].rua}, ${vendedorInfo[0].bairro}, ${vendedorInfo[0].municipio}, ${vendedorInfo[0].provincia}` : 
            'Endereço não encontrado';
        
        // 7. NOTIFICAR A TRANSPORTADORA (com apenas a comissão)
        const listaProdutos = itensPedido.map(item => 
            `${item.produto_nome} (${item.quantidade_comprada}x)`
        ).join(', ');
        
        const mensagemTransportadora = `🚛 Pedido pronto para coleta!\n` +
                                     `🆔 Pedido: #${pedido_id}\n` +
                                     `👤 Cliente final: ${pedidoInfo.cliente_nome}\n` +
                                     `🏪 Buscar em: ${enderecoVendedor}\n` +
                                     `📞 Vendedor: ${vendedorInfo[0]?.contato || 'N/A'}\n` +
                                     `📦 Produtos: ${listaProdutos}\n` +
                                     `⚖️ Peso total: ${pesoTotal.toFixed(2)} kg\n` +
                                     `💰 Valor do frete: ${frete.base} Kz` +
                                     (observacoes ? `\n💬 Observações: ${observacoes}` : '');
        
        try {
            // Buscar transportadora específica (ID = 2)
            const [transportadora] = await conexao.promise().query(
                "SELECT id, nome, contacto, email FROM transportadoras WHERE id = 2 AND status = 'ativo'"
            );
            
            if (transportadora.length > 0) {
                const transportadoraInfo = transportadora[0];
                
                // Notificação usando await notificar com dados estruturados
                await notificar(transportadoraInfo.id, mensagemTransportadora, {
                    pedido_id: pedido_id,
                    estado: "aguardando retirada",
                    tipo_notificacao: "coleta_pedido",
                    cliente: {
                        nome: pedidoInfo.cliente_nome,
                        email: pedidoInfo.cliente_email
                    },
                    vendedor: {
                        endereco: enderecoVendedor,
                        contato: vendedorInfo[0]?.contato || null,
                        nome: vendedorInfo[0]?.nome || null
                    },
                    produtos: itensPedido.map(item => ({
                        nome: item.produto_nome,
                        quantidade: item.quantidade_comprada
                    })),
                    peso_total: pesoTotal,
                    frete: frete.base,
                    observacoes: observacoes,
                    timestamp: new Date().toISOString()
                });
                console.log(`✅ Transportadora ${transportadoraInfo.nome} (ID: 2) notificada para buscar pedido ${pedido_id}`);
            } else {
                console.log(`⚠️ Transportadora com ID 2 não encontrada ou inativa`);
            }
        } catch (error) {
            console.error(`❌ Erro ao notificar transportadora:`, error);
        }
        
        // 8. NOTIFICAR ADMINISTRADORES
        try {
            const [admins] = await conexao.promise().query(
                "SELECT id_usuario, nome FROM usuarios WHERE tipo_usuario = 'Administrador'"
            );
            
            const mensagemAdmin = `📦 Pedido #${pedido_id} marcado como pronto por ${req.usuario.nome || 'Vendedor'}. Transportadora notificada para coleta.`;
            
            for (const admin of admins) {
                await notificar(admin.id_usuario, mensagemAdmin, {
                    pedido_id: pedido_id,
                    estado: "aguardando retirada",
                    acao: "pedido_pronto",
                    vendedor: req.usuario.nome || 'Vendedor',
                    timestamp: new Date().toISOString()
                });
                console.log(`✅ Admin ${admin.nome} notificado sobre pedido ${pedido_id}`);
            }
        } catch (error) {
            console.error(`❌ Erro ao notificar admins:`, error);
        }
        
        res.json({
            message: "Pedido marcado como pronto! Transportadora foi notificada para coleta.",
            pedido_id: pedido_id,
            estado: "aguardando retirada",
            vendedor: {
                endereco: enderecoVendedor,
                telefone: vendedorInfo[0]?.contato || null
            },
            peso_total: pesoTotal,
            frete_transportadora: frete.base,
            comissao_plataforma: frete.comissao,
            observacoes: observacoes || null
        });
        
    } catch (error) {
        console.error("❌ Erro ao marcar pedido como pronto:", error);
        res.status(500).json({
            message: "Erro interno do servidor",
            error: error.message
        });
    }
});



router.put("/cancelar/:pedido_id", autenticarToken, autorizarUsuario(["Agricultor", "Fornecedor", "Administrador"]), async (req, res) => {
    const { pedido_id } = req.params;
    const { motivo_cancelamento } = req.body;
    const usuarioId = req.usuario.id_usuario;
    const tipoUsuario = req.usuario.tipo_usuario;
    
    try {
        console.log(`🔍 Tentando cancelar pedido ${pedido_id}`);
        
        // 1. VERIFICAR SE O PEDIDO EXISTE E PODE SER CANCELADO
        const [pedido] = await conexao.promise().query(
            `SELECT p.*, u.nome as cliente_nome, u.email as cliente_email
             FROM pedidos p 
             JOIN usuarios u ON p.id_usuario = u.id_usuario
             WHERE p.id_pedido = ? AND p.estado IN ('processado', 'confirmado', 'aguardando retirada')`,
            [pedido_id]
        );
        
        if (pedido.length === 0) {
            return res.status(404).json({ 
                message: "Pedido não encontrado ou não pode ser cancelado" 
            });
        }
        
        const pedidoInfo = pedido[0];
        
        // 2. VERIFICAR PERMISSÃO (se não for admin, verificar se tem produtos no pedido)
        if (tipoUsuario !== "Administrador") {
            const [produtosUsuario] = await conexao.promise().query(
                `SELECT COUNT(*) as total 
                 FROM itens_pedido ip
                 JOIN produtos p ON ip.id_produto = p.id_produtos
                 WHERE ip.pedidos_id = ? AND p.id_usuario = ?`,
                [pedido_id, usuarioId]
            );
            
            if (produtosUsuario[0].total === 0) {
                return res.status(403).json({ 
                    message: "Você não tem produtos neste pedido" 
                });
            }
        }
        
        // 3. CANCELAR O PEDIDO
        await conexao.promise().query(
            `UPDATE pedidos 
             SET estado = 'cancelado',
                 data_cancelamento = NOW()
             WHERE id_pedido = ?`,
            [pedido_id]
        );
        
        console.log(`✅ Pedido ${pedido_id} cancelado com sucesso`);
        
        // 4. NOTIFICAR O CLIENTE
        const mensagemCliente = `❌ Pedido #${pedido_id} foi cancelado\n` +
                              `💭 Motivo: ${motivo_cancelamento || 'Não especificado'}\n` +
                              `💰 Valor: ${pedidoInfo.valor_total} Kz será reembolsado`;
        
        try {
            await notificar(pedidoInfo.id_usuario, mensagemCliente);
            console.log(`✅ Cliente notificado sobre cancelamento do pedido ${pedido_id}`);
        } catch (error) {
            console.error(`❌ Erro ao notificar cliente:`, error);
        }
        
        // 5. NOTIFICAR ADMINS
        try {
            const [admins] = await conexao.promise().query(
                "SELECT id_usuario, nome FROM usuarios WHERE tipo_usuario = 'Administrador'"
            );
            
            const mensagemAdmin = `❌ Pedido #${pedido_id} cancelado por ${req.usuario.nome || 'Vendedor'}. Motivo: ${motivo_cancelamento || 'Não especificado'}`;
            
            for (const admin of admins) {
                await notificar(admin.id_usuario, mensagemAdmin);
            }
        } catch (error) {
            console.error(`❌ Erro ao notificar admins:`, error);
        }
        
        res.json({
            message: "Pedido cancelado com sucesso!",
            pedido_id: pedido_id,
            estado: "cancelado",
            motivo: motivo_cancelamento || null
        });
        
    } catch (error) {
        console.error("❌ Erro ao cancelar pedido:", error);
        res.status(500).json({
            message: "Erro interno do servidor",
            error: error.message
        });
    }
});





module.exports = router;


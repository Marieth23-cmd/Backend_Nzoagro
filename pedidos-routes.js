const express = require("express");
const router = express.Router();
const conexao = require("./database");
const numeroAngola=/^9\d{8}$/
const { autenticarToken, autorizarUsuario } = require("./mildwaretoken");



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


router.post("/criar", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { rua, bairro, pais, municipio, referencia, provincia, numero } = req.body;
    const io = req.io
    
    try {
        // Validações básicas
        if (!id_usuario || id_usuario == 0) {
            return res.status(400).json({ message: "Usuário inválido" });
        }

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

        // BUSCAR E CALCULAR DADOS DO CARRINHO
        const [itensCarrinho] = await conexao.promise().query(`
            SELECT 
                ci.quantidade as quantidade_desejada,
                ci.peso as peso_carrinho,
                ci.preco as preco_carrinho,
                ci.unidade as Unidade,
                p.id_produtos,
                p.nome,
                e.quantidade as quantidade_cadastrada,
                p.peso_kg as peso_cadastrado,
                p.preco as preco_cadastrado
            FROM carrinho_itens ci
            JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
            JOIN estoque e ON ci.id_produto = e.produto_id
            JOIN produtos p ON ci.id_produto = p.id_produtos
            WHERE c.id_usuario = ?
        `, [id_usuario]);

        if (itensCarrinho.length === 0) {
            return res.status(400).json({ message: "Não há produtos no carrinho. Adicione itens antes de criar o pedido." });
        }

        // Verificar se há estoque suficiente
        for (const item of itensCarrinho) {
            if (item.quantidade_desejada > item.quantidade_cadastrada) {
                return res.status(400).json({ 
                    message: `Produto ${item.nome} não tem estoque suficiente. Disponível: ${item.quantidade_cadastrada}` 
                });
            }
        }

        // CALCULAR TOTAIS E PREÇOS
        let subtotalProdutos = 0;
        let pesoTotal = 0;

        const itensCalculados = itensCarrinho.map(item => {
            // Calcular proporção baseada na quantidade desejada vs cadastrada
            const proporcao = item.quantidade_desejada / item.quantidade_cadastrada;
            
            // Calcular preço e peso proporcionais
            const preco_final = item.preco_cadastrado * proporcao;
            const peso_final = item.peso_cadastrado * proporcao;
            
            // Calcular subtotal do produto
            const subtotal_produto = preco_final;
            
            // Adicionar aos totais
            subtotalProdutos += subtotal_produto;
            pesoTotal += peso_final;
            
            return {
                id_produto: item.id_produtos,
                nome: item.nome,
                quantidade_comprada: item.quantidade_desejada,
                preco: Math.round(preco_final * 100) / 100,
                subtotal: Math.round(subtotal_produto * 100) / 100,
                peso_final: peso_final
            };
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
        const valor_total = Math.round(subtotalProdutos + frete.base + frete.comissao);

        // CRIAR O PEDIDO (Estado: pendente até pagamento)
        const [pedidoresul] = await conexao.promise().query(`
            INSERT INTO pedidos (id_usuario, estado, valor_total, data_pedido) 
            VALUES (?, 'pendente', ?, NOW())
        `, [id_usuario, valor_total]);

        const id_pedido = pedidoresul.insertId;

        // INSERIR ENDEREÇO DO PEDIDO
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

        // NOTIFICAÇÃO APENAS PARA O COMPRADOR (pedido criado, aguardando pagamento)
        io.to(`usuario_${id_usuario}`).emit("pedido_criado", {
            message: `Pedido criado! ID: ${id_pedido}. Prossiga para o pagamento.`,
            id_pedido,
            estado: 'pendente',
            valor_total,
            data: new Date()
        });

        // NÃO notificar vendedores/admins ainda - só após pagamento confirmado

        // RESPOSTA COM DADOS PARA PAGAMENTO
        res.status(201).json({
            message: "Pedido criado com sucesso! Prossiga para o pagamento.",
            id_pedido,
            status: "aguardando_pagamento",
            dados_pagamento: {
                valor_total,
                subtotalProdutos: Math.round(subtotalProdutos),
                frete: frete.base,
                comissao: frete.comissao,
                itens: itensCalculados.length,
                peso_total: Math.round(pesoTotal * 100) / 100
            },
            // CARRINHO MANTIDO ATÉ PAGAMENTO SER CONFIRMADO
            carrinho_status: "mantido_ate_pagamento"
        });

    } catch (error) {
        console.log("Erro ao criar pedido:", error);
        res.status(500).json({ 
            message: "Erro ao criar pedido", 
            error: error.message 
        });
    }
});


//cancelar estado do pedido





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



  
module.exports = router;

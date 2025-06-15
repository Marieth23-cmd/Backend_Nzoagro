const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken ,autorizarUsuario } = require("./mildwaretoken");
const notificar = require("./utils/notificar");


router.use(express.json());
router.post("/adicionar", autenticarToken,autorizarUsuario(['Agricultor' , 'Fornecedor' , 'Comprador']), async (req, res) => {
    const { id_produto, quantidade, unidade } = req.body;
    const id_usuario = req.usuario.id_usuario;
    
    console.log("Dados recebidos:", { id_produto, quantidade, unidade, id_usuario });
    
    try {
        if (quantidade < 1) {
            return res.status(400).json({ mensagem: "A quantidade deve ser maior que zero." });
        }

        // Buscar informações do produto (incluindo preço)
        const [produto] = await conexao.promise().query(
            "SELECT peso_kg, preco FROM produtos WHERE id_produtos = ?",
            [id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado." });
        }

        const peso_produto = produto[0].peso_kg;
        const preco_produto = produto[0].preco; // ← ADICIONAR ESTA LINHA

        // Verificar se o carrinho já existe para o usuário
        let [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        let id_carrinho;
        if (carrinho.length === 0) {
            // Criar um novo carrinho para o usuário
            const [novoCarrinho] = await conexao.promise().query(
                "INSERT INTO carrinho (id_usuario) VALUES (?)",
                [id_usuario]
            );
            id_carrinho = novoCarrinho.insertId;
        } else {
            id_carrinho = carrinho[0].id_carrinho;
        }

        // Verificar se o produto já está no carrinho
        const [produtoExiste] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produtoExiste.length > 0) {
            // Se o produto já estiver no carrinho, atualizar a quantidade
            await conexao.promise().query(
                "UPDATE carrinho_itens SET quantidade = quantidade + ?, unidade = ?, peso = ?, preco = ? WHERE id_carrinho = ? AND id_produto = ?",
                [quantidade, unidade, peso_produto, preco_produto, id_carrinho, id_produto]
            );
        } else {
            // Se não, adicionar o produto ao carrinho com peso E PREÇO
            await conexao.promise().query(
                "INSERT INTO carrinho_itens (id_carrinho, id_produto, quantidade, unidade, peso, preco) VALUES (?, ?, ?, ?, ?, ?)",
                [id_carrinho, id_produto, quantidade, unidade, peso_produto, preco_produto]
            );
        }
        
        await notificar(req.usuario.id_usuario, `Adicionaste o produto com código ${id_produto} ao carrinho.`);
        
        res.json({ mensagem: "Produto adicionado ao carrinho." });
    } catch (error) {
        console.log("Erro ao adicionar produto ao carrinho:", error);
        res.status(500).json({ erro: "Erro ao adicionar produto ao carrinho." });
    }
});


router.get("/", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    
    try {
        // Primeiro verifica se o usuário tem um carrinho
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );
        
        if (carrinho.length === 0) {
            return res.json({ mensagem: "Carrinho vazio.", produtos: [] });
        }
        
        const id_carrinho = carrinho[0].id_carrinho;
        
        // Agora busque os produtos do carrinho, juntando com a tabela de estoque
        const [produtos] = await conexao.promise().query(
            `SELECT 
                p.id_produtos AS id, 
                p.nome, 
                p.preco, 
                p.categoria,
                p.foto_produto, 
                ci.quantidade,
                ci.unidade AS Unidade,
                ci.peso,
                e.Unidade AS unidade_estoque,      
                e.quantidade AS quantidade_estoque 
            FROM carrinho_itens ci
            JOIN produtos p ON ci.id_produto = p.id_produtos
            LEFT JOIN estoque e ON p.id_produtos = e.produto_id
            WHERE ci.id_carrinho = ?`,
            [id_carrinho]
        );
        
        res.json({ produtos });
    } catch (error) {
        console.log("Erro ao buscar produtos do carrinho:", error);
        res.status(500).json({ erro: "Erro ao buscar produtos do carrinho." });
    }
});

router.delete("/remover/:id_produto", autenticarToken, async (req, res) => {
    const { id_produto } = req.params;
        const id_usuario = req.usuario.id_usuario;
    
    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.status(404).json({ mensagem: "Carrinho não encontrado." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        const [produto] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado no carrinho." });
        }

        await conexao.promise().query(
            "DELETE FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        res.json({ mensagem: "Produto removido do carrinho." });
    } catch (error) {
        console.log("Erro ao remover produto do carrinho:", error);
        res.status(500).json({ erro: "Erro ao remover produto do carrinho." });
    }
});

router.delete("/esvaziar", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    console.log("entrou na função")
  

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.json({ mensagem: "Carrinho já está vazio." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        await conexao.promise().query(
            "DELETE FROM carrinho_itens WHERE id_carrinho = ?",
            [id_carrinho]
        );

        res.json({ mensagem: "Carrinho esvaziado com sucesso." });
    } catch (error) {
        console.log("Erro ao esvaziar o carrinho:", error);
        res.status(500).json({ erro: "Erro ao esvaziar o carrinho." });
    }
});

router.put("/atualizar/:id_produto", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_produto } = req.params;
    const { quantidade } = req.body;
     console.log("entrou na função")

    if (quantidade < 1) {
        return res.status(400).json({ mensagem: "A quantidade deve ser maior que zero." });
    }

    try {
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );

        if (carrinho.length === 0) {
            return res.status(404).json({ mensagem: "Carrinho não encontrado." });
        }

        const id_carrinho = carrinho[0].id_carrinho;

        const [produto] = await conexao.promise().query(
            "SELECT * FROM carrinho_itens WHERE id_carrinho = ? AND id_produto = ?",
            [id_carrinho, id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado no carrinho." });
        }

        await conexao.promise().query(
            "UPDATE carrinho_itens SET quantidade = ? WHERE id_carrinho = ? AND id_produto = ?",
            [quantidade, id_carrinho, id_produto]
        );

        res.json({ mensagem: "Quantidade atualizada com sucesso." });
    } catch (error) {
        console.log("Erro ao atualizar quantidade:", error);
        res.status(500).json({ erro: "Erro ao atualizar quantidade." });
    }
});


// ROTA para calcular preço do carrinho com cálculo proporcional
router.post("/calcular-preco", autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  
  try {
    // Buscar todos os itens do carrinho do usuário com dados do produto original
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
      return res.status(404).json({ erro: "Carrinho vazio." });
    }
    
    // Calcular totais com proporção correta
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
        id_produtos: item.id_produtos,
        nome: item.nome,
        quantidade_desejada: item.quantidade_desejada,
        quantidade_cadastrada: item.quantidade_cadastrada,
        preco_cadastrado: item.preco_cadastrado,
        peso_cadastrado: item.peso_cadastrado,
        Unidade: item.Unidade,
        proporcao: proporcao,
        preco_final: preco_final,
        peso_final: peso_final,
        subtotal_produto: subtotal_produto
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
    const totalFinal = subtotalProdutos + frete.base + frete.comissao;
    
    console.log("Cálculo do carrinho com proporção:", {
      itensCalculados,
      subtotalProdutos,
      pesoTotal,
      frete: frete.base,
      comissao: frete.comissao,
      totalFinal
    });
    
    res.json({
      itens: itensCalculados,
      resumo: {
        subtotalProdutos: Math.round(subtotalProdutos),
        pesoTotal: Math.round(pesoTotal * 100) / 100, // Arredondar para 2 casas decimais
        frete: frete.base,
        comissao: frete.comissao,
        totalFinal: Math.round(totalFinal)
      }
    });
    
  } catch (error) {
    console.log("Erro ao calcular o preço:", error);
    res.status(500).json({
      erro: "Erro ao calcular o preço do carrinho",
      detalhe: error.message
    });
  }
});



router.get("/estoque/:id_produto", autenticarToken, async (req, res) => {
    const { id_produto } = req.params;

    try {
        const [estoque] = await conexao.promise().query(
            "SELECT quantidade FROM estoque WHERE produto_id = ?",
            [id_produto]
        );

        if (estoque.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado." });
        }

        res.json({ quantidade: estoque[0].quantidade });
    } catch (error) {
        console.log("Erro ao buscar estoque:", error);
        res.status(500).json({ erro: "Erro ao buscar estoque." });
    }
});



// Rota para iniciar processo de checkout
router.post("/iniciar-checkout", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    
    try {
        // Pega o carrinho do usuário
        const [carrinho] = await conexao.promise().query(
            "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
            [id_usuario]
        );
        
        if (carrinho.length === 0) {
            return res.status(400).json({ mensagem: "Carrinho vazio." });
        }
        
        const id_carrinho = carrinho[0].id_carrinho;
        
        // Pega os itens do carrinho
        const [itens] = await conexao.promise().query(
            `SELECT ci.id_produto, ci.quantidade AS quantidade_carrinho, 
                    e.quantidade AS estoque_atual, p.nome, p.preco
            FROM carrinho_itens ci
            JOIN produtos p ON ci.id_produto = p.id_produtos
            JOIN estoque e ON e.produto_id = p.id_produtos
            WHERE ci.id_carrinho = ?`,
            [id_carrinho]
        );
        
        if (itens.length === 0) {
            return res.status(400).json({ mensagem: "Carrinho vazio." });
        }
        
        // Verifica se todos os produtos têm estoque suficiente
        for (const item of itens) {
            if (item.quantidade_carrinho > item.estoque_atual) {
                return res.status(400).json({
                    mensagem: `Produto ${item.nome} não tem estoque suficiente.`
                });
            }
        }
        
        // Calcula total para mostrar na tela de pagamento
        const total = itens.reduce(
            (sum, item) => sum + (item.preco * item.quantidade_carrinho), 
            0
        );
        
        res.json({ 
            mensagem: "Checkout iniciado. Prossiga para o pagamento.", 
            itens: itens,
            total: total
        });
        
    } catch (error) {
        console.log("Erro ao iniciar checkout:", error);
        res.status(500).json({ erro: "Erro ao iniciar checkout." });
    }
});



// SOLUÇÃO 1: Usar getConnection() para obter uma conexão específica
router.post("/finalizar-compra", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_pedido, pagamento_confirmado, referencia_pagamento } = req.body;
    const io = req.io;
        console.log("entrou na função" , req.body)
    
    try {

         console.log("🔍 DADOS RECEBIDOS:");
        console.log("- id_usuario:", id_usuario);
        console.log("- id_pedido:", id_pedido);
        console.log("- pagamento_confirmado:", pagamento_confirmado);
        console.log("- referencia_pagamento:", referencia_pagamento);
        
        if (!id_pedido) {
            return res.status(400).json({ message: "ID do pedido é obrigatório" });
        }
        // Verifica se pagamento foi confirmado
        if (!pagamento_confirmado) {
            return res.status(400).json({ 
                message: "Pagamento não confirmado. O pedido permanece pendente."
            });
        }

        if (!id_pedido) {
            return res.status(400).json({ message: "ID do pedido é obrigatório" });
        }
        
        // Verificar se o pedido existe e pertence ao usuário
        const [pedido] = await conexao.promise().query(
            "SELECT * FROM pedidos WHERE id_pedido = ? AND id_usuario = ? AND estado = 'processado'",
            [id_pedido, id_usuario]
        );
        
        if (pedido.length === 0) {
            return res.status(404).json({ 
                message: "Pedido não encontrado ou já foi processado" 
            });
        }
        
        // Pegar itens do pedido
        const [itensPedido] = await conexao.promise().query(
            `SELECT ip.*, p.nome, e.quantidade as estoque_atual
             FROM itens_pedido ip
             JOIN produtos p ON ip.id_produto = p.id_produtos
             JOIN estoque e ON e.produto_id = p.id_produtos
             WHERE ip.pedidos_id = ?`,
            [id_pedido]
        );
        
        // Verificar estoque novamente antes de finalizar
        for (const item of itensPedido) {
            if (item.quantidade_comprada > item.estoque_atual) {
                return res.status(400).json({
                    message: `Produto ${item.nome} não tem mais estoque suficiente. Disponível: ${item.estoque_atual}`
                });
            }
        }
        
        // PROCESSAMENTO SIMPLES - SEM TRANSAÇÕES
        try {
            console.log(`🔄 Iniciando processamento do pedido ${id_pedido}`);
            
            // 1. ATUALIZAR PEDIDO PARA PROCESSADO/PAGO
            await conexao.execute(
                "UPDATE pedidos SET estado = ?, data_pagamento = NOW() WHERE id_pedido = ?",
                ['processado', id_pedido]
            );
            console.log(`✅ Pedido ${id_pedido} atualizado para processado`);

            // 2. ATUALIZAR ESTOQUE DOS PRODUTOS
            for (const item of itensPedido) {
                const novoEstoque = item.estoque_atual - item.quantidade_comprada;
                
                await conexao.execute(  
                    "UPDATE estoque SET quantidade = ?, status = ? WHERE produto_id = ?",
                    [novoEstoque, novoEstoque === 0 ? "esgotado" : "disponível", item.id_produto]
                );
                
                console.log(`✅ Estoque atualizado - Produto ${item.nome}: ${item.estoque_atual} → ${novoEstoque}`);
            }
            
            // 3. LIMPAR O CARRINHO APÓS PAGAMENTO CONFIRMADO
            await conexao.execute(
                `DELETE ci FROM carrinho_itens ci
                 JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
                 WHERE c.id_usuario = ?`,
                [id_usuario]
            );
            console.log(`✅ Carrinho limpo para usuário ${id_usuario}`);
            
            console.log(`🎉 Pedido ${id_pedido} processado com sucesso!`);
            
        } catch (updateError) {
            console.error("❌ Erro ao processar pedido:", updateError);
            return res.status(500).json({
                message: "Erro ao processar compra. Tente novamente.",
                error: updateError.message,
                pedido_id: id_pedido
            });
        }
        const idsProdutos = itensPedido.map(item => item.id_produto);
        
        if (idsProdutos.length > 0) {
            // Criar placeholders para a query IN
            const placeholders = idsProdutos.map(() => '?').join(',');
            
            // Buscar vendedores com seus produtos específicos no pedido
            const [produtosVendedores] = await conexao.promise().query(
                `SELECT DISTINCT 
                    u.id_usuario as vendedor_id,
                    u.nome as vendedor_nome,
                    u.tipo_usuario,
                    p.id_produtos,
                    p.nome as produto_nome,
                    ip.quantidade_comprada,
                    ip.subtotal,
                    p.unidade_medida
                 FROM produtos p 
                 JOIN usuarios u ON p.id_usuario = u.id_usuario 
                 JOIN itens_pedido ip ON p.id_produtos = ip.id_produto
                 WHERE p.id_produtos IN (${placeholders}) 
                 AND ip.pedidos_id = ?
                 ORDER BY u.id_usuario, p.nome`,
                [...idsProdutos, id_pedido]
            );

            // Agrupar produtos por vendedor
            const vendedoresProdutos = {};
            produtosVendedores.forEach(item => {
                if (!vendedoresProdutos[item.vendedor_id]) {
                    vendedoresProdutos[item.vendedor_id] = {
                        vendedor_nome: item.vendedor_nome,
                        tipo_usuario: item.tipo_usuario,
                        produtos: [],
                        valor_total_vendedor: 0
                    };
                }
                
                vendedoresProdutos[item.vendedor_id].produtos.push({
                    nome: item.produto_nome,
                    quantidade: item.quantidade_comprada,
                    subtotal: item.subtotal,
                    unidade: item.unidade_medida || 'kg'
                });
                
                vendedoresProdutos[item.vendedor_id].valor_total_vendedor += parseFloat(item.subtotal || 0);
            });

            // Enviar notificação personalizada para cada vendedor
            Object.keys(vendedoresProdutos).forEach((vendedor_id) => {
                const dadosVendedor = vendedoresProdutos[vendedor_id];
                
                // Criar mensagem personalizada com os produtos do vendedor
                let mensagemProdutos = dadosVendedor.produtos.map(produto => 
                    `${produto.nome}: ${produto.quantidade}${produto.unidade}`
                ).join(', ');
                
                const mensagemFinal = `🛒 Novo pedido confirmado! Pedido #${id_pedido} - ${mensagemProdutos}`;
                
                io.to(`usuario_${vendedor_id}`).emit("novo_pedido", {
                    message: mensagemFinal,
                    id_pedido,
                    estado: 'processado',
                    valor_vendedor: Math.round(dadosVendedor.valor_total_vendedor),
                    produtos_vendedor: dadosVendedor.produtos,
                    comprador: req.usuario.nome || 'Cliente',
                    data: new Date(),
                    tipo: 'pedido_confirmado'
                });
            });
        }

        // 2️⃣ NOTIFICAR ADMINISTRADORES (nova compra na plataforma)
        const [admins] = await conexao.promise().query(
            "SELECT id_usuario, nome FROM usuarios WHERE tipo_usuario = 'Administrador'"
        );

        admins.forEach((admin) => {
            io.to(`usuario_${admin.id_usuario}`).emit("novo_pedido", {
                message: `💰 Nova compra realizada na plataforma! Pedido #${id_pedido}`,
                id_pedido,
                estado: 'confirmado',
                valor_total: pedido[0].valor_total,
                comprador: req.usuario.nome || 'Cliente',
                data: new Date(),
                tipo: 'compra_confirmada'
            });
        });

        // 3️⃣ NOTIFICAR COMPRADOR (compra finalizada)
        io.to(`usuario_${id_usuario}`).emit("compra_finalizada", {
            message: `✅ Compra finalizada com sucesso! Pedido #${id_pedido}`,
            id_pedido,
            estado: 'confirmado',
            valor_total: pedido[0].valor_total,
            data: new Date(),
            tipo: 'compra_finalizada'
        });

        res.json({ 
            message: "Compra finalizada com sucesso!",
            id_pedido,
            status: "confirmado",
            carrinho_status: "limpo",
            referencia_pagamento
        });
        
    } catch (error) {


        console.error("❌ ERRO GERAL CAPTURADO:");
        console.error("- Mensagem:", error.message);
        console.error("- Stack:", error.stack);
        console.error("- Tipo:", error.constructor.name);
        
        console.log("Erro ao finalizar compra:", error);
        res.status(500).json({ 
            message: "Erro ao finalizar compra",
            error: error.message 
        });
    }
});


module.exports = router;
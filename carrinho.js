const express = require("express");
const router = express.Router();
const conexao = require("./database");
const { autenticarToken } = require("./mildwaretoken");
const notificar = require("./utils/notificar");


router.use(express.json());

router.post("/adicionar", autenticarToken, async (req, res) => {
    const { id_produto, quantidade, unidade } = req.body;
    const id_usuario = req.usuario.id_usuario;
    
    console.log("Dados recebidos:", { id_produto, quantidade, unidade, id_usuario });
    
    try {
        if (quantidade < 1) {
            return res.status(400).json({ mensagem: "A quantidade deve ser maior que zero." });
        }

        // Buscar informações do produto 
        const [produto] = await conexao.promise().query(
            "SELECT peso_kg FROM produtos WHERE id_produtos = ?",
            [id_produto]
        );

        if (produto.length === 0) {
            return res.status(404).json({ mensagem: "Produto não encontrado." });
        }

        const peso_produto = produto[0].peso_kg;

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
                "UPDATE carrinho_itens SET quantidade = quantidade + ?, unidade = ?, peso = ? WHERE id_carrinho = ? AND id_produto = ?",
                [quantidade, unidade, peso_produto, id_carrinho, id_produto]
            );
        } else {
            // Se não, adicionar o produto ao carrinho com peso
            await conexao.promise().query(
                "INSERT INTO carrinho_itens (id_carrinho, id_produto, quantidade, unidade, peso) VALUES (?, ?, ?, ?, ?)",
                [id_carrinho, id_produto, quantidade, unidade, peso_produto]
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
// // Endpoint modificado para calcular-preco
// router.post("/calcular-preco", autenticarToken, async (req, res) => {
//   const { produtoId, quantidadeCliente, pesoTotal } = req.body;

//   try {
//     const [resultado] = await conexao.promise().query(
//       "SELECT * FROM produtos WHERE id_produtos = ?",
//       [produtoId]
//     );

//     if (resultado.length === 0) {
//       return res.status(404).json({ erro: "Produto não encontrado." });
//     }

//     const produto = resultado[0];
//     const quantidadeDisponivel = produto.quantidade;
//     const precoUnitario = produto.preco;
    
//     // Se a quantidade solicitada for maior que a disponível, retornamos erro
//     if (quantidadeCliente > quantidadeDisponivel) {
//       return res.status(400).json({ erro: "Quantidade solicitada maior que a disponível." });
//     }

//     const precoCliente = precoUnitario * quantidadeCliente;
    
//     // Usamos o pesoTotal fornecido ou calculamos baseado no produto atual
//     const pesoProduto = produto.peso_kg || 0;
//     const pesoTotalFinal = pesoTotal || (pesoProduto * quantidadeCliente);

//     const calcularFrete = (peso) => {
//       if (peso >= 10 && peso <= 30) return { base: 10000, comissao: 1000 };
//       if (peso >= 31 && peso <= 50) return { base: 15000, comissao: 1500 };
//       if (peso >= 51 && peso <= 70) return { base: 20000, comissao: 2000 };
//       if (peso >= 71 && peso <= 100) return { base: 25000, comissao: 2500 };
//       if (peso >= 101 && peso <= 300) return { base: 35000, comissao: 3500 };
//       if (peso >= 301 && peso <= 500) return { base: 50000, comissao: 5000 };
//       if (peso >= 501 && peso <= 1000) return { base: 80000, comissao: 8000 };
//       if (peso >= 1001 && peso <= 2000) return { base: 120000, comissao: 12000 };
//       return { base: 0, comissao: 0 };
//     };

//     const frete = calcularFrete(pesoTotalFinal);
    
//     // Se estamos calculando apenas para um produto, o total é o preço do produto
//     // Se estamos calculando com peso total, devolvemos apenas os valores de frete e comissão
//     const totalFinal = pesoTotal ? precoCliente : (precoCliente + frete.base + frete.comissao);

//     // Log para depuração
//     console.log("API calculando com:", {
//       produtoId,
//       quantidadeCliente,
//       pesoTotal: pesoTotalFinal,
//       frete: frete.base,
//       comissao: frete.comissao
//     });

//     res.json({
//       precoUnitario,
//       precoCliente,
//       pesoTotal: pesoTotalFinal,
//       frete: frete.base,
//       comissao: frete.comissao,
//       totalFinal
//     });

//   } catch (error) {
//     console.log("Erro ao calcular o preço:", error);
//     res.status(500).json({
//       erro: "Erro ao calcular o preço do produto",
//       detalhe: error.message
//     });
//   }
// });

// router.post("/finalizar-compra", autenticarToken, async (req, res) => {
//     const id_usuario = req.usuario.id_usuario;
    
//     try {
//         // Pega o carrinho do usuário
//         const [carrinho] = await conexao.promise().query(
//             "SELECT id_carrinho FROM carrinho WHERE id_usuario = ?",
//             [id_usuario]
//         );
        
//         if (carrinho.length === 0) {
//             return res.status(400).json({ mensagem: "Carrinho vazio." });
//         }
        
//         const id_carrinho = carrinho[0].id_carrinho;
        
//         // Pega os itens do carrinho
//         const [itens] = await conexao.promise().query(
//             `SELECT ci.id_produto, ci.quantidade AS quantidade_carrinho, e.quantidade AS estoque_atual
//             FROM carrinho_itens ci
//             JOIN produtos p ON ci.id_produto = p.id_produtos
//             JOIN estoque e ON e.produto_id = p.id_produtos
//             WHERE ci.id_carrinho = ?`,
//             [id_carrinho]
//         );
        
//         if (itens.length === 0) {
//             return res.status(400).json({ mensagem: "Carrinho vazio." });
//         }
        
//         // Verifica se todos os produtos têm estoque suficiente
//         for (const item of itens) {
//             if (item.quantidade_carrinho > item.estoque_atual) {
//                 return res.status(400).json({
//                     mensagem: `Produto com ID ${item.id_produto} não tem estoque suficiente.`
//                 });
//             }
//         }
        
//         // Atualiza o estoque dos produtos
//         for (const item of itens) {
//             const novoEstoque = item.estoque_atual - item.quantidade_carrinho;
            
//             // Atualiza a quantidade e status na tabela estoque
//             await conexao.promise().query(
//                 "UPDATE estoque SET quantidade = ?, status = ? WHERE produto_id = ?",
//                 [novoEstoque, novoEstoque === 0 ? "esgotado" : "disponível", item.id_produto]
//             );
//         }
        
//         // Limpa o carrinho
//         await conexao.promise().query(
//             "DELETE FROM carrinho_itens WHERE id_carrinho = ?",
//             [id_carrinho]
//         );
        
//         await notificar(req.usuario.id_usuario, `Compra finalizada com sucesso.`);
        
//         res.json({ mensagem: "Finalizar compra." });
        
//     } catch (error) {
//         console.log("Erro ao finalizar a compra:", error);
//         res.status(500).json({ erro: "Erro ao finalizar a compra." });
//     }
// });


// OPÇÃO 1: Rota simplificada (usando dados do carrinho)
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
        p.id_produtos,
        p.nome,
        p.quantidade as quantidade_cadastrada,
        p.peso_kg as peso_cadastrado,
        p.preco as preco_cadastrado
      FROM carrinho_itens ci
      JOIN carrinho c ON ci.id_carrinho = c.id_carrinho
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

// Rota para processar pagamento e finalizar compra
router.post("/finalizar-compra", autenticarToken, async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { pagamento_confirmado } = req.body; // Receba confirmação de pagamento
    
    try {
        // Verifica se pagamento foi confirmado
        if (!pagamento_confirmado) {
            return res.status(400).json({ 
                mensagem: "Pagamento não confirmado. Os itens permanecerão no seu carrinho."
            });
        }
        
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
            `SELECT ci.id_produto, ci.quantidade AS quantidade_carrinho, e.quantidade AS estoque_atual,
                    p.nome, p.preco
            FROM carrinho_itens ci
            JOIN produtos p ON ci.id_produto = p.id_produtos
            JOIN estoque e ON e.produto_id = p.id_produtos
            WHERE ci.id_carrinho = ?`,
            [id_carrinho]
        );
        
        if (itens.length === 0) {
            return res.status(400).json({ mensagem: "Carrinho vazio." });
        }
        
        // Verifica novamente se todos os produtos têm estoque suficiente
        for (const item of itens) {
            if (item.quantidade_carrinho > item.estoque_atual) {
                return res.status(400).json({
                    mensagem: `Produto ${item.nome} não tem mais estoque suficiente.`
                });
            }
        }
        
        // Calcula o total do pedido
        const totalPedido = itens.reduce(
            (sum, item) => sum + (item.preco * item.quantidade_carrinho), 
            0
        );
        
        // Criar registro do pedido se você já tiver esta tabela
        let id_pedido = null;
        if (pedidosEnabled) { // Substitua por sua verificação se tem a tabela de pedidos
            const [resultPedido] = await conexao.promise().query(
                `INSERT INTO pedidos (id_usuario, valor_total, estado, data_pedido) 
                VALUES (?, ?, 'pago', NOW())`,
                [id_usuario, totalPedido]
            );
            
            id_pedido = resultPedido.insertId;
            
            // Insere os itens do pedido na tabela de itens do pedido
            for (const item of itens) {
                await conexao.promise().query(
                    `INSERT INTO itens_pedido (pedidos_id, id_produto, quantidade_comprada, preco) 
                    VALUES (?, ?, ?, ?)`,
                    [id_pedido, item.id_produto, item.quantidade_carrinho, item.preco]
                );
            }
        }
        
        // Atualiza o estoque dos produtos
        for (const item of itens) {
            const novoEstoque = item.estoque_atual - item.quantidade_carrinho;
            
            // Atualiza a quantidade e status na tabela estoque
            await conexao.promise().query(
                "UPDATE estoque SET quantidade = ?, status = ? WHERE produto_id = ?",
                [novoEstoque, novoEstoque === 0 ? "esgotado" : "disponível", item.id_produto]
            );
        }
        
        // SOMENTE AGORA limpa o carrinho após confirmação de pagamento
        await conexao.promise().query(
            "DELETE FROM carrinho_itens WHERE id_carrinho = ?",
            [id_carrinho]
        );
        
        await notificar(req.usuario.id_usuario, `Compra finalizada com sucesso.`);
        
        res.json({ 
            mensagem: "Compra finalizada com sucesso!",
            id_pedido: id_pedido
        });
        
    } catch (error) {
        console.log("Erro ao finalizar a compra:", error);
        res.status(500).json({ erro: "Erro ao finalizar a compra." });
    }
});







module.exports = router;
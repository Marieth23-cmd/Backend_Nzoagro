Faixa de Peso (Kg) | Preço do Frete Base (Kz) | Comissão da Plataforma (Kz) | Preço Final ao Cliente (Kz)
10 – 30 Kg | 10.000 | 1.000 | 11.000
31 – 50 Kg | 15.000 | 1.500 | 16.500
51 – 70 Kg | 20.000 | 2.000 | 22.000
71 – 100 Kg | 25.000 | 2.500 | 27.500
101 – 300 Kg | 35.000 | 3.500 | 38.500
301 – 500 Kg | 50.000 | 5.000 | 55.000
501 – 1.000 Kg | 80.000 | 8.000 | 88.000
1.001 – 2.000 Kg | 120.000 | 12.000 | 132.000


-- =====================================================
-- ESTRUTURA DA TABELA PAGAMENTOS ATUALIZADA
-- Para trabalhar com tabela usuarios única
-- =====================================================

-- Fazer backup da tabela atual (se existir)
CREATE TABLE pagamentos_backup AS SELECT * FROM pagamentos WHERE 1=0;

-- Remover tabela existente (CUIDADO!)
-- DROP TABLE IF EXISTS pagamentos;

-- Criar nova tabela de pagamentos
CREATE TABLE pagamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Relacionamentos principais
    id_pedido INT NOT NULL,
    id_comprador INT NOT NULL,          -- Quem está pagando
    id_vendedor INT NOT NULL,           -- Quem vai receber (Agricultor/Fornecedor)
    
    -- Informações do pagamento móvel
    tipo_pagamento ENUM('unitel_money', 'afrimoney', 'multicaixa') NOT NULL,
    telefone_pagador VARCHAR(15) NOT NULL,
    transacao_id VARCHAR(50) UNIQUE NOT NULL,           -- ID único da transação
    referencia_pagamento VARCHAR(50) NOT NULL,          -- Referência para o app móvel
    
    -- Valores financeiros
    valor_bruto DECIMAL(10,2) NOT NULL,                 -- Valor que o comprador paga
    valor_taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00,     -- Taxa do provedor (Unitel, etc)
    valor_liquido DECIMAL(10,2) NOT NULL,               -- Valor que o vendedor recebe
    desconto_aplicado DECIMAL(10,2) DEFAULT 0.00,       -- Descontos promocionais
    valor_reembolsado DECIMAL(10,2) DEFAULT 0.00,       -- Valor devolvido (se houver)
    
    -- Controle de status
    status_pagamento ENUM(
        'pendente',         -- Pagamento criado, aguardando
        'processando',      -- Sendo processado pelo provedor
        'pago',            -- Confirmado pelo provedor
        'retido',          -- 💰 VALOR RETIDO - Aguardando entrega
        'liberado',        -- ✅ VALOR LIBERADO - Enviado ao vendedor
        'cancelado',       -- ❌ Pagamento falhou/cancelado
        'reembolsado'      -- ↩️ Valor devolvido ao comprador
    ) DEFAULT 'pendente',
    
    -- Controles adicionais
    motivo_desconto TEXT NULL,
    motivo_reembolso TEXT NULL,
    reembolso_id VARCHAR(50) NULL,                      -- ID para rastrear reembolso
    confirmado_por INT NULL,                            -- Quem confirmou a entrega
    autorizado_por INT NULL,                            -- Quem autorizou reembolso
    metodo_confirmacao VARCHAR(50) DEFAULT 'manual',    -- Como foi confirmado
    
    -- Timestamps para auditoria
    data_pagamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,     -- Quando foi criado
    data_confirmacao TIMESTAMP NULL,                        -- Quando foi confirmado pelo provedor
    data_liberacao TIMESTAMP NULL,                          -- Quando foi liberado ao vendedor
    data_reembolso TIMESTAMP NULL,                          -- Quando foi reembolsado
    data_desconto TIMESTAMP NULL,                           -- Quando desconto foi aplicado
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices para performance
    INDEX idx_pedido (id_pedido),
    INDEX idx_status (status_pagamento),
    INDEX idx_transacao (transacao_id),
    INDEX idx_comprador (id_comprador),
    INDEX idx_vendedor (id_vendedor),
    INDEX idx_data_pagamento (data_pagamento),
    INDEX idx_tipo_pagamento (tipo_pagamento),
    
    -- Chaves estrangeiras
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_comprador) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_vendedor) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (confirmado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
    FOREIGN KEY (autorizado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);

-- =====================================================
-- DADOS DE EXEMPLO PARA TESTE
-- =====================================================

-- Inserir dados de exemplo (ajuste os IDs conforme seus usuários)
INSERT INTO pagamentos (
    id_pedido, id_comprador, id_vendedor, tipo_pagamento, telefone_pagador,
    transacao_id, referencia_pagamento, valor_bruto, valor_taxa, valor_liquido,
    status_pagamento
) VALUES 
-- Comprador normal comprando de Agricultor
(1, 1, 2, 'unitel_money', '923111222', 'TXN_DEMO001', 'REF_1734567890', 15000.00, 300.00, 14700.00, 'retido'),

-- Fornecedor comprando de Agricultor (inter-fornecedores)
(2, 3, 2, 'afrimoney', '933444555', 'TXN_DEMO002', 'REF_1734567891', 8000.00, 120.00, 7880.00, 'liberado'),

-- Agricultor comprando de Fornecedor
(3, 2, 3, 'multicaixa', '936777888', 'TXN_DEMO003', 'REF_1734567892', 12500.00, 312.50, 12187.50, 'processando'),

-- Administrador fazendo compra de teste
(4, 4, 2, 'unitel_money', '923999888', 'TXN_DEMO004', 'REF_1734567893', 6000.00, 120.00, 5880.00, 'reembolsado');

-- =====================================================
-- VIEW PARA RELATÓRIOS DETALHADOS
-- =====================================================

CREATE VIEW vw_pagamentos_completo AS
SELECT 
    p.*,
    -- Dados do comprador
    u_comprador.nome as nome_comprador,
    u_comprador.tipo_usuario as tipo_comprador,
    u_comprador.telefone as telefone_comprador,
    
    -- Dados do vendedor  
    u_vendedor.nome as nome_vendedor,
    u_vendedor.tipo_usuario as tipo_vendedor,
    u_vendedor.telefone as telefone_vendedor,
    
    -- Dados de quem confirmou (se houver)
    u_confirmador.nome as nome_confirmador,
    u_confirmador.tipo_usuario as tipo_confirmador,
    
    -- Informações calculadas
    CASE p.tipo_pagamento
        WHEN 'unitel_money' THEN 'Unitel Money'
        WHEN 'afrimoney' THEN 'Afrimoney'
        WHEN 'multicaixa' THEN 'Multicaixa Express'
    END as nome_provedor,
    
    -- Tempo de retenção (em dias)
    CASE 
        WHEN p.status_pagamento = 'liberado' THEN 
            DATEDIFF(p.data_liberacao, p.data_confirmacao)
        WHEN p.status_pagamento = 'retido' THEN 
            DATEDIFF(NOW(), p.data_confirmacao)
        ELSE NULL
    END as dias_retencao,
    
    -- Status em português
    CASE p.status_pagamento
        WHEN 'pendente' THEN 'Pendente'
        WHEN 'processando' THEN 'Processando'
        WHEN 'pago' THEN 'Pago'
        WHEN 'retido' THEN 'Retido (Aguardando Entrega)'
        WHEN 'liberado' THEN 'Liberado ao Vendedor'
        WHEN 'cancelado' THEN 'Cancelado'
        WHEN 'reembolsado' THEN 'Reembolsado'
    END as status_descricao

FROM pagamentos p
LEFT JOIN usuarios u_comprador ON p.id_comprador = u_comprador.id_usuario
LEFT JOIN usuarios u_vendedor ON p.id_vendedor = u_vendedor.id_usuario
LEFT JOIN usuarios u_confirmador ON p.confirmado_por = u_confirmador.id_usuario;

-- =====================================================
-- CONSULTAS ÚTEIS PARA DASHBOARD
-- =====================================================

-- Pagamentos retidos (precisam de confirmação de entrega)
-- SELECT * FROM vw_pagamentos_completo WHERE status_pagamento = 'retido';

-- Transações por tipo de usuário
-- SELECT tipo_

mysql://root:AagpWWmcISumugIgjShlkERqSNWTeTGx@hopper.proxy.rlwy.net:43669/railway


const EXEMPLOS_PARA_DEFESA = {
    // Valores realistas em Kwanzas Angolanos
    produtos: [
        { nome: "Saco de Milho (50kg)", preco: 15000 },
        { nome: "Cesto de Tomates (20kg)", preco: 8000 },
        { nome: "Saco de Feijão (25kg)", preco: 12500 },
        { nome: "Abóbora Grande", preco: 2500 },
        { nome: "Mandioca (30kg)", preco: 6000 }
    ],
    
    telefones_teste: [
        "923111222", // Unitel
        "933444555", // Africell 
        "936777888"  // Movicel
    ],
    
    cenarios_demonstracao: [
        {
            descricao: "Compra normal com entrega confirmada",
            valor: 25000,
            taxa: 500,
            liquido: 24500,
            status_final: "liberado"
        },
        {
            descricao: "Compra com desconto promocional",
            valor_original: 20000,
            desconto: 2000,
            valor_final: 18000,
            status_final: "liberado"
        },
        {
            descricao: "Compra com problema - reembolso",
            valor: 15000,
            motivo_reembolso: "Produto chegou danificado",
            status_final: "reembolsado"
        }
    ]
};


Explicação Completa - Sistema de Pagamentos Móveis
🔧 CONFIGURAÇÕES INICIAIS
Tipos de Pagamento Suportados
javascript
const TIPOS_PAGAMENTO = {
    'unitel_money': { nome: 'Unitel Money', taxa: 0.02 },     // 2% de taxa
    'afrimoney': { nome: 'Afrimoney', taxa: 0.015 },         // 1.5% de taxa  
    'multicaixa': { nome: 'Multicaixa Express', taxa: 0.025 } // 2.5% de taxa
};
O que faz: Define os provedores de pagamento móvel disponíveis em Angola, cada um com sua taxa específica.

Status dos Pagamentos
javascript
const STATUS_PAGAMENTO = {
    PENDENTE: 'pendente',           // Pagamento iniciado, aguardando autorização
    PROCESSANDO: 'processando',     // Processando no provedor (Unitel, etc)
    PAGO: 'pago',                   // Pagamento confirmado pelo provedor
    RETIDO: 'retido',               // Valor retido até confirmação de entrega
    LIBERADO: 'liberado',           // Valor liberado para o vendedor
    CANCELADO: 'cancelado',         // Pagamento cancelado/falhou
    REEMBOLSADO: 'reembolsado'      // Valor devolvido ao comprador
};
O que faz: Define todos os estados possíveis de um pagamento, desde o início até a conclusão.

🚀 ROTA PRINCIPAL: PROCESSAR PAGAMENTO
1. Validação de Dados de Entrada
javascript
const { id_pedido, tipo_pagamento, telefone_pagador, id_comprador } = req.body;

if (!id_pedido || !tipo_pagamento || !telefone_pagador || !id_comprador) {
    return res.status(400).json({ 
        mensagem: "Campos obrigatórios: id_pedido, tipo_pagamento, telefone_pagador, id_comprador" 
    });
}
O que faz: Verifica se todos os campos necessários foram enviados.

2. PARTE DA REFERÊNCIA - MUITO IMPORTANTE! 🎯
A. Geração dos IDs Únicos
javascript
// Gerar IDs únicos para rastreamento
const transacao_id = `TXN_${uuidv4().substring(0, 8).toUpperCase()}`;
const referencia_pagamento = `REF_${Date.now()}`;
Como funciona:

transacao_id: Cria um ID único tipo TXN_A1B2C3D4 usando UUID
referencia_pagamento: Cria uma referência tipo REF_1672531200000 usando timestamp
Por que é importante:

Transacao_id: Para rastrear internamente no seu sistema
Referencia_pagamento: É o código que o cliente vai usar no app do banco!
B. Como o Cliente Usa a Referência
javascript
instrucoes: `
    📱 INSTRUÇÕES DE PAGAMENTO:
    1. Abra seu app ${TIPOS_PAGAMENTO[tipo_pagamento].nome}
    2. Use a referência: ${referencia_pagamento}  // ← AQUI!
    3. Confirme o pagamento de ${valor_bruto} AKZ
    4. Aguarde a confirmação (±3 segundos)
`
Fluxo real:

Cliente recebe REF_1672531200000
Abre app Unitel Money/Multicaixa
Vai em "Pagar Serviços" ou "Transferir"
Digite a referência REF_1672531200000
Sistema do banco identifica o pagamento
Cliente confirma com PIN
3. Cálculo de Valores
javascript
const valor_bruto = parseFloat(total);                    // Valor total do pedido
const taxa_pagamento = TIPOS_PAGAMENTO[tipo_pagamento].taxa; // Taxa do provedor
const valor_taxa = valor_bruto * taxa_pagamento;          // Valor da taxa
const valor_liquido = valor_bruto - valor_taxa;           // O que o vendedor recebe
Exemplo prático:

Pedido: 1000 AKZ
Taxa Unitel (2%): 20 AKZ
Vendedor recebe: 980 AKZ
4. SIMULAÇÃO DE PROCESSAMENTO
javascript
// SIMULAÇÃO: Processar pagamento em background (3 segundos)
setTimeout(async () => {
    try {
        // Simular resposta do provedor (90% de sucesso)
        const pagamentoAprovado = Math.random() > 0.1;
        
        if (pagamentoAprovado) {
            // Pagamento aprovado → Status RETIDO
            await conexao.promise().query(
                `UPDATE pagamentos 
                 SET status_pagamento = ?, data_confirmacao = NOW() 
                 WHERE id = ?`,
                [STATUS_PAGAMENTO.RETIDO, insertResult.insertId]
            );
        }
    } catch (error) {
        console.error("Erro na simulação:", error);
    }
}, 3000);
O que acontece:

Pagamento criado com status "PROCESSANDO"
Após 3 segundos, simula resposta do banco
90% de chance de sucesso
Se aprovado → Status vira "RETIDO" (não "PAGO" diretamente!)
🔍 CONSULTAR STATUS DO PAGAMENTO
Rota: GET /status/:transacao_id
javascript
router.get("/status/:transacao_id", async (req, res) => {
    const { transacao_id } = req.params;
    // Busca informações completas do pagamento
    // Retorna status atual com explicação
});
Uso: Cliente pode consultar GET /pagamentos/status/TXN_A1B2C3D4

✅ CONFIRMAR ENTREGA E LIBERAR PAGAMENTO
Por que o Status "RETIDO"?
javascript
// Verificar se o pagamento está no status correto
if (pag.status_pagamento !== STATUS_PAGAMENTO.RETIDO) {
    return res.status(400).json({ 
        mensagem: `❌ Não é possível liberar pagamento.`,
        status_atual: pag.status_pagamento,
        status_necessario: STATUS_PAGAMENTO.RETIDO
    });
}
Lógica de Proteção:

Comprador paga → Dinheiro fica "RETIDO"
Vendedor entrega produto
Comprador confirma recebimento
SÓ ENTÃO o dinheiro é "LIBERADO" para o vendedor
Quem Pode Confirmar Entrega?
javascript
const podeConfirmar = (
    confirmado_por == pag.id_comprador || // O próprio comprador
    tipo_confirmador === 'Administrador'  // Ou um administrador
);
💰 SISTEMA DE REEMBOLSO
Quando é Possível Reembolsar?
javascript
if (pag.status_pagamento === STATUS_PAGAMENTO.LIBERADO) {
    return res.status(400).json({ 
        mensagem: "❌ Não é possível reembolsar",
        explicacao: "O pagamento já foi liberado para o vendedor."
    });
}
Regra: Só pode reembolsar se ainda não foi liberado para o vendedor.

📊 DASHBOARD ADMINISTRATIVO
Estatísticas Automáticas
javascript
const [stats] = await conexao.promise().query(`
    SELECT 
        COUNT(*) as total_transacoes,
        SUM(CASE WHEN status_pagamento = 'liberado' THEN valor_liquido ELSE 0 END) as valor_total_liberado,
        SUM(CASE WHEN status_pagamento = 'retido' THEN valor_liquido ELSE 0 END) as valor_total_retido,
        SUM(valor_taxa) as receita_taxas
    FROM pagamentos
`);
O que calcula:

Total de transações
Quanto já foi liberado para vendedores
Quanto ainda está retido
Quanto vocês ganharam em taxas
🎯 FLUXO COMPLETO - EXEMPLO PRÁTICO
Cenário: João compra 500 AKZ de Ana via Unitel Money
Início:
Sistema gera TXN_A1B2C3D4 e REF_1672531200000
Status: "PROCESSANDO"
João paga:
Abre Unitel Money
Usa referência REF_1672531200000
Paga 500 AKZ
Sistema confirma:
Status vira "RETIDO"
Ana receberia 490 AKZ (500 - 2% taxa)
Mas dinheiro ainda não vai para Ana!
Ana entrega produto:
João recebe e confirma entrega
Status vira "LIBERADO"
Agora sim Ana recebe os 490 AKZ
Caso de problema:
Se João não receber, pode pedir reembolso
Administrador pode processar reembolso de 500 AKZ
🔑 PONTOS-CHAVE DA REFERÊNCIA
Por que Duas Referências?
transacao_id: Para uso interno (logs, consultas, suporte)
referencia_pagamento: Para o cliente usar no app do banco
Como Funciona na Prática?
Sistema gera REF_1672531200000
Cliente recebe essa referência
No app do banco, cliente coloca essa referência
Banco identifica que é pagamento para sua plataforma
Banco processa e notifica seu sistema
Seu sistema atualiza status para "RETIDO"
É como um "código de barras" do pagamento móvel! 🏷️










CREATE TABLE pagamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_pedido INT NOT NULL,
    id_comprador INT NOT NULL,          
    id_vendedor INT NOT NULL,           
    tipo_pagamento ENUM('unitel_money', 'afrimoney', 'multicaixa') NOT NULL,
    telefone_pagador VARCHAR(15) NOT NULL,
    transacao_id VARCHAR(50) UNIQUE NOT NULL,
    referencia_pagamento VARCHAR(50) NOT NULL,         
    valor_bruto DECIMAL(10,2) NOT NULL,                 
    valor_taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00,     
    valor_liquido DECIMAL(10,2) NOT NULL,               
    desconto_aplicado DECIMAL(10,2) DEFAULT 0.00,       
    valor_reembolsado DECIMAL(10,2) DEFAULT 0.00,       

    status_pagamento ENUM('pendente','processando','pago','retido','liberado''cancelado','reembolsado' ) DEFAULT 'pendente',
    motivo_desconto TEXT NULL,
    motivo_reembolso TEXT NULL,
    reembolso_id VARCHAR(50) NULL,                     
    confirmado_por INT NULL,                            
    autorizado_por INT NULL,                            
    metodo_confirmacao VARCHAR(50) DEFAULT 'manual',    
    
    data_pagamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,   
    data_confirmacao TIMESTAMP NULL,                        
    data_liberacao TIMESTAMP NULL,                         
    data_reembolso TIMESTAMP NULL,                          
    data_desconto TIMESTAMP NULL,                         
    data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_pedido (id_pedido),
    INDEX idx_status (status_pagamento),
    INDEX idx_transacao (transacao_id),
    INDEX idx_comprador (id_comprador),
    INDEX idx_vendedor (id_vendedor),
    INDEX idx_data_pagamento (data_pagamento),
    INDEX idx_tipo_pagamento (tipo_pagamento),
    
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_comprador) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_vendedor) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (confirmado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
    FOREIGN KEY (autorizado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS contas_virtuais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transportadora_id INT NOT NULL,
    id_usuario INT NOT NULL,
    tipo_conta ENUM('Transportadora', 'Agricultor','Fornecedor','Administrador') NOT NULL ,
    saldo DECIMAL(12,2) DEFAULT 0,
    numero_africell VARCHAR(20) NOT NULL,
    numero_Unitel VARCHAR(20) NOT NULL,
    operadora ENUM('Unitel', 'Africell', 'MulticaixaExpress') NOT NULL,
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id),
    FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario)
);

CREATE TABLE IF NOT EXISTS movimentacoes_conta_virtual (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conta_virtual_id INT NOT NULL,
    tipo ENUM('credito', 'debito', 'saque', 'repassado') NOT NULL,
    valor DECIMAL(12,2) NOT NULL,
    descricao VARCHAR(255),
    data_movimentacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conta_virtual_id) REFERENCES contas_virtuais(id)
);
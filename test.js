const path = require('path');
const fs = require('fs');
const moderador = require('./index.js');

async function executarTeste() {
    console.log('Iniciando teste...');
    
    // Configura uma sensibilidade mais estrita (0.7 ao invés de 0.8)
    moderador.config({ threshold: 0.7 });
    
    // Vamos criar uma imagem falsa ou você pode passar uma real aqui
    // Exemplo real: const imagePath = './minha_foto.jpg';
    
    console.log('Para testar de verdade, troque este código para apontar para uma imagem local.');
    console.log('Exemplo:');
    console.log('  const analise = await moderador.analisarImagem(\\'./sua_imagem.jpg\\');');
    console.log('  console.log(analise);');
}

executarTeste();

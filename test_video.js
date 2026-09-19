const moderador = require('./index.js');

async function test() {
    console.log('Iniciando teste de vídeo...');
    
    // Supondo que você coloque um arquivo 'video_teste.mp4' na mesma pasta
    const videoPath = './video_teste.mp4';
    
    // Verifica se o arquivo existe para não dar erro bruto no console
    const fs = require('fs');
    if (!fs.existsSync(videoPath)) {
        console.log(`❌ Coloque um arquivo de vídeo chamado '${videoPath}' nesta pasta para testar.`);
        return;
    }

    try {
        console.log('Extraindo frames e analisando...');
        
        // Testa a chamada usando o novo Alias em Inglês
        const analise = await moderador.analyzeVideo(videoPath, { frames: 3 });
        
        console.log('\n--- Resultado Final ---');
        console.log(analise);

        if (!analise.isSafe) {
            console.log('⚠️ Cuidado! Vídeo considerado impróprio!');
        } else {
            console.log('✅ Vídeo totalmente limpo.');
        }

    } catch (e) {
        console.error('Falha no teste:', e);
    }
}

test();

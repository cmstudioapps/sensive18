const moderador = require('./index.js');
const fs = require('fs');

async function testarIdade() {
    console.log('Iniciando o teste de verificação de idade...\n');

    // TESTE 1: IMAGEM BASE64
    const fakeBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    try {
        console.log('--- TESTE 1: IMAGEM (BASE64) ---');
        const analiseBase64 = await moderador.estimarIdade(fakeBase64);
        console.log('Resultado Base64 (Imagem Vazia):', analiseBase64);

        // TESTE 2: IMAGEM REAL
        console.log('\n--- TESTE 2: IMAGEM REAL (rosto.jpg) ---');
        if (fs.existsSync('./rosto.jpg')) {
            const analise = await moderador.estimateAge('./rosto.jpg');
            if (analise.hasFaces) {
                console.log(`Detectamos ${analise.faceCount} rosto(s).`);
                console.log(`Primeiro rosto: Idade estimada ${analise.faces[0].age} anos (${analise.faces[0].gender}).`);
            } else {
                console.log('Nenhum rosto encontrado na imagem.');
            }
        } else {
            console.log('Para testar de verdade, crie um arquivo chamado "rosto.jpg" nesta pasta.');
        }

        // TESTE 3: VÍDEO
        console.log('\n--- TESTE 3: VÍDEO REAL (rosto_video.mp4) ---');
        if (fs.existsSync('./rosto_video.mp4')) {
            console.log('Extraindo frames e procurando pessoas...');
            const analiseVid = await moderador.estimateAgeVideo('./rosto_video.mp4', { frames: 3 });
            
            if (analiseVid.hasFaces) {
                console.log(`Pessoas totais encontradas nos frames: ${analiseVid.faceCountTotal}`);
                console.log(`Pessoas ÚNICAS no vídeo todo: ${analiseVid.uniquePeopleCount} 🏆`);
                console.log('Detalhes das pessoas encontradas:', analiseVid.faces);
            } else {
                console.log('Ninguém detectado no vídeo.');
            }
        } else {
            console.log('Para testar rastreamento de pessoas em vídeo, coloque um arquivo "rosto_video.mp4" nesta pasta.');
        }

    } catch (e) {
        console.error('Falha no teste:', e);
    }
}

testarIdade();

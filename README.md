# Sensive18

Um wrapper open-source extremamente simples, rápido e direto ao ponto para **detecção de conteúdo adulto (NSFW)**, nudez, gore, e **estimativa de idade facial** em imagens e vídeos utilizando inteligência artificial diretamente no Node.js (via `@tensorflow/tfjs-node`).

O Sensive18 esconde toda a complexidade do machine learning (como gerenciamento de tensores 3D, limpeza de memória e carregamento de modelos) e expõe apenas uma API limpa.

> Todas as funções possuem **aliases em inglês** (`analyzeImage`, `analyzeVideo`, `estimateAge`) para facilitar times internacionais.

---

## 📦 Instalação

```bash
npm install sensive18
```

---

## ⚙️ Configuração

A biblioteca utiliza configurações globais para ditar a rigidez da moderação de NSFW.

```javascript
const moderador = require('sensive18');

// Configura o rigor do bloqueio (threshold).
// Varia de 0.0 (bloqueia qualquer coisa suspeita) a 1.0 (muito liberal).
// O padrão é 0.8.
moderador.config({ threshold: 0.8 });
```

---

## 📷 Moderação de Imagem (NSFW)

Analisa uma imagem para descobrir se ela contém conteúdo explícito, pornográfico ou sensível. Aceita inteligentemente o caminho de um arquivo (`String`), um `Buffer` nativo do Node.js, ou uma string em `Base64`.

### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function validarUpload(req) {
    try {
        // Pode ser um arquivo local...
        const analise = await moderador.analisarImagem('./uploads/foto.jpg');
        
        // Pode ser um Buffer do multer...
        // const analise = await moderador.analyzeImage(req.file.buffer);

        // Pode ser Base64 vindo do front-end...
        // const analise = await moderador.analyzeImage('data:image/jpeg;base64,...');

        if (!analise.isSafe) {
            console.log(`Foto bloqueada! Nível de nudez: ${analise.explicitScore}`);
        } else {
            console.log(`Foto limpa e segura.`);
        }
    } catch (err) {
        console.error('Erro na análise', err);
    }
}
```

### O que essa função retorna?
O retorno é sempre uma `Promise` que resolve para um objeto JSON exato:

```json
{
  "isSafe": false,
  "explicitScore": 0.9542,
  "topCategory": "Porn",
  "rawPredictions": [
    { "className": "Porn", "probability": 0.9542 },
    { "className": "Hentai", "probability": 0.0003 },
    { "className": "Sexy", "probability": 0.0231 },
    { "className": "Neutral", "probability": 0.0101 },
    { "className": "Drawing", "probability": 0.0123 }
  ]
}
```
- **`isSafe` (Boolean):** Seu melhor amigo. Já cruza os dados com o `threshold` que você configurou e te diz "sim ou não" direto ao ponto.
- **`explicitScore` (Number):** A soma das probabilidades das categorias pesadas (`Porn` + `Hentai`). De 0.0 a 1.0.
- **`topCategory` (String):** A classe principal detectada. Pode ser `Porn`, `Hentai`, `Sexy`, `Neutral` ou `Drawing`.
- **`rawPredictions` (Array):** Os dados matemáticos puros vindos diretamente da rede neural caso queira fazer um cruzamento complexo.

---

## 🎬 Moderação de Vídeo (NSFW)

Analisa um arquivo de vídeo de forma silenciosa extraindo e escaneando "keyframes" usando o ffmpeg embutido.

### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function checarVideo() {
    // Opções: { frames: X }. Define quantas partes do vídeo checar (ex: 3 extrai no início, meio e fim).
    // O input para vídeos DEVE ser obrigatoriamente um caminho local (String).
    const analise = await moderador.analisarVideo('./video_usuario.mp4', { frames: 3 });
    // Alias: moderador.analyzeVideo()

    if (!analise.isSafe) {
        console.log(`Bloqueado! Encontrada categoria pesada: ${analise.topCategory}`);
    }
}
```

### O que essa função retorna?
```json
{
  "isSafe": false,
  "explicitScore": 0.8710,
  "topCategory": "Hentai",
  "rawPredictions": [ ... ],
  "details": "Análise baseada no frame mais explícito extraído."
}
```
*Atenção: A função devolve o JSON exatamente no mesmo padrão de imagens para unificar sua lógica de backend. Os scores retornados correspondem ao pior frame (o frame mais "sujo") encontrado durante o escaneamento do vídeo.*

---

### 3. Estimativa de Idade e Rosto (Face API)

Localiza um ou mais rostos na foto e detecta matematicamente a provável idade e o gênero. Útil para processos de verificação de conta (KYC) e proteção para menores.

#### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function kyc(fotoDocumento) {
    // Aceita File Path, Buffer ou Base64
    // Novo: Você pode passar a opção `underAgeCheck` com a idade alvo.
    const rosto = await moderador.estimarIdade(fotoDocumento, { underAgeCheck: 18 });
    // Alias: moderador.estimateAge()

    if (!rosto.hasFaces) {
        return "Foto recusada: Nenhum rosto humano detectado na imagem.";
    }

    console.log(`Detectados ${rosto.faceCount} rosto(s).`);
    
    // Varrendo os rostos e imprimindo detalhes matemáticos
    rosto.faces.forEach((face, index) => {
        console.log(`Pessoa ${index + 1}: ${face.age} anos, gênero ${face.gender}`);
        if (face.isUnderAge) {
            console.log(`Certeza de ser menor de idade: ${(face.underAgeProbability * 100).toFixed(1)}%`);
        }
    });
}
```

#### O que essa função retorna?
```json
{
  "hasFaces": true,
  "faceCount": 1,
  "faces": [
    { 
      "age": 14, 
      "gender": "female", 
      "genderScore": 0.985, 
      "box": [120, 250, 60, 60],
      "isUnderAge": true,
      "underAgeProbability": 0.9608
    }
  ]
}
```
- **`isUnderAge` (Boolean):** Flag opcional presente se você informar o `underAgeCheck`.
- **`underAgeProbability` (Number):** Uma curva de probabilidade sigmoide (logística) exata variando de 0 a 1 que calcula a distância entre a idade real detectada e o seu limite de verificação. Ex: Se a IA detectar alguém com 12 anos e seu limite é 18, a probabilidade da pessoa de fato ser uma criança será de 99,1%. Se a IA detectar alguém de 17 anos (muito próximo a 18), a probabilidade cai para ~70%. Isso evita falsos positivos drásticos!

---

### 4. Estimativa de Idade em Vídeos (Face API para Vídeos)

Da mesma forma que o moderador de NSFW para vídeos, você pode mandar a biblioteca escanear o vídeo inteiro em busca de rostos. A inteligência artificial embarcada consegue, usando uma avançada função matemática de "Cosine Similarity", identificar e agrupar rostos idênticos entre os frames extraídos! Isso significa que ela retorna **quantas pessoas diferentes** apareceram durante o vídeo inteiro, ignorando clones de uma mesma pessoa em diferentes cenas.

#### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function validarIdentidadesNoVideo() {
    // Opções: { frames: X }. Define a quantidade de frames a serem escaneados.
    const analise = await moderador.estimarIdadeVideo('./apresentacao.mp4', { frames: 5 });
    // Alias: moderador.estimateAgeVideo()

    if (analise.hasFaces) {
        console.log(`Detectamos ${analise.uniquePeopleCount} pessoas diferentes no vídeo!`);
        console.log(`Detalhe das idades de todas as faces rastreadas no vídeo:`, analise.faces);
    }
}
```

#### O que essa função retorna?
```json
{
  "hasFaces": true,
  "faceCountTotal": 8,
  "uniquePeopleCount": 2,
  "faces": [
    { "age": 25, "gender": "male", "genderScore": 0.985, "box": [120, 250, 60, 60] },
    { "age": 28, "gender": "female", "genderScore": 0.92, "box": [400, 100, 50, 50] }
  ]
}
```
- **`faceCountTotal` (Number):** A soma total de todos os rostos identificados varrendo todos os frames (pode conter pessoas repetidas).
- **`uniquePeopleCount` (Number):** A contagem mágica de identidades **únicas** no vídeo, obtida comparando as assinaturas faciais neurais de cada rosto.

---

### 5. Moderação de Textos e OCR em Imagens (Com Inteligência de Contexto)

O Sensive18 possui uma **arquitetura híbrida de moderação de texto**, o que significa que ele roda super rápido de forma offline, mas pode se tornar incrivelmente inteligente se você der uma chave de API para ele.

#### 1. Modo Offline Padrão (Extrema Velocidade)
Se você não configurar nada, ele rodará offline usando nossos dicionários embarcados com mais de **2800 palavras** nativas obscenas em Inglês e Português do Brasil em 0 milissegundos.

#### 2. Modo IA de Contexto Offline (Pipeline Tradução + Toxicity)
Se você quer moderar **ameaças reais e ironias**, mas seu servidor **não possui internet** ou sua empresa não permite uso de APIs externas, a Sensive18 possui um motor brutal 100% offline. Ele baixa o tradutor da Hugging Face, traduz o português em tempo real e joga pro motor americano `@tensorflow-models/toxicity`.
```javascript
moderador.config({ 
    useLocalToxicity: true, // Ativa o cérebro offline avançado
    keepModelsInMemory: false // Lança o Garbage Collector após o uso para salvar memória RAM
});
```
*Aviso:* O modo local exige processamento. Com `keepModelsInMemory: false`, a IA de texto é carregada na RAM e completamente destruída após julgar a frase (Zero RAM state no repouso). Se você tem bastante RAM e quer respostas instantâneas, mude para `true`!

#### 3. Modo IA de Contexto Online (Google Perspective)
Para a análise em tempo real mais poderosa do planeta com peso 0 no seu servidor, nós integramos a biblioteca nativamente com a **Perspective API** (do Google). Basta injetar a chave que o sistema prioriza ela:
```javascript
moderador.config({ 
    perspectiveApiKey: 'SUA_API_KEY_AQUI',
    perspectiveThreshold: 0.75 
});
```

#### Exemplo de Código (Chat e Textos)
*(Nota: A partir da versão 1.5, a função analisarTexto passa a ser assíncrona)*
```javascript
async function moderarChat(mensagemUsuario) {
    // Se a API Key não foi passada, ou se a internet cair, ele roda offline silenciosamente!
    const analise = await moderador.analisarTexto(mensagemUsuario);
    // Alias: moderador.analyzeText()

    if (!analise.isSafe) {
        console.log(`Mensagem bloqueada! Fonte da decisão: ${analise.source}`);
        return analise.censoredText;
    }
    return mensagemUsuario;
}
```

#### O que essa função retorna no Modo Google?
```json
{
  "isSafe": false,
  "badWordsFound": ["[toxicidade-detectada-por-contexto]"],
  "censoredText": "[MENSAGEM RETIDA PELA MODERAÇÃO DE CONTEXTO]",
  "toxicityScore": 0.89,
  "threatScore": 0.95,
  "insultScore": 0.82,
  "profanityScore": 0.12,
  "source": "perspective-api"
}
```

#### Extração de Texto em Imagens (Memes/Prints)
Se o usuário enviar um meme contendo xingamentos, a biblioteca conta com OCR integrado para ler e enviar para moderação!
```javascript
async function checarMeme(fotoUpload) {
    const analise = await moderador.analisarTextoDeImagem(fotoUpload);
    // Alias: moderador.analyzeImageText()

    if (!analise.isSafe) {
        console.log(`O que a IA conseguiu ler da imagem: "${analise.extractedText}"`);
    }
}
```

#### Funções Dinâmicas (Controle Total Offline)
Caso você use o modo offline (ou o fallback seja ativado), você pode inserir regras em tempo real:
```javascript
moderador.adicionarPalavraProibida('bananada');
moderador.removerPalavraProibida('bobão');
```

---

### 6. Transcrição e Moderação de Áudio e Vídeo (Whisper AI Offline)

A Sensive18 também é capaz de **"ouvir"** arquivos de vídeo ou áudio e julgar se as pessoas estão xingando, fazendo ameaças (com o Google Perspective habilitado) ou falando obscenidades! 

Isso é feito embutindo uma versão super otimizada do modelo **Whisper (da OpenAI)** rodando 100% de forma local no seu servidor, sem APIs pagas!

*(Aviso: Na primeira vez que a função rodar, ela baixará automaticamente os pesos do modelo local `whisper-tiny` de aprox. 75MB).*

#### Exemplo de Código (Speech-to-Text em Moderação)
```javascript
async function analisarVozDoVideo(arquivoPath) {
    // A inteligência extrairá o áudio do vídeo/áudio com FFmpeg e passará pro Whisper
    const analiseVoz = await moderador.analisarAudio('./podcast.mp4');
    // Alias: moderador.analyzeAudioText() ou moderador.analyzeVideoText()

    if (!analiseVoz.isSafe) {
        console.log(`Palavrões falados no áudio: ${analiseVoz.badWordsFound.join(', ')}`);
    }
    
    // Você também pode usar a biblioteca puramente como um Transcritor!
    console.log(`Texto extraído pela IA: "${analiseVoz.transcription}"`);
}
```

#### O que essa função retorna?
O retorno cruza perfeitamente com a Moderação de Texto.
```json
{
  "isSafe": false,
  "transcription": "Seu otário, eu vou acabar com você!",
  "badWordsFound": ["otário"],
  "censoredText": "Seu ******, eu vou acabar com você!",
  "source": "offline-dictionary" 
}
```

---

### 7. Classificação e Natureza Visual de Imagens (CLIP AI Offline)

A Sensive18 possui um recurso avançado para identificar a natureza visual de imagens utilizando IA local (modelo CLIP). Ele classifica se a imagem é uma fotografia real, desenho, anime, arte digital, render 3D ou se há indícios de ter sido gerada por inteligência artificial.

#### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function checarNaturezaDaImagem(fotoPath) {
    // Aceita File Path, Buffer ou Base64
    const analise = await moderador.verificarImagem(fotoPath);
    // Alias em inglês: moderador.verifyComposeImage(fotoPath);

    if (analise.success) {
        console.log(`Tipo principal detectado: ${analise.type}`);
        console.log(`Confiança: ${analise.confidence}`);
        console.log(`Scores detalhados:`, analise.results);
    }
}
```

#### O que essa função retorna?
```json
{
  "success": true,
  "type": "realPhoto",
  "confidence": 0.8942,
  "results": {
    "realPhoto": 0.8942,
    "drawingOrIllustration": 0.0512,
    "digitalArt": 0.0301,
    "threeDRender": 0.0120,
    "animeOrManga": 0.0015,
    "aiGeneratedImage": 0.0110
  },
  "description": "A imagem foi classificada como realPhoto com 89.42% de similaridade."
}
```

---

1. **Anti Memory-Leaks (Vazamento de Memória):** Diferente de implementações ingênuas de IA no Node.js, a biblioteca limpa religiosamente os tensores decodificados do C++ (`imageTensor.dispose()`) após cada processamento.
2. **Offline Local Models (Whisper e NSFW):** As redes neurais são baixadas localmente. Em nenhum momento a Sensive18 envia arquivos de áudio/imagem dos seus usuários para fora ou precisa de conexão externa para rodar o Whisper ou o NSFW. Funciona 100% offline.
3. **FFMPEG Inteligente e Estático:** A análise de vídeos e áudios não falha caso o servidor do usuário não tenha ffmpeg instalado no Ubuntu/Windows. A Sensive18 embala seu próprio executável (`ffmpeg-static`), garantindo extração de WAV em segundos.

## ⚖️ Licença
Sensive18 é livre e open-source licenciado através da **MIT License**.

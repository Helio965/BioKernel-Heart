# Arquitetura

Este documento registra a análise feita antes de programar, as decisões
técnicas e como cada parte do sistema funciona. O README explica o uso; aqui
está o "porquê".

## 1. Ponto de partida: o projeto Black-Hole

O [Black-Hole](https://github.com/Helio965/Black-Hole) foi lido por inteiro
(`README.md`, `index.html`, `css/style.css`, todos os módulos de `js/`,
`iniciar.bat`, `tools/servidor.ps1`). O que foi reaproveitado:

| Black-Hole | Human Heart | Como |
| --- | --- | --- |
| Three.js r170 via `importmap` do jsDelivr, sem npm/bundler | igual | mesma versão e mesma forma de carregar |
| `WebGLRenderer({ powerPreference: 'high-performance' })`, sem MSAA no canvas | `js/renderer.js` | igual; o anti-aliasing fica no render target multisample do composer |
| `EffectComposer` → `UnrealBloomPass` → `OutputPass` (HDR half-float) | `js/renderer.js` | igual, com MSAA configurável por perfil |
| `gpu.js` (`WEBGL_debug_renderer_info`, classificação dedicada/integrada/CPU) | `js/gpu.js` | copiado sem alterações |
| `quality.js` (perfil por GPU + governador de FPS, `?quality=`) | `js/quality.js` | mesmos perfis ultra/high/medium/low e mesmo governador, com os passos pedidos (efeitos → resolução → partículas → sombras → pós → LOD) |
| `ui.js` (painel com `[data-setting]`, status GPU/FPS, cartão "use a placa dedicada", dica) | `js/ui.js` | mesma abordagem (marcação no HTML, módulo só liga os eventos), ampliada |
| OrbitControls com amortecimento, reset animado em coordenadas esféricas | `js/main.js` (`createCameraMotion`) | mesmo reset suave, mais o "focar estrutura" |
| Loop com `clock.getDelta()` limitado a 0,1 s, FPS médio a cada 0,5 s | `js/main.js` | igual |
| `iniciar.bat` + `tools/servidor.ps1` (HttpListener, Chrome/Edge com `--force-high-performance-gpu`, preferência "Alto desempenho" do Windows) | igual | adaptado: nome, pasta de estado e tipos MIME de `.glb`/`.json`/`.wasm` |
| `.gitattributes` com CRLF para `.bat`/`.ps1` (necessário no ZIP do GitHub) | igual | |
| `random.js` (mulberry32) | `js/random.js` | copiado |
| shaders num único módulo `shaders.js`, simplex noise da Ashima | `js/shaders.js` | mesma organização e mesmo ruído |

## 2. Os vídeos de referência

Os dois vídeos mostram corações simbólicos feitos de partículas em Python:
um vermelho, em nuvem de pontos 3D, girando continuamente em torno do eixo
vertical com sombreamento por profundidade; outro rosa, em que filamentos
luminosos se juntam até formar o coração, que então pulsa e se desfaz. O que
foi aproveitado é o comportamento, não o objeto:

- objeto centralizado sobre fundo escuro, sempre "vivo" (batendo);
- rotação automática opcional (painel → *Rotação automática*);
- abertura em que partículas convergem para a superfície do coração anatômico,
  que então aparece e começa a bater (`js/intro.js`);
- brilho aditivo (bloom) e profundidade.

O objeto principal é o modelo anatômico; as partículas só aparecem na abertura,
no fluxo sanguíneo e no fluxo coronariano.

## 3. Modelo anatômico

Foram avaliados:

- **HuBMAP / Human Reference Atlas, 3D Reference Organ – Heart** (NIH, CC BY 4.0):
  câmaras, septo interventricular, valvas e músculos papilares, mas **sem
  coronárias, veias cardíacas e grandes vasos**.
- **BodyParts3D** (DBCLS, Japão; hoje CC BY 4.0): modelo de corpo inteiro feito
  a partir de RM de um voluntário, refinado por ilustradores médicos, com cada
  peça ligada a um conceito da FMA. Para o coração tem, **no mesmo sistema de
  coordenadas**: paredes, as 4 cavidades, todas as cúspides/folhetos (com as
  cordas tendíneas modeladas), 5 músculos papilares, a árvore coronariana ramo
  a ramo (tronco da coronária esquerda, DA, diagonais, septais, circunflexa,
  coronária direita, cone, marginais, ventriculares, DP), as veias cardíacas
  (seio coronário, magna, interventricular anterior, média, parva, marginais,
  posterior do VE, anteriores) e os grandes vasos.

Foi escolhido o BodyParts3D (detalhes e licença em `MODEL_LICENSE.md`).

### Pipeline (`tools/model-build/`)

Roda uma vez, offline; o resultado fica em `assets/models/` e o app não precisa
de npm.

1. lê do ZIP oficial só os ~150 OBJ listados em `js/anatomy.js` (catálogo único
   usado pelo app e pelo pipeline);
2. recorta os vasos longos com planos (corte limpo, triângulos divididos na
   interseção), solda vértices e aplica suavização de Taubin (remove o
   escalonamento da segmentação sem encolher a malha);
3. converte para o referencial do app: centímetros, +Y superior, +Z anterior,
   +X esquerda do paciente, origem no centro das 4 cavidades;
4. **segmenta** a malha "Wall of ventricle" em parede do VE, parede do VD e
   septo interventricular, e as paredes atriais em átrios e septo interatrial,
   pela distância a cada cavidade (a superfície das cavidades coincide com o
   endocárdio no BodyParts3D: 7 300 vértices a < 0,5 mm);
5. dados por vértice (`_TISSUE`, 4 bytes): endocárdio, gordura epicárdica
   (nos sulcos, ao redor dos vasos), tempo de ativação elétrica e oclusão
   ambiente pré-calculada (20 raios por vértice, three-mesh-bvh);
6. **valvas**: o anel AV é encontrado em coordenadas polares (ponto mais atrial
   e periférico de cada setor), a distância geodésica anel→ancoragem das cordas
   separa folheto e cordas tendíneas; a abertura é uma rotação em torno da
   tangente local do anel (o folheto dobra ao longo de toda a inserção e fica
   paralelo ao fluxo), com as cordas presas aos músculos papilares; as cúspides
   semilunares dobram-se contra a parede do seio;
7. **blend shapes** (morph targets) de cada malha: sístole ventricular, sístole
   atrial, valva meio aberta, valva aberta e distensão arterial;
8. nível de detalhe com subdivisão de Loop (mais nos vasos grossos), GLB
   quantizado (`KHR_mesh_quantization`) e comprimido (`EXT_meshopt_compression`,
   decodificado pelo decodificador oficial do Three.js);
9. `heart-data.json`: referenciais das câmaras, valvas, linhas centrais dos
   vasos (traçadas por seções transversais), árvores coronarianas, circuitos do
   fluxo sanguíneo, sistema de condução, âncoras dos rótulos.

## 4. Batimento (`js/heartbeat.js`, `js/cardiacField.js`)

### Ciclo cardíaco

O tempo 0 é o início do QRS e o ciclo dura `60 / BPM` segundos. As durações
vêm de regressões medidas em pessoas (Weissler et al.):

```
PEP  = 131 − 0,4·FC  ms      (contração isovolumétrica, até a abertura aórtica)
QS2  = 546 − 2,1·FC  ms      (fim da ejeção, fechamento aórtico = B2)
LVET = QS2 − PEP             (ejeção)
IVRT ≈ 70–90 ms              (relaxamento isovolumétrico)
PR   = 120–200 ms            (a onda P precede o próximo QRS)
sístole atrial ≈ 100 ms, ~25 ms após o início da onda P
```

Com isso a sístole encurta pouco e a diástole muito quando a frequência sobe,
como na fisiologia. As fases (enchimento rápido, diástase, sístole atrial,
contração isovolumétrica, ejeção, relaxamento isovolumétrico) produzem:

- volume ventricular (0 = sistólico final, 1 = diastólico final): ~75% do
  enchimento é passivo e o resto vem do "chute" atrial;
- contração atrial;
- abertura de cada valva (a tricúspide fecha um pouco depois da mitral — M1/T1 —
  e a pulmonar depois da aórtica — A2/P2);
- fluxos (retorno venoso com ondas S e D, ejeção, fluxo coronariano esquerdo
  predominantemente diastólico, retorno venoso coronariano sistólico);
- relógios elétricos (ms desde a onda P e relativos ao QRS) e um ECG simples.

A mudança de BPM é suavizada (constante de ~0,7 s) e a fase é integrada, então
o coração nunca "pula".

### Deformação

Não é um `scale()`. `js/cardiacField.js` é um campo de deslocamento contínuo:

- **encurtamento longitudinal**: o plano atrioventricular desce em direção ao
  ápice (o ápice quase não se move);
- **contração radial** de cada ventrículo em torno do seu eixo longo, com a
  parede espessando pela conservação do volume da parede
  (`ρ'² = α²R² + (ρ² − R²)/λ`); o VD contrai contra o septo;
- **torção**: ápice anti-horário e base horário, vistos do ápice;
- **contração atrial** concêntrica, também conservando volume;
- a base fibrosa (anéis e raízes arteriais) acompanha o plano AV mas não se
  contrai com a cavidade; as valvas se movem com o anel.

O pipeline "assa" esse campo nos blend shapes; o navegador só mistura os
pesos (barato na GPU). O mesmo módulo é usado em tempo real para mover o que
não faz parte do modelo (partículas do fluxo, rótulos, sistema de condução),
então tudo permanece encaixado.

## 5. Visualização interna por aproximação (`js/cameraReveal.js`)

Nada é cortado. A distância da câmera ao alvo define um nível contínuo de 0 a 4:

| nível | distância | o que acontece |
| --- | --- | --- |
| 0 Exterior | > 34 cm | anatomia externa completa |
| 1 Vasos da superfície | ~28 cm | coronárias e veias ganham brilho, a gordura afina |
| 2 Miocárdio translúcido | ~21 cm | o epicárdio some, o miocárdio começa a abrir |
| 3 Estruturas profundas | ~15 cm | miocárdio e grandes vasos transparentes; câmaras, valvas, septos, papilares |
| 4 Interior | < 10 cm | só o que está em volta da câmera |

Cada camada fica transparente **só dentro de uma janela suave em volta da linha
de visão, à frente do alvo** (no fragment shader), e mantém um contorno de
Fresnel. As partes que continuam opacas escrevem profundidade num pré-passe
(`createDepthPrepassMaterial`), então o que está atrás delas continua
escondido, enquanto a janela transparente não escreve. O `zoomToCursor` do
OrbitControls leva a câmera para onde o ponteiro aponta; clique duplo leva o
alvo até a estrutura.

## 6. Módulos

```
js/main.js          inicialização, loop, qualidade, câmera
js/renderer.js      renderer, iluminação PBR (ambiente, luz principal com sombra,
                    contraluz, luz de área, hemisfério), pós-processamento
js/heart.js         carrega o modelo, materiais, camadas, seleção, isolamento,
                    blend shapes, níveis de detalhe, proxies de seleção
js/materials.js     famílias de tecido (PBR) e injeção dos shaders
js/shaders.js       GLSL: relevo, AO, SSS, revelação, onda elétrica, partículas
js/anatomy.js       catálogo anatômico (nomes, FMA, descrições, camadas)
js/cardiacField.js  campo de deformação cardíaca (compartilhado com o pipeline)
js/heartbeat.js     ciclo cardíaco, BPM, ECG
js/valves.js        valva de cada estrutura e pesos dos blend shapes
js/cameraReveal.js  revelação progressiva
js/vessels.js       trajetos sobre as linhas centrais
js/bloodFlow.js     fluxo sanguíneo (circulações pulmonar e sistêmica)
js/coronary.js      fluxo coronariano
js/conduction.js    sistema de condução
js/interaction.js   Raycaster: hover, seleção, foco
js/labels.js        rótulos 3D com desobstrução
js/audio.js         bulhas B1/B2 sintetizadas
js/intro.js         animação de abertura
js/ui.js            HUD, painel, cartão de informações
js/gpu.js, js/quality.js, js/random.js   (Black-Hole)
```

## 7. Desempenho

- Um material por estrutura (uniforms próprios), mas todos compilam para poucos
  programas (`customProgramCacheKey`); as variantes opaca e translúcida são
  pré-compiladas (`compileAsync`) para o primeiro zoom não travar.
- Deformação via blend shapes (textura de morph do WebGL 2), sem cálculo por
  vértice na CPU.
- Modo translúcido só quando algo está transparente; sombras só na vista externa.
- Seleção com Raycaster sobre proxies de baixa resolução que compartilham os
  pesos dos blend shapes, limitada a ~20 Hz.
- Perfis ultra/high/medium/low (resolução, MSAA, sombras, bloom, relevo
  procedural, lobos extras do material, partículas, nível de detalhe) e
  governador de FPS que reduz nessa ordem, sem nunca remover anatomia.

# Modelo 3D: origem e licença

## Resumo

| Item | Valor |
| --- | --- |
| Modelo | **BodyParts3D**, versão 4.0 (arquivo `isa_BP3D_4.0_obj_99.zip`, árvore IS-A, redução de polígonos 99%) |
| Autor / instituição | **Database Center for Life Science (DBCLS)**, Research Organization of Information and Systems, Japão; distribuído pelo **LSDB Archive** do NBDC / Japan Science and Technology Agency |
| Publicação científica | Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Research 37 (Database issue): D782–D785, 2009. doi:[10.1093/nar/gkn613](https://doi.org/10.1093/nar/gkn613) |
| Origem dos dados | modelo de corpo inteiro construído sobre o modelo voxel "TARO", feito a partir de **imagens de ressonância magnética (intervalo de 2 mm) de um voluntário humano do sexo masculino**; segmentações adicionais e detalhes refinados por ilustradores médicos com base em livros, atlas e modelos anatômicos (artigo acima) |
| Nomes das estruturas | conceitos da **FMA (Foundational Model of Anatomy)**; cada arquivo traz o ID FMA no cabeçalho |
| Download | <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html> |
| Página de licença | <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html> |
| Licença do banco (atual) | **Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)** — página atualizada em 27/02/2025 |
| Licença citada nos cabeçalhos dos OBJ (2011) | Creative Commons Atribuição–CompartilhaIgual 2.1 Japão (CC BY-SA 2.1 JP) |
| Licença dos arquivos derivados neste repositório | **CC BY-SA 4.0** (ver "Por que CC BY-SA 4.0" abaixo) |
| Uso permitido? | Sim: acessar, redistribuir e criar e distribuir obras derivadas, com atribuição |
| Redistribuição permitida? | Sim |

## Atribuição exigida

Texto pedido pela página de licença do BodyParts3D, reproduzido aqui, no
README e no `LICENSE`:

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

## Verificação feita

1. O modelo foi encontrado a partir da busca por modelos cardíacos científicos
   (NIH 3D / Human Reference Atlas e BodyParts3D, ver `ARCHITECTURE.md`).
2. Autor e instituição: DBCLS (artigo na Nucleic Acids Research, 2009).
3. Licença: a página oficial de licença do banco (atualizada em 2025-02-27)
   declara CC BY 4.0 e lista explicitamente que é permitido acessar e obter os
   dados, **redistribuir** parte ou todo o banco e **criar e distribuir obras
   derivadas**, desde que se faça a atribuição indicada.
4. Os cabeçalhos dos arquivos OBJ (gerados em 2011) ainda citam a licença
   anterior, CC BY-SA 2.1 Japão.
5. A origem ficou registrada neste arquivo, no README, no `LICENSE` e dentro
   do próprio GLB (campo `asset.generator`) e do `heart-data.json` (`source`).

### Por que CC BY-SA 4.0 para os arquivos derivados

Para respeitar as duas licenças ao mesmo tempo:

- CC BY 4.0 (licença atual) permite distribuir obras derivadas sob qualquer
  licença, com atribuição, inclusive CC BY-SA 4.0;
- CC BY-SA 2.1 JP (licença citada nos arquivos antigos) exige que adaptações
  sejam distribuídas sob a mesma licença ou uma versão posterior com os mesmos
  elementos (BY-SA) — CC BY-SA 4.0 atende.

Portanto `assets/models/heart-base.glb`, `assets/models/heart-detail.glb` e
`assets/models/heart-data.json` são distribuídos sob **CC BY-SA 4.0**, com a
atribuição acima. O código do projeto continua sob a licença MIT (`LICENSE`).

## Arquivos usados

147 arquivos OBJ do BodyParts3D (lista completa em `js/anatomy.js`, campo
`sources` de cada estrutura), entre eles:

- paredes: `FJ2428` (Wall of ventricle), `FJ2438` (Wall of left atrium), `FJ2439` (Wall of right atrium);
- cavidades: `FJ2422`–`FJ2425`;
- valvas: `FJ2417`, `FJ2420`, `FJ2421`, `FJ2426`, `FJ2427`, `FJ2431`–`FJ2436`;
- músculos papilares: `FJ2418`, `FJ2419`, `FJ2429`, `FJ2430`, `FJ2437`;
- artérias coronárias: `FJ2631`–`FJ2654`, `FJ2667`–`FJ2677`, `FJ2692`–`FJ2700`, `FJ2714`–`FJ2723`, `FJ2732`–`FJ2737`;
- veias cardíacas: `FJ2655`–`FJ2665`, `FJ2678`–`FJ2691`, `FJ2701`–`FJ2713`, `FJ2724`–`FJ2731`;
- grandes vasos: `FJ3413`, `FJ3411`, `FJ1931`, `FJ3417`, `FJ3483`, `FJ3479`, `FJ2966`, `FJ3019`, `FJ2924`, `FJ2925`, `FJ2933`, `FJ3020`, `FJ2944`, `FJ2950`, `FJ2955`, `FJ3040`, `FJ3645`, `FJ3441`, `FJ3482`, `FJ3583`.

## Modificações feitas (obra derivada)

Todas feitas pelo pipeline `tools/model-build/build.mjs` (reproduzível):

- conversão de milímetros para centímetros e para o referencial do app
  (Y superior, Z anterior), com origem no centro das quatro cavidades;
- recorte dos vasos longos por planos (aorta descendente, veia cava inferior,
  ramos do arco, artérias pulmonares, veias braquiocefálicas);
- soldagem de vértices e suavização de Taubin; subdivisão de Loop no nível de
  detalhe;
- junção de segmentos de vaso que no BodyParts3D são peças fechadas
  sobrepostas (aorta ascendente → arco → descendente; veia braquiocefálica
  direita → veia cava superior): remoção das tampas, ajuste suave de centro e
  calibre e um trecho de tubo interpolado entre as bordas;
- segmentação de "Wall of ventricle" em parede do VE, parede do VD e septo
  interventricular, e das paredes atriais em átrios e septo interatrial (pela
  proximidade das cavidades);
- separação das cordas tendíneas das malhas dos folhetos atrioventriculares;
- película do epicárdio gerada sobre a superfície externa das paredes, com
  gordura nos sulcos;
- atributos por vértice (endocárdio, gordura, tempo de ativação, oclusão
  ambiente) e blend shapes (sístole ventricular e atrial, abertura das valvas,
  distensão arterial);
- linhas centrais dos vasos, trajetos de fluxo, sistema de condução esquemático
  e âncoras de rótulos (em `heart-data.json`).

Estruturas que **não** existem no BodyParts3D e foram geradas de forma
esquemática (e identificadas como tal no cartão de informações e no
`ANATOMY_SOURCES.md`): o sistema de condução (nó SA, vias internodais e feixe
de Bachmann, nó AV, feixe de His, ramos e rede de Purkinje) e a película do
epicárdio com a distribuição da gordura.

## Outros componentes de terceiros

| Componente | Licença | Uso |
| --- | --- | --- |
| [Three.js](https://threejs.org/) r170 (e addons oficiais: OrbitControls, GLTFLoader, meshopt decoder, EffectComposer, UnrealBloomPass, OutputPass, RoomEnvironment, RectAreaLightUniformsLib, BufferGeometryUtils) | MIT | carregado do jsDelivr em tempo de execução |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.8.3 | MIT | seleção por raio acelerada (carregado do jsDelivr) |
| [webgl-noise](https://github.com/ashima/webgl-noise) (Ashima Arts / Stefan Gustavson) | MIT | ruído simplex nos shaders |
| Pipeline (somente offline): [glTF-Transform](https://gltf-transform.dev/), [meshoptimizer](https://github.com/zeux/meshoptimizer), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | geração do GLB, compressão, raios da oclusão ambiente |

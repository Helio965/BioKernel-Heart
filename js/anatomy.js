/**
 * Anatomical catalogue: every structure the application can show, select,
 * label or isolate.
 *
 * This file is pure data (no Three.js import) because it is shared by the
 * browser application and by the offline model pipeline
 * (tools/model-build/build.mjs), which uses `sources` to know which
 * BodyParts3D meshes form each structure.
 *
 * Names follow the Terminologia Anatomica / FMA names used by BodyParts3D
 * (FMA IDs listed in `fma`). Descriptions were written from the references in
 * docs/ANATOMY_SOURCES.md; the numbers quoted there come from those sources.
 *
 * Fields
 *   name        Portuguese name shown in the interface
 *   nameEn      English (FMA / BodyParts3D) name
 *   type        short classification shown under the name
 *   layer       anatomy layer that toggles it (see LAYERS)
 *   detail      1 = always visible, 2 = main structures, 3 = small branches
 *               that fade in as the camera gets closer (semantic LOD)
 *   material    shading family used by js/heart.js
 *   sources     BodyParts3D element files (FJxxxx.obj) or a derived part
 *   derived     how a part that does not exist as a separate file was made
 *   description / function   texts shown in the information card
 *   priority    label priority (1 = shown first when labels compete)
 */

export const LAYERS = [
  { key: 'exterior', name: 'Exterior (epicárdio)', defaultOn: true },
  { key: 'myocardium', name: 'Miocárdio', defaultOn: true },
  { key: 'arteries', name: 'Artérias coronárias', defaultOn: true },
  { key: 'veins', name: 'Veias cardíacas', defaultOn: true },
  { key: 'greatVessels', name: 'Grandes vasos', defaultOn: true },
  { key: 'chambers', name: 'Câmaras (volume sanguíneo)', defaultOn: false },
  { key: 'valves', name: 'Válvulas e cordas tendíneas', defaultOn: true },
  { key: 'interior', name: 'Interior (revelação ao aproximar)', defaultOn: true },
  { key: 'bloodFlow', name: 'Fluxo sanguíneo', defaultOn: false },
  { key: 'coronaryFlow', name: 'Circulação coronariana', defaultOn: false },
  { key: 'conduction', name: 'Sistema elétrico', defaultOn: false },
  { key: 'labels', name: 'Rótulos', defaultOn: true },
];

const WALL = 'Parede muscular (miocárdio)';
const CAVITY = 'Câmara cardíaca · volume sanguíneo';
const AV_LEAFLET = 'Valva atrioventricular · folheto';
const SL_CUSP = 'Valva semilunar · válvula (cúspide)';
const PAPILLARY = 'Músculo papilar';
const CORONARY = 'Artéria coronária';
const CARDIAC_VEIN = 'Veia cardíaca';
const GREAT_ARTERY = 'Grande vaso · artéria';
const GREAT_VEIN = 'Grande vaso · veia';
const CONDUCTION = 'Sistema de condução';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `FJ${from + i}`);

export const STRUCTURES = {
  // -------------------------------------------------------------------------
  // Heart wall
  // -------------------------------------------------------------------------
  epicardium: {
    name: 'Epicárdio e gordura epicárdica',
    nameEn: 'Epicardium (visceral serous pericardium) and subepicardial fat',
    fma: [],
    type: 'Camada externa da parede cardíaca',
    layer: 'exterior',
    detail: 1,
    material: 'epicardium',
    derived:
      'Película gerada sobre a superfície externa das paredes do BodyParts3D. A gordura foi distribuída ' +
      'nos sulcos coronário e interventriculares, ao redor dos vasos coronários (onde ela se acumula).',
    description:
      'Lâmina visceral do pericárdio seroso, fundida à superfície do coração. Nos sulcos coronário e ' +
      'interventriculares há tecido adiposo que envolve as artérias e veias coronárias.',
    function:
      'Forma a camada mais externa da parede do coração, reduz o atrito durante os batimentos e protege os ' +
      'vasos coronários que correm nos sulcos.',
    priority: 3,
  },
  lvWall: {
    name: 'Parede do ventrículo esquerdo',
    nameEn: 'Wall of left ventricle',
    fma: ['FMA9556'],
    type: WALL,
    layer: 'myocardium',
    detail: 1,
    material: 'myocardium',
    sources: ['FJ2428'],
    derived: 'Segmentada da malha "Wall of ventricle" (FJ2428) pela proximidade com a cavidade do VE.',
    description:
      'Parede muscular do ventrículo esquerdo, muito mais espessa que a do direito. Forma o ápice e a maior ' +
      'parte da face esquerda e diafragmática do coração.',
    function:
      'Gera a pressão que ejeta o sangue oxigenado pela valva aórtica para a aorta e toda a circulação ' +
      'sistêmica, que tem resistência muito maior que a pulmonar.',
    priority: 1,
  },
  rvWall: {
    name: 'Parede do ventrículo direito',
    nameEn: 'Wall of right ventricle',
    fma: ['FMA9533'],
    type: WALL,
    layer: 'myocardium',
    detail: 1,
    material: 'myocardium',
    sources: ['FJ2428'],
    derived: 'Segmentada da malha "Wall of ventricle" (FJ2428) pela proximidade com a cavidade do VD.',
    description:
      'Parede do ventrículo direito, mais fina que a do esquerdo; forma a maior parte da face anterior ' +
      '(esternocostal). Por dentro tem trabéculas cárneas e a banda moderadora (trabécula septomarginal).',
    function:
      'Bombeia o sangue pouco oxigenado pela valva pulmonar para o tronco pulmonar e os pulmões, um circuito ' +
      'de baixa pressão.',
    priority: 1,
  },
  ivs: {
    name: 'Septo interventricular',
    nameEn: 'Interventricular septum',
    fma: [],
    type: 'Septo cardíaco',
    layer: 'myocardium',
    detail: 1,
    material: 'myocardium',
    sources: ['FJ2428'],
    derived:
      'Segmentado da malha "Wall of ventricle" (FJ2428): região da parede situada entre as cavidades dos ' +
      'dois ventrículos.',
    description:
      'Parede entre os ventrículos direito e esquerdo, bem mais espessa que o septo interatrial. É percorrida ' +
      'pelo feixe atrioventricular (de His) e pelos seus ramos direito e esquerdo.',
    function:
      'Separa o sangue das duas circulações, contrai junto com o ventrículo esquerdo e conduz o impulso ' +
      'elétrico em direção ao ápice.',
    priority: 1,
  },
  laWall: {
    name: 'Átrio esquerdo',
    nameEn: 'Wall of left atrium',
    fma: ['FMA9531'],
    type: WALL + ' · átrio',
    layer: 'myocardium',
    detail: 1,
    material: 'atrium',
    sources: ['FJ2438'],
    description:
      'Câmara superior esquerda, a mais posterior do coração, com a aurícula esquerda. Recebe as quatro ' +
      'veias pulmonares.',
    function:
      'Recebe o sangue oxigenado dos pulmões e o passa ao ventrículo esquerdo pela valva mitral. A contração ' +
      'atrial completa os últimos 20–30% do enchimento ventricular.',
    priority: 1,
  },
  raWall: {
    name: 'Átrio direito',
    nameEn: 'Wall of right atrium',
    fma: ['FMA9457'],
    type: WALL + ' · átrio',
    layer: 'myocardium',
    detail: 1,
    material: 'atrium',
    sources: ['FJ2439'],
    description:
      'Câmara superior direita, com a aurícula direita e os músculos pectíneos. Recebe as veias cavas ' +
      'superior e inferior e o seio coronário. Na sua parede ficam o nó sinoatrial e o nó atrioventricular.',
    function:
      'Recebe o sangue venoso do corpo e do próprio coração e o conduz ao ventrículo direito pela valva ' +
      'tricúspide.',
    priority: 1,
  },
  ias: {
    name: 'Septo interatrial',
    nameEn: 'Interatrial septum',
    fma: [],
    type: 'Septo cardíaco',
    layer: 'myocardium',
    detail: 2,
    material: 'atrium',
    sources: ['FJ2438', 'FJ2439'],
    derived:
      'Segmentado das paredes atriais (FJ2438/FJ2439): região que separa as cavidades dos dois átrios.',
    description:
      'Parede fina entre os átrios. Tem uma depressão oval, a fossa oval, remanescente do forame oval do ' +
      'coração fetal.',
    function: 'Separa o sangue pouco oxigenado do átrio direito do sangue oxigenado do átrio esquerdo.',
    priority: 2,
  },

  // -------------------------------------------------------------------------
  // Cavities (blood volume of each chamber)
  // -------------------------------------------------------------------------
  raCavity: {
    name: 'Cavidade do átrio direito',
    nameEn: 'Cavity of right atrium',
    fma: ['FMA11359'],
    type: CAVITY,
    layer: 'chambers',
    detail: 1,
    material: 'bloodDeoxy',
    sources: ['FJ2424'],
    description: 'Espaço interno do átrio direito, onde chegam as veias cavas e o seio coronário.',
    function: 'Acumula o sangue venoso durante a sístole ventricular e o entrega ao ventrículo direito na diástole.',
    priority: 2,
  },
  rvCavity: {
    name: 'Cavidade do ventrículo direito',
    nameEn: 'Cavity of right ventricle',
    fma: ['FMA9291'],
    type: CAVITY,
    layer: 'chambers',
    detail: 1,
    material: 'bloodDeoxy',
    sources: ['FJ2423'],
    description:
      'Espaço interno do ventrículo direito, com via de entrada (valva tricúspide) e via de saída ' +
      '(infundíbulo ou cone arterial, até a valva pulmonar).',
    function: 'Recebe sangue do átrio direito e o ejeta no tronco pulmonar.',
    priority: 2,
  },
  laCavity: {
    name: 'Cavidade do átrio esquerdo',
    nameEn: 'Cavity of left atrium',
    fma: ['FMA9465'],
    type: CAVITY,
    layer: 'chambers',
    detail: 1,
    material: 'bloodOxy',
    sources: ['FJ2425'],
    description: 'Espaço interno do átrio esquerdo, onde desembocam as veias pulmonares.',
    function: 'Recebe o sangue oxigenado e o entrega ao ventrículo esquerdo pela valva mitral.',
    priority: 2,
  },
  lvCavity: {
    name: 'Cavidade do ventrículo esquerdo',
    nameEn: 'Cavity of left ventricle',
    fma: ['FMA9466'],
    type: CAVITY,
    layer: 'chambers',
    detail: 1,
    material: 'bloodOxy',
    sources: ['FJ2422'],
    description:
      'Espaço interno do ventrículo esquerdo. No fim da diástole contém cerca de 130 mL, e cada batimento ' +
      'ejeta normalmente 70–80 mL.',
    function: 'Recebe o sangue pela valva mitral e o ejeta na aorta pela valva aórtica.',
    priority: 2,
  },

  // -------------------------------------------------------------------------
  // Valves
  // -------------------------------------------------------------------------
  mitralAnterior: {
    name: 'Valva mitral · folheto anterior',
    nameEn: 'Anterior leaflet of mitral valve',
    fma: ['FMA7242'],
    type: AV_LEAFLET + ' (esquerda)',
    layer: 'valves',
    detail: 1,
    material: 'valve',
    sources: ['FJ2420'],
    valve: { kind: 'av', side: 'left', valve: 'mitral' },
    description:
      'O maior dos dois folhetos da valva mitral (bicúspide), em continuidade fibrosa com a valva aórtica. ' +
      'Preso aos músculos papilares pelas cordas tendíneas.',
    function:
      'Fecha o orifício atrioventricular esquerdo na sístole ventricular, impedindo o refluxo para o átrio. ' +
      'O fechamento das valvas atrioventriculares produz a primeira bulha (B1, "tum").',
    priority: 1,
  },
  mitralPosterior: {
    name: 'Valva mitral · folheto posterior',
    nameEn: 'Posterior leaflet of mitral valve',
    fma: ['FMA7243'],
    type: AV_LEAFLET + ' (esquerda)',
    layer: 'valves',
    detail: 1,
    material: 'valve',
    sources: ['FJ2432'],
    valve: { kind: 'av', side: 'left', valve: 'mitral' },
    description: 'Folheto posterior da valva mitral, mais baixo e largo, preso à parte posterior do anel mitral.',
    function: 'Junto com o folheto anterior, fecha a valva mitral na sístole ventricular.',
    priority: 2,
  },
  tricuspidAnterior: {
    name: 'Valva tricúspide · folheto anterior',
    nameEn: 'Anterior leaflet of tricuspid valve',
    fma: ['FMA7238'],
    type: AV_LEAFLET + ' (direita)',
    layer: 'valves',
    detail: 1,
    material: 'valve',
    sources: ['FJ2421'],
    valve: { kind: 'av', side: 'right', valve: 'tricuspid' },
    description: 'O maior dos três folhetos da valva tricúspide, entre o átrio e o ventrículo direitos.',
    function:
      'Fecha o orifício atrioventricular direito na sístole ventricular, impedindo o refluxo para o átrio ' +
      'direito; contribui para a primeira bulha (B1).',
    priority: 1,
  },
  tricuspidPosterior: {
    name: 'Valva tricúspide · folheto posterior',
    nameEn: 'Posterior leaflet of tricuspid valve',
    fma: ['FMA7239'],
    type: AV_LEAFLET + ' (direita)',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2433'],
    valve: { kind: 'av', side: 'right', valve: 'tricuspid' },
    description: 'Folheto posterior (inferior) da valva tricúspide.',
    function: 'Participa do fechamento da valva tricúspide durante a sístole ventricular.',
    priority: 3,
  },
  tricuspidSeptal: {
    name: 'Valva tricúspide · folheto septal',
    nameEn: 'Septal leaflet of tricuspid valve',
    fma: ['FMA7240'],
    type: AV_LEAFLET + ' (direita)',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2436'],
    valve: { kind: 'av', side: 'right', valve: 'tricuspid' },
    description:
      'Folheto preso ao septo interventricular. Sua inserção forma um dos limites do triângulo de Koch, onde ' +
      'fica o nó atrioventricular.',
    function: 'Participa do fechamento da valva tricúspide durante a sístole ventricular.',
    priority: 3,
  },
  mitralChordae: {
    name: 'Cordas tendíneas da valva mitral',
    nameEn: 'Chordae tendineae of mitral valve',
    fma: [],
    type: 'Aparelho valvar · cordas tendíneas',
    layer: 'valves',
    detail: 2,
    material: 'chordae',
    derived: 'Porção das malhas dos folhetos mitrais (FJ2420/FJ2432) entre a borda livre e os músculos papilares.',
    description:
      'Cordões fibrosos que ligam a borda e a face ventricular dos folhetos mitrais aos músculos papilares ' +
      'do ventrículo esquerdo.',
    function:
      'Quando os músculos papilares se contraem, as cordas ficam tensas e impedem que os folhetos se ' +
      'everterem para o átrio (prolapso) durante a sístole.',
    priority: 2,
  },
  tricuspidChordae: {
    name: 'Cordas tendíneas da valva tricúspide',
    nameEn: 'Chordae tendineae of tricuspid valve',
    fma: [],
    type: 'Aparelho valvar · cordas tendíneas',
    layer: 'valves',
    detail: 2,
    material: 'chordae',
    derived: 'Porção das malhas dos folhetos tricúspides (FJ2421/FJ2433/FJ2436) entre a borda livre e os papilares.',
    description: 'Cordões fibrosos que prendem os três folhetos da tricúspide aos músculos papilares do VD.',
    function: 'Mantêm os folhetos da tricúspide fechados e sem everter durante a sístole ventricular.',
    priority: 2,
  },
  aorticRight: {
    name: 'Valva aórtica · válvula coronariana direita',
    nameEn: 'Anterior cusp of aortic valve (right coronary cusp)',
    fma: ['FMA7253'],
    type: SL_CUSP + ' aórtica',
    layer: 'valves',
    detail: 1,
    material: 'valve',
    sources: ['FJ2435'],
    valve: { kind: 'sl', valve: 'aortic' },
    description:
      'Válvula semilunar anterior da valva aórtica (FMA: anterior cusp). O seio aórtico acima dela dá origem ' +
      'à artéria coronária direita.',
    function:
      'Na diástole, as três válvulas se fecham e impedem o refluxo da aorta para o ventrículo esquerdo; ' +
      'o fechamento das valvas semilunares produz a segunda bulha (B2, "tá").',
    priority: 1,
  },
  aorticLeft: {
    name: 'Valva aórtica · válvula coronariana esquerda',
    nameEn: 'Left posterior cusp of aortic valve (left coronary cusp)',
    fma: ['FMA7254'],
    type: SL_CUSP + ' aórtica',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2426'],
    valve: { kind: 'sl', valve: 'aortic' },
    description:
      'Válvula posterior esquerda (FMA: left posterior cusp). O seio aórtico acima dela dá origem ao tronco ' +
      'da artéria coronária esquerda.',
    function: 'Fecha a valva aórtica na diástole, junto com as outras duas válvulas.',
    priority: 3,
  },
  aorticPosterior: {
    name: 'Valva aórtica · válvula não coronariana',
    nameEn: 'Right posterior cusp of aortic valve (non-coronary cusp)',
    fma: ['FMA7252'],
    type: SL_CUSP + ' aórtica',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2431'],
    valve: { kind: 'sl', valve: 'aortic' },
    description: 'Válvula posterior direita (FMA: right posterior cusp); seu seio não dá origem a coronária.',
    function: 'Fecha a valva aórtica na diástole, junto com as outras duas válvulas.',
    priority: 3,
  },
  pulmonaryLeft: {
    name: 'Valva pulmonar · válvula anterior esquerda',
    nameEn: 'Left anterior cusp of pulmonary valve',
    fma: ['FMA7247'],
    type: SL_CUSP + ' pulmonar',
    layer: 'valves',
    detail: 1,
    material: 'valve',
    sources: ['FJ2417'],
    valve: { kind: 'sl', valve: 'pulmonary' },
    description: 'Uma das três válvulas semilunares da valva pulmonar, na saída do ventrículo direito.',
    function:
      'Na diástole impede o refluxo do tronco pulmonar para o ventrículo direito; o fechamento contribui ' +
      'para a segunda bulha (B2).',
    priority: 1,
  },
  pulmonaryRight: {
    name: 'Valva pulmonar · válvula anterior direita',
    nameEn: 'Right anterior cusp of pulmonary valve',
    fma: ['FMA7249'],
    type: SL_CUSP + ' pulmonar',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2434'],
    valve: { kind: 'sl', valve: 'pulmonary' },
    description: 'Válvula semilunar anterior direita da valva pulmonar.',
    function: 'Fecha a valva pulmonar na diástole.',
    priority: 3,
  },
  pulmonaryPosterior: {
    name: 'Valva pulmonar · válvula posterior',
    nameEn: 'Posterior cusp of pulmonary valve',
    fma: ['FMA7250'],
    type: SL_CUSP + ' pulmonar',
    layer: 'valves',
    detail: 2,
    material: 'valve',
    sources: ['FJ2427'],
    valve: { kind: 'sl', valve: 'pulmonary' },
    description: 'Válvula semilunar posterior da valva pulmonar.',
    function: 'Fecha a valva pulmonar na diástole.',
    priority: 3,
  },

  // -------------------------------------------------------------------------
  // Papillary muscles
  // -------------------------------------------------------------------------
  pmRvAnterior: {
    name: 'Músculo papilar anterior do VD',
    nameEn: 'Anterior papillary muscle of right ventricle',
    fma: ['FMA7260'],
    type: PAPILLARY + ' · ventrículo direito',
    layer: 'interior',
    detail: 2,
    material: 'papillary',
    sources: ['FJ2419'],
    description:
      'O maior músculo papilar do ventrículo direito. Recebe a banda moderadora, que leva parte do ramo ' +
      'direito do feixe de His.',
    function:
      'Contrai no início da sístole e tensiona as cordas tendíneas da tricúspide, mantendo os folhetos fechados.',
    priority: 2,
  },
  pmRvPosterior: {
    name: 'Músculo papilar posterior do VD',
    nameEn: 'Posterior papillary muscle of right ventricle',
    fma: ['FMA7261'],
    type: PAPILLARY + ' · ventrículo direito',
    layer: 'interior',
    detail: 3,
    material: 'papillary',
    sources: ['FJ2430'],
    description: 'Músculo papilar da parede inferior do ventrículo direito.',
    function: 'Tensiona as cordas tendíneas dos folhetos da tricúspide durante a sístole.',
    priority: 3,
  },
  pmRvSeptal: {
    name: 'Músculo papilar septal do VD',
    nameEn: 'Septal papillary muscle of right ventricle',
    fma: ['FMA7262'],
    type: PAPILLARY + ' · ventrículo direito',
    layer: 'interior',
    detail: 3,
    material: 'papillary',
    sources: ['FJ2437'],
    description: 'Pequeno músculo papilar (ou grupo de cordas) que nasce do septo interventricular.',
    function: 'Ancora o folheto septal da tricúspide.',
    priority: 3,
  },
  pmLvAnterolateral: {
    name: 'Músculo papilar do VE · cabeça anterolateral',
    nameEn: 'Anterolateral head of lateral papillary muscle of left ventricle',
    fma: ['FMA7265'],
    type: PAPILLARY + ' · ventrículo esquerdo',
    layer: 'interior',
    detail: 2,
    material: 'papillary',
    sources: ['FJ2418'],
    description:
      'Parte anterolateral do aparelho papilar do ventrículo esquerdo (nomenclatura FMA/BodyParts3D). ' +
      'Envia cordas tendíneas aos dois folhetos da mitral.',
    function: 'Contrai com o ventrículo e tensiona as cordas tendíneas, impedindo o prolapso da valva mitral.',
    priority: 2,
  },
  pmLvLateral: {
    name: 'Músculo papilar lateral do VE',
    nameEn: 'Lateral papillary muscle of left ventricle',
    fma: ['FMA7264'],
    type: PAPILLARY + ' · ventrículo esquerdo',
    layer: 'interior',
    detail: 2,
    material: 'papillary',
    sources: ['FJ2429'],
    description:
      'Músculo papilar do ventrículo esquerdo modelado no BodyParts3D (FMA: lateral papillary muscle). Os livros ' +
      'descrevem dois grupos papilares no VE (anterolateral e posteromedial).',
    function: 'Ancora, por cordas tendíneas, os folhetos anterior e posterior da valva mitral.',
    priority: 3,
  },

  // -------------------------------------------------------------------------
  // Coronary arteries
  // -------------------------------------------------------------------------
  lmca: {
    name: 'Tronco da coronária esquerda',
    nameEn: 'Trunk of left coronary artery',
    fma: ['FMA3855'],
    type: CORONARY + ' · esquerda',
    layer: 'arteries',
    detail: 1,
    material: 'artery',
    sources: ['FJ2737'],
    description:
      'Nasce no seio aórtico esquerdo; é curto (em média 10,5 ± 5,5 mm) e se divide em ramo interventricular ' +
      'anterior e ramo circunflexo (em ~25% das pessoas há um ramo intermédio).',
    function:
      'Leva sangue ao lado esquerdo do coração: átrio e ventrículo esquerdos e septo interventricular.',
    priority: 1,
  },
  lad: {
    name: 'Ramo interventricular anterior (DA)',
    nameEn: 'Anterior interventricular branch of left coronary artery (LAD)',
    fma: ['FMA74912', 'FMA3862'],
    type: CORONARY + ' · esquerda',
    layer: 'arteries',
    detail: 1,
    material: 'artery',
    sources: ['FJ2631'],
    description:
      'Artéria descendente anterior (LAD): desce pelo sulco interventricular anterior em direção ao ápice, ' +
      'dando ramos diagonais para a parede do VE e ramos septais para o septo.',
    function: 'Irriga a parede anterior do ventrículo esquerdo, grande parte do septo interventricular e o ápice.',
    priority: 1,
  },
  ladDiagonal: {
    name: 'Ramos diagonais da DA',
    nameEn: 'Diagonal branches of anterior descending branch of left coronary artery',
    fma: ['FMA3860'],
    type: CORONARY + ' · ramo da DA',
    layer: 'arteries',
    detail: 2,
    material: 'artery',
    sources: [...range(2633, 2640), 'FJ2642', 'FJ2648'],
    description: 'Ramos (D1, D2...) que saem da DA e correm, afastando-se do sulco, sobre a face anterolateral do VE.',
    function: 'Irrigam a parede anterolateral do ventrículo esquerdo.',
    priority: 2,
  },
  ladRightAnterior: {
    name: 'Ramos anteriores direitos da DA',
    nameEn: 'Right anterior branches of anterior interventricular branch of left coronary artery',
    fma: ['FMA3870'],
    type: CORONARY + ' · ramo da DA',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2632', 'FJ2645', 'FJ2646', 'FJ2641', 'FJ2647'],
    description: 'Pequenos ramos da DA que cruzam para a face anterior do ventrículo direito.',
    function: 'Irrigam a parte da parede anterior do ventrículo direito próxima ao sulco interventricular.',
    priority: 3,
  },
  ladConus: {
    name: 'Ramo do cone (da DA)',
    nameEn: 'Conus branch of anterior interventricular branch of left coronary artery',
    fma: ['FMA3868'],
    type: CORONARY + ' · ramo da DA',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2643', 'FJ2644'],
    description: 'Ramo que se dirige ao cone arterial (infundíbulo) do ventrículo direito.',
    function: 'Irriga a via de saída do ventrículo direito, junto com a artéria do cone da coronária direita.',
    priority: 3,
  },
  ladSeptal: {
    name: 'Ramos septais da DA',
    nameEn: 'Septal branches of anterior interventricular artery',
    fma: ['FMA3892'],
    type: CORONARY + ' · ramo intramiocárdico',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2732', 'FJ2733', 'FJ2734'],
    description:
      'Ramos perfurantes que penetram o septo interventricular (em média ~9, variando de 6 a 14). Ficam dentro ' +
      'do músculo e só aparecem quando a parede fica translúcida.',
    function: 'Irrigam a maior parte do septo interventricular.',
    priority: 3,
  },
  lcx: {
    name: 'Ramo circunflexo',
    nameEn: 'Circumflex branch of left coronary artery',
    fma: ['FMA3895'],
    type: CORONARY + ' · esquerda',
    layer: 'arteries',
    detail: 1,
    material: 'artery',
    sources: range(2649, 2654),
    description:
      'Segue o sulco coronário (atrioventricular) esquerdo em direção à face posterior e termina perto da ' +
      'margem obtusa, dando ramos marginais obtusos.',
    function: 'Irriga o átrio esquerdo e as paredes lateral e posterior do ventrículo esquerdo.',
    priority: 1,
  },
  rca: {
    name: 'Artéria coronária direita',
    nameEn: 'Trunk of right coronary artery',
    fma: ['FMA3802'],
    type: CORONARY + ' · direita',
    layer: 'arteries',
    detail: 1,
    material: 'artery',
    sources: ['FJ2723'],
    description:
      'Nasce no seio aórtico direito e percorre o sulco coronário direito, entre átrio e ventrículo direitos, ' +
      'até a crux cordis na face posterior.',
    function:
      'Irriga o átrio e o ventrículo direitos e parte do ventrículo esquerdo; na maioria das pessoas também ' +
      'o nó sinoatrial (60–70%) e o nó atrioventricular (~90%).',
    priority: 1,
  },
  rcaConus: {
    name: 'Artéria do cone direita',
    nameEn: 'Right conus artery',
    fma: ['FMA3807'],
    type: CORONARY + ' · ramo da coronária direita',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2670', 'FJ2676'],
    description: 'Geralmente o primeiro ramo da coronária direita (ramo infundibular ou conal).',
    function: 'Irriga o infundíbulo (via de saída) do ventrículo direito.',
    priority: 3,
  },
  rcaAnteriorVentricular: {
    name: 'Ramos ventriculares anteriores da coronária direita',
    nameEn: 'Anterior ventricular branches of right coronary artery',
    fma: ['FMA3813', 'FMA3815'],
    type: CORONARY + ' · ramo da coronária direita',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2671', 'FJ2673', 'FJ2677'],
    description: 'Ramos que descem da coronária direita sobre a face anterior do ventrículo direito.',
    function: 'Irrigam a parede anterior do ventrículo direito.',
    priority: 3,
  },
  rcaMarginal: {
    name: 'Ramo marginal direito',
    nameEn: 'Marginal branch of right coronary artery',
    fma: ['FMA3818'],
    type: CORONARY + ' · ramo da coronária direita',
    layer: 'arteries',
    detail: 2,
    material: 'artery',
    sources: ['FJ2667', 'FJ2668', 'FJ2672', 'FJ2674', 'FJ2675'],
    description:
      'Uma ou mais artérias marginais que saem da coronária direita abaixo do átrio direito e seguem a margem ' +
      'direita (aguda) do coração.',
    function: 'Irriga a parede lateral do ventrículo direito.',
    priority: 2,
  },
  pda: {
    name: 'Ramo interventricular posterior (DP)',
    nameEn: 'Posterior interventricular branch of right coronary artery',
    fma: ['FMA3840'],
    type: CORONARY + ' · ramo da coronária direita',
    layer: 'arteries',
    detail: 1,
    material: 'artery',
    sources: range(2692, 2700),
    description:
      'Artéria descendente posterior: percorre o sulco interventricular posterior. Neste modelo nasce da ' +
      'coronária direita (dominância direita, presente em 70–80% das pessoas).',
    function: 'Irriga as paredes inferiores dos ventrículos e a parte posterior do septo interventricular.',
    priority: 1,
  },
  rcaPosteriorVentricular: {
    name: 'Ramos ventriculares posteriores da coronária direita',
    nameEn: 'Posterior ventricular branches of right coronary artery',
    fma: ['FMA3835', 'FMA3837'],
    type: CORONARY + ' · ramo da coronária direita',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: range(2714, 2722),
    description: 'Ramos da coronária direita, após a crux, para a face diafragmática do ventrículo esquerdo.',
    function: 'Irrigam a parede inferior (diafragmática) do ventrículo esquerdo.',
    priority: 3,
  },
  pdaSeptal: {
    name: 'Ramos septais da DP',
    nameEn: 'Septal branches of posterior interventricular artery',
    fma: ['FMA3845'],
    type: CORONARY + ' · ramo intramiocárdico',
    layer: 'arteries',
    detail: 3,
    material: 'artery',
    sources: ['FJ2735', 'FJ2736'],
    description: 'Ramos perfurantes que entram no septo pela face posterior (inferior).',
    function: 'Irrigam a parte posterior (inferior) do septo interventricular.',
    priority: 3,
  },

  // -------------------------------------------------------------------------
  // Cardiac veins
  // -------------------------------------------------------------------------
  coronarySinus: {
    name: 'Seio coronário',
    nameEn: 'Coronary sinus',
    fma: ['FMA4706'],
    type: CARDIAC_VEIN + ' · coletor principal',
    layer: 'veins',
    detail: 1,
    material: 'vein',
    sources: ['FJ2655'],
    description:
      'Grande veia de parede fina na parte posterior do sulco coronário (25–50 mm de comprimento, 6–12 mm de ' +
      'diâmetro). Desemboca no átrio direito, perto da veia cava inferior, guardada pela valva de Tebésio.',
    function: 'Recebe a maior parte do sangue venoso do miocárdio e o devolve ao átrio direito.',
    priority: 1,
  },
  greatCardiacVein: {
    name: 'Veia cardíaca magna',
    nameEn: 'Great cardiac vein',
    fma: ['FMA4707'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 1,
    material: 'vein',
    sources: ['FJ2656'],
    description:
      'Continuação da veia interventricular anterior: contorna o sulco atrioventricular esquerdo, junto ao ' +
      'ramo circunflexo, e termina no seio coronário (junto à valva de Vieussens).',
    function: 'Drena as regiões irrigadas pela coronária esquerda.',
    priority: 1,
  },
  anteriorInterventricularVein: {
    name: 'Veia interventricular anterior',
    nameEn: 'Anterior interventricular vein',
    fma: ['FMA66403'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 1,
    material: 'vein',
    sources: range(2657, 2665),
    description: 'Sobe pelo sulco interventricular anterior, paralela à DA, do ápice até a base do coração.',
    function: 'Drena a parede anterior dos ventrículos e o septo para a veia cardíaca magna.',
    priority: 2,
  },
  leftMarginalVein: {
    name: 'Veia marginal esquerda',
    nameEn: 'Left marginal vein',
    fma: ['FMA4708'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 3,
    material: 'vein',
    sources: ['FJ2703', 'FJ2704', 'FJ2705'],
    description: 'Veia da margem obtusa (parede lateral do VE).',
    function: 'Drena a parede lateral do ventrículo esquerdo para a veia cardíaca magna/seio coronário.',
    priority: 3,
  },
  posteriorLvVein: {
    name: 'Veia posterior do ventrículo esquerdo',
    nameEn: 'Posterior vein of left ventricle',
    fma: ['FMA4712'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 2,
    material: 'vein',
    sources: ['FJ2701', 'FJ2702', ...range(2706, 2713)],
    description: 'Veia da face diafragmática do ventrículo esquerdo (também chamada veia inferior do VE).',
    function: 'Drena a parede inferior do ventrículo esquerdo para o seio coronário.',
    priority: 3,
  },
  middleCardiacVein: {
    name: 'Veia cardíaca média',
    nameEn: 'Middle cardiac vein',
    fma: ['FMA4713'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 1,
    material: 'vein',
    sources: range(2678, 2691),
    description: 'Sobe pelo sulco interventricular posterior, paralela ao ramo interventricular posterior.',
    function: 'Drena as áreas irrigadas pela artéria interventricular posterior para o seio coronário.',
    priority: 2,
  },
  smallCardiacVein: {
    name: 'Veia cardíaca parva',
    nameEn: 'Small cardiac vein',
    fma: ['FMA4714'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 2,
    material: 'vein',
    sources: ['FJ2724', 'FJ2731'],
    description: 'Acompanha a coronária direita no sulco coronário direito.',
    function: 'Drena as faces posteriores do átrio e do ventrículo direitos para o seio coronário.',
    priority: 3,
  },
  anteriorCardiacVeins: {
    name: 'Veias cardíacas anteriores',
    nameEn: 'Anterior cardiac veins',
    fma: ['FMA76767'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 3,
    material: 'vein',
    sources: ['FJ2725', 'FJ2730'],
    description: 'Pequenas veias da face anterior do ventrículo direito, paralelas às pequenas artérias cardíacas.',
    function: 'Drenam a face anterior do VD diretamente no átrio direito, sem passar pelo seio coronário.',
    priority: 3,
  },
  rightMarginalVein: {
    name: 'Veia marginal direita',
    nameEn: 'Right marginal vein',
    fma: ['FMA4716'],
    type: CARDIAC_VEIN,
    layer: 'veins',
    detail: 3,
    material: 'vein',
    sources: ['FJ2727', 'FJ2728', 'FJ2729'],
    description: 'Veia da margem direita (aguda) do coração, acompanhando o ramo marginal direito.',
    function: 'Drena a parede lateral do ventrículo direito.',
    priority: 3,
  },

  // -------------------------------------------------------------------------
  // Great vessels
  // -------------------------------------------------------------------------
  ascendingAorta: {
    name: 'Aorta ascendente',
    nameEn: 'Ascending aorta',
    fma: ['FMA3736'],
    type: GREAT_ARTERY,
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ3413'],
    description:
      'Primeiro segmento da aorta, saindo do ventrículo esquerdo pela valva aórtica. Na raiz ficam os seios ' +
      'aórticos, de onde nascem as artérias coronárias.',
    function: 'Recebe todo o sangue ejetado pelo ventrículo esquerdo a cada sístole.',
    priority: 1,
  },
  aorticArch: {
    name: 'Arco da aorta',
    nameEn: 'Arch of aorta',
    fma: ['FMA3768'],
    type: GREAT_ARTERY,
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ3411'],
    description:
      'Curva da aorta para trás e para a esquerda, de onde saem o tronco braquiocefálico, a carótida comum ' +
      'esquerda e a subclávia esquerda.',
    function: 'Distribui sangue oxigenado para a cabeça, o pescoço e os membros superiores e continua como aorta descendente.',
    priority: 1,
  },
  descendingAorta: {
    name: 'Aorta descendente (torácica)',
    nameEn: 'Descending thoracic aorta',
    fma: ['FMA87217'],
    type: GREAT_ARTERY,
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ1931'],
    clip: [{ axis: 'z', keep: '>', value: 1168 }],
    description: 'Continuação do arco, descendo atrás do coração (cortada aqui logo abaixo do coração).',
    function: 'Leva sangue oxigenado ao tórax, abdome e membros inferiores.',
    priority: 2,
  },
  brachiocephalicTrunk: {
    name: 'Tronco braquiocefálico',
    nameEn: 'Brachiocephalic trunk',
    fma: ['FMA3932'],
    type: GREAT_ARTERY + ' · ramo do arco',
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ3417'],
    description: 'Primeiro e maior ramo do arco aórtico; divide-se nas artérias subclávia e carótida comum direitas.',
    function: 'Leva sangue ao membro superior direito e ao lado direito da cabeça e do pescoço.',
    priority: 2,
  },
  leftCommonCarotid: {
    name: 'Artéria carótida comum esquerda',
    nameEn: 'Left common carotid artery',
    fma: ['FMA4058'],
    type: GREAT_ARTERY + ' · ramo do arco',
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ3483'],
    clip: [{ axis: 'z', keep: '<', value: 1352 }],
    description: 'Segundo ramo do arco aórtico, sobe pelo lado esquerdo do pescoço (cortada no modelo).',
    function: 'Leva sangue ao lado esquerdo da cabeça e do pescoço.',
    priority: 2,
  },
  leftSubclavian: {
    name: 'Artéria subclávia esquerda',
    nameEn: 'Left subclavian artery',
    fma: ['FMA4694'],
    type: GREAT_ARTERY + ' · ramo do arco',
    layer: 'greatVessels',
    detail: 1,
    material: 'greatArtery',
    sources: ['FJ3479'],
    clip: [
      { axis: 'z', keep: '<', value: 1350 },
      { axis: 'x', keep: '<', value: 42 },
    ],
    description: 'Terceiro ramo do arco aórtico (cortada no modelo).',
    function: 'Leva sangue ao membro superior esquerdo.',
    priority: 2,
  },
  pulmonaryTrunk: {
    name: 'Tronco pulmonar',
    nameEn: 'Pulmonary trunk',
    fma: ['FMA8612'],
    type: GREAT_ARTERY + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryArtery',
    sources: ['FJ2966'],
    description: 'Sai do ventrículo direito pela valva pulmonar e se divide nas artérias pulmonares direita e esquerda.',
    function: 'Leva o sangue pouco oxigenado do ventrículo direito aos pulmões.',
    priority: 1,
  },
  rightPulmonaryArtery: {
    name: 'Artéria pulmonar direita',
    nameEn: 'Right pulmonary artery',
    fma: ['FMA50872'],
    type: GREAT_ARTERY + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryArtery',
    sources: ['FJ3019'],
    clip: [{ axis: 'x', keep: '>', value: -46 }],
    description: 'Passa por baixo do arco aórtico e atrás da aorta ascendente e da veia cava superior até o pulmão direito.',
    function: 'Leva sangue pouco oxigenado ao pulmão direito.',
    priority: 2,
  },
  leftPulmonaryArtery: {
    name: 'Artéria pulmonar esquerda',
    nameEn: 'Left pulmonary artery',
    fma: ['FMA50873'],
    type: GREAT_ARTERY + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryArtery',
    sources: ['FJ2924'],
    clip: [{ axis: 'x', keep: '<', value: 66 }],
    description: 'Ramo esquerdo do tronco pulmonar, que se curva sobre o brônquio principal esquerdo.',
    function: 'Leva sangue pouco oxigenado ao pulmão esquerdo.',
    priority: 2,
  },
  rightSuperiorPulmonaryVein: {
    name: 'Veia pulmonar superior direita',
    nameEn: 'Right superior pulmonary vein',
    fma: ['FMA49914'],
    type: GREAT_VEIN + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryVein',
    sources: ['FJ3020'],
    description: 'Uma das quatro veias pulmonares; desemboca no átrio esquerdo.',
    function: 'Traz sangue oxigenado do pulmão direito ao átrio esquerdo.',
    priority: 2,
  },
  rightInferiorPulmonaryVein: {
    name: 'Veia pulmonar inferior direita',
    nameEn: 'Right inferior pulmonary vein',
    fma: ['FMA49911'],
    type: GREAT_VEIN + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryVein',
    sources: ['FJ3040'],
    description: 'Veia pulmonar inferior do pulmão direito; desemboca no átrio esquerdo.',
    function: 'Traz sangue oxigenado do pulmão direito ao átrio esquerdo.',
    priority: 3,
  },
  leftSuperiorPulmonaryVein: {
    name: 'Veia pulmonar superior esquerda',
    nameEn: 'Left superior pulmonary vein',
    fma: ['FMA49914'],
    type: GREAT_VEIN + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryVein',
    sources: ['FJ2925', 'FJ2933'],
    description: 'Veia pulmonar superior do pulmão esquerdo; desemboca no átrio esquerdo.',
    function: 'Traz sangue oxigenado do pulmão esquerdo ao átrio esquerdo.',
    priority: 2,
  },
  leftInferiorPulmonaryVein: {
    name: 'Veia pulmonar inferior esquerda',
    nameEn: 'Left inferior pulmonary vein',
    fma: ['FMA49916'],
    type: GREAT_VEIN + ' · circulação pulmonar',
    layer: 'greatVessels',
    detail: 1,
    material: 'pulmonaryVein',
    sources: ['FJ2944', 'FJ2950', 'FJ2955'],
    description: 'Veia pulmonar inferior do pulmão esquerdo; desemboca no átrio esquerdo.',
    function: 'Traz sangue oxigenado do pulmão esquerdo ao átrio esquerdo.',
    priority: 3,
  },
  superiorVenaCava: {
    name: 'Veia cava superior',
    nameEn: 'Superior vena cava',
    fma: ['FMA4720'],
    type: GREAT_VEIN,
    layer: 'greatVessels',
    detail: 1,
    material: 'greatVein',
    sources: ['FJ3645'],
    description:
      'Formada pela união das veias braquiocefálicas; desemboca na parte superior do átrio direito, perto do nó ' +
      'sinoatrial.',
    function: 'Traz ao coração o sangue das regiões acima do diafragma: cabeça, pescoço, membros superiores e tórax.',
    priority: 1,
  },
  inferiorVenaCava: {
    name: 'Veia cava inferior',
    nameEn: 'Inferior vena cava',
    fma: ['FMA10951'],
    type: GREAT_VEIN,
    layer: 'greatVessels',
    detail: 1,
    material: 'greatVein',
    sources: ['FJ3441'],
    clip: [{ axis: 'z', keep: '>', value: 1158 }],
    description: 'Desemboca na parte inferior do átrio direito (cortada no modelo logo abaixo do coração).',
    function: 'Traz ao coração o sangue das regiões abaixo do diafragma: membros inferiores e abdome.',
    priority: 1,
  },
  leftBrachiocephalicVein: {
    name: 'Veia braquiocefálica esquerda',
    nameEn: 'Left brachiocephalic vein',
    fma: ['FMA4761'],
    type: GREAT_VEIN,
    layer: 'greatVessels',
    detail: 2,
    material: 'greatVein',
    sources: ['FJ3482'],
    clip: [
      { axis: 'z', keep: '<', value: 1330 },
      { axis: 'x', keep: '<', value: 24 },
    ],
    description: 'Cruza à frente dos ramos do arco aórtico e se une à direita para formar a veia cava superior.',
    function: 'Drena a cabeça, o pescoço e o membro superior esquerdos para a veia cava superior.',
    priority: 3,
  },
  rightBrachiocephalicVein: {
    name: 'Veia braquiocefálica direita',
    nameEn: 'Right brachiocephalic vein',
    fma: ['FMA4751'],
    type: GREAT_VEIN,
    layer: 'greatVessels',
    detail: 2,
    material: 'greatVein',
    sources: ['FJ3583'],
    clip: [{ axis: 'z', keep: '<', value: 1330 }],
    description: 'Une-se à veia braquiocefálica esquerda para formar a veia cava superior.',
    function: 'Drena a cabeça, o pescoço e o membro superior direitos.',
    priority: 3,
  },

  // -------------------------------------------------------------------------
  // Conduction system (schematic, see js/conduction.js)
  // -------------------------------------------------------------------------
  saNode: {
    name: 'Nó sinoatrial (SA)',
    nameEn: 'Sinoatrial node',
    fma: [],
    type: CONDUCTION + ' · marca-passo',
    layer: 'conduction',
    detail: 1,
    material: 'conduction',
    derived: 'Posição esquemática na parede do átrio direito, junto à desembocadura da veia cava superior.',
    description:
      'Grupo de células marca-passo nas paredes superior e posterior do átrio direito, próximo ao óstio da veia ' +
      'cava superior. Sem influência nervosa ou hormonal dispararia cerca de 80–100 vezes por minuto.',
    function: 'Inicia cada batimento (ritmo sinusal); o impulso se espalha pelos dois átrios.',
    priority: 1,
  },
  internodalPathways: {
    name: 'Vias internodais e feixe de Bachmann',
    nameEn: 'Internodal pathways and Bachmann bundle',
    fma: [],
    type: CONDUCTION,
    layer: 'conduction',
    detail: 2,
    material: 'conduction',
    derived: 'Trajetos esquemáticos sobre as paredes atriais entre os marcos do modelo.',
    description:
      'Três feixes (anterior, médio e posterior) levam o impulso do nó SA ao nó AV em cerca de 50 ms; o feixe ' +
      'de Bachmann (interatrial) leva o impulso diretamente ao átrio esquerdo.',
    function: 'Coordenam a despolarização e a contração dos dois átrios.',
    priority: 2,
  },
  avNode: {
    name: 'Nó atrioventricular (AV)',
    nameEn: 'Atrioventricular node',
    fma: [],
    type: CONDUCTION,
    layer: 'conduction',
    detail: 1,
    material: 'conduction',
    derived: 'Posição esquemática no triângulo de Koch: entre o óstio do seio coronário e o folheto septal da tricúspide.',
    description:
      'Grupo de células na parte inferior do átrio direito, no septo atrioventricular. O impulso atrasa ' +
      'cerca de 100 ms ao atravessá-lo.',
    function:
      'O atraso permite que os átrios terminem de contrair e esvaziar antes da contração ventricular; ' +
      'também limita a frequência transmitida aos ventrículos.',
    priority: 1,
  },
  hisBundle: {
    name: 'Feixe atrioventricular (de His)',
    nameEn: 'Atrioventricular bundle (bundle of His)',
    fma: [],
    type: CONDUCTION,
    layer: 'conduction',
    detail: 1,
    material: 'conduction',
    derived: 'Trajeto esquemático do nó AV até a crista do septo interventricular muscular.',
    description: 'Continua o nó AV através do esqueleto fibroso até o topo do septo interventricular.',
    function: 'Única conexão elétrica normal entre átrios e ventrículos.',
    priority: 2,
  },
  bundleBranches: {
    name: 'Ramos direito e esquerdo do feixe de His',
    nameEn: 'Right and left bundle branches',
    fma: [],
    type: CONDUCTION,
    layer: 'conduction',
    detail: 2,
    material: 'conduction',
    derived: 'Trajetos esquemáticos nas duas faces do septo; o direito segue para a banda moderadora.',
    description:
      'O feixe de His se divide em ramo esquerdo (maior, com fascículos) e ramo direito, que descem pelo septo ' +
      'em cerca de 25 ms até o ápice. Parte do ramo direito passa pela banda moderadora.',
    function: 'Levam o impulso rapidamente ao ápice e aos músculos papilares.',
    priority: 2,
  },
  purkinje: {
    name: 'Rede de Purkinje',
    nameEn: 'Purkinje fibers (subendocardial plexus)',
    fma: [],
    type: CONDUCTION,
    layer: 'conduction',
    detail: 3,
    material: 'conduction',
    derived: 'Rede ramificada gerada sobre o endocárdio dos ventrículos do modelo (representação esquemática).',
    description:
      'Fibras de condução rápida sob o endocárdio. Levam o impulso a todo o músculo ventricular em cerca de ' +
      '75 ms, do ápice em direção à base.',
    function: 'Fazem os ventrículos contraírem do ápice para a base, "espremendo" o sangue para as grandes artérias.',
    priority: 3,
  },
};

/** Keys in a stable order (catalogue order). */
export const STRUCTURE_KEYS = Object.keys(STRUCTURES);

/** Short names of the phases shown in the HUD (js/heartbeat.js). */
export const PHASE_NAMES = {
  atrialSystole: 'Sístole atrial',
  isovolumicContraction: 'Contração isovolumétrica',
  ejection: 'Ejeção ventricular',
  isovolumicRelaxation: 'Relaxamento isovolumétrico',
  rapidFilling: 'Enchimento rápido',
  diastasis: 'Diástase (enchimento lento)',
};

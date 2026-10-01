# Fontes anatômicas e fisiológicas

Todas as estruturas, nomes, posições e tempos usados no projeto vêm das fontes
abaixo ou do próprio modelo anatômico (BodyParts3D, ver `MODEL_LICENSE.md`).
Nada foi posicionado "de cabeça": vasos, câmaras e valvas estão onde estão no
modelo derivado de ressonância magnética; o que o modelo não contém (sistema de
condução, película do epicárdio) foi gerado a partir de marcos anatômicos do
modelo seguindo estas fontes, e isso é informado ao usuário no cartão da
estrutura.

## Instituições e livros-texto

| Fonte | O que sustenta |
| --- | --- |
| **NHLBI / NIH** — *How the Heart Works: Heart Anatomy*. <https://www.nhlbi.nih.gov/health/heart/anatomy> | 4 câmaras, septo, valvas, camadas da parede (endocárdio, miocárdio, pericárdio), sentido do sangue pouco/muito oxigenado |
| **NHLBI / NIH** — *How the Heart Beats*. <https://www.nhlbi.nih.gov/health/heart/heart-beats> | sequência elétrica: nó SA no átrio direito → átrios → nó AV (o sinal desacelera para os ventrículos terminarem de encher) → ventrículos |
| **OpenStax, *Anatomy and Physiology 2e*** (Rice University, 2022, CC BY 4.0), cap. 19.1 *Heart Anatomy*. <https://openstax.org/books/anatomy-and-physiology-2e/pages/19-1-heart-anatomy> | aurículas, músculos pectíneos, fossa oval, trabéculas cárneas, banda moderadora; papilares (VD: anterior, posterior e septal; VE: dois grupos); valvas e cordas tendíneas; veias cavas e seio coronário no AD; tronco e artérias pulmonares; **quatro veias pulmonares**; artérias coronárias (CD, marginais, interventricular posterior, CE, circunflexa, interventricular anterior); veias cardíacas (magna, média, parva, **anteriores drenando direto no AD**); sulcos com gordura que alojam os vasos coronários; epicárdio = pericárdio seroso visceral; VE mais espesso que o VD |
| **OpenStax, *Anatomy and Physiology 2e***, cap. 19.2 *Cardiac Muscle and Electrical Activity*. <https://openstax.org/books/anatomy-and-physiology-2e/pages/19-2-cardiac-muscle-and-electrical-activity> | nó SA nas paredes superior e posterior do AD junto à cava superior; três vias internodais e feixe de Bachmann; **~50 ms** SA → AV; nó AV na parte inferior do AD, no septo AV; **~100 ms** de atraso; feixe de His, ramos direito/esquerdo (o esquerdo com fascículos), banda moderadora levando parte do ramo direito; **~25 ms** até o ápice; Purkinje em **~75 ms**, do ápice à base; frequências intrínsecas (SA 80–100/min, AV 40–60/min); P, QRS, T |
| **OpenStax, *Anatomy and Physiology 2e***, cap. 19.3 *Cardiac Cycle*. <https://openstax.org/books/anatomy-and-physiology-2e/pages/19-3-cardiac-cycle> | sístole atrial ~100 ms; **70–80%** do enchimento ventricular passivo e **20–30%** pela contração atrial; contração e relaxamento isovolumétricos; ejeção; VDF ~130 mL, volume sistólico 70–80 mL, VSF 50–60 mL; **B1** = fechamento das valvas AV, **B2** = fechamento das semilunares |
| **Mayo Clinic** — *Heart rate: What's normal?* <https://www.mayoclinic.org/healthy-lifestyle/fitness/expert-answers/heart-rate/faq-20057979> | frequência de repouso de adultos entre **60 e 100 bpm** (textos "batimento calmo / repouso / rápido" do painel) |

## Artigos científicos

| Referência | O que sustenta |
| --- | --- |
| Weissler AM, Harris WS, Schoenfeld CD. *Systolic time intervals in heart failure in man.* **Circulation** 1968;37:149–159; e Weissler AM. *Systolic time intervals* (revisão), **Circulation** 1977;56:146. doi:[10.1161/01.cir.56.2.146](https://doi.org/10.1161/01.cir.56.2.146) | regressões usadas em `js/heartbeat.js`: **QS2 = 546 − 2,1·FC**, **LVET = 413 − 1,7·FC**, **PEP = 131 − 0,4·FC** (ms, homens) |
| Bombardini T, Gemignani V, Bianchini E, et al. *Diastolic time–frequency relation in the stress echo lab: filling timing and flow at different heart rates.* **Cardiovascular Ultrasound** 2008;6:15. doi:[10.1186/1476-7120-6-15](https://doi.org/10.1186/1476-7120-6-15) | com o aumento da FC a diástole encurta muito mais que a sístole (o modelo reproduz isso) |
| Kesieme EB, Omoregbee B, Ngaage DL, Danton MHD. *Comprehensive Review of Coronary Artery Anatomy Relevant to Cardiac Surgery.* **Current Cardiology Reviews** 2025. [PMC12060931](https://pmc.ncbi.nlm.nih.gov/articles/PMC12060931/) | origem da CD no seio aórtico direito e do TCE no esquerdo; TCE 10,5 ± 5,5 mm, trifurcação em ~25%; trajeto da CD no sulco AV até a crux; ramo do cone, artéria do nó SA (60–70%), nó AV (~90%), marginal agudo, DP; DA no sulco interventricular anterior com diagonais e ~9 (6–14) septais; circunflexa no sulco AV esquerdo até a margem obtusa, com marginais obtusos; **dominância direita em 70–80%** |
| Didenko M, Harutyunyan K, Scharf C, et al. *Coronary sinus and cardiac venous anatomy for cardiac resynchronization therapy: A clinician's view.* **Indian Pacing and Electrophysiology Journal** 2026. [PMC13329930](https://pmc.ncbi.nlm.nih.gov/articles/PMC13329930/) | seio coronário no sulco AV inferior (25–50 mm, 6–12 mm), óstio no AD perto da cava inferior, valva de Tebésio; veia cardíaca magna vinda do sulco interventricular anterior, valva de Vieussens; veia cardíaca média no sulco interventricular inferior; pequenas veias no sulco AV direito |
| Duncker DJ, Koller A, Merkus D, Canty JM Jr. *Regulation of Coronary Blood Flow in Health and Ischemic Heart Disease.* **Progress in Cardiovascular Diseases** 2015;57(5):409–422. doi:[10.1016/j.pcad.2014.12.002](https://doi.org/10.1016/j.pcad.2014.12.002) | a contração sistólica comprime os microvasos intramiocárdicos, **dificultando a entrada arterial coronariana e aumentando a saída venosa**; na diástole o fluxo arterial aumenta (fluxo coronariano esquerdo predominantemente diastólico em `js/heartbeat.js`/`js/coronary.js`) |
| Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* **Nucleic Acids Research** 2009;37:D782–D785. doi:[10.1093/nar/gkn613](https://doi.org/10.1093/nar/gkn613) | origem do modelo (RM de voluntário humano, refinamento por ilustradores médicos, conceitos FMA) |
| Ndrepepa G. *Epicardial adipose tissue: An anatomic component of obesity & metabolic syndrome in close proximity to myocardium & coronary arteries.* **Indian Journal of Medical Research** 2020. [PMC7602928](https://pmc.ncbi.nlm.nih.gov/articles/PMC7602928) | gordura epicárdica entre o miocárdio e o pericárdio visceral, cobrindo até **80%** da superfície; **10–14 mm** nos sulcos atrioventricular e interventriculares, **5–7 mm** sobre a parede livre do VD, menos sobre átrios e ápice do VE; em contato direto com as coronárias epicárdicas (distribuição e volume da gordura em `tools/model-build/build.mjs`) |
| University of Utah, WebPath — *Normal heart, gross* <https://webpath.med.utah.edu/CVHTML/CV001.html>; PathologyOutlines — *Heart histology* <https://www.pathologyoutlines.com/topic/hearthistology.html> | aparência do coração normal: epicárdio **liso e brilhante** (película úmida e translúcida), gordura epicárdica presente, miocárdio **castanho-avermelhado a vermelho**, DA descendo da raiz da aorta até o ápice (cores e brilho dos materiais em `js/materials.js`) |

## Bases de modelos consultadas

| Base | Resultado |
| --- | --- |
| **NIH 3D / HuBMAP Human Reference Atlas** — *3D Reference Organ: Heart* (Visible Human, CC BY 4.0). <https://humanatlas.io/3d-reference-library> | avaliado: câmaras, septo, valvas e papilares, mas sem coronárias, veias cardíacas e grandes vasos |
| **BodyParts3D** (DBCLS) — <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/> | escolhido (ver `MODEL_LICENSE.md` e `ARCHITECTURE.md`) |
| **FMA** — Foundational Model of Anatomy (nomes e IDs dos conceitos, via BodyParts3D) | nomenclatura das estruturas em `js/anatomy.js` |

## Onde cada fonte foi aplicada

| Parte do projeto | Fontes |
| --- | --- |
| nomes, tipos, descrições e funções (`js/anatomy.js`) | OpenStax 19.1–19.3, NHLBI, Kesieme 2025, Didenko 2026, FMA/BodyParts3D |
| tempos do ciclo e mudança com o BPM (`js/heartbeat.js`) | Weissler, OpenStax 19.3, Bombardini 2008 |
| bulhas B1/B2 (`js/audio.js`) | OpenStax 19.3 (origem de B1 e B2) |
| sistema de condução e tempos de ativação (`tools/model-build/lib/conduction.mjs`, `js/conduction.js`) | OpenStax 19.2, NHLBI |
| fluxo sanguíneo (`js/bloodFlow.js`) | OpenStax 19.1/19.3, NHLBI |
| fluxo coronariano (`js/coronary.js`) | Duncker 2015, Kesieme 2025, Didenko 2026 |
| aparência dos tecidos e gordura epicárdica (`js/materials.js`, `js/shaders.js`, película do epicárdio no pipeline) | Ndrepepa 2020, WebPath, PathologyOutlines |
| deformação (`js/cardiacField.js`) | OpenStax 19.2/19.3 (contração do ápice para a base, volumes), valores de encurtamento e torção dentro das faixas fisiológicas usuais |

## Limites conhecidos (também no README)

- O BodyParts3D descreve o aparelho papilar do VE como músculo papilar lateral e
  sua cabeça anterolateral (nomenclatura FMA); os livros descrevem dois grupos
  (anterolateral e posteromedial). O projeto mantém a nomenclatura do modelo e
  avisa na descrição.
- Anatomia de **uma** pessoa (dominância direita); variações normais (ramo
  intermédio, dominância esquerda etc.) não são representadas.
- O sistema de condução é esquemático: não é visível macroscopicamente e não
  existe no modelo; foi posicionado por marcos do modelo.
- O movimento é uma aproximação cinemática do ciclo, não uma simulação
  mecânica ou hemodinâmica.

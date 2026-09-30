/**
 * GLB writer: one node per structure part, custom tissue attribute, morph
 * targets (blend shapes). Quantized (KHR_mesh_quantization) and compressed
 * with EXT_meshopt_compression; the app decodes it with the official
 * meshopt decoder that ships with Three.js.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

export const TARGET_NAMES = ['ventricularSystole', 'atrialSystole', 'valveHalf', 'valveOpen', 'arterialDistension'];

/**
 * @param nodes [{ name, key, positions, normals, indices, tissue(Uint8 x4), targets: [{name, position, normal}] }]
 */
export async function writeGlb(file, nodes, { level }) {
  const doc = new Document();
  const asset = doc.getRoot().getAsset();
  asset.generator = 'Human Heart model pipeline (tools/model-build)';
  asset.copyright =
    'Derived from BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International. ' +
    'This derived model: CC BY-SA 4.0. See docs/MODEL_LICENSE.md.';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Heart');
  const material = doc.createMaterial('placeholder').setDoubleSided(false);

  for (const node of nodes) {
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(node.positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(node.normals).setBuffer(buffer))
      .setAttribute('_TISSUE', doc.createAccessor().setType('VEC4').setArray(node.tissue).setNormalized(true).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(node.indices)).setBuffer(buffer));

    const targetNames = [];
    for (const target of node.targets) {
      const t = doc
        .createPrimitiveTarget(target.name)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(target.position).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(target.normal).setBuffer(buffer));
      prim.addTarget(t);
      targetNames.push(target.name);
    }
    const mesh = doc
      .createMesh(node.name)
      .addPrimitive(prim)
      .setWeights(targetNames.map(() => 0))
      .setExtras({ targetNames });
    const gltfNode = doc.createNode(node.name).setMesh(mesh).setExtras({ key: node.key, level });
    scene.addChild(gltfNode);
  }

  await MeshoptEncoder.ready;
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({
      pattern: /^(POSITION|NORMAL)$/,
      quantizationVolume: 'scene',
      quantizePosition: 14,
      quantizeNormal: 10,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await io.write(file, doc);
}

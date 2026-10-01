import * as THREE from 'three';
import { MeshBVH, CENTER } from 'three-mesh-bvh';

/**
 * Fast raycasting against the beating heart.
 *
 * The meshes deform with blend shapes, so THREE.Mesh.raycast has to morph and
 * test every one of their ~200 000 triangles: 15–30 ms per ray, too slow for
 * hover picking and for the label visibility tests. Here every mesh gets a
 * bounding volume hierarchy (three-mesh-bvh) built once on its rest pose. The
 * boxes are enlarged by the largest displacement the current blend-shape
 * weights can produce, so no triangle is missed, and only the few triangles
 * near the ray are morphed (Mesh.getVertexPosition, the same weights as the
 * rendering) and tested exactly. Same hits as Mesh.raycast, in a fraction of a millisecond.
 */
export function createPicker() {
  const entries = new WeakMap(); // geometry -> { bvh, margin }
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const box = new THREE.Box3();
  const entry = new THREE.Vector3();
  const farPoint = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const point = new THREE.Vector3();

  function prepare(geometry) {
    let entry = entries.get(geometry);
    if (entry) return entry;
    const bvh = new MeshBVH(geometry, { strategy: CENTER, maxLeafTris: 8, indirect: true });
    // Largest displacement of each blend shape; the search margin of a ray is
    // then sum(|weight| * largest displacement) for the current weights.
    const morphs = geometry.morphAttributes.position ?? [];
    const reach = morphs.map((attribute) => {
      let max = 0;
      for (let i = 0; i < attribute.count; i++) max = Math.max(max, Math.hypot(attribute.getX(i), attribute.getY(i), attribute.getZ(i)));
      return max;
    });
    const relative = geometry.morphTargetsRelative || morphs.length === 0;
    entry = { bvh, reach, relative };
    entries.set(geometry, entry);
    return entry;
  }

  /**
   * Like raycaster.intersectObjects(objects, false): hits sorted by distance,
   * each { distance, point, object, face: { a, b, c }, faceIndex }.
   * With `rest: true` the meshes are taken at rest (without the beat).
   */
  function intersect(raycaster, objects, { rest = false } = {}) {
    const hits = [];
    const ray = raycaster.ray;
    for (const mesh of objects) {
      if (!mesh.isMesh) continue;
      const geometry = mesh.geometry;
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere(); // includes the blend shapes
      sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (!ray.intersectsSphere(sphere)) continue;
      const { bvh, reach, relative } = prepare(geometry);
      let margin = relative ? 1e-5 : Infinity; // absolute targets: no safe bound
      const weights = mesh.morphTargetInfluences;
      if (rest) margin = 1e-5;
      else if (weights) for (let k = 0; k < reach.length; k++) margin += Math.abs(weights[k] ?? 0) * reach[k];
      inverse.copy(mesh.matrixWorld).invert();
      localRay.copy(ray).applyMatrix4(inverse);
      // raycaster.far in the mesh's local units (boxes beyond it are skipped).
      const localFar = Number.isFinite(raycaster.far)
        ? farPoint.copy(ray.direction).multiplyScalar(raycaster.far).add(ray.origin).applyMatrix4(inverse).distanceTo(localRay.origin)
        : Infinity;
      const index = geometry.index;
      const position = geometry.attributes.position;
      const vertex = (i) => (index ? index.getX(i) : i);
      const vertexPosition = rest ? (i, target) => target.fromBufferAttribute(position, i) : (i, target) => mesh.getVertexPosition(i, target);
      bvh.shapecast({
        intersectsBounds: (bounds) => {
          if (margin === Infinity) return true;
          const hit = localRay.intersectBox(box.copy(bounds).expandByScalar(margin), entry);
          return hit !== null && hit.distanceTo(localRay.origin) <= localFar;
        },
        intersectsTriangle: (triangle, face) => {
          const a = vertex(face * 3);
          const b = vertex(face * 3 + 1);
          const c = vertex(face * 3 + 2);
          vertexPosition(a, va);
          vertexPosition(b, vb);
          vertexPosition(c, vc);
          if (!localRay.intersectTriangle(va, vb, vc, false, point)) return false;
          point.applyMatrix4(mesh.matrixWorld);
          const distance = ray.origin.distanceTo(point);
          if (distance >= raycaster.near && distance <= raycaster.far) {
            hits.push({ distance, point: point.clone(), object: mesh, face: { a, b, c }, faceIndex: face });
          }
          return false; // keep traversing: every hit is wanted
        },
      });
    }
    return hits.sort((x, y) => x.distance - y.distance);
  }

  /** Builds the hierarchies in idle time so the first hover does not stall. */
  function warmUp(objects) {
    const queue = objects.filter((mesh) => mesh.isMesh && !entries.has(mesh.geometry));
    const idle = window.requestIdleCallback ?? ((callback) => setTimeout(() => callback({ timeRemaining: () => 8 }), 16));
    const step = (deadline) => {
      while (queue.length && deadline.timeRemaining() > 4) prepare(queue.shift().geometry);
      if (queue.length) idle(step);
    };
    idle(step);
  }

  return { intersect, warmUp };
}

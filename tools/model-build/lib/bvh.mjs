/** three-mesh-bvh helpers (closest point, ray casts) for the pipeline. */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function toGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  return geometry;
}

export function buildBVH(mesh) {
  const geometry = toGeometry(mesh);
  const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
  const point = new THREE.Vector3();
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  return {
    bvh,
    geometry,
    /** Distance from [x,y,z] to the surface. */
    distance(p, maxDistance = Infinity) {
      point.set(p[0], p[1], p[2]);
      const hit = bvh.closestPointToPoint(point, target, 0, maxDistance);
      return hit ? hit.distance : Infinity;
    },
    closest(p) {
      point.set(p[0], p[1], p[2]);
      const hit = bvh.closestPointToPoint(point, target);
      return hit ? { point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance, faceIndex: hit.faceIndex } : null;
    },
  };
}

/** Ray caster over a merged set of meshes (used for ambient occlusion). */
export function buildRayCaster(mesh) {
  const geometry = toGeometry(mesh);
  const bvh = new MeshBVH(geometry, { maxLeafTris: 6 });
  const ray = new THREE.Ray();
  return {
    /** Distance to the first hit along (origin, dir) or Infinity. */
    cast(origin, dir, far) {
      ray.origin.set(origin[0], origin[1], origin[2]);
      ray.direction.set(dir[0], dir[1], dir[2]);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far);
      return hit ? hit.distance : Infinity;
    },
  };
}

/** Is a point inside a closed mesh? (odd number of crossings along +x). */
export function buildInsideTest(mesh) {
  const geometry = toGeometry(mesh);
  const bvh = new MeshBVH(geometry);
  const ray = new THREE.Ray();
  const dirs = [
    [1, 0.013, 0.007],
    [-0.011, 1, 0.017],
    [0.009, -0.014, 1],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
  return (p) => {
    let votes = 0;
    for (const d of dirs) {
      ray.origin.set(p[0], p[1], p[2]);
      ray.direction.copy(d);
      const hits = bvh.raycast(ray, THREE.DoubleSide);
      if (hits.length % 2 === 1) votes++;
    }
    return votes >= 2;
  };
}

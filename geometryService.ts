import { Vector3, MathUtils } from 'three';
import { CONFIG, COLORS } from '../constants';
import { ParticleData, PhotoData } from '../types';

const { randFloatSpread, randFloat } = MathUtils;

// Generate positions for a cone spiral (Christmas Tree)
export const calculateTreePosition = (index: number, total: number): Vector3 => {
  const y = (index / total) * CONFIG.TREE_HEIGHT - CONFIG.TREE_HEIGHT / 2;
  const radius = CONFIG.TREE_RADIUS * (1 - (y + CONFIG.TREE_HEIGHT / 2) / CONFIG.TREE_HEIGHT);
  const angle = index * 0.5; // Golden angle approx for nice spiral
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return new Vector3(x, y, z);
};

// Generate positions for a random sphere cloud
export const calculateScatterPosition = (): Vector3 => {
  const theta = randFloat(0, Math.PI * 2);
  const phi = randFloat(0, Math.PI);
  const r = CONFIG.SCATTER_RADIUS * Math.cbrt(randFloat(0, 1)); // Uniform sphere distribution
  
  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta);
  const z = r * Math.cos(phi);
  return new Vector3(x, y, z);
};

export const generateParticles = (count: number): ParticleData[] => {
  const particles: ParticleData[] = [];
  for (let i = 0; i < count; i++) {
    const randomVal = Math.random();
    
    let type: 'SPHERE' | 'CUBE' | 'CANDY' = 'SPHERE';
    let color = COLORS.MATTE_GREEN;
    let scale = 1;

    // Distribution:
    // 50% Green Spheres (Matte)
    // 25% Gold Spheres (Metallic)
    // 15% Red Cubes (Gifts)
    // 10% White/Red Cylinders (Candy/Lights)

    if (randomVal < 0.50) {
        // Matte Green Sphere
        type = 'SPHERE';
        color = COLORS.MATTE_GREEN;
        scale = randFloat(0.15, 0.35);
    } else if (randomVal < 0.75) {
        // Gold Sphere
        type = 'SPHERE';
        color = COLORS.METALLIC_GOLD;
        scale = randFloat(0.2, 0.4);
    } else if (randomVal < 0.90) {
        // Red Cube (Gift)
        type = 'CUBE';
        color = COLORS.CHRISTMAS_RED;
        scale = randFloat(0.2, 0.45);
    } else {
        // Candy (Cylinder)
        type = 'CANDY';
        color = COLORS.WHITE; // Base white, we might rely on light to tint it or just white 'snow' particles
        scale = randFloat(0.1, 0.2); 
    }

    particles.push({
      id: `p-${i}`,
      initialPos: calculateTreePosition(i, count),
      scatterPos: calculateScatterPosition(),
      color,
      type,
      scale,
    });
  }
  return particles;
};

export const processPhotos = (urls: string[]): PhotoData[] => {
    return urls.map((url, i) => {
        // Intersperse photos within the tree structure
        const treeIndex = Math.floor((i / urls.length) * CONFIG.PARTICLE_COUNT);
        const pos = calculateTreePosition(treeIndex, CONFIG.PARTICLE_COUNT);
        // Push them slightly out so they sit on surface
        pos.multiplyScalar(1.3); 

        return {
            id: `photo-${i}`,
            url,
            aspectRatio: 1, // Assume square or handle later
            initialPos: pos,
            scatterPos: calculateScatterPosition(),
        };
    });
}
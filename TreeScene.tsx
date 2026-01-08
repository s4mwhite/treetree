import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Stars, Image as DreiImage } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { AppMode, HandState, ParticleData, PhotoData, HandGesture } from '../types';
import { generateParticles, processPhotos } from '../services/geometryService';
import { COLORS } from '../constants';

// Add missing JSX types for Three.js elements
// We augment both global JSX and React.JSX to cover different TS configurations
declare global {
  namespace JSX {
    interface IntrinsicElements {
      instancedMesh: any;
      group: any;
      ambientLight: any;
      spotLight: any;
      pointLight: any;
      color: any;
    }
  }
}

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            instancedMesh: any;
            group: any;
            ambientLight: any;
            spotLight: any;
            pointLight: any;
            color: any;
        }
    }
}

interface SceneProps {
  mode: AppMode;
  handState: HandState;
  photoUrls: string[];
}

// Generic Instanced Group Manager
const InstancedGroup: React.FC<{ 
    mode: AppMode, 
    particles: ParticleData[], 
    geometry: THREE.BufferGeometry, 
    material: THREE.Material 
}> = ({ mode, particles, geometry, material }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const tempObj = new THREE.Object3D();

    // Initialize colors
    useEffect(() => {
        if (meshRef.current) {
            particles.forEach((p, i) => {
                const color = new THREE.Color(p.color);
                meshRef.current!.setColorAt(i, color);
            });
            if (meshRef.current.instanceColor) {
                meshRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, [particles]);

    // Animation Loop
    useFrame((state, delta) => {
        if (!meshRef.current) return;

        particles.forEach((particle, i) => {
            const targetPos = mode === AppMode.TREE ? particle.initialPos : particle.scatterPos;
            
            // Get current matrix
            meshRef.current!.getMatrixAt(i, tempObj.matrix);
            tempObj.matrix.decompose(tempObj.position, tempObj.quaternion, tempObj.scale);
            
            // Lerp position
            tempObj.position.lerp(targetPos, delta * 2.5);
            
            // Subtle float effect
            if (mode !== AppMode.TREE) {
                tempObj.position.y += Math.sin(state.clock.elapsedTime * 0.5 + i) * 0.005;
                tempObj.rotation.x += 0.01;
                tempObj.rotation.z += 0.01;
            } else {
                // Reset rotation in tree mode
                tempObj.rotation.set(0, 0, 0);
            }
            
            // Apply Rotation to Object3D wrapper
            tempObj.updateMatrix(); // Applies pos/rot/scale to matrix
            
            // Update scale
            tempObj.scale.setScalar(particle.scale);
            tempObj.updateMatrix();
            
            meshRef.current!.setMatrixAt(i, tempObj.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh 
            ref={meshRef} 
            args={[geometry, undefined, particles.length]} 
            material={material}
        />
    );
};

const Ornaments: React.FC<{ mode: AppMode, particles: ParticleData[] }> = ({ mode, particles }) => {
    // 1. Green Spheres (Matte)
    const greenSpheres = useMemo(() => particles.filter(p => p.type === 'SPHERE' && p.color === COLORS.MATTE_GREEN), [particles]);
    
    // 2. Gold Spheres (Metallic)
    const goldSpheres = useMemo(() => particles.filter(p => p.type === 'SPHERE' && p.color === COLORS.METALLIC_GOLD), [particles]);
    
    // 3. Red Cubes (Glossy Gifts)
    const redCubes = useMemo(() => particles.filter(p => p.type === 'CUBE'), [particles]);
    
    // 4. White Cylinders (Candy/Lights)
    const candies = useMemo(() => particles.filter(p => p.type === 'CANDY'), [particles]);

    // Geometries
    const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
    const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
    const cylinderGeo = useMemo(() => new THREE.CylinderGeometry(0.2, 0.2, 2, 8), []);

    // Materials
    const matteGreenMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: COLORS.MATTE_GREEN,
        roughness: 0.7,
        metalness: 0.1,
    }), []);

    const goldMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: COLORS.METALLIC_GOLD,
        roughness: 0.15,
        metalness: 0.9,
        emissive: COLORS.METALLIC_GOLD,
        emissiveIntensity: 0.2,
    }), []);

    const redGlossyMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: COLORS.CHRISTMAS_RED,
        roughness: 0.2,
        metalness: 0.3,
        emissive: COLORS.CHRISTMAS_RED,
        emissiveIntensity: 0.1,
    }), []);

    const whiteMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: COLORS.WHITE,
        roughness: 0.4,
        metalness: 0.1,
        emissive: COLORS.WHITE,
        emissiveIntensity: 0.5,
    }), []);

    return (
        <group>
            {greenSpheres.length > 0 && <InstancedGroup mode={mode} particles={greenSpheres} geometry={sphereGeo} material={matteGreenMat} />}
            {goldSpheres.length > 0 && <InstancedGroup mode={mode} particles={goldSpheres} geometry={sphereGeo} material={goldMat} />}
            {redCubes.length > 0 && <InstancedGroup mode={mode} particles={redCubes} geometry={boxGeo} material={redGlossyMat} />}
            {candies.length > 0 && <InstancedGroup mode={mode} particles={candies} geometry={cylinderGeo} material={whiteMat} />}
        </group>
    );
};

interface PhotoPlaneProps {
    photo: PhotoData;
    mode: AppMode;
    isFocused: boolean;
}

const PhotoPlane: React.FC<PhotoPlaneProps> = ({ photo, mode, isFocused }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const targetPos = useRef(new THREE.Vector3());
    const targetScale = useRef(1);

    useFrame((state, delta) => {
        if (!meshRef.current) return;

        // Determine Targets
        if (mode === AppMode.ZOOM && isFocused) {
            targetPos.current.set(0, 0, 10); // Close to camera
            targetScale.current = 6;
        } else if (mode === AppMode.TREE) {
            targetPos.current.copy(photo.initialPos);
            targetScale.current = 1.5;
        } else {
            // SCATTER
            targetPos.current.copy(photo.scatterPos);
            targetScale.current = 2;
        }

        // Animate
        meshRef.current.position.lerp(targetPos.current, delta * 3);
        const currentScale = meshRef.current.scale.x;
        const nextScale = THREE.MathUtils.lerp(currentScale, targetScale.current, delta * 3);
        meshRef.current.scale.setScalar(nextScale);
        
        // Face camera
        meshRef.current.lookAt(state.camera.position);
    });

    return (
        <DreiImage 
            ref={meshRef}
            url={photo.url} 
            transparent 
            opacity={0.9}
            side={THREE.DoubleSide}
        />
    );
};

// Photo Cloud Component
const PhotoCloud: React.FC<{ mode: AppMode, photos: PhotoData[], focusedPhotoId: string | null }> = ({ mode, photos, focusedPhotoId }) => {
    return (
        <group>
            {photos.map((photo, i) => (
                <PhotoPlane 
                    key={photo.id} 
                    photo={photo} 
                    mode={mode} 
                    isFocused={focusedPhotoId === photo.id} 
                />
            ))}
        </group>
    );
}

const CameraController = ({ handState, mode }: { handState: HandState, mode: AppMode }) => {
    const { camera } = useThree();
    
    useFrame((state, delta) => {
        if (mode === AppMode.SCATTER && handState.isPresent && handState.gesture !== HandGesture.PINCH) {
            // Rotate camera based on hand position
            const targetX = handState.position.x * 10;
            const targetY = handState.position.y * 5;
            
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, delta);
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, delta);
            camera.lookAt(0, 0, 0);
        } else if (mode === AppMode.TREE) {
            // Auto rotate slowly
             const angle = state.clock.elapsedTime * 0.2;
             camera.position.x = Math.sin(angle) * 20;
             camera.position.z = Math.cos(angle) * 20;
             camera.lookAt(0, 0, 0);
        }
    });
    return null;
}

const TreeScene: React.FC<SceneProps> = ({ mode, handState, photoUrls }) => {
  const particles = useMemo(() => generateParticles(450), []);
  const photos = useMemo(() => processPhotos(photoUrls), [photoUrls]);
  
  // Logic to select a photo to zoom into
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === AppMode.ZOOM && photos.length > 0) {
        // Pick a random photo to zoom if none selected, or cycle
        if (!focusedPhotoId) {
            const random = photos[Math.floor(Math.random() * photos.length)];
            setFocusedPhotoId(random.id);
        }
    } else if (mode !== AppMode.ZOOM) {
        setFocusedPhotoId(null);
    }
  }, [mode, photos, focusedPhotoId]);

  return (
    <Canvas camera={{ position: [0, 0, 20], fov: 45 }} gl={{ antialias: true, toneMapping: THREE.ReinhardToneMapping }}>
      <color attach="background" args={['#050505']} />
      
      {/* Cinematic Lighting */}
      <ambientLight intensity={0.2} color={COLORS.MATTE_GREEN} />
      
      {/* Warm Main Key Light */}
      <spotLight position={[10, 20, 10]} angle={0.5} penumbra={1} intensity={2} color={COLORS.METALLIC_GOLD} castShadow />
      
      {/* Fill Light */}
      <pointLight position={[-10, 5, -10]} intensity={1} color={COLORS.CHRISTMAS_RED} />
      
      {/* Rim Light for separation */}
      <spotLight position={[0, -10, 10]} angle={1} intensity={1} color="#4444ff" />

      {/* Environment */}
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" />

      {/* Content */}
      <group>
        <Ornaments mode={mode} particles={particles} />
        <PhotoCloud mode={mode} photos={photos} focusedPhotoId={focusedPhotoId} />
      </group>

      {/* Controls */}
      <CameraController handState={handState} mode={mode} />
      
      {/* Post Processing for Cinematic Glow */}
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.5} mipmapBlur intensity={2.0} radius={0.5} color="#fff8e0" />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </Canvas>
  );
};

export default TreeScene;
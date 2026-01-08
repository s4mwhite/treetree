import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- CONFIGURATION ---
const CONFIG = {
    colors: {
        bg: 0x000000, 
        champagneGold: 0xffd966, 
        deepGreen: 0x03180a,     
        accentRed: 0x990000,     
    },
    particles: {
        count: 1500,     
        dustCount: 2500, 
        treeHeight: 24,  
        treeRadius: 8    
    },
    camera: {
        z: 50 
    }
};

const STATE = {
    mode: 'TREE', 
    focusIndex: -1, 
    focusTarget: null as THREE.Object3D | null,
    hand: { detected: false, x: 0, y: 0 },
    rotation: { x: 0, y: 0 } 
};

class Particle {
    mesh: THREE.Mesh | THREE.Group;
    type: string;
    isDust: boolean;
    posTree: THREE.Vector3;
    posScatter: THREE.Vector3;
    baseScale: number;
    spinSpeed: THREE.Vector3;

    constructor(mesh: THREE.Mesh | THREE.Group, type: string, isDust = false) {
        this.mesh = mesh;
        this.type = type;
        this.isDust = isDust;
        
        this.posTree = new THREE.Vector3();
        this.posScatter = new THREE.Vector3();
        this.baseScale = mesh.scale.x; 

        // Individual Spin Speed
        // Photos spin slower to be readable
        const speedMult = (type === 'PHOTO') ? 0.3 : 2.0;

        this.spinSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult
        );

        this.calculatePositions();
    }

    calculatePositions() {
        // TREE: Tight Spiral
        const h = CONFIG.particles.treeHeight;
        const halfH = h / 2;
        let t = Math.random(); 
        t = Math.pow(t, 0.8); 
        const y = (t * h) - halfH;
        let rMax = CONFIG.particles.treeRadius * (1.0 - t); 
        if (rMax < 0.5) rMax = 0.5;
        const angle = t * 50 * Math.PI + Math.random() * Math.PI; 
        const r = rMax * (0.8 + Math.random() * 0.4); 
        this.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

        // SCATTER: 3D Sphere
        let rScatter = this.isDust ? (12 + Math.random()*20) : (8 + Math.random()*12);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.posScatter.set(
            rScatter * Math.sin(phi) * Math.cos(theta),
            rScatter * Math.sin(phi) * Math.sin(theta),
            rScatter * Math.cos(phi)
        );
    }

    update(dt: number, mode: string, focusTargetMesh: THREE.Object3D | null, camera: THREE.Camera, clock: THREE.Clock, mainGroup: THREE.Group) {
        let target = this.posTree;
        
        if (mode === 'SCATTER') target = this.posScatter;
        else if (mode === 'FOCUS') {
            if (this.mesh === focusTargetMesh) {
                const desiredWorldPos = new THREE.Vector3(0, 2, 35);
                const invMatrix = new THREE.Matrix4().copy(mainGroup.matrixWorld).invert();
                target = desiredWorldPos.applyMatrix4(invMatrix);
            } else {
                target = this.posScatter;
            }
        }

        // Movement Easing
        const lerpSpeed = (mode === 'FOCUS' && this.mesh === focusTargetMesh) ? 5.0 : 2.0; 
        this.mesh.position.lerp(target, lerpSpeed * dt);

        // Rotation Logic
        if (mode === 'SCATTER') {
            this.mesh.rotation.x += this.spinSpeed.x * dt;
            this.mesh.rotation.y += this.spinSpeed.y * dt;
            this.mesh.rotation.z += this.spinSpeed.z * dt;
        } else if (mode === 'TREE') {
            // Reset rotations slowly
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
            this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, dt);
            this.mesh.rotation.y += 0.5 * dt; 
        }
        
        if (mode === 'FOCUS' && this.mesh === focusTargetMesh) {
            this.mesh.lookAt(camera.position); 
        }

        // Scale Logic
        let s = this.baseScale;
        if (this.isDust) {
            s = this.baseScale * (0.8 + 0.4 * Math.sin(clock.elapsedTime * 4 + this.mesh.id));
            if (mode === 'TREE') s = 0; 
        } else if (mode === 'SCATTER' && this.type === 'PHOTO') {
            // Large preview size in scatter
            s = this.baseScale * 2.5; 
        } else if (mode === 'FOCUS') {
            if (this.mesh === focusTargetMesh) s = 4.5; 
            else s = this.baseScale * 0.8; 
        }
        
        this.mesh.scale.lerp(new THREE.Vector3(s,s,s), 4*dt);
    }
}

const App: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Bridge to allow React file input to trigger Three.js scene updates
    const addPhotoRef = useRef<((texture: THREE.Texture) => void) | null>(null);

    useEffect(() => {
        if (!containerRef.current || !videoRef.current) return;

        // Variables
        let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, composer: EffectComposer;
        let mainGroup: THREE.Group;
        let clock = new THREE.Clock();
        let particleSystem: Particle[] = [];
        let photoMeshGroup = new THREE.Group();
        let handLandmarker: HandLandmarker | undefined;
        let caneTexture: THREE.CanvasTexture;
        let animationFrameId: number;

        // Initialization
        const init = async () => {
            initThree();
            setupEnvironment();
            setupLights();
            createTextures();
            createParticles();
            createDust();
            createDefaultPhotos();
            setupPostProcessing();
            await initMediaPipe();
            
            // Expose the addPhoto function to the React component
            addPhotoRef.current = addPhotoToScene;

            setIsLoading(false);
            animate();
        };

        const initThree = () => {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(CONFIG.colors.bg);
            scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.01);

            camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 2, CONFIG.camera.z);

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.toneMapping = THREE.ReinhardToneMapping;
            renderer.toneMappingExposure = 2.2;
            
            if (containerRef.current) {
                containerRef.current.appendChild(renderer.domElement);
            }

            mainGroup = new THREE.Group();
            scene.add(mainGroup);
        };

        const setupEnvironment = () => {
            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        };

        const setupLights = () => {
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambient);

            const innerLight = new THREE.PointLight(0xffaa00, 2, 20);
            innerLight.position.set(0, 5, 0);
            mainGroup.add(innerLight);

            const spotGold = new THREE.SpotLight(0xffcc66, 1200);
            spotGold.position.set(30, 40, 40);
            spotGold.angle = 0.5;
            spotGold.penumbra = 0.5;
            scene.add(spotGold);

            const spotBlue = new THREE.SpotLight(0x6688ff, 600);
            spotBlue.position.set(-30, 20, -30);
            scene.add(spotBlue);
            
            const fill = new THREE.DirectionalLight(0xffeebb, 0.8);
            fill.position.set(0, 0, 50);
            scene.add(fill);
        };

        const setupPostProcessing = () => {
            const renderScene = new RenderPass(scene, camera);
            const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
            bloomPass.threshold = 0.7; 
            bloomPass.strength = 0.45; 
            bloomPass.radius = 0.4;

            composer = new EffectComposer(renderer);
            composer.addPass(renderScene);
            composer.addPass(bloomPass);
        };

        const createTextures = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0,0,128,128);
                ctx.fillStyle = '#880000'; 
                ctx.beginPath();
                for(let i=-128; i<256; i+=32) {
                    ctx.moveTo(i, 0); ctx.lineTo(i+32, 128); ctx.lineTo(i+16, 128); ctx.lineTo(i-16, 0);
                }
                ctx.fill();
            }
            caneTexture = new THREE.CanvasTexture(canvas);
            caneTexture.wrapS = THREE.RepeatWrapping;
            caneTexture.wrapT = THREE.RepeatWrapping;
            caneTexture.repeat.set(3, 3);
        };

        const createParticles = () => {
            const sphereGeo = new THREE.SphereGeometry(0.5, 32, 32); 
            const boxGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55); 
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.3, 0),
                new THREE.Vector3(0.1, 0.5, 0), new THREE.Vector3(0.3, 0.4, 0)
            ]);
            const candyGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);

            const goldMat = new THREE.MeshStandardMaterial({
                color: CONFIG.colors.champagneGold,
                metalness: 1.0, roughness: 0.1,
                envMapIntensity: 2.0, 
                emissive: 0x443300,   
                emissiveIntensity: 0.3
            });

            const greenMat = new THREE.MeshStandardMaterial({
                color: CONFIG.colors.deepGreen,
                metalness: 0.2, roughness: 0.8,
                emissive: 0x002200,
                emissiveIntensity: 0.2 
            });

            const redMat = new THREE.MeshPhysicalMaterial({
                color: CONFIG.colors.accentRed,
                metalness: 0.3, roughness: 0.2, clearcoat: 1.0,
                emissive: 0x330000
            });
            
            const candyMat = new THREE.MeshStandardMaterial({ map: caneTexture, roughness: 0.4 });

            for (let i = 0; i < CONFIG.particles.count; i++) {
                const rand = Math.random();
                let mesh, type;
                
                if (rand < 0.40) {
                    mesh = new THREE.Mesh(boxGeo, greenMat);
                    type = 'BOX';
                } else if (rand < 0.70) {
                    mesh = new THREE.Mesh(boxGeo, goldMat);
                    type = 'GOLD_BOX';
                } else if (rand < 0.92) {
                    mesh = new THREE.Mesh(sphereGeo, goldMat);
                    type = 'GOLD_SPHERE';
                } else if (rand < 0.97) {
                    mesh = new THREE.Mesh(sphereGeo, redMat);
                    type = 'RED';
                } else {
                    mesh = new THREE.Mesh(candyGeo, candyMat);
                    type = 'CANE';
                }

                const s = 0.4 + Math.random() * 0.5;
                mesh.scale.set(s,s,s);
                mesh.rotation.set(Math.random()*6, Math.random()*6, Math.random()*6);
                
                mainGroup.add(mesh);
                particleSystem.push(new Particle(mesh, type, false));
            }

            // --- YELLOW 5-POINTED STAR TOPPER ---
            const starShape = new THREE.Shape();
            const points = 5;
            const outerRadius = 1.6; // Slightly larger for emphasis
            const innerRadius = 0.8;
            
            for (let i = 0; i < points * 2; i++) {
                const r = (i % 2 === 0) ? outerRadius : innerRadius;
                // Correct angle generation to start at Top (90deg / PI/2)
                const step = (Math.PI * 2) / (points * 2);
                // i=0 -> PI/2 (Top)
                const angle = (Math.PI / 2) + (i * step); 
                
                const x = Math.cos(angle) * r;
                const y = Math.sin(angle) * r;
                
                if (i === 0) starShape.moveTo(x, y);
                else starShape.lineTo(x, y);
            }
            starShape.closePath();

            const extrudeSettings = {
                depth: 0.4,
                bevelEnabled: true,
                bevelThickness: 0.1,
                bevelSize: 0.1,
                bevelSegments: 2
            };

            const starGeo = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
            
            // Align "crotch" (inner bottom point) to origin (0,0,0)
            // The inner bottom point is at (0, -innerRadius)
            // Extrusion goes from Z=0 to Z=depth
            // So we translate Y by +innerRadius and Z by -depth/2 to center it
            starGeo.translate(0, innerRadius, -extrudeSettings.depth / 2);

            const starMat = new THREE.MeshStandardMaterial({
                color: 0xffff00, // Pure Yellow
                emissive: 0xffd700, // Gold emission
                emissiveIntensity: 2.0,
                metalness: 0.5,
                roughness: 0.2
            });

            const star = new THREE.Mesh(starGeo, starMat);
            // Position exactly at top of tree
            star.position.set(0, CONFIG.particles.treeHeight/2, 0);
            
            // Add a point light to make it glow
            const starLight = new THREE.PointLight(0xffd700, 2, 25);
            star.add(starLight);

            mainGroup.add(star);
            
            mainGroup.add(photoMeshGroup);
        };

        const createDust = () => {
            const geo = new THREE.TetrahedronGeometry(0.08, 0);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffeebb, transparent: true, opacity: 0.8 });
            
            for(let i=0; i<CONFIG.particles.dustCount; i++) {
                 const mesh = new THREE.Mesh(geo, mat);
                 mesh.scale.setScalar(0.5 + Math.random());
                 mainGroup.add(mesh);
                 particleSystem.push(new Particle(mesh, 'DUST', true));
            }
        };

        const createDefaultPhotos = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#050505'; ctx.fillRect(0,0,512,512);
                ctx.strokeStyle = '#eebb66'; ctx.lineWidth = 15; ctx.strokeRect(20,20,472,472);
                ctx.font = '500 60px Times New Roman'; ctx.fillStyle = '#eebb66';
                ctx.textAlign = 'center'; 
                ctx.fillText("JOYEUX", 256, 230);
                ctx.fillText("NOEL", 256, 300);
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            addPhotoToScene(tex);
        };

        const addPhotoToScene = (texture: THREE.Texture) => {
            const frameGeo = new THREE.BoxGeometry(1.4, 1.4, 0.05);
            const frameMat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.champagneGold, metalness: 1.0, roughness: 0.1 });
            const frame = new THREE.Mesh(frameGeo, frameMat);

            const photoGeo = new THREE.PlaneGeometry(1.2, 1.2);
            const photoMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
            const photo = new THREE.Mesh(photoGeo, photoMat);
            photo.position.z = 0.04;

            const group = new THREE.Group();
            group.add(frame);
            group.add(photo);
            
            const s = 0.8;
            group.scale.set(s,s,s);
            
            photoMeshGroup.add(group);
            particleSystem.push(new Particle(group, 'PHOTO', false));
        };

        const initMediaPipe = async () => {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            
            if (navigator.mediaDevices?.getUserMedia && videoRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoRef.current.srcObject = stream;
                videoRef.current.addEventListener("loadeddata", predictWebcam);
            }
        };

        let lastVideoTime = -1;
        const predictWebcam = () => {
            if (videoRef.current && videoRef.current.currentTime !== lastVideoTime) {
                lastVideoTime = videoRef.current.currentTime;
                if (handLandmarker) {
                    const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
                    processGestures(result);
                }
            }
            animationFrameId = requestAnimationFrame(predictWebcam);
        };

        const processGestures = (result: any) => {
            if (result.landmarks && result.landmarks.length > 0) {
                STATE.hand.detected = true;
                const lm = result.landmarks[0];
                STATE.hand.x = (lm[9].x - 0.5) * 2; 
                STATE.hand.y = (lm[9].y - 0.5) * 2;

                const thumb = lm[4]; const index = lm[8]; const wrist = lm[0];
                const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
                const tips = [lm[8], lm[12], lm[16], lm[20]];
                let avgDist = 0;
                tips.forEach((t: any) => avgDist += Math.hypot(t.x - wrist.x, t.y - wrist.y));
                avgDist /= 4;

                if (pinchDist < 0.05) {
                    if (STATE.mode !== 'FOCUS') {
                        STATE.mode = 'FOCUS';
                        const photos = particleSystem.filter(p => p.type === 'PHOTO');
                        if (photos.length) STATE.focusTarget = photos[Math.floor(Math.random()*photos.length)].mesh;
                    }
                } else if (avgDist < 0.25) {
                    STATE.mode = 'TREE';
                    STATE.focusTarget = null;
                } else if (avgDist > 0.4) {
                    STATE.mode = 'SCATTER';
                    STATE.focusTarget = null;
                }
            } else {
                STATE.hand.detected = false;
            }
        };

        const animate = () => {
            const dt = clock.getDelta();

            // Rotation Logic
            if (STATE.mode === 'SCATTER' && STATE.hand.detected) {
                const targetRotY = STATE.hand.x * Math.PI * 0.9; 
                const targetRotX = STATE.hand.y * Math.PI * 0.25;
                STATE.rotation.y += (targetRotY - STATE.rotation.y) * 3.0 * dt;
                STATE.rotation.x += (targetRotX - STATE.rotation.x) * 3.0 * dt;
            } else {
                if(STATE.mode === 'TREE') {
                    STATE.rotation.y += 0.3 * dt;
                    STATE.rotation.x += (0 - STATE.rotation.x) * 2.0 * dt;
                } else {
                     STATE.rotation.y += 0.1 * dt; 
                }
            }

            mainGroup.rotation.y = STATE.rotation.y;
            mainGroup.rotation.x = STATE.rotation.x;

            particleSystem.forEach(p => p.update(dt, STATE.mode, STATE.focusTarget, camera, clock, mainGroup));
            composer.render();
            
            requestAnimationFrame(animate);
        };

        const resizeHandler = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        };

        window.addEventListener('resize', resizeHandler);
        
        init();

        return () => {
            window.removeEventListener('resize', resizeHandler);
            if (renderer) {
                renderer.dispose();
                // Ensure canvas is removed
                if (renderer.domElement && containerRef.current) {
                    if (containerRef.current.contains(renderer.domElement)) {
                        containerRef.current.removeChild(renderer.domElement);
                    }
                }
            }
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            // Clear ref to prevent stale closure calls
            addPhotoRef.current = null;
        };
    }, []);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if(!files || !files.length) return;
        
        Array.from(files).forEach((file) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const result = ev.target?.result as string;
                if (result) {
                    new THREE.TextureLoader().load(result, (texture) => {
                        texture.colorSpace = THREE.SRGBColorSpace;
                        // Use the ref to call the Three.js internal function
                        if (addPhotoRef.current) {
                            addPhotoRef.current(texture);
                        }
                    });
                }
            };
            reader.readAsDataURL(file);
        });
    };

    return (
        <>
            {isLoading && (
                <div id="loader">
                    <div className="spinner"></div>
                    <div className="loader-text">Loading Holiday Magic</div>
                </div>
            )}
            
            <div id="canvas-container" ref={containerRef}></div>

            <div id="ui-layer">
                <h1>Merry Christmas</h1>
                
                <div className="upload-wrapper">
                    <label className="upload-btn">
                        Add Memories
                        <input type="file" className="hidden" multiple accept="image/*" onChange={handleFileUpload} />
                    </label>
                    {/* Gesture hint text removed per request */}
                </div>
            </div>

            <div id="webcam-wrapper">
                <video ref={videoRef} id="webcam" autoPlay playsInline style={{display:'none'}}></video>
            </div>
        </>
    );
};

export default App;
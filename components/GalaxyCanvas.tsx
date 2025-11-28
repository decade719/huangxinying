import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { initializeHandLandmarker } from '../services/visionService';
import { HandLandmarker } from '@mediapipe/tasks-vision';

// --- SHADERS ---

const vertexShader = `
  uniform float uTime;
  attribute float aOffset;
  attribute float aSpeed;
  attribute vec3 aDirection;
  
  varying float vAlpha;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    
    // Dynamics: Cycle from 0 to maxRadius
    float maxRadius = 6.0;
    
    // Time-based expansion
    // aOffset ensures particles are distributed throughout the volume initially
    float t = uTime * aSpeed * 0.8 + aOffset; 
    
    // Modulo gives us the repeating "birth -> death" cycle
    float r = mod(t, maxRadius); 
    
    // Logarithmic distribution for "explosive" inner growth, slowing down at edges
    float dist = r;

    // SPIRAL EFFECT
    // Rotate particles around the Y-axis as they move outward
    // The angle increases with distance to create a galaxy spiral arms look
    float twistStrength = 2.0; 
    float angle = dist * twistStrength * 0.2; 
    float c = cos(angle);
    float s = sin(angle);
    mat2 rot = mat2(c, -s, s, c);

    // Initial position based on random direction on sphere surface
    vec3 pos = aDirection * dist;
    
    // Apply spiral twist to X and Z coords
    pos.xz = rot * pos.xz;
    
    // Add some vertical sine wave drift for "floating" feel
    pos.y += sin(uTime * 2.0 + aOffset) * 0.1;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Size attenuation
    float sizeBase = 250.0; 
    // Particles start small, grow, then stay roughly same size
    float growth = smoothstep(0.0, 1.0, dist); 
    gl_PointSize = sizeBase * (0.5 + growth * 0.5) * (1.0 / -mvPosition.z);

    // Alpha Logic (Dynamic Balance):
    // 1. Fade In quickly at center (birth)
    // 2. Fade Out gradually at edge (death)
    float normalizedR = r / maxRadius;
    float fadeIn = smoothstep(0.0, 0.1, normalizedR);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, normalizedR);
    
    vAlpha = fadeIn * fadeOut;
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    // Correct UV orientation for Points:
    // gl_PointCoord (0,0) is top-left.
    // Texture (0,0) is bottom-left (Standard GL) or top-left (Canvas).
    // By default Three.js flips Textures Y.
    // So we use standard mapping: 1.0 - y matches Texture V=1 (Top) to Point Top.
    vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
    
    vec4 texColor = texture2D(uTexture, uv);
    
    if (texColor.a < 0.05) discard;

    // Boost brightness for glow effect (Increased from 1.5 to 2.2 for stronger bloom)
    vec3 glowColor = uColor * 2.2;
    
    gl_FragColor = vec4(glowColor, 1.0) * texColor * vAlpha;
  }
`;

// --- TEXTURE GENERATION HELPERS ---

const setupCanvas = (size: number, colorHex: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const centerX = size / 2;
  const centerY = size / 2;

  // 1. Radial Background Glow (Halos)
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size / 2);
  const c = new THREE.Color(colorHex);
  const r = Math.floor(c.r * 255);
  const g = Math.floor(c.g * 255);
  const b = Math.floor(c.b * 255);

  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.8)`);
  gradient.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.3)`);
  gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.05)`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Setup glow for the main content
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 1.0)`;
  ctx.shadowBlur = 40;
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'; // Core is white

  return { ctx, canvas, size, centerX, centerY };
};

const createTextTexture = (text: string, colorHex: string, fontFamily: string): THREE.Texture => {
  const setup = setupCanvas(512, colorHex);
  if (!setup) return new THREE.Texture();
  const { ctx, canvas, size, centerX, centerY } = setup;

  ctx.font = `240px "${fontFamily}", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  ctx.fillText(text, centerX, centerY);
  // Double pass for extra glow
  ctx.shadowBlur = 20;
  ctx.fillText(text, centerX, centerY);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const createShapeTexture = (shape: 'star' | 'heart' | 'circle' | 'diamond', colorHex: string): THREE.Texture => {
  const setup = setupCanvas(512, colorHex);
  if (!setup) return new THREE.Texture();
  const { ctx, canvas, centerX, centerY } = setup;
  
  const radius = 120;

  ctx.beginPath();
  
  if (shape === 'circle') {
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  } else if (shape === 'star') {
    const spikes = 5;
    const outerRadius = radius;
    const innerRadius = radius / 2;
    let rot = Math.PI / 2 * 3;
    let x = centerX;
    let y = centerY;
    let step = Math.PI / spikes;

    ctx.moveTo(centerX, centerY - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = centerX + Math.cos(rot) * outerRadius;
        y = centerY + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = centerX + Math.cos(rot) * innerRadius;
        y = centerY + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(centerX, centerY - outerRadius);
  } else if (shape === 'heart') {
    // Custom Bezier Heart
    const topCurveHeight = radius * 0.8; 
    ctx.moveTo(centerX, centerY + radius * 0.6);
    // Left side
    ctx.bezierCurveTo(
      centerX - radius, centerY - radius * 0.5, 
      centerX - radius, centerY - radius * 1.5, 
      centerX, centerY - topCurveHeight
    );
    // Right side
    ctx.bezierCurveTo(
      centerX + radius, centerY - radius * 1.5, 
      centerX + radius, centerY - radius * 0.5, 
      centerX, centerY + radius * 0.6
    );
  } else if (shape === 'diamond') {
    ctx.moveTo(centerX, centerY - radius * 1.2);
    ctx.lineTo(centerX + radius, centerY);
    ctx.lineTo(centerX, centerY + radius * 1.2);
    ctx.lineTo(centerX - radius, centerY);
    ctx.closePath();
  }

  ctx.fill();
  
  // Double pass for extra glow
  ctx.shadowBlur = 20;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

// --- REALISTIC EARTH CREATION ---
const createEarth = () => {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();

  // Textures from Three.js examples repository
  const earthMap = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
  const earthSpecular = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');
  const earthNormal = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
  const earthClouds = loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png');

  // 1. Earth Surface (Phong for ocean specular highlights)
  const geometry = new THREE.SphereGeometry(1.2, 64, 64);
  const material = new THREE.MeshPhongMaterial({
    map: earthMap,
    specularMap: earthSpecular,
    normalMap: earthNormal,
    specular: new THREE.Color(0x333333),
    shininess: 15
  });
  const earth = new THREE.Mesh(geometry, material);
  group.add(earth);

  // 2. Atmosphere/Clouds
  const cloudGeometry = new THREE.SphereGeometry(1.22, 64, 64);
  const cloudMaterial = new THREE.MeshLambertMaterial({
    map: earthClouds,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  group.add(clouds);

  // 3. Simple Glow Sprite (Atmospheric haze)
  const spriteMaterial = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(generateGlowTexture()),
    color: 0x44aaff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending
  });
  const glowSprite = new THREE.Sprite(spriteMaterial);
  glowSprite.scale.set(3.0, 3.0, 1.0);
  group.add(glowSprite);

  return { group, earth, clouds };
};

const generateGlowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(0.2, 'rgba(0, 255, 255, 0.2)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 64, 0.0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return canvas;
};

const GalaxyCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>("INITIALIZING...");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fontLoaded, setFontLoaded] = useState<boolean>(false);

  // Preload font check
  useEffect(() => {
    document.fonts.ready.then(() => {
      setFontLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || !videoRef.current || !fontLoaded) return;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let animationId: number;
    let handLandmarker: HandLandmarker | null = null;
    let lastVideoTime = -1;

    // Interaction State
    let targetScale = 1.0;
    let currentScale = 1.0;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let currentTiltX = 0;
    let currentTiltY = 0;
    
    const uniformsPerChar: { [key: string]: any } = {};
    const manipulationGroup = new THREE.Group();
    const planetGroup = new THREE.Group();
    let earthMesh: THREE.Mesh | null = null;
    let cloudMesh: THREE.Mesh | null = null;

    const initScene = () => {
      scene = new THREE.Scene();
      // Use a textured background or simple dark fog
      scene.fog = new THREE.FogExp2(0x000000, 0.02);

      camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.z = 10;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      containerRef.current?.appendChild(renderer.domElement);

      scene.add(manipulationGroup);
      manipulationGroup.add(planetGroup);

      // --- Lighting ---
      const ambientLight = new THREE.AmbientLight(0x333333);
      scene.add(ambientLight);
      
      const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
      dirLight.position.set(5, 3, 5);
      scene.add(dirLight);

      // --- Add Realistic Earth ---
      const { group: earthGroup, earth, clouds } = createEarth();
      earthMesh = earth;
      cloudMesh = clouds;
      planetGroup.add(earthGroup);

      // --- Create Dynamic Particle Systems ---
      const totalParticles = 1400; 
      
      const fonts = [
        "Ma Shan Zheng", 
        "ZCOOL XiaoWei", 
        "Long Cang", 
        "Zhi Mang Xing", 
        "Liu Jian Mao Cao",
        "Noto Serif SC"
      ];

      // Mixed content array: Characters and Shapes
      const items = [
        // "Huang" - Gold
        { type: 'text', value: 'H', color: '#FFD700' },
        { type: 'text', value: 'u', color: '#FFD700' },
        { type: 'text', value: 'a', color: '#FFD700' },
        { type: 'text', value: 'n', color: '#FFD700' },
        { type: 'text', value: 'g', color: '#FFD700' },

        // "Xin" - Pink
        { type: 'text', value: 'X', color: '#FF69B4' },
        { type: 'text', value: 'i', color: '#FF69B4' },
        { type: 'text', value: 'n', color: '#FF69B4' },

        // "Ying" - Cyan
        { type: 'text', value: 'Y', color: '#00FFFF' },
        { type: 'text', value: 'i', color: '#00FFFF' },
        { type: 'text', value: 'n', color: '#00FFFF' },
        { type: 'text', value: 'g', color: '#00FFFF' },
        
        // Shapes with Expanded Colors
        { type: 'shape', value: 'star', color: '#FF8C00' },   // Orange Star
        { type: 'shape', value: 'heart', color: '#FF0055' },  // Red Heart
        { type: 'shape', value: 'circle', color: '#FFFFFF' }, // White Orb
        { type: 'shape', value: 'diamond', color: '#9D00FF' },// Purple Diamond
        { type: 'shape', value: 'star', color: '#32CD32' },   // Lime Green Star
        { type: 'shape', value: 'circle', color: '#00BFFF' }  // Deep Sky Blue Orb
      ];

      items.forEach((item, index) => {
        const count = totalParticles / items.length;
        const geometry = new THREE.BufferGeometry();
        
        const offsets = [];
        const speeds = [];
        const directions = [];

        for (let i = 0; i < count; i++) {
          // 1. Random Direction (Uniform on Sphere Surface)
          const u = Math.random();
          const v = Math.random();
          const theta = 2 * Math.PI * u;
          const phi = Math.acos(2 * v - 1);

          const x = Math.sin(phi) * Math.cos(theta);
          const y = Math.sin(phi) * Math.sin(theta);
          const z = Math.cos(phi);
          directions.push(x, y, z);

          // 2. Random Start Offset (0 to maxRadius 6.0)
          offsets.push(Math.random() * 6.0);

          // 3. Speed (Variation for organic flow)
          speeds.push(0.3 + Math.random() * 0.4);
        }

        geometry.setAttribute('aDirection', new THREE.Float32BufferAttribute(directions, 3));
        geometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 1));
        geometry.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speeds, 1));
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(directions, 3));

        let texture;
        if (item.type === 'text') {
           const randomFont = fonts[Math.floor(Math.random() * fonts.length)];
           texture = createTextTexture(item.value, item.color, randomFont);
        } else {
           texture = createShapeTexture(item.value as any, item.color);
        }
        
        uniformsPerChar[index] = {
          uTime: { value: 0 },
          uTexture: { value: texture },
          uColor: { value: new THREE.Color(item.color) }
        };

        const material = new THREE.ShaderMaterial({
          uniforms: uniformsPerChar[index],
          vertexShader: vertexShader,
          fragmentShader: fragmentShader,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false; 
        planetGroup.add(points);
      });
    };

    const startVision = async () => {
      try {
        handLandmarker = await initializeHandLandmarker();
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener("loadeddata", () => {
            setIsLoading(false);
            setStatus("SYSTEM READY");
            predictWebcam();
          });
        }
      } catch (error) {
        console.error("Error initializing vision:", error);
        setStatus("CAMERA ERROR");
        setIsLoading(false);
      }
    };

    const predictWebcam = () => {
      if (!handLandmarker || !videoRef.current) return;
      
      const now = performance.now();
      if (videoRef.current.currentTime !== lastVideoTime) {
        lastVideoTime = videoRef.current.currentTime;
        const results = handLandmarker.detectForVideo(videoRef.current, now);

        if (results.landmarks && results.landmarks.length > 0) {
          setStatus("HAND LOCKED");
          const landmarks = results.landmarks[0];

          // Pinch Scale
          const thumb = landmarks[4];
          const indexFinger = landmarks[8];
          const dist = Math.sqrt(Math.pow(thumb.x - indexFinger.x, 2) + Math.pow(thumb.y - indexFinger.y, 2));
          const clampDist = Math.max(0.02, Math.min(0.3, dist));
          targetScale = 0.5 + ((clampDist - 0.02) / 0.28) * 4.5;

          // Rotation
          const handCenter = landmarks[9];
          targetTiltY = (handCenter.x - 0.5) * -3.0; 
          targetTiltX = (handCenter.y - 0.5) * 3.0;
        } else {
          setStatus("SCANNING SPACE...");
        }
      }
      requestAnimationFrame(predictWebcam);
    };

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const time = performance.now() * 0.001;

      // Update Uniforms
      Object.keys(uniformsPerChar).forEach(key => {
        uniformsPerChar[key].uTime.value = time;
      });

      // Animate Earth Rotation
      if (earthMesh && cloudMesh) {
        earthMesh.rotation.y = time * 0.05;
        cloudMesh.rotation.y = time * 0.07; // Clouds move slightly faster
      }

      // Smooth interaction
      const lerpFactor = 0.1;
      currentScale += (targetScale - currentScale) * lerpFactor;
      currentTiltX += (targetTiltX - currentTiltX) * lerpFactor;
      currentTiltY += (targetTiltY - currentTiltY) * lerpFactor;

      manipulationGroup.scale.set(currentScale, currentScale, currentScale);
      manipulationGroup.rotation.x = currentTiltX;
      manipulationGroup.rotation.y = currentTiltY;
      
      // Gentle auto-rotation of the whole system
      planetGroup.rotation.y = time * 0.1;

      renderer.render(scene, camera);
    };

    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    initScene();
    startVision();
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      if (renderer) renderer.dispose();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [fontLoaded]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#121212_0%,_#000000_100%)] -z-10" />

      <div className="absolute top-6 left-6 z-10 pointer-events-none font-serif">
        <h1 style={{ fontFamily: '"Ma Shan Zheng", cursive' }} className="text-4xl tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 via-pink-400 to-cyan-400 mb-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">
          Huang Xinying
        </h1>
        <div className="flex items-center gap-2 font-mono">
          <div className={`w-1 h-4 ${status === 'HAND LOCKED' ? 'bg-cyan-400 shadow-[0_0_10px_#22d3ee]' : 'bg-gray-600'}`}></div>
          <span className="text-xs text-gray-400 tracking-widest">{status}</span>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/90 text-cyan-200 font-serif tracking-[0.3em] text-lg animate-pulse" style={{ fontFamily: '"Ma Shan Zheng", cursive' }}>
          LOADING GALAXY...
        </div>
      )}

      <video ref={videoRef} className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none" autoPlay playsInline muted />
      <div ref={containerRef} className="w-full h-full z-0" />
    </div>
  );
};

export default GalaxyCanvas;
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

// Particle shapes and gesture logic are based on the user's supplied script.js.
// The IDs are adapted to the existing minimal Orb Gesture Visualizer UI.
const canvas = document.querySelector('#scene');
const trailCanvas = document.querySelector('#trail');
const trailCtx = trailCanvas.getContext('2d');
const video = document.querySelector('#camera');
const startBtn = document.querySelector('#start');
const welcome = document.querySelector('#welcome');
const errorEl = document.querySelector('#error');

let landmarker = null, stream = null, lastVideoTime = -1;
let activeMode = 'free', particleCount = 2400, lastGesture = '', gestureSince = 0, lastModeChange = 0;
let handSeen = false, fingerPoint = null, noHandSince = 0;
let W = innerWidth, H = innerHeight;

// Tornado tracking state
let circleHistory = [];
let lastCircleTime = 0;
let tornadoIntensity = 0;
let tornadoDir = 1;

// Flower bloom tracking state
let bloomStartTime = 0;

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(W, H); renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
camera.position.z = 15;
const geometry = new THREE.BufferGeometry();
let positions = new Float32Array(particleCount * 3);
let targets = new Float32Array(particleCount * 3);
let colors = new Float32Array(particleCount * 3);
let orbOffsets = new Float32Array(particleCount * 3);
const material = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
const points = new THREE.Points(geometry, material); scene.add(points);
const colorPink = new THREE.Color('#ff4caa'), colorBlue = new THREE.Color('#5c9dff'), colorOrange = new THREE.Color('#ff9c48'), colorWhite = new THREE.Color('#fff0fa');
const rand = (a, b) => a + Math.random() * (b - a);

// 6 dynamic orbs placed across the screen with independent motion paths and vibrant palettes
const orbConfigs = [
  { bx: 0,    by: 0.5,  bz: 0,    ax: 2.8, ay: 1.8, az: 1.5, sx: 0.90, sy: 0.75, sz: 0.65, px: 0.0, py: 0.0, pz: 0.0, color: new THREE.Color('#ff8a00'), radius: 1.4 },  // Center Amber Sun
  { bx: -5.6, by: 2.8,  bz: 0.6,  ax: 2.4, ay: 1.6, az: 1.2, sx: 1.05, sy: 1.15, sz: 0.85, px: 1.3, py: 2.2, pz: 0.7, color: new THREE.Color('#00e5ff'), radius: 1.25 }, // Top-Left Electric Cyan
  { bx: 5.6,  by: 2.6,  bz: -0.6, ax: 2.5, ay: 1.7, az: 1.3, sx: 0.80, sy: 0.95, sz: 0.75, px: 3.5, py: 1.1, pz: 2.1, color: new THREE.Color('#ff2a85'), radius: 1.25 }, // Top-Right Hot Magenta
  { bx: -5.3, by: -2.8, bz: -0.5, ax: 2.6, ay: 1.5, az: 1.1, sx: 1.10, sy: 0.85, sz: 0.95, px: 2.6, py: 3.6, pz: 1.3, color: new THREE.Color('#a855f7'), radius: 1.2 },  // Bottom-Left Violet
  { bx: 5.3,  by: -2.6, bz: 0.5,  ax: 2.3, ay: 1.8, az: 1.2, sx: 0.85, sy: 1.05, sz: 0.70, px: 4.3, py: 0.9, pz: 3.2, color: new THREE.Color('#00f59b'), radius: 1.2 },  // Bottom-Right Emerald
  { bx: 0,    by: -3.4, bz: -1.0, ax: 3.2, ay: 1.4, az: 1.6, sx: 0.95, sy: 0.90, sz: 0.80, px: 5.2, py: 2.8, pz: 1.9, color: new THREE.Color('#ffbe0b'), radius: 1.35 }, // Bottom-Center Golden Glow
];

function setParticleColor(i, c) {
  colors[i * 3] = c.r * rand(.75, 1.1);
  colors[i * 3 + 1] = c.g * rand(.75, 1.1);
  colors[i * 3 + 2] = c.b * rand(.75, 1.1);
}
function makeTargets(mode, textValue = 'I LOVE YOU') {
  const textCanvas = document.createElement('canvas');
  const ctx = textCanvas.getContext('2d');
  const textPixels = [];
  if (mode === 'text') {
    textCanvas.width = 1000; textCanvas.height = 320;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fontSize = textValue.length > 14 ? 72 : textValue.length > 8 ? 94 : 130;
    ctx.font = `800 ${fontSize}px Arial`;
    ctx.fillText(textValue.toUpperCase(), 500, 160, 940);
    const data = ctx.getImageData(0, 0, 1000, 320).data;
    for (let y = 0; y < 320; y += 3) for (let x = 0; x < 1000; x += 3) {
      if (data[(y * 1000 + x) * 4 + 3] > 100) textPixels.push([(x - 500) / 70, -(y - 160) / 70]);
    }
  }
  const nextTargets = new Float32Array(particleCount * 3);
  const nextColors = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    let x = 0, y = 0, z = 0, c;
    if (mode === 'heart') {
      // 3D Volumetric Beating Heart with rich depth & radiant gradient
      const t = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.35);
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const depthMax = Math.sin(t) * 4.5 * (1 - Math.abs(hy) / 20);
      const hz = rand(-1, 1) * Math.max(0.35, Math.abs(depthMax)) * r;
      
      x = hx * 0.22 * r;
      y = (hy * 0.22 + 0.35) * r;
      z = hz * 0.26;
      
      const dist = Math.hypot(x, y);
      if (dist < 0.75) {
        c = Math.random() > 0.4 ? colorWhite : new THREE.Color('#ffe4e6');
      } else if (Math.random() > 0.35) {
        c = new THREE.Color('#ff007f'); // Vivid Neon Pink
      } else {
        c = new THREE.Color('#e11d48'); // Passion Ruby Crimson
      }
    } else if (mode === 'flower') {
      // 3D Multi-Layered Blooming Blossom with golden pistil, layered petals & stem leaves
      const coreCount = 340;
      const innerCount = 500;
      const midCount = 650;
      const outerCount = 650;
      
      if (i < coreCount) {
        // Glowing Golden Core Pistil
        const u = rand(-1, 1), theta = rand(0, Math.PI * 2), r = 0.55 * Math.cbrt(Math.random());
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        x = r * s * Math.cos(theta);
        y = r * u + 0.3;
        z = r * s * Math.sin(theta) + 0.35;
        c = Math.random() > 0.35 ? new THREE.Color('#ffd700') : new THREE.Color('#fff9db');
      } else if (i < coreCount + innerCount) {
        // Inner Petals (5 petals, curled cup-like)
        const numPetals = 5;
        const theta = rand(0, Math.PI * 2);
        const petalShape = Math.pow(Math.abs(Math.sin((numPetals * theta) / 2)), 0.65);
        const petalR = (0.5 + petalShape * 1.15) * rand(0.65, 1.0);
        x = Math.cos(theta) * petalR;
        y = Math.sin(theta) * petalR + 0.25;
        z = -Math.pow(petalR / 1.6, 2) * 0.65 + 0.35 + rand(-0.08, 0.08);
        c = new THREE.Color('#ff2d92'); // Vibrant Hot Pink
      } else if (i < coreCount + innerCount + midCount) {
        // Middle Petals (7 petals, spreading outward)
        const numPetals = 7;
        const theta = rand(0, Math.PI * 2);
        const petalShape = Math.pow(Math.abs(Math.sin((numPetals * theta) / 2)), 0.7);
        const petalR = (1.2 + petalShape * 1.55) * rand(0.7, 1.0);
        x = Math.cos(theta) * petalR;
        y = Math.sin(theta) * petalR + 0.15;
        z = -Math.pow(petalR / 2.7, 2) * 0.8 + 0.2 + rand(-0.1, 0.1);
        c = new THREE.Color('#d946ef'); // Royal Orchid Fuchsia
      } else if (i < coreCount + innerCount + midCount + outerCount) {
        // Outer Petals (9 broad graceful blooming petals)
        const numPetals = 9;
        const theta = rand(0, Math.PI * 2);
        const petalShape = Math.pow(Math.abs(Math.sin((numPetals * theta) / 2)), 0.75);
        const petalR = (2.2 + petalShape * 1.85) * rand(0.75, 1.0);
        x = Math.cos(theta) * petalR;
        y = Math.sin(theta) * petalR;
        z = -Math.pow(petalR / 4.0, 2) * 0.95 + rand(-0.12, 0.12);
        c = Math.random() > 0.4 ? new THREE.Color('#ec4899') : new THREE.Color('#f472b6');
      } else {
        // Stem & Leaves at the base
        if (Math.random() > 0.45) {
          // Graceful curving stem
          const progress = rand(0, 1);
          y = -0.3 - progress * 3.6;
          x = Math.sin(progress * 1.8) * 0.4 + rand(-0.06, 0.06);
          z = rand(-0.1, 0.1) - progress * 0.3;
          c = new THREE.Color('#10b981'); // Emerald Green
        } else {
          // Emerald leaves branching left and right
          const side = Math.random() > 0.5 ? 1 : -1;
          const leafLen = rand(0.3, 1.9);
          const leafWidth = Math.sin(rand(0, Math.PI)) * 0.65;
          x = side * (0.35 + leafLen * 1.1) + rand(-0.05, 0.05);
          y = -1.8 + (side > 0 ? 0.3 : -0.2) + Math.sin(leafLen) * 0.4 + leafWidth * rand(-0.4, 0.4);
          z = -0.3 + rand(-0.15, 0.15);
          c = new THREE.Color('#34d399'); // Mint Emerald
        }
      }
    } else if (mode === 'orb') {
      // Multiple orbs distributed across the screen
      const k = i % orbConfigs.length;
      const cfg = orbConfigs[k];
      const u = rand(-1, 1), theta = rand(0, Math.PI * 2), r = cfg.radius * Math.cbrt(Math.random()), s = Math.sqrt(Math.max(0, 1 - u * u));
      const lx = r * s * Math.cos(theta);
      const ly = r * u;
      const lz = r * s * Math.sin(theta);
      orbOffsets[i * 3] = lx;
      orbOffsets[i * 3 + 1] = ly;
      orbOffsets[i * 3 + 2] = lz;
      x = cfg.bx + lx;
      y = cfg.by + ly;
      z = cfg.bz + lz;
      c = cfg.color;
    } else if (mode === 'text' && textPixels.length) {
      const p = textPixels[(Math.random() * textPixels.length) | 0];
      x = p[0] + rand(-.04, .04); y = p[1] + rand(-.04, .04); z = rand(-.18, .18); c = colorWhite;
    } else if (mode === 'chayma') {
      if (!textPixels.length) {
        textCanvas.width = 1000; textCanvas.height = 320;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '800 130px Arial'; ctx.fillText('CHAYMA', 500, 160, 940);
        const data = ctx.getImageData(0, 0, 1000, 320).data;
        for (let yy = 0; yy < 320; yy += 3) for (let xx = 0; xx < 1000; xx += 3) if (data[(yy * 1000 + xx) * 4 + 3] > 100) textPixels.push([(xx - 500) / 70, -(yy - 160) / 70]);
      }
      const p = textPixels[(Math.random() * Math.max(1, textPixels.length)) | 0] || [rand(-3,3), rand(-1,1)];
      x = p[0] + rand(-.04, .04); y = p[1] + rand(-.04, .04); z = rand(-.18, .18); c = colorPink;
    } else if (mode === 'swirl') {
      const a = i * 2.399, r = Math.sqrt(i / particleCount) * 4.6;
      x = Math.cos(a) * r; y = Math.sin(a) * r * .7; z = rand(-1.5, 1.5); c = colorPink;
    } else {
      // First form: cosmic celestial particle field
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 5.2;
      x = Math.cos(a) * r; y = Math.sin(a) * r * .75; z = rand(-2.5, 2.5);
      c = Math.random() > .5 ? colorBlue : colorPink;
    }
    nextTargets.set([x, y, z], i * 3);
    nextColors[i * 3] = c.r * rand(.75, 1.1); nextColors[i * 3 + 1] = c.g * rand(.75, 1.1); nextColors[i * 3 + 2] = c.b * rand(.75, 1.1);
  }
  targets = nextTargets; colors = nextColors;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}
function setMode(mode) { if (activeMode === mode) return; activeMode = mode; makeTargets(mode); }
function fingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y; }
function classify(lm) {
  const index = fingerUp(lm, 8, 6), middle = fingerUp(lm, 12, 10), ring = fingerUp(lm, 16, 14), pinky = fingerUp(lm, 20, 18);
  const count = [index, middle, ring, pinky].filter(Boolean).length;
  
  // Fist -> Orbs formation
  if (count === 0) return 'fist';
  
  // Hand circle gesture (OK sign / ring formed by thumb & index tips touching 👌):
  const thumbIndexDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  if (thumbIndexDist < 0.065 && (middle || ring || pinky)) {
    return 'circle';
  }
  // Also recognize curling all fingers together to form an 'O' ring
  const thumbMiddleDist = Math.hypot(lm[4].x - lm[12].x, lm[4].y - lm[12].y);
  if (thumbIndexDist < 0.075 && thumbMiddleDist < 0.085 && !index) {
    return 'circle';
  }
  
  // Pointing with index finger
  if (count === 1 && index) return 'point';
  
  // Peace sign (2 fingers: index & middle) -> 'I LOVE YOU'
  if (count === 2 && index && middle && !ring && !pinky) return 'love';
  
  // 3 fingers -> 'CHAYMA'
  if (count === 3 && index && middle && ring && !pinky) return 'chayma';
  
  // 4 fingers or Free Palm:
  if (count === 4) {
    const thumbDist = Math.hypot(lm[4].x - lm[9].x, lm[4].y - lm[9].y);
    // If thumb is tucked against palm, it's 4 fingers -> Cool Heart!
    // If thumb is extended outward, it's a full free palm -> back to first form ('free')
    if (thumbDist < 0.175) {
      return 'bigheart';
    } else {
      return 'open';
    }
  }
  
  // Finger heart / Horns gesture backup -> Heart
  if ((index && pinky && !middle && !ring) || (thumbIndexDist < 0.055 && !middle && !ring)) return 'bigheart';
  
  return 'open';
}
function onGesture(gesture, lm) {
  const now = performance.now();
  if (gesture !== lastGesture) { lastGesture = gesture; gestureSince = now; }
  if (gesture === 'point') {
    const p = lm[8];
    fingerPoint = { x: (0.5 - p.x) * 12, y: (0.5 - p.y) * 7 };
    if (activeMode !== 'draw') activeMode = 'draw';
    
    // Circle trajectory detection for Tornado
    circleHistory.push({ x: fingerPoint.x, y: fingerPoint.y, t: now });
    while (circleHistory.length > 0 && now - circleHistory[0].t > 1100) {
      circleHistory.shift();
    }
    
    if (circleHistory.length >= 8) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let cx = 0, cy = 0;
      for (const pt of circleHistory) {
        cx += pt.x; cy += pt.y;
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
      }
      cx /= circleHistory.length;
      cy /= circleHistory.length;
      const spreadX = maxX - minX;
      const spreadY = maxY - minY;
      
      // Minimum circular sweep area
      if (spreadX > 0.45 && spreadY > 0.45) {
        let totalAng = 0;
        let prevAng = Math.atan2(circleHistory[0].y - cy, circleHistory[0].x - cx);
        for (let k = 1; k < circleHistory.length; k++) {
          const ang = Math.atan2(circleHistory[k].y - cy, circleHistory[k].x - cx);
          let diff = ang - prevAng;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          totalAng += diff;
          prevAng = ang;
        }
        if (Math.abs(totalAng) >= 1.55 * Math.PI) {
          lastCircleTime = now;
          tornadoDir = Math.sign(totalAng) || 1;
        }
      }
    }
    return;
  } else {
    circleHistory = [];
  }
  fingerPoint = null;
  if (now - gestureSince < 140 || now - lastModeChange < 300) return;
  let next = null;
  if (gesture === 'love') next = 'text';
  else if (gesture === 'chayma') next = 'chayma';
  else if (gesture === 'bigheart') next = 'heart';
  else if (gesture === 'circle') next = 'flower';
  else if (gesture === 'fist') next = 'orb';
  else if (gesture === 'open') next = 'free';
  else if (gesture === 'hand') next = 'free';
  if (next && activeMode !== next) {
    activeMode = next;
    if (next === 'flower') bloomStartTime = now;
    makeTargets(next, next === 'text' ? 'I LOVE YOU' : next === 'chayma' ? 'CHAYMA' : 'I LOVE YOU');
    lastModeChange = now;
  }
}
async function startCamera() {
  startBtn.disabled = true; startBtn.textContent = 'Connecting…'; errorEl.textContent = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost. Use VS Code Live Server.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play();
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 1
    });
    welcome.style.display = 'none';
  } catch (err) {
    console.error(err); errorEl.textContent = err.message || 'Could not start camera. Check permissions and try again.';
    startBtn.disabled = false; startBtn.textContent = 'Try again';
  }
}
startBtn.addEventListener('click', startCamera);
function trackHand() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, performance.now());
  if (result.landmarks?.length) { handSeen = true; noHandSince = 0; onGesture(classify(result.landmarks[0]), result.landmarks[0]); }
  else {
    handSeen = false; fingerPoint = null; circleHistory = [];
    const now = performance.now();
    if (!noHandSince) noHandSince = now;
    if (now - noHandSince > 350 && activeMode !== 'free') {
      activeMode = 'free'; makeTargets('free'); lastGesture = ''; lastModeChange = now;
    }
  }
}
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate); trackHand();
  const dt = Math.min(clock.getDelta() * 1000, 40), t = clock.elapsedTime;
  const now = performance.now();
  const arr = geometry.attributes.position.array;
  
  // Smoothly ramp tornado intensity when circles are detected while pointing
  if (now - lastCircleTime < 550 && fingerPoint && activeMode === 'draw') {
    tornadoIntensity = Math.min(1.0, tornadoIntensity + 0.08);
  } else {
    tornadoIntensity = Math.max(0.0, tornadoIntensity - 0.04);
  }

  for (let i = 0; i < particleCount; i++) {
    const j = i * 3;
    if (activeMode === 'draw' && fingerPoint) {
      if (tornadoIntensity > 0.04) {
        // High-velocity 3D Tornado vortex rising dynamically from bottom to fingertip!
        const tornadoCenterX = fingerPoint.x;
        const tornadoTopY = Math.max(fingerPoint.y + 1.2, 2.5);
        const tornadoBottomY = -6.5;
        const tornadoHeight = tornadoTopY - tornadoBottomY;
        
        const frac = ((i * 1.618 + t * 3.8) % 1.0 + 1.0) % 1.0;
        const py = tornadoBottomY + frac * tornadoHeight;
        
        const funnelR = (0.35 + Math.pow(frac, 1.25) * 2.8) * tornadoIntensity;
        const spinAng = tornadoDir * (t * 7.5 + frac * 14.0 + i * 0.12);
        const turb = Math.sin(t * 6.0 + i * 0.4) * 0.14;
        const r = funnelR + turb;
        
        const whip = Math.sin(py * 0.65 + t * 2.8) * 0.35 * frac;
        const tx = tornadoCenterX + Math.cos(spinAng) * r + whip;
        const ty = py;
        const tz = Math.sin(spinAng) * r * 0.9;
        
        arr[j] += (tx - arr[j]) * 0.18;
        arr[j + 1] += (ty - arr[j + 1]) * 0.18;
        arr[j + 2] += (tz - arr[j + 2]) * 0.18;
      } else {
        // Gather particles tightly under the pointing index fingertip
        const a = i * 2.399 + t * 1.8, r = .07 + (i % 12) * .018;
        const tx = fingerPoint.x + Math.cos(a) * r, ty = fingerPoint.y + Math.sin(a) * r, tz = Math.sin(a * .6) * r;
        arr[j] += (tx - arr[j]) * .19; arr[j + 1] += (ty - arr[j + 1]) * .19; arr[j + 2] += (tz - arr[j + 2]) * .19;
      }
    } else if (activeMode === 'orb') {
      // Multiple orbs dancing and moving dynamically across the screen
      const k = i % orbConfigs.length;
      const o = orbConfigs[k];
      const ox = o.bx + Math.sin(t * o.sx + o.px) * o.ax + Math.cos(t * o.sy * 0.5 + o.px) * (o.ax * 0.35);
      const oy = o.by + Math.cos(t * o.sy + o.py) * o.ay + Math.sin(t * o.sx * 0.6 + o.py) * (o.ay * 0.3);
      const oz = o.bz + Math.sin(t * o.sz + o.pz) * o.az;
      // Internal swirling rotation around orb center
      const spin = t * 1.6 + k * 1.1;
      const cosS = Math.cos(spin * 0.6), sinS = Math.sin(spin * 0.6);
      const lx = orbOffsets[j], ly = orbOffsets[j + 1], lz = orbOffsets[j + 2];
      const rx = lx * cosS - lz * sinS;
      const rz = lx * sinS + lz * cosS;
      const ry = ly + Math.sin(t * 2.5 + i * 0.1) * 0.05;
      const tx = ox + rx, ty = oy + ry, tz = oz + rz;
      arr[j] += (tx - arr[j]) * 0.085;
      arr[j + 1] += (ty - arr[j + 1]) * 0.085;
      arr[j + 2] += (tz - arr[j + 2]) * 0.085;
    } else if (activeMode === 'heart') {
      // Dynamic cardiac double-thump heartbeat pulse animation
      const heartPulse = Math.pow(Math.sin(t * 3.6), 8) * 0.16 + Math.pow(Math.sin(t * 3.6 - 0.35), 8) * 0.08;
      const scale = 1.0 + heartPulse;
      const tx = targets[j] * scale;
      const ty = targets[j + 1] * scale;
      const tz = targets[j + 2] * scale;
      arr[j] += (tx - arr[j]) * 0.07;
      arr[j + 1] += (ty - arr[j + 1]) * 0.07;
      arr[j + 2] += (tz - arr[j + 2]) * 0.07;
      arr[j] += Math.sin(t * 2.5 + i) * 0.005;
      arr[j + 1] += Math.cos(t * 2.3 + i) * 0.005;
    } else if (activeMode === 'flower') {
      // Dynamic blooming popup and living floral breathing animation
      const elapsedBloom = (now - bloomStartTime) / 1000;
      const bloomProgress = Math.min(1.0, elapsedBloom);
      // Elastic spring popup curve: rapid burst outward with gentle overshoot
      const popScale = bloomProgress < 1.0
        ? Math.sin(bloomProgress * Math.PI * 0.5) * (1.0 + 0.18 * Math.sin(bloomProgress * Math.PI))
        : 1.0;
      // Organic living respiration breathing wave
      const breathe = 1.0 + Math.sin(t * 2.2 + i * 0.015) * 0.025;
      const s = popScale * breathe;
      
      const tx = targets[j] * s;
      const ty = targets[j + 1] * s;
      const tz = targets[j + 2] * s;
      
      arr[j] += (tx - arr[j]) * 0.085;
      arr[j + 1] += (ty - arr[j + 1]) * 0.085;
      arr[j + 2] += (tz - arr[j + 2]) * 0.085;
      
      // Floating petals / pollen shimmer
      arr[j] += Math.sin(t * 2.0 + i * 0.15) * 0.004;
      arr[j + 1] += Math.cos(t * 1.8 + i * 0.12) * 0.004;
    } else {
      // Other shapes and the first form (free mode)
      arr[j] += (targets[j] - arr[j]) * .055;
      arr[j + 1] += (targets[j + 1] - arr[j + 1]) * .055;
      arr[j + 2] += (targets[j + 2] - arr[j + 2]) * .055;
      // Fluid cosmic wave movement
      arr[j] += Math.sin(t * 1.2 + i * 0.2) * 0.008;
      arr[j + 1] += Math.cos(t * 1.0 + i * 0.17) * 0.008;
    }
  }
  
  // Lightning tint during tornado
  if (tornadoIntensity > 0.05 && activeMode === 'draw') {
    const colArr = geometry.attributes.color.array;
    for (let i = 0; i < particleCount; i++) {
      const cj = i * 3;
      const isCore = (i % 6 === 0);
      const targetR = isCore ? 1.0 : 0.05;
      const targetG = isCore ? 0.95 : 0.85;
      const targetB = 1.0;
      colArr[cj] += (targetR - colArr[cj]) * 0.12;
      colArr[cj + 1] += (targetG - colArr[cj + 1]) * 0.12;
      colArr[cj + 2] += (targetB - colArr[cj + 2]) * 0.12;
    }
    geometry.attributes.color.needsUpdate = true;
  }
  
  geometry.attributes.position.needsUpdate = true;
  points.rotation.y += (Math.sin(t * .22) * .12 - points.rotation.y) * .025;
  points.rotation.x += (Math.cos(t * .19) * .06 - points.rotation.x) * .025;
  if (activeMode === 'flower') { points.rotation.y += 0.0025; points.rotation.x += Math.sin(t * 0.5) * 0.0005; }
  if (activeMode === 'swirl' && !fingerPoint) { points.rotation.y += .002; points.rotation.z += .001; }
  renderer.render(scene, camera);
}
function resize() {
  W = innerWidth; H = innerHeight;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W, H);
  if (trailCanvas) { trailCanvas.width = Math.round(W * Math.min(devicePixelRatio || 1, 2)); trailCanvas.height = Math.round(H * Math.min(devicePixelRatio || 1, 2)); trailCanvas.style.width = W + 'px'; trailCanvas.style.height = H + 'px'; trailCtx.setTransform(Math.min(devicePixelRatio || 1, 2), 0, 0, Math.min(devicePixelRatio || 1, 2), 0, 0); }
}
positions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i++) { positions[i * 3] = rand(-8, 8); positions[i * 3 + 1] = rand(-5, 5); positions[i * 3 + 2] = rand(-3, 3); }
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
makeTargets('free');
resize(); window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => stream?.getTracks().forEach(track => track.stop()));
requestAnimationFrame(animate);



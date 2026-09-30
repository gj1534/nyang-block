import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, catFaceSVG } from './cats.js';
import { CATS, CAT_ORDER, GOAL_TEXT, PROLOGUE, EPILOGUE, CHAPTERS } from './story.js';

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const N = 8;
const TRAY_SCALE = 0.55;
const TRAY_Y = -0.33;
const LIFT = 1.15;
const SAVE_KEY = 'nyangblock.save.v1', BEST_KEY = 'nyangblock.best', SOUND_KEY = 'nyangblock.sound', STORY_KEY = 'nyangblock.story.v1';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 저장소 (없어도 동작) ---------------- */
const store = {
  get(k){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};

/* ---------------- 렌더러 / 장면 ---------------- */
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// 정사영 카메라: 원근 없이 판이 반듯한 사각형으로 보여요
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
const CAM_EL = THREE.MathUtils.degToRad(80);
const CAM_DIR = new V3(0, Math.sin(CAM_EL), Math.cos(CAM_EL));

scene.add(new THREE.HemisphereLight(0xfff6f2, 0xf2c3cc, 1.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.55);
sun.position.set(-4, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left:-11, right:11, top:11, bottom:-11, near:1, far:40 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
sun.target.position.set(1.5, 0, 1.5);
scene.add(sun, sun.target);

/* ---------------- 모양과 난수 ---------------- */
const WHITE = new THREE.Color('#ffffff');
const BASE = {
  I:[[0,0],[1,0],[2,0],[3,0]], O:[[0,0],[1,0],[0,1],[1,1]], T:[[0,0],[1,0],[2,0],[1,1]],
  S:[[1,0],[2,0],[0,1],[1,1]], Z:[[0,0],[1,0],[1,1],[2,1]], J:[[0,0],[0,1],[1,1],[2,1]], L:[[2,0],[0,1],[1,1],[2,1]],
  m1:[[0,0]], m2:[[0,0],[1,0]], m3:[[0,0],[1,0],[2,0]], v3:[[0,0],[1,0],[0,1]]
};
const SHAPE_COLOR = { I:6, O:1, T:2, S:3, Z:4, J:5, L:0 };
const TETRO = ['I','O','T','S','Z','J','L'];
const SMALL = [['m1',.16],['m2',.34],['m3',.26],['v3',.24]];
const SMALL_COLORS = [7,7,0,4,2,3];

function norm(cells){
  let mc = Infinity, mr = Infinity;
  for (const [c,r] of cells){ mc = Math.min(mc,c); mr = Math.min(mr,r); }
  return cells.map(([c,r]) => [c-mc, r-mr]).sort((a,b) => a[1]-b[1] || a[0]-b[0]);
}
const ROT = {};
for (const [k, cells] of Object.entries(BASE)){
  const out = [], seen = new Set(); let cur = cells;
  for (let i=0;i<4;i++){
    const n = norm(cur), key = JSON.stringify(n);
    if (!seen.has(key)){ seen.add(key); out.push(n); }
    cur = cur.map(([c,r]) => [-r, c]);
  }
  ROT[k] = out;
}
// 스테이지는 같은 순서로 블럭이 나오도록 시드 난수를 써요
function mulberry(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rand = Math.random;
const pick = (arr, r = Math.random) => arr[(r()*arr.length)|0];

// 지금 판의 규칙 (자유 모드 / 스토리 스테이지 / 메뉴 배경)
let run = { mode:'idle' };

function randomPiece(){
  const small = run.small ?? 0.26;
  let cells, color;
  if (rand() >= small){ const k = pick(TETRO, rand); cells = pick(ROT[k], rand); color = SHAPE_COLOR[k]; }
  else {
    let x = rand(), k = 'm1';
    for (const [kk, w] of SMALL){ if ((x -= w) <= 0){ k = kk; break; } }
    cells = pick(ROT[k], rand); color = pick(SMALL_COLORS, rand);
  }
  if (run.colors) color = pick(run.colors, rand);
  return { cells, color };
}

/* ---------------- 젤리 셰이더 ----------------
   고양이 재질은 고양이 자신의 좌표계에서 정점을 변형해요:
   눌림/늘어남(uJ.x), 움직임에 따른 기울기(uJ.yz), 퍼져 나가는 출렁임(uWob). */
const TIME = { value: 0 };
const JELLY_GLSL = `
uniform vec3 uJ; uniform float uWob; uniform float uTime; uniform mat4 uPM; uniform mat4 uPI;
vec3 jelly(vec3 p){
  float hn = clamp(p.y / 0.75, 0.0, 1.9);
  float sq = uJ.x;
  p.y *= 1.0 - sq;
  p.xz *= 1.0 + sq * (0.3 + 0.35 * hn);
  p.xz += uJ.yz * hn * hn;
  float ph = uTime * 15.0 + p.x * 2.3 + p.z * 1.9;
  p.y += sin(ph) * uWob * 0.07 * hn;
  p.x += sin(ph * 0.83 + 1.3) * uWob * 0.055 * hn;
  p.z += cos(ph * 0.91) * uWob * 0.055 * hn;
  return p;
}`;
const JELLY_PROJECT = `
vec4 jwp = modelMatrix * vec4( transformed, 1.0 );
vec3 jlp = jelly( ( uPI * jwp ).xyz );
jwp = uPM * vec4( jlp, 1.0 );
vec4 mvPosition = viewMatrix * jwp;
gl_Position = projectionMatrix * mvPosition;`;
function jelly(mat, U){
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uJ:U.uJ, uWob:U.uWob, uTime:U.uTime, uPM:U.uPM, uPI:U.uPI });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + JELLY_GLSL)
      .replace('#include <project_vertex>', JELLY_PROJECT);
  };
  mat.customProgramCacheKey = () => 'jelly-v1';
  return mat;
}

/* ---------------- 지오메트리 도우미 ---------------- */
const IDQ = new THREE.Quaternion();
const ONE = new V3(1,1,1);
const YUP = new V3(0,1,0);
const ZROT_PI = new THREE.Quaternion().setFromAxisAngle(new V3(0,0,1), Math.PI);
const _o = new THREE.Object3D();
const _m = new THREE.Matrix4();

function paint(g, color){
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count, a = new Float32Array(n*3);
  for (let i=0;i<n;i++){ a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function part(geo, color, pos = new V3(), quat = IDQ, scale = ONE){
  const g = geo.clone();
  if (g.attributes.uv) g.deleteAttribute('uv');
  _o.position.copy(pos); _o.quaternion.copy(quat);
  if (typeof scale === 'number') _o.scale.setScalar(scale); else _o.scale.copy(scale);
  _o.updateMatrix();
  g.applyMatrix4(_o.matrix);
  return paint(g, color);
}
function merge(list){ const g = mergeGeometries(list, false); list.forEach(x => x.dispose()); return g; }
function faceQuat(n){
  const x = new V3(1,0,0).addScaledVector(n, -n.x).normalize();
  const y = new V3().crossVectors(n, x);
  _m.makeBasis(x, y, n);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

const earPts = [[0,0],[.17,0],[.165,.05],[.13,.14],[.075,.23],[.03,.285],[0,.3]].map(([x,y]) => new THREE.Vector2(x,y));
const G = {
  sphere: new THREE.SphereGeometry(1, 32, 22),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  arc: new THREE.TorusGeometry(1, 0.27, 8, 18, Math.PI),
  whisker: new THREE.CylinderGeometry(0.009, 0.006, 0.26, 5),
  ear: new THREE.LatheGeometry(earPts, 16),
};

// 폴리오미노 몸통: 외곽선을 따라가 안쪽으로 줄이고, 모서리를 둥글게 한 뒤 부드럽게 돌출해요.
const INSET = 0.18, RC = 0.26, RV = 0.22;
const bodyCache = new Map();
function bodyBase(cells){
  const key = cells.map(p => p.join(',')).join(';');
  if (bodyCache.has(key)) return bodyCache.get(key);
  let w = 0, h = 0;
  for (const [c,r] of cells){ w = Math.max(w,c+1); h = Math.max(h,r+1); }
  const set = new Set(cells.map(([c,r]) => c+','+r)), has = (c,r) => set.has(c+','+r);
  const edges = new Map();
  const add = (x1,y1,x2,y2) => edges.set(x1+','+y1, [x1,y1,x2,y2]);
  for (const [c,r] of cells){
    const L=c, R=c+1, T=-r, B=-r-1;
    if (!has(c,r+1)) add(L,B,R,B);
    if (!has(c+1,r)) add(R,B,R,T);
    if (!has(c,r-1)) add(R,T,L,T);
    if (!has(c-1,r)) add(L,T,L,B);
  }
  const pts = [];
  let e = edges.values().next().value; const startK = e[0]+','+e[1];
  let guard = 0;
  do { pts.push([e[0],e[1]]); e = edges.get(e[2]+','+e[3]); } while (e && (e[0]+','+e[1]) !== startK && ++guard < 400);
  const poly = [];
  for (let i=0;i<pts.length;i++){
    const a = pts[(i-1+pts.length)%pts.length], b = pts[i], c = pts[(i+1)%pts.length];
    if ((b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]) !== 0) poly.push(b);
  }
  const m = poly.length, V = [];
  for (let i=0;i<m;i++){
    const a = poly[(i-1+m)%m], b = poly[i], c = poly[(i+1)%m];
    const d1 = [Math.sign(b[0]-a[0]), Math.sign(b[1]-a[1])], d2 = [Math.sign(c[0]-b[0]), Math.sign(c[1]-b[1])];
    const n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]];
    const convex = d1[0]*d2[1] - d1[1]*d2[0] > 0;
    V.push({ p:[b[0] + INSET*(n1[0]+n2[0]), b[1] + INSET*(n1[1]+n2[1])], d1, d2, r: convex ? RC : RV });
  }
  const shape = new THREE.Shape(), KK = 0.5523;
  let first = null;
  V.forEach((v, i) => {
    const A = [v.p[0]-v.d1[0]*v.r, v.p[1]-v.d1[1]*v.r], B = [v.p[0]+v.d2[0]*v.r, v.p[1]+v.d2[1]*v.r];
    if (i === 0){ shape.moveTo(A[0], A[1]); first = A; } else shape.lineTo(A[0], A[1]);
    shape.bezierCurveTo(A[0]+v.d1[0]*v.r*KK, A[1]+v.d1[1]*v.r*KK, B[0]-v.d2[0]*v.r*KK, B[1]-v.d2[1]*v.r*KK, B[0], B[1]);
  });
  shape.lineTo(first[0], first[1]);
  let g = new THREE.ExtrudeGeometry(shape, { depth:0.34, bevelEnabled:true, bevelThickness:0.15, bevelSize:0.13, bevelSegments:4, curveSegments:6 });
  g.rotateX(-Math.PI/2);
  g.translate(-w/2, 0.15, -h/2);
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.clearGroups();
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  bodyCache.set(key, g);
  return g;
}
const tailCache = new Map();
function tailBase(side){
  const k = side.join(',');
  if (tailCache.has(k)) return tailCache.get(k);
  const s = new V3(side[0], 0, side[1]);
  const perp = new V3(-side[1], 0, side[0]);
  const P = (a, y, p=0) => s.clone().multiplyScalar(a).add(new V3(0,y,0)).addScaledVector(perp, p);
  const pts = [P(0,0), P(.2,.05), P(.34,.3,.03), P(.27,.58,.05), P(.09,.72,.02)];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.075, 10, false);
  g.userData.end = pts[4];
  tailCache.set(k, g);
  return g;
}

/* ---------------- 고양이 ---------------- */
const HEAD_R = new V3(0.5, 0.37, 0.45);
const FACE_F = new V3(0, 0.82, 0.57).normalize();
const FACE_R = new V3(1, 0, 0);
const FACE_U = new V3().crossVectors(FACE_F, FACE_R).normalize();
function surf(a, b, lift = 0){
  const d = FACE_F.clone().addScaledVector(FACE_R, a).addScaledVector(FACE_U, b).normalize();
  const n = d.clone().divide(HEAD_R).normalize();
  const p = d.clone().multiply(HEAD_R).addScaledVector(n, lift);
  return { p, n };
}

const cats = new Set();
let catSeq = 1;

function makeCat(cellsIn, colorIdx){
  const cells = norm(cellsIn);
  let w = 0, h = 0;
  for (const [c,r] of cells){ w = Math.max(w,c+1); h = Math.max(h,r+1); }
  const set = new Set(cells.map(([c,r]) => c+','+r)), has = (c,r) => set.has(c+','+r);
  const def = COLORS[colorIdx];
  const cBody = new THREE.Color(def.body);
  const cLight = cBody.clone().lerp(WHITE, 0.62);
  const cStripe = new THREE.Color(def.stripe);
  const cPink = new THREE.Color('#FF94AC');
  const cInk = new THREE.Color(def.dark ? '#FFC7D4' : '#5B3A44');
  const cBlush = cBody.clone().lerp(new THREE.Color('#FF7F9E'), def.dark ? 0.35 : 0.5);
  const cWhisk = new THREE.Color(def.dark ? '#D9CCD8' : '#8B6B74');
  const cEye = new THREE.Color(def.dark ? '#E2EE78' : '#3A2A32');

  const U = { uJ:{ value:new V3() }, uWob:{ value:0 }, uTime:TIME, uPM:{ value:new THREE.Matrix4() }, uPI:{ value:new THREE.Matrix4() } };
  const main = jelly(new THREE.MeshPhysicalMaterial({ vertexColors:true, roughness:0.62, sheen:0.7, sheenRoughness:0.5, sheenColor:new THREE.Color('#fff2ea') }), U);
  const flat = jelly(new THREE.MeshBasicMaterial({ vertexColors:true }), U);
  const geos = new Set();
  const group = new THREE.Group();
  const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); geos.add(geo); return m; };
  const lc = (c,r) => new V3(c + 0.5 - w/2, 0, r + 0.5 - h/2);

  mesh(paint(bodyBase(cells).clone(), cBody), main, group);

  // 머리는 뒤쪽이 비어 있는 칸에 올려서 귀가 들어갈 자리를 만들어요
  const cand = cells.filter(([c,r]) => !has(c, r-1));
  const head = pick(cand);
  const hc = lc(head[0], head[1]);
  const headG = new THREE.Group();
  headG.position.set(hc.x, 0.74, hc.z - 0.03);
  group.add(headG);
  mesh(part(G.sphere, cBody, undefined, undefined, HEAD_R), main, headG);

  const earGeo = merge([
    part(G.ear, cBody, new V3(), IDQ, new V3(1, 1, 0.62)),
    part(G.ear, cPink, new V3(0, 0.03, 0.06), IDQ, new V3(0.58, 0.64, 0.4)),
  ]);
  const ears = [];
  for (const s of [-1, 1]){
    const piv = new THREE.Group();
    piv.position.set(s*0.28, 0.22, -0.14);
    piv.rotation.set(-0.22, 0, -s*0.34);
    piv.scale.setScalar(1.15);
    headG.add(piv); mesh(earGeo, main, piv); ears.push(piv);
  }

  const eyeParts = [part(G.sphereLo, cEye, new V3(), IDQ, new V3(0.084, 0.102, 0.042))];
  if (def.dark) eyeParts.push(part(G.sphereLo, new THREE.Color('#2B2233'), new V3(0, 0, 0.026), IDQ, new V3(0.03, 0.072, 0.018)));
  eyeParts.push(part(G.sphereLo, WHITE, new V3(-0.024, 0.032, 0.033), IDQ, 0.026));
  eyeParts.push(part(G.sphereLo, WHITE, new V3(0.023, -0.028, 0.033), IDQ, 0.012));
  const eyeGeo = merge(eyeParts);
  const hapGeo = part(G.arc, cInk, new V3(0, -0.02, 0.02), IDQ, 0.058);
  const eyes = [];
  for (const s of [-1, 1]){
    const { p, n } = surf(s*0.35, 0.14);
    const piv = new THREE.Group(); piv.position.copy(p); piv.quaternion.copy(faceQuat(n)); headG.add(piv);
    const open = mesh(eyeGeo, flat, piv);
    const hap = mesh(hapGeo, flat, piv); hap.visible = false;
    eyes.push({ piv, open, hap });
  }

  const fd = [];
  { const { p, n } = surf(0, -0.1); fd.push(part(G.sphereLo, cPink, p, faceQuat(n), new V3(0.044, 0.031, 0.026))); }
  for (const s of [-1, 1]){ const { p, n } = surf(s*0.1, -0.27, 0.004); fd.push(part(G.arc, cInk, p, faceQuat(n).multiply(ZROT_PI), 0.046)); }
  for (const s of [-1, 1]){ const { p, n } = surf(s*0.7, -0.2); fd.push(part(G.sphereLo, cBlush, p, faceQuat(n), new V3(0.085, 0.055, 0.012))); }
  for (const s of [-1, 1]) for (const k of [0.16, -0.05]){
    const { p } = surf(s*0.82, -0.2);
    const dir = new V3(s, k, 0.3).normalize();
    fd.push(part(G.whisker, cWhisk, p.clone().addScaledVector(dir, 0.1), new THREE.Quaternion().setFromUnitVectors(YUP, dir)));
  }
  if (def.tabby) for (const [a, b, l] of [[-0.2, 0.6, 0.75], [0, 0.68, 1], [0.2, 0.6, 0.75]]){
    const { p, n } = surf(a, b); fd.push(part(G.sphereLo, cStripe, p, faceQuat(n), new V3(0.03, 0.085*l, 0.014)));
  }
  mesh(merge(fd), main, headG);

  const bd = [];
  if (!has(head[0], head[1]+1)) for (const s of [-1, 1]) bd.push(part(G.sphereLo, cLight, new V3(hc.x + s*0.17, 0.1, hc.z + 0.42), IDQ, new V3(0.11, 0.08, 0.1)));
  const others = cells.filter(([c,r]) => c !== head[0] || r !== head[1]);
  if (def.tabby){
    for (const [c,r] of others){ const q = lc(c,r); for (const dz of [-0.15, 0.13]) bd.push(part(G.sphereLo, cStripe, new V3(q.x, 0.632, q.z + dz), IDQ, new V3(0.3, 0.022, 0.055))); }
  } else if (others.length){
    const [c,r] = pick(others), q = lc(c,r);
    bd.push(part(G.sphereLo, def.dark ? cBody.clone().lerp(WHITE, 0.8) : cLight, new V3(q.x + (Math.random()-.5)*0.14, 0.63, q.z + (Math.random()-.5)*0.14), IDQ, new V3(0.24, 0.024, 0.2)));
  }
  if (bd.length) mesh(merge(bd), main, group);

  // 꼬리는 머리에서 가장 먼 칸의 비어 있는 옆면에서 자라요
  let tailCell = head, far = -1;
  for (const cl of cells){
    const d = Math.abs(cl[0]-head[0]) + Math.abs(cl[1]-head[1]);
    if (d > far || (d === far && Math.random() < 0.5)){ far = d; tailCell = cl; }
  }
  const sx = Math.random() < 0.5 ? 1 : -1;
  let side = null;
  for (const [dx, dz] of [[sx,0],[-sx,0],[0,1],[0,-1]]){
    if (has(tailCell[0]+dx, tailCell[1]+dz)) continue;
    if (tailCell === head && dz !== 0) continue;
    side = [dx, dz]; break;
  }
  if (!side) side = [sx, 0];
  const tq = lc(tailCell[0], tailCell[1]);
  const tailPiv = new THREE.Group();
  tailPiv.position.set(tq.x + side[0]*0.4, 0.3, tq.z + side[1]*0.4);
  group.add(tailPiv);
  const tb = tailBase(side);
  mesh(merge([part(tb, cBody), part(G.sphereLo, cLight, tb.userData.end, IDQ, 0.082)]), main, tailPiv);

  scene.add(group);
  const cat = {
    id: catSeq++, cells, w, h, color: colorIdx, group, U, mats:[main, flat], geos, eyes, ears, headG, tailPiv,
    j:{ s:0, sv:0, lx:0, lz:0, lvx:0, lvz:0, w:0 }, tilt:0, tiltV:0, tiltT:0, flick:0,
    phase: Math.random()*Math.PI*2, blinkT: 1 + Math.random()*4, blinkP: -1, happyT: 0, hover: false, sad: false,
    earT: 2 + Math.random()*5, earP: -1, earSide: 0,
    tp: new V3(), ts: 1, rate: 16, vel: new V3(), landing: false, abs: null, slot: -1,
  };
  cats.add(cat);
  return cat;
}
function disposeCat(cat){
  scene.remove(cat.group);
  cat.geos.forEach(g => g.dispose());
  cat.mats.forEach(m => m.dispose());
  cats.delete(cat);
}

const _prev = new V3();
function updateCat(cat, dt, t){
  const g = cat.group;
  _prev.copy(g.position);
  g.position.lerp(cat.tp, 1 - Math.exp(-cat.rate*dt));
  const sc = g.scale.x + (cat.ts - g.scale.x) * (1 - Math.exp(-14*dt));
  g.scale.setScalar(Math.max(sc, 0.001));
  cat.vel.subVectors(g.position, _prev).divideScalar(Math.max(dt, 1e-4));
  if (cat.landing && g.position.distanceTo(cat.tp) < 0.035){ cat.landing = false; g.position.copy(cat.tp); onLand(cat); }

  const j = cat.j, m = reduceMotion ? 0.4 : 1;
  const breath = Math.sin(t*2.1 + cat.phase) * 0.012 * m;
  j.sv += (-(j.s - breath)*240 - j.sv*8.5) * dt; j.s += j.sv*dt;
  j.s = Math.max(-0.4, Math.min(0.42, j.s));
  const inv = 1 / Math.max(g.scale.x, 0.2);
  const tlx = Math.max(-0.34, Math.min(0.34, -cat.vel.x*0.045*inv));
  const tlz = Math.max(-0.34, Math.min(0.34, -cat.vel.z*0.045*inv));
  j.lvx += (-(j.lx - tlx)*170 - j.lvx*9) * dt; j.lx += j.lvx*dt;
  j.lvz += (-(j.lz - tlz)*170 - j.lvz*9) * dt; j.lz += j.lvz*dt;
  j.w *= Math.exp(-dt*2.6);
  cat.U.uJ.value.set(j.s, j.lx, j.lz);
  cat.U.uWob.value = j.w * m;

  // 깜빡임과 표정
  cat.blinkT -= dt;
  if (cat.blinkT <= 0 && cat.blinkP < 0){ cat.blinkP = 0; cat.blinkT = 2.5 + Math.random()*4; }
  let ey = 1;
  if (cat.blinkP >= 0){ cat.blinkP += dt/0.15; if (cat.blinkP >= 1) cat.blinkP = -1; else ey = 1 - Math.sin(cat.blinkP*Math.PI)*0.9; }
  if (cat.sad) ey = 0.12;
  cat.happyT -= dt;
  const happy = !cat.sad && (cat.happyT > 0 || cat.hover);
  for (const e of cat.eyes){ e.piv.scale.y = happy ? 1 : ey; e.open.visible = !happy; e.hap.visible = happy; }

  // 귀 쫑긋
  cat.earT -= dt;
  if (cat.earT <= 0){ cat.earT = 3 + Math.random()*6; cat.earP = 0; cat.earSide = Math.random() < 0.5 ? 0 : 1; }
  if (cat.earP >= 0){
    cat.earP += dt/0.3;
    const k = cat.earP >= 1 ? 0 : Math.sin(cat.earP*Math.PI*2) * 0.3 * (1 - cat.earP);
    cat.ears[cat.earSide].rotation.x = -0.22 + k;
    if (cat.earP >= 1) cat.earP = -1;
  }
  // 꼬리 살랑, 고개 갸웃
  cat.flick *= Math.exp(-dt*3);
  cat.tailPiv.rotation.y = Math.sin(t*1.7 + cat.phase)*0.3*m + Math.sin(t*16)*cat.flick;
  cat.tiltT *= Math.exp(-dt*1.6);
  cat.tiltV += (-(cat.tilt - cat.tiltT)*120 - cat.tiltV*8) * dt; cat.tilt += cat.tiltV*dt;
  cat.headG.rotation.z = cat.tilt;

  g.updateMatrixWorld(true);
  cat.U.uPM.value.copy(g.matrixWorld);
  cat.U.uPI.value.copy(g.matrixWorld).invert();
}
function poke(cat, k = 1){
  cat.j.sv += 5.5*k; cat.j.w = Math.max(cat.j.w, 0.9*k);
  cat.happyT = Math.max(cat.happyT, 1.1*k);
  cat.tiltT = (Math.random() < 0.5 ? -1 : 1) * 0.26 * k;
  cat.flick = 0.35*k;
}

/* ---------------- 판, 방석, 바닥 ---------------- */
function rrShape(w, h, r){
  const s = new THREE.Shape(), x = -w/2, y = -h/2;
  s.moveTo(x+r, y); s.lineTo(x+w-r, y); s.quadraticCurveTo(x+w, y, x+w, y+r);
  s.lineTo(x+w, y+h-r); s.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  s.lineTo(x+r, y+h); s.quadraticCurveTo(x, y+h, x, y+h-r);
  s.lineTo(x, y+r); s.quadraticCurveTo(x, y, x+r, y);
  return s;
}
function slab(w, h, r, depth, top, color){
  const g = new THREE.ExtrudeGeometry(rrShape(w, h, r), { depth, bevelEnabled:true, bevelThickness:0.06, bevelSize:0.06, bevelSegments:3, curveSegments:12 });
  g.rotateX(-Math.PI/2); g.translate(0, top - depth - 0.06, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness:0.85 }));
  m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
}
const rimSlab = slab(9.1, 9.1, 0.8, 0.3, -0.14, '#FFC3D0');
slab(8.7, 8.7, 0.6, 0.36, 0, '#FFF9F5');

const tileGeo = new THREE.ShapeGeometry(rrShape(0.9, 0.9, 0.2), 6); tileGeo.rotateX(-Math.PI/2);
const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.95 }), N*N);
tiles.receiveShadow = true;
const tileBase = [];
for (let r=0;r<N;r++) for (let c=0;c<N;c++){
  const i = r*N + c;
  _o.position.set(c - 3.5, 0.004, r - 3.5); _o.quaternion.identity(); _o.scale.set(1,1,1); _o.updateMatrix();
  tiles.setMatrixAt(i, _o.matrix);
  tileBase[i] = new THREE.Color((r + c) % 2 ? '#F7E4DC' : '#F2DAD1');
  tiles.setColorAt(i, tileBase[i]);
}
scene.add(tiles);

const catcher = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI/2), new THREE.ShadowMaterial({ color:0xb0506a, opacity:0.14 }));
catcher.position.y = -0.49; catcher.receiveShadow = true; scene.add(catcher);

const RING = ['#FFC6D2', '#FFDFA6', '#C6E0FF'];
const slots = [0,1,2].map(i => {
  const bed = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.26, 0.16, 48), new THREE.MeshStandardMaterial({ color:'#FFFCFA', roughness:0.95 }));
  pad.position.y = -0.41; pad.receiveShadow = true; pad.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.13, 14, 64), new THREE.MeshStandardMaterial({ color:RING[i], roughness:0.8 }));
  ring.rotation.x = Math.PI/2; ring.position.y = -0.31; ring.receiveShadow = true; ring.castShadow = true;
  bed.add(pad, ring); scene.add(bed);
  return { pos:new V3(), bed, cat:null };
});

/* ---------------- 스토리 판 위의 것들: 생선, 얼음, 상자, 낙엽 ---------------- */
const cellPos = (i) => new V3(i % N - 3.5, 0, ((i / N) | 0) - 3.5);
const obst = new Array(N*N).fill(null);   // 칸을 차지하는 것: 상자, 낙엽
const mark = new Array(N*N).fill(null);   // 칸 위의 표시: 생선, 얼음 (고양이를 올릴 수 있음)
const ICE = new THREE.Color('#D3E9FB');
const tileColor = (i) => (mark[i] && mark[i].type === 'frost') ? ICE : tileBase[i];

const fishGeo = (() => {
  const body = new THREE.Shape(); body.absellipse(-0.04, 0, 0.23, 0.13, 0, Math.PI*2, false, 0);
  const tail = new THREE.Shape(); tail.moveTo(0.15, 0); tail.lineTo(0.33, 0.13); tail.quadraticCurveTo(0.29, 0, 0.33, -0.13); tail.lineTo(0.15, 0);
  const g = mergeGeometries([new THREE.ShapeGeometry(body, 16), new THREE.ShapeGeometry(tail, 6)], false);
  g.rotateX(-Math.PI/2);
  return g;
})();
const fishMat = new THREE.MeshStandardMaterial({ color:'#7DB4EA', roughness:0.5 });
const fishEyeMat = new THREE.MeshBasicMaterial({ color:'#2F3A55' });
const flakeGeo = (() => {
  const bars = [0, 1, 2].map(k => { const b = new THREE.BoxGeometry(0.5, 0.012, 0.05); b.rotateY(k*Math.PI/3); return b; });
  return mergeGeometries(bars, false);
})();
const flakeMat = new THREE.MeshBasicMaterial({ color:'#FFFFFF', transparent:true, opacity:0.9 });

const boxGeo = bodyBase([[0,0]]).clone(); boxGeo.scale(0.96, 0.9, 0.96);
const boxMat = new THREE.MeshStandardMaterial({ color:'#E2B47E', roughness:0.8 });
const boxHurtMat = new THREE.MeshStandardMaterial({ color:'#C99862', roughness:0.85 });
const tapeGeo = new THREE.BoxGeometry(0.18, 0.02, 0.66);
const tapeMat = new THREE.MeshStandardMaterial({ color:'#F6E2BC', roughness:0.6 });
const kittenEarMats = new Map();
const kittenEarMat = (c) => { if (!kittenEarMats.has(c)) kittenEarMats.set(c, new THREE.MeshStandardMaterial({ color:COLORS[c].body, roughness:0.6 })); return kittenEarMats.get(c); };

const leafGeo = (() => {
  const s = new THREE.Shape(); s.moveTo(0, -0.3); s.quadraticCurveTo(0.24, -0.08, 0, 0.3); s.quadraticCurveTo(-0.24, -0.08, 0, -0.3);
  const g = new THREE.ShapeGeometry(s, 8); g.rotateX(-Math.PI/2); return g;
})();
const LEAF_COLORS = ['#F29A4A', '#E8704F', '#F5C04E', '#D9824A'];
const leafMats = LEAF_COLORS.map(c => new THREE.MeshStandardMaterial({ color:c, roughness:0.7, side:THREE.DoubleSide }));
const moundMat = new THREE.MeshStandardMaterial({ color:'#D9B48C', roughness:0.95 });

function addFish(i){
  const g = new THREE.Group();
  g.add(new THREE.Mesh(fishGeo, fishMat));
  const eye = new THREE.Mesh(G.sphereLo, fishEyeMat); eye.scale.set(0.028, 0.01, 0.028); eye.position.set(-0.15, 0.01, -0.02); g.add(eye);
  g.position.copy(cellPos(i)).setY(0.014); g.rotation.y = (Math.random() - 0.5)*0.8;
  scene.add(g);
  mark[i] = { type:'fish', mesh:g };
}
function addFrost(i){
  const m = new THREE.Mesh(flakeGeo, flakeMat);
  m.position.copy(cellPos(i)).setY(0.012); m.rotation.y = Math.random();
  scene.add(m);
  mark[i] = { type:'frost', mesh:m };
  tilesDirty = true;
}
function addBox(i, kitten){
  const g = new THREE.Group();
  const body = new THREE.Mesh(boxGeo, boxMat); g.add(body);
  const tape = new THREE.Mesh(tapeGeo, tapeMat); tape.position.y = 0.585; g.add(tape);
  let ears = null;
  if (kitten != null){
    ears = new THREE.Group();
    for (const s of [-1, 1]){
      const e = new THREE.Mesh(G.ear, kittenEarMat(kitten));
      e.scale.set(0.95, 0.95, 0.55); e.position.set(s*0.2, 0.5, -0.14); e.rotation.z = -s*0.3;
      ears.add(e);
    }
    g.add(ears);
  }
  g.position.copy(cellPos(i));
  scene.add(g);
  obst[i] = { type:'box', hp:2, kitten, mesh:g, body, tape, ears, shake:0, phase:Math.random()*6 };
}
function addLeaf(i, fall){
  const g = new THREE.Group();
  const mound = new THREE.Mesh(G.sphereLo, moundMat); mound.scale.set(0.34, 0.09, 0.34); g.add(mound);
  for (let k=0;k<4;k++){
    const m = new THREE.Mesh(leafGeo, leafMats[(k + i) % 4]);
    m.position.set((Math.random()-.5)*0.3, 0.05 + k*0.03, (Math.random()-.5)*0.3);
    m.rotation.set((Math.random()-.5)*0.3, Math.random()*Math.PI*2, (Math.random()-.5)*0.3);
    m.scale.setScalar(0.85 + Math.random()*0.35);
    g.add(m);
  }
  g.position.copy(cellPos(i));
  scene.add(g);
  obst[i] = { type:'leaf', hp:1, mesh:g, fall: fall ? 0 : 1 };
}
function removeMark(i){ const mk = mark[i]; if (!mk) return; scene.remove(mk.mesh); mark[i] = null; if (mk.type === 'frost') tilesDirty = true; }
function removeObst(i){ const o = obst[i]; if (!o) return; scene.remove(o.mesh); obst[i] = null; }
function clearStoryBits(){ for (let i=0;i<N*N;i++){ removeMark(i); removeObst(i); } for (const f of flyers) disposeCat(f.cat); flyers.length = 0; }

// 구조된 아기 고양이는 폴짝 뛰어올라 하트와 함께 떠나요
const flyers = [];
function rescueKitten(pos, color){
  const kit = makeCat([[0,0]], color);
  kit.group.position.copy(pos); kit.tp.copy(pos); kit.rate = 30; kit.ts = 0.85; kit.group.scale.setScalar(0.4);
  kit.happyT = 3; poke(kit, 1);
  flyers.push({ cat:kit, base:pos.clone(), t:0 });
}
function updateObstacles(dt, t){
  for (let i=0;i<N*N;i++){
    const o = obst[i]; if (!o) continue;
    if (o.type === 'box'){
      o.shake *= Math.exp(-dt*6);
      o.mesh.rotation.z = Math.sin(t*40)*0.09*o.shake + (o.hp === 1 ? 0.06 : 0);
      o.mesh.position.y = Math.abs(Math.sin(t*30))*0.05*o.shake;
      if (o.ears) o.ears.rotation.x = Math.sin(t*2 + o.phase) > 0.96 ? 0.25 : 0;
    } else if (o.type === 'leaf' && o.fall < 1){
      o.fall = Math.min(1, o.fall + dt/0.7);
      const k = 1 - o.fall;
      o.mesh.position.y = k*k*3.2;
      o.mesh.rotation.y = k*4;
      o.mesh.position.x = cellPos(i).x + Math.sin(k*9)*0.25*k;
    }
  }
  for (let n = flyers.length - 1; n >= 0; n--){
    const f = flyers[n]; f.t += dt;
    const hop = Math.sin(Math.min(f.t/0.55, 1)*Math.PI)*1.4;
    f.cat.tp.copy(f.base).setY(hop + Math.max(0, f.t - 0.9)*3);
    if (f.t > 0.9) f.cat.ts = 0.001;
    if (f.t > 0.55 && !f.hearted){ f.hearted = true; burst(f.base.clone().setY(1.3), 5, ['heart'], ['#FF8FAB', '#FF6F8E', '#FFC2D1'], 0.9); }
    if (f.t > 1.3){ disposeCat(f.cat); flyers.splice(n, 1); }
  }
}

/* ---------------- 파티클 ---------------- */
function makeTex(draw){
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.strokeStyle = '#fff'; draw(x);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {
  heart: makeTex(x => { x.beginPath(); x.moveTo(32,55); x.bezierCurveTo(4,38,4,16,18,11); x.bezierCurveTo(26,8,32,13,32,20); x.bezierCurveTo(32,13,38,8,46,11); x.bezierCurveTo(60,16,60,38,32,55); x.fill(); }),
  star: makeTex(x => { x.beginPath(); for (let i=0;i<10;i++){ const r = i%2 ? 11 : 27, a = -Math.PI/2 + i*Math.PI/5; x.lineTo(32 + Math.cos(a)*r, 34 + Math.sin(a)*r); } x.closePath(); x.lineJoin = 'round'; x.lineWidth = 6; x.stroke(); x.fill(); }),
  paw: makeTex(x => { x.beginPath(); x.ellipse(32,42,13,11,0,0,Math.PI*2); x.fill(); for (const [px,py] of [[15,26],[25,16],[39,16],[49,26]]){ x.beginPath(); x.arc(px,py,6.5,0,Math.PI*2); x.fill(); } }),
  dot: makeTex(x => { x.beginPath(); x.arc(32,32,22,0,Math.PI*2); x.fill(); }),
  fish: makeTex(x => { x.beginPath(); x.ellipse(27,32,19,12,0,0,Math.PI*2); x.fill(); x.beginPath(); x.moveTo(40,32); x.lineTo(58,18); x.quadraticCurveTo(53,32,58,46); x.closePath(); x.fill(); }),
  leaf: makeTex(x => { x.beginPath(); x.moveTo(32,6); x.quadraticCurveTo(58,30,32,58); x.quadraticCurveTo(6,30,32,6); x.fill(); }),
  flake: makeTex(x => { x.lineWidth = 5; x.lineCap = 'round'; for (let k=0;k<3;k++){ const a = k*Math.PI/3; x.beginPath(); x.moveTo(32 - Math.cos(a)*24, 32 - Math.sin(a)*24); x.lineTo(32 + Math.cos(a)*24, 32 + Math.sin(a)*24); x.stroke(); } }),
};
const parts = [];
for (let i=0;i<120;i++){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX.dot, transparent:true, depthWrite:false }));
  s.visible = false; s.renderOrder = 10; scene.add(s);
  parts.push({ s, vel:new V3(), life:0, max:1, size:0.3, spin:0, active:false });
}
function burst(pos, n, kinds, colors, power = 1){
  for (let i=0;i<n;i++){
    const p = parts.find(q => !q.active); if (!p) return;
    p.active = true; p.s.visible = true;
    p.s.material.map = TEX[kinds[i % kinds.length]];
    p.s.material.color.set(Array.isArray(colors) ? colors[i % colors.length] : colors);
    p.s.material.rotation = (Math.random() - 0.5)*0.8;
    p.s.position.copy(pos);
    p.vel.set((Math.random()-0.5)*2.8*power, (2 + Math.random()*2.2)*power, (Math.random()-0.5)*2.8*power);
    p.life = 0; p.max = 0.7 + Math.random()*0.45; p.size = 0.26 + Math.random()*0.18; p.spin = (Math.random()-0.5)*4;
  }
}
function updateParts(dt){
  for (const p of parts){
    if (!p.active) continue;
    p.life += dt;
    if (p.life >= p.max){ p.active = false; p.s.visible = false; continue; }
    p.vel.y -= 5.2*dt;
    p.s.position.addScaledVector(p.vel, dt);
    const k = p.life/p.max;
    p.s.scale.setScalar(p.size * Math.min(1, p.life/0.08) * (1 - k*0.3));
    p.s.material.opacity = 1 - k*k;
    p.s.material.rotation += p.spin*dt;
  }
}

// 사라지는 칸마다 한 번 부풀었다가 톡 터지는 덩어리
const puffMats = new Map();
const puffMat = (hex) => { if (!puffMats.has(hex)) puffMats.set(hex, new THREE.MeshStandardMaterial({ color:hex, roughness:0.6 })); return puffMats.get(hex); };
const puffs = [];
function spawnPuff(pos, hex, delay){
  const m = new THREE.Mesh(bodyBase([[0,0]]), puffMat(hex));
  m.position.copy(pos); scene.add(m);
  puffs.push({ m, delay, t:0, popped:false, hex });
}
function updatePuffs(dt){
  for (let i = puffs.length - 1; i >= 0; i--){
    const p = puffs[i];
    if (p.delay > 0){ p.delay -= dt; continue; }
    p.t += dt;
    if (p.t < 0.09){ const k = p.t/0.09; p.m.scale.set(1 + k*0.18, 1 - k*0.25, 1 + k*0.18); }
    else {
      if (!p.popped){ p.popped = true; burst(p.m.position.clone().setY(0.6), 3, ['star','heart','paw'], ['#FFD166', '#FF8FAB', p.hex]); }
      const k = Math.min(1, (p.t - 0.09)/0.2);
      const s = (1 - k) * (1.18 + 0.3*Math.sin(k*Math.PI));
      p.m.scale.set(Math.max(s, 0.001), Math.max(s*1.1, 0.001), Math.max(s, 0.001)); p.m.position.y = k*0.5; p.m.rotation.y = k*1.2;
      if (k >= 1){ scene.remove(p.m); puffs.splice(i, 1); }
    }
  }
}

/* ---------------- 소리 (첫 터치 이후 합성) ---------------- */
let AC = null, master = null, noiseBuf = null, soundOn = store.get(SOUND_KEY) !== false;
function audioUnlock(){
  if (!AC){
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination); }
    catch(e){ return; }
  }
  if (AC.state === 'suspended') AC.resume();
}
function blip(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0){
  if (!AC || !soundOn) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(dur, freq, q, vol, delay = 0){
  if (!AC || !soundOn) return;
  if (!noiseBuf){
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i=0;i<d.length;i++) d[i] = Math.random()*2 - 1;
  }
  const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.05);
}
function meow(p = 1, vol = 0.15, delay = 0){
  if (!AC || !soundOn) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
  o.type = 'sawtooth'; o2.type = 'triangle'; o2.detune.value = 8;
  for (const x of [o, o2]){
    x.frequency.setValueAtTime(480*p, t); x.frequency.linearRampToValueAtTime(840*p, t + 0.09);
    x.frequency.linearRampToValueAtTime(760*p, t + 0.2); x.frequency.linearRampToValueAtTime(520*p, t + 0.36);
  }
  f.type = 'bandpass'; f.Q.value = 2.4;
  f.frequency.setValueAtTime(900*p, t); f.frequency.linearRampToValueAtTime(2200*p, t + 0.1); f.frequency.linearRampToValueAtTime(1100*p, t + 0.36);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
  g.gain.setValueAtTime(vol*0.85, t + 0.22); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(f); o2.connect(f); f.connect(g).connect(master);
  o.start(t); o2.start(t); o.stop(t + 0.46); o2.stop(t + 0.46);
}
const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
const sfx = {
  pick(){ blip(620, 980, 0.09, 'sine', 0.13); },
  drop(){ blip(330, 160, 0.15, 'triangle', 0.22); blip(1100, 700, 0.05, 'sine', 0.05, 0.01); },
  nope(){ blip(280, 210, 0.11, 'square', 0.045); blip(230, 170, 0.13, 'square', 0.045, 0.1); },
  clear(lines, combo){
    const up = 1 + Math.min(combo - 1, 6)*0.06, n = Math.min(3 + lines, 6);
    for (let i=0;i<n;i++) blip(NOTES[i]*up, NOTES[i]*up*1.01, 0.24, 'triangle', 0.11, i*0.055);
    meow(1.25*up, 0.1, 0.12); if (lines > 1) meow(1.45*up, 0.08, 0.26);
  },
  over(){ [523, 440, 349, 262].forEach((f, i) => blip(f, f*0.97, 0.32, 'triangle', 0.13, i*0.17)); meow(0.8, 0.12, 0.7); },
  knock(){ blip(190, 90, 0.12, 'triangle', 0.24); hiss(0.07, 900, 1.2, 0.1); },
  rustle(){ hiss(0.32, 3200, 0.7, 0.07); hiss(0.2, 2200, 0.9, 0.05, 0.08); },
  collect(){ blip(880, 1320, 0.12, 'sine', 0.1); blip(1320, 1760, 0.14, 'sine', 0.08, 0.07); },
  thaw(){ blip(1568, 2093, 0.2, 'sine', 0.06); blip(2093, 2637, 0.26, 'sine', 0.05, 0.08); },
  rescue(){ meow(1.55, 0.13); blip(1046, 1568, 0.3, 'triangle', 0.08, 0.15); },
  win(){ [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(f, f, 0.34, 'triangle', 0.12, i*0.12)); meow(1.3, 0.1, 0.5); },
  page(){ blip(760, 840, 0.05, 'sine', 0.035); },
  star(k){ blip(880*(1 + k*0.25), 1320*(1 + k*0.25), 0.2, 'triangle', 0.1); },
  letter(){ hiss(0.4, 1800, 0.6, 0.05); blip(659, 988, 0.5, 'sine', 0.05, 0.2); },
};
function buzz(ms){ try { navigator.vibrate && navigator.vibrate(ms); } catch(e){} }
const pitchFor = (cat) => 1.02 + (4 - cat.cells.length)*0.08 + Math.random()*0.1;

/* ---------------- 계절과 날씨 ---------------- */
const wcv = $('weather'), wctx = wcv.getContext('2d');
let season = 'home', wParts = [], wAcc = 0, wDpr = 1;
const RIM = { home:'#FFC3D0', spring:'#FFC3D0', summer:'#BFE6D3', rain:'#BFCFE8', autumn:'#F6C08E', winter:'#CFDAF2' };
const WX = {
  home:   { rate: 2,  make: () => ({ x: Math.random(), y: 1.04, vx: 0, vy: -0.035, r: 2 + Math.random()*3, kind:'dot', col:'255,150,175', a:0.35 }) },
  spring: { rate: 9,  make: () => ({ x: Math.random()*1.2 - 0.2, y: -0.04, vx: 0.05, vy: 0.07 + Math.random()*0.05, r: 4 + Math.random()*3, kind:'petal', col:'255,168,190', a:0.8, rot: Math.random()*6, vr:(Math.random()-.5)*3 }) },
  summer: { rate: 4,  make: () => ({ x: Math.random(), y: 1.04, vx: 0, vy: -0.03 - Math.random()*0.02, r: 2 + Math.random()*3, kind:'glow', col:'255,214,110', a:0.55 }) },
  rain:   { rate: 42, make: () => ({ x: Math.random()*1.1, y: -0.05, vx: -0.08, vy: 1.3 + Math.random()*0.4, r: 10 + Math.random()*10, kind:'drop', col:'120,150,200', a:0.35 }) },
  autumn: { rate: 4,  make: () => ({ x: Math.random()*1.2 - 0.1, y: -0.04, vx: 0.02, vy: 0.08 + Math.random()*0.05, r: 6 + Math.random()*4, kind:'leaf', col: pick(['242,154,74','232,112,79','245,192,78']), a:0.85, rot: Math.random()*6, vr:(Math.random()-.5)*3 }) },
  winter: { rate: 14, make: () => ({ x: Math.random(), y: -0.03, vx: 0, vy: 0.05 + Math.random()*0.05, r: 1.6 + Math.random()*2.6, kind:'snow', col:'255,255,255', a:0.9 }) },
};
function setSeason(s){
  if (season === s) return;
  season = s; document.body.dataset.season = s; wParts = [];
  rimSlab.material.color.set(RIM[s] || RIM.home);
}
function updateWeather(dt, t){
  const cfg = WX[season] || WX.home;
  const w = wcv.width, h = wcv.height;
  wctx.clearRect(0, 0, w, h);
  if (reduceMotion) return;
  wAcc += cfg.rate * dt;
  while (wAcc > 1 && wParts.length < 180){ wAcc -= 1; const p = cfg.make(); p.ph = Math.random()*6; wParts.push(p); }
  for (let i = wParts.length - 1; i >= 0; i--){
    const p = wParts[i];
    p.x += (p.vx + Math.sin(t*1.3 + p.ph)*(p.kind === 'drop' ? 0 : 0.02)) * dt;
    p.y += p.vy * dt;
    if (p.rot != null) p.rot += p.vr * dt;
    if (p.y > 1.08 || p.y < -0.08 || p.x < -0.25 || p.x > 1.25){ wParts.splice(i, 1); continue; }
    const x = p.x*w, y = p.y*h, r = p.r*wDpr;
    wctx.fillStyle = `rgba(${p.col},${p.a})`; wctx.strokeStyle = wctx.fillStyle;
    if (p.kind === 'drop'){ wctx.lineWidth = 1.4*wDpr; wctx.beginPath(); wctx.moveTo(x, y); wctx.lineTo(x + p.vx*r*0.6, y + r); wctx.stroke(); }
    else if (p.kind === 'petal' || p.kind === 'leaf'){
      wctx.save(); wctx.translate(x, y); wctx.rotate(p.rot);
      wctx.beginPath(); wctx.ellipse(0, 0, r, r*(p.kind === 'leaf' ? 0.5 : 0.62), 0, 0, Math.PI*2); wctx.fill(); wctx.restore();
    } else if (p.kind === 'glow'){
      const gr = wctx.createRadialGradient(x, y, 0, x, y, r*3); gr.addColorStop(0, `rgba(${p.col},${p.a})`); gr.addColorStop(1, `rgba(${p.col},0)`);
      wctx.fillStyle = gr; wctx.beginPath(); wctx.arc(x, y, r*3, 0, Math.PI*2); wctx.fill();
    } else { wctx.beginPath(); wctx.arc(x, y, r, 0, Math.PI*2); wctx.fill(); }
  }
}

/* ---------------- 게임 상태 ---------------- */
const grid = new Int32Array(N*N);
const boardCats = new Map();
let score = 0, shownScore = 0, best = store.get(BEST_KEY) || 0, combo = 0, sinceClear = 0;
let state = 'menu', busyUntil = 0, drag = null, tilesDirty = false;
const timers = [];
const later = (s, fn) => timers.push({ t:s, fn });
const prog = Object.assign({ stars:{}, rescued:[7], prologue:false, intro:{}, ending:false }, store.get(STORY_KEY) || {});
const saveProg = () => store.set(STORY_KEY, prog);
const stageKey = (ci, si) => `${ci+1}-${si+1}`;

const occupied = (i) => grid[i] !== 0 || obst[i] !== null;
const boardPos = (cat) => {
  let mc = Infinity, mr = Infinity;
  for (const [c,r] of cat.abs){ mc = Math.min(mc,c); mr = Math.min(mr,r); }
  return new V3(mc + cat.w/2 - N/2, 0, mr + cat.h/2 - N/2);
};
function canPlace(cells, col, row){
  for (const [c,r] of cells){
    const x = c + col, y = r + row;
    if (x < 0 || y < 0 || x >= N || y >= N || occupied(y*N + x)) return false;
  }
  return true;
}
function fitsAnywhere(cells){
  for (let r=0;r<N;r++) for (let c=0;c<N;c++) if (canPlace(cells, c, r)) return true;
  return false;
}
function fullLines(extra){
  const filled = (i) => occupied(i) || (extra && extra.has(i));
  const rows = [], cols = [];
  for (let r=0;r<N;r++){ let ok = true; for (let c=0;c<N;c++) if (!filled(r*N+c)){ ok = false; break; } if (ok) rows.push(r); }
  for (let c=0;c<N;c++){ let ok = true; for (let r=0;r<N;r++) if (!filled(r*N+c)){ ok = false; break; } if (ok) cols.push(c); }
  return { rows, cols };
}
function lineCells(rows, cols){
  const s = new Set();
  rows.forEach(r => { for (let c=0;c<N;c++) s.add(r*N+c); });
  cols.forEach(c => { for (let r=0;r<N;r++) s.add(r*N+c); });
  return s;
}
function components(cells){
  const left = new Set(cells.map(([c,r]) => c+','+r)), out = [];
  for (const [c0,r0] of cells){
    const k0 = c0+','+r0; if (!left.has(k0)) continue;
    const comp = [], q = [[c0,r0]]; left.delete(k0);
    while (q.length){
      const [c,r] = q.pop(); comp.push([c,r]);
      for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){ const k = (c+dc)+','+(r+dr); if (left.has(k)){ left.delete(k); q.push([c+dc, r+dr]); } }
    }
    out.push(comp);
  }
  return out;
}

function putOnBoard(cat, absCells){
  cat.abs = absCells.map(p => p.slice());
  for (const [c,r] of cat.abs) grid[r*N + c] = cat.id;
  boardCats.set(cat.id, cat);
  cat.slot = -1;
}
function placeInstant(cat, absCells){
  putOnBoard(cat, absCells);
  cat.tp.copy(boardPos(cat)); cat.group.position.copy(cat.tp);
  cat.ts = 1; cat.group.scale.setScalar(1); cat.rate = 20;
}
function setSlot(i, cat, popIn = true){
  const s = slots[i]; s.cat = cat; cat.slot = i;
  cat.tp.copy(s.pos).setY(TRAY_Y); cat.ts = TRAY_SCALE; cat.rate = 14;
  cat.group.position.copy(cat.tp);
  cat.group.scale.setScalar(popIn ? 0.001 : TRAY_SCALE);
}
function genTray(count){
  for (let a=0;a<40;a++){
    const set = Array.from({ length:count }, randomPiece);
    if (set.some(p => fitsAnywhere(p.cells))) return set;
  }
  return Array.from({ length:count }, (_, i) => ({ cells: i ? randomPiece().cells : [[0,0]], color: run.colors ? pick(run.colors, rand) : 7 }));
}
function fillTray(popIn = true){
  const count = run.mode === 'story' ? Math.min(3, run.movesLeft) : 3;
  if (count <= 0) return;
  genTray(count).forEach((p, i) => {
    const cat = makeCat(p.cells, p.color);
    setSlot(i, cat, popIn);
    if (popIn){
      cat.ts = 0.001;
      later(0.08 + i*0.11, () => { if (cat.slot === i){ cat.ts = TRAY_SCALE; poke(cat, 0.8); } });
    }
  });
}
function clearEverything(withPuffs){
  drag = null;
  for (const cat of boardCats.values()){
    if (withPuffs) for (const [c,r] of cat.abs) spawnPuff(new V3(c-3.5, 0, r-3.5), COLORS[cat.color].body, Math.random()*0.25);
    disposeCat(cat);
  }
  boardCats.clear(); grid.fill(0);
  for (const s of slots){ if (s.cat){ disposeCat(s.cat); s.cat = null; } }
  clearStoryBits();
  timers.length = 0;
  tilesDirty = true;
}

/* ---------------- 자유 모드 저장 ---------------- */
function serialize(){
  return {
    v:1, score, combo, sinceClear,
    board:[...boardCats.values()].map(c => ({ cells:c.abs, color:c.color })),
    tray: slots.map(s => s.cat ? { cells:s.cat.cells, color:s.cat.color } : null),
  };
}
function save(){ if (run.mode === 'free' && state === 'play') store.set(SAVE_KEY, serialize()); }
function restoreFree(d){
  for (const b of d.board || []) placeInstant(makeCat(b.cells, b.color), b.cells);
  (d.tray || []).forEach((p, i) => { if (p) setSlot(i, makeCat(p.cells, p.color), false); });
  if (slots.every(s => !s.cat)) fillTray(false);
  score = shownScore = d.score || 0; combo = d.combo || 0; sinceClear = d.sinceClear || 0;
}

/* ---------------- 스토리 판 불러오기 ---------------- */
function loadBoard(rows){
  if (!rows) return;
  const seen = new Set();
  for (let r=0;r<N;r++) for (let c=0;c<N;c++){
    const ch = rows[r][c], i = r*N + c;
    if (ch >= '0' && ch <= '7'){
      if (seen.has(i)) continue;
      const comp = [], q = [[c, r]]; seen.add(i);
      while (q.length){
        const [x, y] = q.pop(); comp.push([x, y]);
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx = x+dx, ny = y+dy, ni = ny*N + nx;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen.has(ni) || rows[ny][nx] !== ch) continue;
          seen.add(ni); q.push([nx, ny]);
        }
      }
      placeInstant(makeCat(comp, +ch), comp);
    }
    else if (ch === 'f') addFish(i);
    else if (ch === 'i') addFrost(i);
    else if (ch === 'b') addBox(i, null);
    else if (ch === 'k') addBox(i, pick(run.kittens, rand));
    else if (ch === 'K') addBox(i, CHAPTERS[run.ci].rescue[0]);
    else if (ch === 'l') addLeaf(i, false);
  }
}
function countOnBoard(type){
  let n = 0;
  for (let i=0;i<N*N;i++){
    if (type === 'thaw' && mark[i] && mark[i].type === 'frost') n++;
    if (type === 'rescue' && obst[i] && obst[i].type === 'box' && obst[i].kitten != null) n++;
  }
  return n;
}
function colorsFor(ci){ return [...new Set([7, ...CHAPTERS.slice(0, ci + 1).flatMap(c => c.rescue)])]; }
const goalsDone = () => run.goals.every(g => g.have >= g.need);

/* ---------------- 놓기와 지우기 ---------------- */
function placeCat(cat, slot, col, row){
  slots[slot].cat = null;
  putOnBoard(cat, cat.cells.map(([c,r]) => [c + col, r + row]));
  cat.tp.copy(boardPos(cat)); cat.ts = 1; cat.rate = 24; cat.landing = true;
  if (run.mode === 'free') score += cat.cells.length;
  if (run.mode === 'story'){ run.movesLeft--; run.placed++; updateMoves(); }
  const { rows, cols } = fullLines();
  const lines = rows.length + cols.length;
  busyUntil = performance.now() + (lines ? 480 : 120);
  later(lines ? 0.16 : 0.05, () => afterPlace(rows, cols, cat));
  updateHud();
}
function afterPlace(rows, cols, origin){
  if (run.mode === 'idle') return;
  const lines = rows.length + cols.length;
  if (lines){
    combo++; sinceClear = 0;
    const res = doClear(rows, cols, origin);
    showBanner(lines, combo);
    sfx.clear(lines, combo); buzz([12, 30, 18]);
    if (run.mode === 'free'){
      const gain = Math.round(lines*(lines+1)/2 * 80 * (1 + (combo-1)*0.5));
      score += gain; floatText(res.center, '+' + gain); bumpScore();
    } else {
      const gained = { lines, fish:res.fish, rescue:res.rescued, leaves:res.leaves, thaw:res.thaw };
      const words = [];
      for (const g of run.goals){
        const add = gained[g.type] || 0;
        if (add && g.have < g.need){ g.have = Math.min(g.need, g.have + add); words.push(g.type); }
      }
      if (words.length) renderGoals(words);
      if (res.fish) floatText(res.center, `생선 +${res.fish}`);
      else if (res.rescued) floatText(res.center, '구조했어요!');
    }
  } else {
    sinceClear++;
    if (sinceClear >= 3) combo = 0;
  }
  if (run.mode === 'story' && run.leafEvery && run.placed % run.leafEvery === 0 && !goalsDone()) dropLeaf();
  if (run.mode === 'story'){
    if (goalsDone()){ busyUntil = performance.now() + 1200; later(0.7, winStage); return; }
    if (run.movesLeft <= 0){ busyUntil = performance.now() + 1200; later(0.7, () => failStage('moves')); return; }
  }
  if (slots.every(s => !s.cat)) fillTray(true);
  if (run.mode === 'free' && score > best){ best = score; store.set(BEST_KEY, best); }
  updateHud(); save();
  if (!slots.some(s => s.cat && fitsAnywhere(s.cat.cells))){
    if (run.mode === 'free') later(0.55, gameOver); else later(0.7, () => failStage('space'));
  }
}
function doClear(rows, cols, origin){
  const cleared = lineCells(rows, cols);
  const oc = boardPos(origin);
  const affected = new Map();
  const center = new V3();
  const res = { center, fish:0, thaw:0, leaves:0, rescued:0 };
  for (const idx of cleared){
    const wp = cellPos(idx);
    center.add(wp);
    const delay = wp.distanceTo(oc)*0.035;
    const id = grid[idx];
    if (id){
      const cat = boardCats.get(id);
      if (cat){ affected.set(id, cat); spawnPuff(wp, COLORS[cat.color].body, delay); }
      grid[idx] = 0;
    }
    const o = obst[idx];
    if (o){
      o.hp--;
      if (o.type === 'leaf'){
        removeObst(idx); res.leaves++;
        later(delay, () => { burst(wp.clone().setY(0.4), 4, ['leaf'], LEAF_COLORS, 0.9); sfx.rustle(); });
      } else if (o.hp > 0){
        o.body.material = boxHurtMat; o.tape.visible = false; o.shake = 1;
        later(delay, () => { burst(wp.clone().setY(0.6), 3, ['dot'], ['#E2B47E', '#F6E2BC']); sfx.knock(); });
      } else {
        removeObst(idx);
        spawnPuff(wp, '#E2B47E', delay);
        if (o.kitten != null){ res.rescued++; later(delay + 0.15, () => { rescueKitten(wp, o.kitten); sfx.rescue(); }); }
        else later(delay, () => sfx.knock());
      }
    }
    const mk = mark[idx];
    if (mk){
      if (mk.type === 'fish'){ res.fish++; later(delay, () => { burst(wp.clone().setY(0.8), 3, ['fish', 'star'], ['#7DB4EA', '#FFD166']); sfx.collect(); }); }
      else { res.thaw++; later(delay, () => { burst(wp.clone().setY(0.5), 4, ['flake', 'dot'], ['#FFFFFF', '#BFE0FA']); sfx.thaw(); }); }
      removeMark(idx);
    }
  }
  center.divideScalar(cleared.size).setY(1);
  for (const cat of affected.values()){
    const rest = cat.abs.filter(([c,r]) => !cleared.has(r*N + c));
    boardCats.delete(cat.id); disposeCat(cat);
    // 남은 조각은 작은 고양이로 다시 태어나요
    for (const comp of components(rest)){
      const kit = makeCat(comp, cat.color);
      placeInstant(kit, comp);
      kit.j.sv += 4; kit.j.w = 0.8; kit.happyT = 1.2;
    }
  }
  for (const cat of boardCats.values()){ cat.j.sv += 1.6; cat.j.w = Math.max(cat.j.w, 0.35); }
  return res;
}
function dropLeaf(){
  const free = [];
  for (let i=0;i<N*N;i++) if (!occupied(i) && !mark[i]) free.push(i);
  if (!free.length) return;
  const i = pick(free, rand);
  addLeaf(i, true);
  later(0.5, () => sfx.rustle());
}
function onLand(cat){
  cat.j.sv += 7; cat.j.w = Math.max(cat.j.w, 0.7); cat.happyT = 0.8;
  sfx.drop(); buzz(10);
  burst(cat.group.position.clone().setY(0.15), 4, ['dot'], ['#FFFFFF', '#FFE1E8']);
}
function allCatsDo(fn){ let d = 0; for (const cat of [...boardCats.values(), ...slots.filter(s => s.cat).map(s => s.cat)]){ later(d, () => fn(cat)); d += 0.02; } }

function gameOver(){
  if (state !== 'play') return;
  if (slots.some(s => s.cat && fitsAnywhere(s.cat.cells))) return;
  state = 'over';
  cancelDrag();
  store.del(SAVE_KEY);
  const isRecord = score > 0 && score >= best;
  if (score > best){ best = score; store.set(BEST_KEY, best); }
  allCatsDo(cat => { cat.sad = true; cat.j.sv += 3; cat.j.w = 0.6; });
  sfx.over();
  later(0.9, () => {
    $('finalScore').textContent = score.toLocaleString('ko-KR');
    $('bestOver').textContent = best.toLocaleString('ko-KR');
    $('newRecord').hidden = !isRecord;
    show('overScr');
  });
}

/* ---------------- 칸 색: 놓일 자리 미리보기와 지워질 줄 ---------------- */
const _tc = new THREE.Color();
function paintTiles(ghost, lines, color, t){
  const glow = 0.55 + 0.2*Math.sin(t*9);
  const hi = color ? color.clone().lerp(WHITE, 0.25) : null;
  for (let i=0;i<N*N;i++){
    _tc.copy(tileColor(i));
    if (lines && lines.has(i)) _tc.lerp(hi, glow);
    else if (ghost && ghost.has(i)) _tc.lerp(color, 0.62);
    tiles.setColorAt(i, _tc);
  }
  tiles.instanceColor.needsUpdate = true;
}

/* ---------------- 입력 ---------------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new V3(0,1,0), 0);
let W = 1, H = 1;
function groundAt(x, y){
  ndc.set(x/W*2 - 1, -(y/H)*2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new V3();
  return ray.ray.intersectPlane(ground, p) ? p : null;
}
function nearestSlot(g){
  let bi = -1, bd = 1.6;
  slots.forEach((s, i) => { if (!s.cat) return; const d = Math.hypot(g.x - s.pos.x, g.z - s.pos.z); if (d < bd){ bd = d; bi = i; } });
  return bi;
}
function catAt(g){
  const c = Math.floor(g.x + N/2), r = Math.floor(g.z + N/2);
  if (c < 0 || r < 0 || c >= N || r >= N) return null;
  const id = grid[r*N + c];
  return id ? boardCats.get(id) : null;
}
function pokeWithFx(cat){
  poke(cat, 1);
  meow(pitchFor(cat)); buzz(8);
  const hp = new V3(); cat.headG.getWorldPosition(hp); hp.y += 0.45*cat.group.scale.x;
  burst(hp, 2, ['heart'], ['#FF8FAB', '#FF6F8E'], 0.8);
  if (cat.abs){
    const near = new Set();
    for (const [c,r] of cat.abs) for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x = c+dc, y = r+dr; if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const id = grid[y*N + x]; if (id && id !== cat.id) near.add(id);
    }
    for (const id of near){ const o = boardCats.get(id); if (o){ o.j.sv += 2.2; o.j.w = Math.max(o.j.w, 0.45); } }
  }
}
function returnToSlot(cat, slot){
  slots[slot].cat = cat; cat.slot = slot;
  cat.tp.copy(slots[slot].pos).setY(TRAY_Y); cat.ts = TRAY_SCALE; cat.rate = 13; cat.hover = false;
  cat.j.sv += 3; cat.j.w = Math.max(cat.j.w, 0.5);
}
function cancelDrag(){
  if (!drag) return;
  for (const c of drag.hot) c.hover = false;
  returnToSlot(drag.cat, drag.slot);
  drag = null; tilesDirty = true;
}

canvas.addEventListener('pointerdown', (e) => {
  audioUnlock();
  const g = groundAt(e.clientX, e.clientY); if (!g) return;
  if (state !== 'play'){
    // 메뉴 뒤 배경의 고양이도 톡 건드릴 수 있어요
    const si = nearestSlot(g);
    if (state === 'menu' && si >= 0) pokeWithFx(slots[si].cat);
    return;
  }
  if (drag) return;
  const si = nearestSlot(g);
  if (si >= 0 && performance.now() > busyUntil){
    const cat = slots[si].cat;
    try { canvas.setPointerCapture(e.pointerId); } catch(err){}
    drag = {
      cat, slot:si, id:e.pointerId, g:g.clone(), off:0,
      offset: new V3(0, 0, e.pointerType === 'mouse' ? -0.35 : -2.3),
      sx:e.clientX, sy:e.clientY, t0:performance.now(), moved:false,
      col:null, row:null, valid:false, over:false, lines:null, ghost:null, hot:new Set(),
    };
    cat.ts = 1; cat.rate = 30; cat.j.sv -= 6; cat.j.w = Math.max(cat.j.w, 0.4); cat.hover = true;
    sfx.pick(); buzz(6);
    canvas.style.cursor = 'grabbing';
    return;
  }
  const cat = catAt(g);
  if (cat) pokeWithFx(cat);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id){
    const g = groundAt(e.clientX, e.clientY); if (g) drag.g.copy(g);
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
    return;
  }
  if (e.pointerType === 'mouse'){
    const g = groundAt(e.clientX, e.clientY);
    const hot = g && (nearestSlot(g) >= 0 || (state === 'play' && catAt(g)));
    canvas.style.cursor = hot ? (state === 'play' && nearestSlot(g) >= 0 ? 'grab' : 'pointer') : 'default';
  }
});
function endDrag(e, cancelled){
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  if (!cancelled){
    // 마지막 움직임 뒤 프레임이 돌지 않았어도, 손을 뗀 자리로 착지를 확정해요
    const g = groundAt(e.clientX, e.clientY); if (g) d.g.copy(g);
    d.off = 1; d.col = null; updateDrag(0, TIME.value);
  }
  drag = null;
  for (const c of d.hot) c.hover = false;
  d.cat.hover = false;
  canvas.style.cursor = 'default';
  const tap = !d.moved && performance.now() - d.t0 < 300;
  if (!cancelled && !tap && d.valid && state === 'play') placeCat(d.cat, d.slot, d.col, d.row);
  else {
    returnToSlot(d.cat, d.slot);
    if (tap) pokeWithFx(d.cat);
    else if (d.over) sfx.nope();
  }
  tilesDirty = true;
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const _L = new V3();
function updateDrag(dt, t){
  const d = drag, cat = d.cat;
  d.off = Math.min(1, d.off + dt/0.12);
  _L.copy(d.g).addScaledVector(d.offset, d.off);
  const k = LIFT / CAM_DIR.y;
  cat.tp.set(_L.x + CAM_DIR.x*k, LIFT, _L.z + CAM_DIR.z*k);
  const col = Math.round(_L.x - cat.w/2 + N/2), row = Math.round(_L.z - cat.h/2 + N/2);
  if (col !== d.col || row !== d.row){
    d.col = col; d.row = row;
    d.over = Math.abs(_L.x) < N/2 + 0.6 && Math.abs(_L.z) < N/2 + 0.6;
    d.valid = canPlace(cat.cells, col, row);
    for (const c of d.hot) c.hover = false;
    d.hot.clear();
    if (d.valid){
      d.ghost = new Set(cat.cells.map(([c,r]) => (r+row)*N + (c+col)));
      const { rows, cols } = fullLines(d.ghost);
      d.lines = rows.length || cols.length ? lineCells(rows, cols) : null;
      if (d.lines) for (const i of d.lines){ const o = boardCats.get(grid[i]); if (o){ o.hover = true; d.hot.add(o); } }
    } else { d.ghost = null; d.lines = null; }
  }
  paintTiles(d.ghost, d.lines, d.valid ? new THREE.Color(COLORS[cat.color].body) : null, t);
}

/* ---------------- 아이콘 ---------------- */
const ICON = {
  lines: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="9" width="19" height="6" rx="2.2" fill="currentColor"/><rect x="9" y="2.5" width="6" height="19" rx="2.2" fill="currentColor" opacity=".35"/></svg>',
  fish: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="10" cy="12" rx="7.5" ry="4.8" fill="currentColor"/><path d="M15.5 12 L22 6.5 Q20 12 22 17.5 Z" fill="currentColor"/><circle cx="6.5" cy="11" r="1.1" fill="#fff"/></svg>',
  rescue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9 L7.5 3.5 L10.5 8 M18 9 L16.5 3.5 L13.5 8" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="3" y="8.5" width="18" height="12.5" rx="2.5" fill="currentColor"/><rect x="10.5" y="8.5" width="3" height="12.5" fill="#fff" opacity=".45"/></svg>',
  leaves: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 Q21 10 12 21.5 Q3 10 12 2.5 Z" fill="currentColor"/><path d="M12 6 V20" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></svg>',
  thaw: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" stroke="none"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5C5 15.5 2.5 12 2.5 8.6 2.5 5.8 4.7 3.8 7.3 3.8c1.9 0 3.6 1.1 4.7 2.8 1.1-1.7 2.8-2.8 4.7-2.8 2.6 0 4.8 2 4.8 4.8 0 3.4-2.5 6.9-9.5 11.9z" fill="currentColor"/></svg>',
};
const SEASON_ART = {
  spring: '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="#FF9DB5">' + [0,1,2,3,4].map(k => { const a = k*Math.PI*2/5 - Math.PI/2; return `<ellipse cx="${32 + Math.cos(a)*12}" cy="${32 + Math.sin(a)*12}" rx="9" ry="11" transform="rotate(${k*72} ${32 + Math.cos(a)*12} ${32 + Math.sin(a)*12})"/>`; }).join('') + '</g><circle cx="32" cy="32" r="6" fill="#FFD166"/></svg>',
  summer: '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="27" cy="33" rx="18" ry="11" fill="#7DB4EA"/><path d="M41 33 L57 21 Q52 33 57 45 Z" fill="#7DB4EA"/><circle cx="18" cy="30" r="2.6" fill="#2F3A55"/><path d="M24 26 q4 7 0 14" stroke="#fff" stroke-width="2.4" fill="none" opacity=".6" stroke-linecap="round"/></svg>',
  rain: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 34 Q32 4 56 34 Z" fill="#8FB0DE"/><path d="M8 34 q6 -5 12 0 q6 -5 12 0 q6 -5 12 0 q6 -5 12 0" fill="#8FB0DE"/><path d="M32 34 V52 q0 5 -5 5 q-4 0 -4 -4" stroke="#6C84AE" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M14 44 l-2 5 M48 42 l-2 5 M40 52 l-2 5" stroke="#8FB0DE" stroke-width="3" stroke-linecap="round"/></svg>',
  autumn: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 Q58 30 32 58 Q6 30 32 6 Z" fill="#F29A4A"/><path d="M32 12 V56 M32 26 L22 19 M32 26 L42 19 M32 38 L20 30 M32 38 L44 30" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/></svg>',
  winter: '<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#8FB0DE" stroke-width="4" stroke-linecap="round"><path d="M32 6v52M9.5 19l45 26M9.5 45l45-26M25 11l7 7 7-7M25 53l7-7 7 7M11 28l9 3-3 9M53 36l-9-3 3-9"/></svg>',
};

/* ---------------- 화면 전환 ---------------- */
const SCREENS = ['titleScr','mapScr','stageScr','talkScr','letterScr','resultScr','failScr','overScr','pauseScr','albumScr'];
function show(...ids){
  for (const s of SCREENS) $(s).hidden = !ids.includes(s);
  $('hud').classList.toggle('dim', ids.length > 0 || run.mode === 'idle');
}
function setHudMode(mode){
  $('freeInfo').hidden = mode !== 'free';
  $('bestChip').hidden = mode !== 'free';
  $('storyInfo').hidden = mode !== 'story';
  $('movesPill').hidden = mode !== 'story';
}
const scoreEl = $('score'), bestEl = $('best'), comboEl = $('combo');
function updateHud(){
  bestEl.textContent = best.toLocaleString('ko-KR');
  comboEl.hidden = run.mode !== 'free' || combo < 2;
  comboEl.textContent = '콤보 ×' + combo;
}
function bumpScore(){ scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump'); }
function renderGoals(bumpTypes = []){
  const box = $('goals'); box.innerHTML = '';
  for (const g of run.goals){
    const done = g.have >= g.need;
    const el = document.createElement('div');
    el.className = `goal goal-${g.type}` + (done ? ' done' : '') + (bumpTypes.includes(g.type) ? ' bump' : '');
    el.innerHTML = `${ICON[g.type]}<span><b>${g.have}</b>/${g.need}</span>`;
    el.setAttribute('aria-label', GOAL_TEXT[g.type](g.need) + `, ${g.have}개 완료`);
    box.appendChild(el);
  }
}
function updateMoves(){
  $('moves').textContent = run.movesLeft;
  $('movesPill').classList.toggle('low', run.movesLeft <= 3);
}
function floatText(world, text){
  const v = world.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'float'; el.textContent = text;
  el.style.left = ((v.x + 1)/2*W) + 'px'; el.style.top = ((1 - v.y)/2*H) + 'px';
  $('fx').appendChild(el);
  setTimeout(() => el.remove(), 1100);
}
const CHEERS = ['', '냥!', '냥냥!', '냥냥냥!', '대박이냥!', '전설의 냥!'];
function showBanner(lines, c){
  const b = $('banner');
  b.querySelector('.big').textContent = CHEERS[Math.min(lines, 5)];
  const sm = b.querySelector('.small'); sm.hidden = c < 2; sm.textContent = '콤보 ×' + c;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function setSoundIcon(){
  $('icoOn').hidden = !soundOn; $('icoOff').hidden = soundOn;
  $('soundBtn').setAttribute('aria-label', soundOn ? '소리 끄기' : '소리 켜기');
}

// 메뉴 뒤에서 방석 위 고양이들이 기다리는 배경
function enterIdle(){
  if (run.mode === 'idle' && slots.some(s => s.cat)) return;
  clearEverything(false);
  run = { mode:'idle' }; rand = Math.random;
  setHudMode('none');
  fillTray(false);
  layout();
}
function goTitle(){
  state = 'menu'; enterIdle(); setSeason('home');
  const started = prog.prologue;
  $('storyBtn').textContent = started ? '이야기 이어서' : '이야기 시작';
  const cur = currentStage();
  $('storyHint').textContent = !started ? '할머니의 다락에서 시작해요' : cur ? `${cur[0]+1}장 · ${CHAPTERS[cur[0]].seasonName} · ${CHAPTERS[cur[0]].title}` : '모든 이야기를 마쳤어요';
  $('freeBtn').textContent = store.get(SAVE_KEY) ? '자유 모드 이어서' : '자유 모드';
  $('albumCount').textContent = `${prog.rescued.length}/8`;
  $('bestStart').textContent = best.toLocaleString('ko-KR');
  show('titleScr');
}

/* ---------------- 대화 ---------------- */
let talkAdvance = null;
const ME_FACE = `<span class="me-face">${ICON.heart}</span>`;
function playTalk(lines){
  return new Promise((resolve) => {
    let i = -1, timer = null, full = '';
    const text = $('talkText');
    const finish = () => { if (timer) clearInterval(timer); talkAdvance = null; $('talkScr').hidden = true; resolve(); };
    const next = () => {
      if (timer){ clearInterval(timer); timer = null; text.textContent = full; return; }
      if (++i >= lines.length){ finish(); return; }
      const L = lines[i], box = $('talkBox');
      box.classList.toggle('narr', L.who === 'narr');
      box.classList.toggle('me', L.who === 'me');
      if (typeof L.who === 'number'){
        $('talkFace').innerHTML = catFaceSVG(L.who, { mood: i % 3 === 1 ? 'happy' : 'open', size: 72 });
        $('talkWho').textContent = CATS[L.who].name;
        meow(1.05 + (L.who % 4)*0.08, 0.06);
      } else if (L.who === 'me'){ $('talkFace').innerHTML = ME_FACE; $('talkWho').textContent = '나'; }
      else { $('talkFace').innerHTML = ''; $('talkWho').textContent = ''; }
      full = L.text; let n = 0; text.textContent = '';
      box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
      sfx.page();
      if (reduceMotion){ text.textContent = full; return; }
      timer = setInterval(() => { n++; text.textContent = full.slice(0, n); if (n >= full.length){ clearInterval(timer); timer = null; } }, 34);
    };
    talkAdvance = next;
    $('talkScr').onclick = (e) => { if (!e.target.closest('#talkSkip')) next(); };
    $('talkSkip').onclick = (e) => { e.stopPropagation(); finish(); };
    show('talkScr');
    next();
  });
}
function showLetter(letter){
  return new Promise((resolve) => {
    $('letterFrom').textContent = letter.from;
    $('letterText').innerHTML = '';
    letter.text.split('\n').forEach(line => { const p = document.createElement('p'); p.textContent = line || ' '; $('letterText').appendChild(p); });
    $('letterBtn').onclick = () => { $('letterScr').hidden = true; resolve(); };
    show('letterScr');
    sfx.letter();
    const paper = $('letterScr').querySelector('.paper'); paper.scrollTop = 0;
    paper.classList.remove('in'); void paper.offsetWidth; paper.classList.add('in');
  });
}

/* ---------------- 이야기 지도 ---------------- */
function isUnlocked(ci, si){
  if (ci === 0 && si === 0) return true;
  const [pc, ps] = si > 0 ? [ci, si - 1] : [ci - 1, CHAPTERS[ci - 1].stages.length - 1];
  return (prog.stars[stageKey(pc, ps)] || 0) > 0;
}
function chapterCleared(ci){ return (prog.stars[stageKey(ci, CHAPTERS[ci].stages.length - 1)] || 0) > 0; }
function currentStage(){
  for (let ci = 0; ci < CHAPTERS.length; ci++) for (let si = 0; si < CHAPTERS[ci].stages.length; si++)
    if (!prog.stars[stageKey(ci, si)] && isUnlocked(ci, si)) return [ci, si];
  return null;
}
const starRow = (n) => [0,1,2].map(k => `<i class="${k < n ? 'on' : ''}">${ICON.star}</i>`).join('');
function renderMap(){
  const list = $('mapList'); list.innerHTML = '';
  let total = 0, max = 0;
  const cur = currentStage();
  CHAPTERS.forEach((ch, ci) => {
    const open = isUnlocked(ci, 0);
    const card = document.createElement('article');
    card.className = `chapter s-${ch.season}` + (open ? '' : ' locked');
    card.innerHTML = `<div class="ch-art">${SEASON_ART[ch.season]}</div>
      <div class="ch-body">
        <p class="eyebrow">${ci + 1}장 · ${ch.seasonName} · ${ch.place}</p>
        <h3>${ch.title}</h3>
        <ol class="nodes"></ol>
        <div class="ch-foot"></div>
      </div>`;
    const ol = card.querySelector('.nodes');
    ch.stages.forEach((st, si) => {
      const stars = prog.stars[stageKey(ci, si)] || 0; total += stars; max += 3;
      const ok = isUnlocked(ci, si);
      const li = document.createElement('li');
      const b = document.createElement('button');
      const isCur = cur && cur[0] === ci && cur[1] === si;
      b.className = 'node' + (stars ? ' done' : '') + (isCur ? ' current' : '');
      b.disabled = !ok;
      b.innerHTML = ok ? `<span class="num">${si + 1}</span><span class="mini">${starRow(stars)}</span>` : `<span class="num lock">${ICON.lock}</span>`;
      b.setAttribute('aria-label', `${ci + 1}장 ${si + 1}번째 이야기` + (stars ? `, 별 ${stars}개` : ok ? '' : ', 잠김'));
      b.onclick = () => { audioUnlock(); openStageCard(ci, si); };
      li.appendChild(b); ol.appendChild(li);
    });
    const foot = card.querySelector('.ch-foot');
    if (chapterCleared(ci)){
      foot.innerHTML = `<div class="faces">${ch.rescue.map(c => `<span title="${CATS[c].name}">${catFaceSVG(c, { mood:'happy', size:34 })}</span>`).join('')}</div><button class="link-btn" type="button">편지 다시 읽기</button>`;
      foot.querySelector('button').onclick = async () => { await showLetter(ch.letter); show('mapScr'); };
    } else if (!open){
      foot.innerHTML = '<p class="locked-note">앞 이야기를 마치면 열려요</p>';
    }
    list.appendChild(card);
  });
  $('starTotal').innerHTML = `${ICON.star}<span>${total} / ${max}</span>`;
  requestAnimationFrame(() => { const c = list.querySelector('.node.current'); if (c) c.scrollIntoView({ block:'center', behavior: reduceMotion ? 'auto' : 'smooth' }); });
}
function openMap(){
  state = 'menu'; enterIdle(); setSeason('home');
  renderMap(); show('mapScr');
}
async function openStory(){
  audioUnlock();
  if (!prog.prologue){
    enterIdle();
    await playTalk(PROLOGUE);
    prog.prologue = true; saveProg();
  }
  openMap();
}
let pending = null;
async function openStageCard(ci, si){
  const ch = CHAPTERS[ci], st = ch.stages[si];
  state = 'menu'; enterIdle(); setSeason(ch.season);
  if (si === 0 && !prog.intro[ci]){
    await playTalk(ch.intro);
    prog.intro[ci] = true; saveProg();
  }
  pending = [ci, si];
  $('stEyebrow').textContent = `${ci + 1}장 · ${ch.seasonName} · ${si + 1}번째 이야기`;
  $('stTitle').textContent = ch.title;
  $('stStory').textContent = st.story;
  const goals = $('stGoals'); goals.innerHTML = '';
  for (const g of st.goals){
    const li = document.createElement('li');
    li.className = `goal-line goal-${g.type}`;
    const n = g.n ?? countIn(st.board, g.type);
    li.innerHTML = `${ICON[g.type]}<span>${GOAL_TEXT[g.type](n)}</span>`;
    goals.appendChild(li);
  }
  $('stMoves').textContent = st.moves;
  $('stLeaf').hidden = !st.leafEvery;
  $('stLeaf').textContent = st.leafEvery ? `고양이를 ${st.leafEvery}번 놓을 때마다 낙엽이 떨어져요` : '';
  const stars = prog.stars[stageKey(ci, si)] || 0;
  $('stStars').innerHTML = starRow(stars);
  $('stStars').hidden = !stars;
  show('stageScr');
}
function countIn(board, type){
  if (!board) return 0;
  const want = type === 'thaw' ? /i/g : /[kK]/g;
  return board.join('').match(want)?.length || 0;
}
function startStage(ci, si){
  const ch = CHAPTERS[ci], st = ch.stages[si];
  clearEverything(false);
  rand = mulberry((ci + 1)*1000 + (si + 1)*37);
  run = {
    mode:'story', ci, si, colors: colorsFor(ci), kittens: ch.kittens || ch.rescue,
    small: st.small ?? ch.small ?? 0.3, movesLeft: st.moves, moves: st.moves,
    leafEvery: st.leafEvery || 0, placed: 0, goals: [],
  };
  score = 0; combo = 0; sinceClear = 0;
  loadBoard(st.board);
  run.goals = st.goals.map(g => ({ type:g.type, need: g.n ?? countOnBoard(g.type), have:0 }));
  setSeason(ch.season);
  setHudMode('story');
  $('stageLabel').textContent = `${ch.seasonName} · ${si + 1}`;
  renderGoals(); updateMoves(); updateHud();
  fillTray(true);
  state = 'play';
  show();
  layout();
}
function winStage(){
  if (state !== 'play') return;
  state = 'result';
  cancelDrag();
  const ratio = run.movesLeft / run.moves;
  const stars = ratio >= 0.35 ? 3 : ratio >= 0.15 ? 2 : 1;
  const { ci, si } = run, ch = CHAPTERS[ci];
  const key = stageKey(ci, si), first = !prog.stars[key];
  prog.stars[key] = Math.max(prog.stars[key] || 0, stars);
  const last = si === ch.stages.length - 1;
  const newCats = last ? ch.rescue.filter(c => !prog.rescued.includes(c)) : [];
  prog.rescued.push(...newCats);
  saveProg();
  allCatsDo(cat => { poke(cat, 0.8); cat.happyT = 3; });
  sfx.win();
  later(0.9, () => showResult({ ci, si, stars, first, last, newCats }));
}
function showResult({ ci, si, stars, first, last, newCats }){
  const ch = CHAPTERS[ci];
  $('resEyebrow').textContent = `${ci + 1}장 · ${ch.seasonName} · ${si + 1}번째 이야기`;
  $('resTitle').textContent = stars === 3 ? '완벽해요!' : stars === 2 ? '잘했어요!' : '해냈어요!';
  $('resSub').textContent = `고양이 블럭을 ${run.movesLeft}개 남기고 마쳤어요.`;
  const starEls = $('resStars'); starEls.innerHTML = starRow(0);
  [...starEls.children].forEach((el, k) => { if (k < stars) setTimeout(() => { el.classList.add('on', 'pop'); sfx.star(k); }, 350 + k*280); });
  const rev = $('resReveal');
  rev.hidden = !newCats.length;
  rev.innerHTML = newCats.map(c => `<div class="new-cat">${catFaceSVG(c, { mood:'happy', size:72 })}<div><p class="eyebrow">새 가족이 생겼어요</p><p class="name">${CATS[c].name}</p><p class="desc">${CATS[c].title}</p></div></div>`).join('');
  const ending = last && ci === CHAPTERS.length - 1;
  $('resNext').textContent = last ? (first || newCats.length ? '이야기 이어 보기' : '지도로') : '다음 이야기';
  $('resNext').onclick = async () => {
    if (last && (first || newCats.length)){
      await playTalk(ch.outro);
      await showLetter(ch.letter);
      if (ending && !prog.ending){ await playTalk(EPILOGUE); prog.ending = true; saveProg(); }
      openMap(); return;
    }
    if (last){ openMap(); return; }
    openStageCard(ci, si + 1);
  };
  $('resMap').onclick = () => openMap();
  $('resRetry').onclick = () => startStage(ci, si);
  show('resultScr');
}
function failStage(reason){
  if (state !== 'play') return;
  state = 'result';
  cancelDrag();
  allCatsDo(cat => { cat.sad = true; cat.j.sv += 3; cat.j.w = 0.6; });
  sfx.over();
  later(0.9, () => {
    $('failWhy').textContent = reason === 'moves' ? '고양이 블럭을 모두 썼어요.' : '더 놓을 자리가 없어요.';
    const left = run.goals.filter(g => g.have < g.need).map(g => `${GOAL_TEXT[g.type](g.need)} (${g.have}/${g.need})`);
    $('failGoal').textContent = left.join(' · ');
    show('failScr');
  });
}

/* ---------------- 자유 모드 ---------------- */
function startFree(){
  audioUnlock();
  clearEverything(false);
  run = { mode:'free' }; rand = Math.random;
  setSeason('home'); setHudMode('free');
  const saved = store.get(SAVE_KEY);
  if (saved && saved.board){ restoreFree(saved); for (const cat of cats) poke(cat, 0.6); }
  else { score = shownScore = 0; combo = 0; sinceClear = 0; fillTray(true); }
  state = 'play';
  show(); updateHud(); layout(); save();
  meow(1.15, 0.12, 0.1);
}
function newFree(){
  store.del(SAVE_KEY);
  clearEverything(true);
  run = { mode:'free' }; rand = Math.random;
  score = shownScore = 0; combo = 0; sinceClear = 0;
  fillTray(true);
  state = 'play';
  show(); updateHud(); save();
}

/* ---------------- 고양이 앨범 ---------------- */
function openAlbum(){
  const grid2 = $('albumGrid'); grid2.innerHTML = '';
  for (const c of CAT_ORDER){
    const met = prog.rescued.includes(c);
    const el = document.createElement('article');
    el.className = 'album-cat' + (met ? '' : ' unknown');
    el.innerHTML = `${catFaceSVG(c, { mood: met ? 'open' : 'open', size: 76, locked: !met })}
      <p class="name">${met ? CATS[c].name : '아직 못 만났어요'}</p>
      <p class="title">${met ? CATS[c].title : '이야기를 따라가 보세요'}</p>
      ${met ? `<p class="desc">${CATS[c].desc}</p>` : ''}`;
    grid2.appendChild(el);
  }
  $('albumCount2').textContent = `${prog.rescued.length} / 8`;
  show('albumScr');
}

/* ---------------- 버튼 연결 ---------------- */
$('storyBtn').onclick = openStory;
$('freeBtn').onclick = startFree;
$('albumBtn').onclick = () => { audioUnlock(); openAlbum(); };
$('albumBack').onclick = goTitle;
$('mapBack').onclick = goTitle;
$('stStart').onclick = () => { audioUnlock(); if (pending) startStage(...pending); };
$('stBack').onclick = openMap;
$('failRetry').onclick = () => startStage(run.ci, run.si);
$('failMap').onclick = openMap;
$('againBtn').onclick = () => { audioUnlock(); newFree(); };
$('overHome').onclick = goTitle;
$('soundBtn').onclick = () => { soundOn = !soundOn; store.set(SOUND_KEY, soundOn); setSoundIcon(); audioUnlock(); if (soundOn) meow(1.2, 0.1); };
$('pauseBtn').onclick = () => {
  if (state !== 'play') return;
  audioUnlock(); cancelDrag();
  state = 'paused';
  $('pauseExit').textContent = run.mode === 'story' ? '지도로 나가기' : '처음 화면으로';
  $('pauseRetry').textContent = run.mode === 'story' ? '처음부터 다시' : '새 판 시작';
  $('pauseNote').textContent = run.mode === 'story' ? '나가면 이번 이야기는 처음부터 다시 해요.' : '지금 판은 저장돼 있어요.';
  show('pauseScr');
};
$('pauseResume').onclick = () => { state = 'play'; show(); };
$('pauseRetry').onclick = () => { if (run.mode === 'story') startStage(run.ci, run.si); else newFree(); };
$('pauseExit').onclick = () => { if (run.mode === 'story') openMap(); else { state = 'play'; save(); goTitle(); } };
window.addEventListener('keydown', (e) => {
  if (talkAdvance && (e.key === ' ' || e.key === 'Enter')){ e.preventDefault(); talkAdvance(); return; }
  if (e.key === 'Escape'){
    if (state === 'play') $('pauseBtn').click();
    else if (state === 'paused') $('pauseResume').click();
  }
});

/* ---------------- 레이아웃: HUD와 화면 아래 사이에 판과 방석을 맞춰요 ---------------- */
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden';
document.body.appendChild(safeProbe);
function layout(){
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  wDpr = Math.min(window.devicePixelRatio || 1, 2);
  wcv.width = Math.round(W*wDpr); wcv.height = Math.round(H*wDpr);
  const land = W/H > 1.05;
  slots.forEach((s, i) => {
    if (land) s.pos.set(N/2 + 2.7, 0, (i-1)*2.85); else s.pos.set((i-1)*2.85, 0, N/2 + 2.35);
    s.bed.position.set(s.pos.x, 0, s.pos.z);
    if (s.cat && (!drag || drag.cat !== s.cat)){ s.cat.tp.copy(s.pos).setY(TRAY_Y); s.cat.group.position.copy(s.cat.tp); }
  });
  const minX = -4.6, maxX = land ? N/2 + 4.1 : 4.6, minZ = -4.6, maxZ = land ? 4.6 : N/2 + 3.75;
  const center = new V3((minX + maxX)/2, 0, (minZ + maxZ)/2);
  camera.position.copy(center).addScaledVector(CAM_DIR, 60);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [minX, maxX]) for (const y of [-0.5, 1.3]) for (const z of [minZ, maxZ]){
    const v = new V3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const hudB = $('hud').getBoundingClientRect().bottom + 8;
  const top = 1 - 2*hudB/H, bottom = -1 + 2*(14 + safeProbe.offsetHeight)/H;
  const side = 1 - 2*14/W;
  const sx = Math.max((x1 - x0)/(2*side), (y1 - y0)*W/((top - bottom)*H));
  const sy = sx*H/W;
  const cx = (x0 + x1)/2, cy = (y0 + y1)/2 - (top + bottom)/2*sy;
  camera.left = cx - sx; camera.right = cx + sx; camera.top = cy + sy; camera.bottom = cy - sy;
  camera.updateProjectionMatrix();
  const bc = new V3(0, 0.8, -0.5).project(camera);
  $('banner').style.top = ((1 - bc.y)/2*H) + 'px';
}
window.addEventListener('resize', layout);
if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

/* ---------------- 루프 ---------------- */
const clock = new THREE.Clock();
function frame(){
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1/30);
  TIME.value += dt;
  const t = TIME.value;
  if (state !== 'paused') for (let i = timers.length - 1; i >= 0; i--){
    timers[i].t -= dt;
    if (timers[i].t <= 0){ const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  if (drag) updateDrag(dt, t);
  else if (tilesDirty){ paintTiles(null, null, null, t); tilesDirty = false; }
  for (const cat of cats) updateCat(cat, dt, t);
  updateObstacles(dt, t);
  updatePuffs(dt);
  updateParts(dt);
  updateWeather(dt, t);
  if (run.mode === 'free'){
    shownScore += (score - shownScore) * (1 - Math.exp(-dt*10));
    if (Math.abs(score - shownScore) < 0.5) shownScore = score;
    scoreEl.textContent = Math.round(shownScore).toLocaleString('ko-KR');
  }
  renderer.render(scene, camera);
}

/* ---------------- 시작 ---------------- */
setSoundIcon();
document.body.dataset.season = 'home';
goTitle();
layout();
requestAnimationFrame(frame);

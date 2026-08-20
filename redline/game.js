'use strict';
(function(){

// ══════════════════════════════════════════════════════════════════════════
//  REDLINE — open-world arcade racer with impulse-based crash physics
// ══════════════════════════════════════════════════════════════════════════

var hasTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ── Renderer / scene / camera ───────────────────────────────────────────────
var canvas = document.getElementById('canvas');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060c);
scene.fog = new THREE.FogExp2(0x05060c, 0.0028);

var camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 2000);

window.addEventListener('resize', function(){
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  if (fxaaPass) fxaaPass.material.uniforms['resolution'].value.set(1/(window.innerWidth*renderer.getPixelRatio()), 1/(window.innerHeight*renderer.getPixelRatio()));
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
});

// ── Lighting ─────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x2a2a44, 1.4));
var moon = new THREE.DirectionalLight(0x6a7dff, 0.9);
moon.position.set(-200, 300, -150);
scene.add(moon);

// ── Bloom / FXAA post ───────────────────────────────────────────────────────
var composer=null, bloomPass=null, fxaaPass=null;
try {
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.55, 0.18);
  composer.addPass(bloomPass);
  if (typeof THREE.ShaderPass === 'function' && typeof THREE.FXAAShader !== 'undefined') {
    fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1/(window.innerWidth*renderer.getPixelRatio()), 1/(window.innerHeight*renderer.getPixelRatio()));
    fxaaPass.renderToScreen = true;
    composer.addPass(fxaaPass);
  }
} catch(e) { composer = null; }

// ── Ground ───────────────────────────────────────────────────────────────
var WORLD_R = 900;
var groundMat = new THREE.MeshStandardMaterial({ color: 0x0c0d16, roughness: 1 });
var ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_R*2.4, WORLD_R*2.4, 1, 1), groundMat);
ground.rotation.x = -Math.PI/2;
scene.add(ground);

// Road material (grid of streets drawn as flat dark strips above ground)
var roadMat = new THREE.MeshStandardMaterial({ color: 0x1b1c24, roughness: 0.9 });
var laneMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });

function addRoadStrip(cx, cz, w, l, rotY){
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), roadMat);
  m.rotation.x = -Math.PI/2; m.rotation.z = rotY || 0;
  m.position.set(cx, 0.02, cz);
  scene.add(m);
}
function addLaneLine(cx, cz, w, l, rotY){
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), laneMat);
  m.rotation.x = -Math.PI/2; m.rotation.z = rotY || 0;
  m.position.set(cx, 0.03, cz);
  m.material.transparent = true; m.material.opacity = 0.5;
  scene.add(m);
}

// ── Collidables ──────────────────────────────────────────────────────────
// AABB colliders (buildings) and segment colliders (guardrails)
var aabbColliders = []; // {minX,maxX,minZ,maxZ,h}
var segColliders   = []; // {x1,z1,x2,z2,r}

function addBuilding(cx, cz, w, d, h, color){
  var geo = new THREE.BoxGeometry(w, h, d);
  var mat = new THREE.MeshStandardMaterial({ color: color || 0x22242e, roughness: 0.85, emissive: 0x000000 });
  var m = new THREE.Mesh(geo, mat);
  m.position.set(cx, h/2, cz);
  scene.add(m);
  // window glow strip
  if (Math.random() < 0.85) {
    var gw = new THREE.Mesh(new THREE.PlaneGeometry(w*0.9, h*0.7),
      new THREE.MeshBasicMaterial({ color: Math.random()<0.5?0xff6a3d:0x33ccff, transparent:true, opacity:0.14 }));
    gw.position.set(cx, h/2, cz + d/2 + 0.05);
    scene.add(gw);
  }
  aabbColliders.push({ minX:cx-w/2, maxX:cx+w/2, minZ:cz-d/2, maxZ:cz+d/2, h:h });
}

function addGuardrail(x1,z1,x2,z2){
  var dx=x2-x1, dz=z2-z1, len=Math.sqrt(dx*dx+dz*dz);
  var geo = new THREE.BoxGeometry(len, 0.9, 0.25);
  var mat = new THREE.MeshStandardMaterial({ color:0x888899, emissive:0x111122, roughness:0.5, metalness:0.4 });
  var m = new THREE.Mesh(geo, mat);
  m.position.set((x1+x2)/2, 0.45, (z1+z2)/2);
  m.rotation.y = -Math.atan2(dz,dx);
  scene.add(m);
  segColliders.push({ x1:x1,z1:z1,x2:x2,z2:z2, r:0.5 });
}

function addStreetlight(x,z){
  var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,5,6), new THREE.MeshStandardMaterial({color:0x333340}));
  pole.position.set(x,2.5,z); scene.add(pole);
  var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3,8,8), new THREE.MeshBasicMaterial({color:0xffd97a}));
  lamp.position.set(x,5,z); scene.add(lamp);
  var pl = new THREE.PointLight(0xffcc66, 0.6, 16);
  pl.position.set(x,5,z); scene.add(pl);
  aabbColliders.push({ minX:x-0.3, maxX:x+0.3, minZ:z-0.3, maxZ:z+0.3, h:5 });
}

// ── World generation ─────────────────────────────────────────────────────
// Downtown grid (city blocks) centered at origin
var BLOCK = 46, STREET_W = 14, GRID_N = 7; // 7x7 blocks
var downtownHalf = (GRID_N*(BLOCK+STREET_W))/2;
for (var gx=0; gx<GRID_N; gx++){
  for (var gz=0; gz<GRID_N; gz++){
    var cx = -downtownHalf + gx*(BLOCK+STREET_W) + BLOCK/2 + STREET_W/2;
    var cz = -downtownHalf + gz*(BLOCK+STREET_W) + BLOCK/2 + STREET_W/2;
    // leave a cross-shaped clearing in the middle for a plaza
    if (Math.abs(gx-3)<=0 && Math.abs(gz-3)<=0) continue;
    var h = 10 + Math.random()*46;
    var col = [0x1c1e2a,0x201a26,0x161b28,0x241c1a][Math.floor(Math.random()*4)];
    addBuilding(cx, cz, BLOCK*0.82, BLOCK*0.82, h, col);
    if (Math.random()<0.4) addStreetlight(cx + BLOCK*0.55, cz);
  }
}
// downtown streets (visual strips)
for (var i=0;i<=GRID_N;i++){
  var p = -downtownHalf + i*(BLOCK+STREET_W);
  addRoadStrip(p, 0, STREET_W, downtownHalf*2+40, 0);
  addRoadStrip(0, p, downtownHalf*2+40, STREET_W, Math.PI/2);
}
for (var i=0;i<=GRID_N;i++){
  var p = -downtownHalf + i*(BLOCK+STREET_W);
  addLaneLine(p, 0, 0.4, downtownHalf*2+40, 0);
}

// Highway loop (oval) around downtown
var HW_RX = downtownHalf + 220, HW_RZ = downtownHalf + 170, HW_SEG = 48;
var highwayPts = [];
for (var s=0; s<HW_SEG; s++){
  var a = (s/HW_SEG)*Math.PI*2;
  highwayPts.push(new THREE.Vector3(Math.cos(a)*HW_RX, 0, Math.sin(a)*HW_RZ));
}
for (var s=0; s<HW_SEG; s++){
  var p0 = highwayPts[s], p1 = highwayPts[(s+1)%HW_SEG];
  var dx=p1.x-p0.x, dz=p1.z-p0.z, len=Math.sqrt(dx*dx+dz*dz), ang=Math.atan2(dz,dx);
  addRoadStrip((p0.x+p1.x)/2, (p0.z+p1.z)/2, 22, len+2, -ang);
  // guardrails on both edges
  var nx=-dz/len, nz=dx/len;
  addGuardrail(p0.x+nx*11, p0.z+nz*11, p1.x+nx*11, p1.z+nz*11);
  addGuardrail(p0.x-nx*11, p0.z-nz*11, p1.x-nx*11, p1.z-nz*11);
}

// Industrial district (east of downtown, past the highway)
var indX = HW_RX + 260;
for (var i=0;i<10;i++){
  var cx = indX + (Math.random()-0.5)*260;
  var cz = (Math.random()-0.5)*420;
  addBuilding(cx, cz, 30+Math.random()*40, 30+Math.random()*40, 8+Math.random()*10, 0x1a1d16);
}
addRoadStrip(indX, 0, 60, 500, 0);
addRoadStrip((indX+HW_RX)/2, 0, 700, 40, 0); // connector road

// Static parked-car props (also collidable, small)
function addProp(x,z){
  var m = new THREE.Mesh(new THREE.BoxGeometry(1.8,1,3.8), new THREE.MeshStandardMaterial({color:0x333344}));
  m.position.set(x,0.5,z); scene.add(m);
  aabbColliders.push({minX:x-0.9,maxX:x+0.9,minZ:z-1.9,maxZ:z+1.9,h:1});
}
for (var i=0;i<40;i++){
  var side = Math.random()<0.5?-1:1;
  addProp((Math.random()-0.5)*downtownHalf*1.8, side*(downtownHalf*0.15+Math.random()*downtownHalf*1.4));
}

// ── Neon skyline glow strip (visual only, no collision) ─────────────────────
var skyRing = new THREE.Mesh(new THREE.RingGeometry(WORLD_R*0.9, WORLD_R*1.4, 32),
  new THREE.MeshBasicMaterial({ color:0x2a1440, transparent:true, opacity:0.25, side:THREE.DoubleSide }));
skyRing.rotation.x = -Math.PI/2; skyRing.position.y = 0.01;
scene.add(skyRing);

// ── Particle pool (crash sparks/debris) ─────────────────────────────────────
var particles = [];
var partGeo = new THREE.BoxGeometry(0.18,0.18,0.18);
function burst(pos, color, count, power){
  count = count||14; power = power||8;
  for (var i=0;i<count;i++){
    var mat = new THREE.MeshBasicMaterial({ color: color||0xffaa33 });
    var m = new THREE.Mesh(partGeo, mat);
    m.position.copy(pos);
    scene.add(m);
    var ang = Math.random()*Math.PI*2, ele = Math.random()*Math.PI*0.5;
    var v = new THREE.Vector3(Math.cos(ang)*Math.cos(ele), Math.sin(ele)+0.4, Math.sin(ang)*Math.cos(ele)).multiplyScalar(power*(0.4+Math.random()*0.8));
    particles.push({ mesh:m, vel:v, life: 0.5+Math.random()*0.6, max: 1.1 });
  }
}
function updateParticles(dt){
  for (var i=particles.length-1;i>=0;i--){
    var p=particles[i];
    if (p.isSmoke){ p.vel.y += 1.4*dt; p.vel.multiplyScalar(1-0.6*dt); p.mesh.scale.multiplyScalar(1+0.7*dt); }
    else p.vel.y -= 18*dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.life -= dt;
    p.mesh.material.opacity = Math.max(0, (p.life/p.max) * (p.isSmoke?0.35:1));
    p.mesh.material.transparent = true;
    if (!p.isSmoke) p.mesh.scale.setScalar(Math.max(0.05, p.life/p.max));
    if (p.life<=0){ scene.remove(p.mesh); p.mesh.material.dispose(); particles.splice(i,1); }
  }
}
// ── Soft-body-style crumple: push body-mesh vertices near the impact point
// inward along the hit normal, clamped so they can't collapse past a limit.
var _dfM4 = new THREE.Matrix4(), _dfLocalPt = new THREE.Vector3(), _dfLocalN = new THREE.Vector3();
function deformCarBody(car, worldPt, worldNx, worldNz, severity){
  var body = car.mesh.userData.body;
  car.mesh.updateMatrixWorld(true);
  _dfLocalPt.copy(worldPt);
  body.worldToLocal(_dfLocalPt);
  _dfM4.extractRotation(body.matrixWorld).invert();
  _dfLocalN.set(worldNx,0,worldNz).applyMatrix4(_dfM4).normalize();

  var geo = body.geometry, pos = geo.attributes.position, orig = geo.userData.origPos;
  // BeamNG-style crumple magnitudes: a hard hit should visibly cave the nose/side in,
  // not just dimple it. radius/push/maxDent are all deliberately large relative to the
  // ~1.9 x 0.55 x 4.6 body so a serious impact reads immediately as real damage.
  var radius = 0.75 + severity*0.75, push = 0.5 + severity*0.95, maxDent = 0.55;
  for (var i=0;i<pos.count;i++){
    var ox=orig[i*3], oy=orig[i*3+1], oz=orig[i*3+2];
    var dx=ox-_dfLocalPt.x, dy=oy-_dfLocalPt.y, dz=oz-_dfLocalPt.z;
    var d = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (d>radius) continue;
    var t = 1 - d/radius;
    var falloff = t*t*(3-2*t); // smoothstep — rounded crumple instead of a sharp cone
    // worldNx/worldNz point from the obstacle toward the car, so pushing ALONG that
    // direction moves surface vertices further into the car's own body — that's the dent.
    // (Subtracting here, as an earlier version did, pushed vertices back toward the
    // obstacle instead — the surface would bulge outward rather than cave in.)
    var cx=pos.getX(i), cy=pos.getY(i), cz=pos.getZ(i);
    var nx=cx+_dfLocalN.x*push*falloff, ny=cy+_dfLocalN.y*push*falloff*0.6, nz=cz+_dfLocalN.z*push*falloff;
    // clamp displacement from the pristine vertex so it can't invert through itself
    var ddx=nx-ox, ddy=ny-oy, ddz=nz-oz, dd=Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz);
    if (dd>maxDent){ var s=maxDent/dd; nx=ox+ddx*s; ny=oy+ddy*s; nz=oz+ddz*s; }
    pos.setXYZ(i, nx, ny, nz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

var smokeCooldownByCarId = new WeakMap();
function emitSmoke(car){
  var dmg = car.damage;
  if (dmg < 45) return;
  var cd = smokeCooldownByCarId.get(car) || 0;
  if (cd > 0){ smokeCooldownByCarId.set(car, cd-1); return; }
  smokeCooldownByCarId.set(car, Math.max(2, Math.floor(8 - dmg/15))); // heavier damage = denser smoke
  var fwd = car.forwardVec();
  var mat = new THREE.MeshBasicMaterial({ color: dmg>80?0x1a1a1a:0x555555 });
  var m = new THREE.Mesh(partGeo, mat);
  m.position.set(car.x + fwd.x*1.7, 0.55, car.z + fwd.z*1.7);
  m.scale.setScalar(0.6);
  scene.add(m);
  particles.push({ mesh:m, vel:new THREE.Vector3((Math.random()-0.5)*0.5,1.2+Math.random()*0.6,(Math.random()-0.5)*0.5), life:1.2+Math.random()*0.6, max:1.8, isSmoke:true });
}

// ── Skid marks ───────────────────────────────────────────────────────────
var skidGroup = new THREE.Group(); scene.add(skidGroup);
var skidMat = new THREE.MeshBasicMaterial({ color:0x090909, transparent:true, opacity:0.5 });
var skidCount = 0;
function addSkid(x,z,ang){
  if (skidCount++ % 2 !== 0) return; // thin out
  var m = new THREE.Mesh(new THREE.PlaneGeometry(0.5,1.2), skidMat.clone());
  m.rotation.x=-Math.PI/2; m.rotation.z=-ang;
  m.position.set(x,0.025,z);
  skidGroup.add(m);
  if (skidGroup.children.length>260) skidGroup.remove(skidGroup.children[0]);
}

// ══════════════════════════════════════════════════════════════════════════
//  CAR
// ══════════════════════════════════════════════════════════════════════════
function buildCarMesh(bodyColor, isCop){
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshStandardMaterial({ color:bodyColor, roughness:0.28, metalness:0.65, envMapIntensity:1.2 });
  var glassMat = new THREE.MeshStandardMaterial({ color:0x0a0c12, roughness:0.08, metalness:0.2 });
  var trimMat = new THREE.MeshStandardMaterial({ color:0x15161c, roughness:0.5, metalness:0.6 });

  // Lower body — extends the full length of the car including what used to be separate
  // front/rear bumper boxes, so the whole shell (the part that actually takes impacts) is
  // one continuous soft-body mesh instead of a rigid bumper bolted onto a dentable box.
  var bodyGeo = new THREE.BoxGeometry(1.9,0.55,4.6, 7,4,16); // dense grid so dents look like real crumples
  bodyGeo.userData.origPos = bodyGeo.attributes.position.array.slice();
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.48; g.add(body); g.userData.body = body;
  var beltline = new THREE.Mesh(new THREE.BoxGeometry(1.96,0.16,3.2), bodyMat);
  beltline.position.set(0,0.78,0); g.add(beltline);

  // Cabin/greenhouse with raked windshield + rear glass (angled boxes, not just a flat block)
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55,0.5,2.0), bodyMat);
  cabin.position.set(0,1.05,-0.15); g.add(cabin);
  var windshield = new THREE.Mesh(new THREE.BoxGeometry(1.45,0.42,0.06), glassMat);
  windshield.position.set(0,1.08,0.8); windshield.rotation.x = -0.32; g.add(windshield);
  var rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.45,0.38,0.06), glassMat);
  rearGlass.position.set(0,1.02,-1.1); rearGlass.rotation.x = 0.3; g.add(rearGlass);
  var sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.34,1.7), glassMat);
  sideGlassL.position.set(-0.77,1.05,-0.15); g.add(sideGlassL);
  var sideGlassR = sideGlassL.clone(); sideGlassR.position.x = 0.77; g.add(sideGlassR);

  // Mirrors
  [-1, 1].forEach(function(side){
    var mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.22), trimMat);
    mirror.position.set(side*1.0, 0.85, 0.55); g.add(mirror);
  });

  // Rear valance trim only — the front bumper is no longer a separate rigid mesh, it's
  // now part of the deformable body shell above so a head-on hit actually crumples it.
  var rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.85,0.4,0.2), trimMat);
  rearBumper.position.set(0,0.4,-2.25); g.add(rearBumper);

  // Wheels with a simple rim disc so they read as more than plain cylinders
  var wheelGeo = new THREE.CylinderGeometry(0.36,0.36,0.32,12);
  var wheelMat = new THREE.MeshStandardMaterial({ color:0x0c0c0c, roughness:0.75 });
  var rimGeo = new THREE.CylinderGeometry(0.2,0.2,0.34,8);
  var rimMat = new THREE.MeshStandardMaterial({ color:0xaaaaaa, roughness:0.35, metalness:0.85 });
  var wheels = [];
  [[-0.95,1.3],[0.95,1.3],[-0.95,-1.3],[0.95,-1.3]].forEach(function(p){
    var wg = new THREE.Group();
    var w = new THREE.Mesh(wheelGeo, wheelMat); w.rotation.z = Math.PI/2; wg.add(w);
    var rim = new THREE.Mesh(rimGeo, rimMat); rim.rotation.z = Math.PI/2; wg.add(rim);
    wg.position.set(p[0],0.36,p[1]); g.add(wg); wheels.push(wg);
  });
  g.userData.wheels = wheels;

  // Headlights — two, one per side (previously a stray clone/reference mixup produced
  // three overlapping spheres with one side missing its own independent instance)
  var hl1 = new THREE.PointLight(0xbfe0ff, isCop?0.9:1.4, isCop?14:20);
  hl1.position.set(0,0.6,2.45); g.add(hl1);
  var hlGeo = new THREE.SphereGeometry(0.12,6,6);
  var hlMat = new THREE.MeshBasicMaterial({color:0xdff2ff});
  [-0.7, 0.7].forEach(function(sx){
    var hlMesh = new THREE.Mesh(hlGeo, hlMat);
    hlMesh.position.set(sx,0.55,2.25); g.add(hlMesh);
  });

  // Taillights
  var tl = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.15,0.05), new THREE.MeshBasicMaterial({color:0xff2233}));
  tl.position.set(0,0.55,-2.28); g.add(tl); g.userData.tail = tl;

  if (isCop) {
    var bar = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.2,0.35), new THREE.MeshStandardMaterial({color:0x111111}));
    bar.position.set(0,1.28,-0.2); g.add(bar);
    var red = new THREE.PointLight(0xff2233, 0, 20); red.position.set(-0.25,1.35,-0.2); g.add(red); g.userData.copRed=red;
    var blue = new THREE.PointLight(0x2255ff, 0, 20); blue.position.set(0.25,1.35,-0.2); g.add(blue); g.userData.copBlue=blue;
  } else {
    // Small rear spoiler — purely cosmetic, gives non-cop cars a sportier silhouette
    var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.06,0.3), trimMat);
    spoiler.position.set(0,0.98,-1.85); g.add(spoiler);
    var strutGeo = new THREE.BoxGeometry(0.06,0.22,0.06);
    [-0.6,0.6].forEach(function(sx){
      var strut = new THREE.Mesh(strutGeo, trimMat);
      strut.position.set(sx,0.86,-1.85); g.add(strut);
    });
  }
  return g;
}

function Car(opts){
  this.mesh = buildCarMesh(opts.color, opts.isCop);
  scene.add(this.mesh);
  this.x = opts.x||0; this.z = opts.z||0; this.heading = opts.heading||0;
  this.speed = 0;          // forward speed, world units/sec (approx mph*0.42)
  this.angularVel = 0;     // spin from crashes, rad/sec
  this.damage = 0;         // 0..100
  this.wrecked = false;
  this.wreckTimer = 0;
  this.isPlayer = !!opts.isPlayer;
  this.isCop = !!opts.isCop;
  this.isAI = !!opts.isAI;
  this.driftSlip = 0;      // lateral slip angle offset while drifting
  this.radius = 2.3; // matches the extended body length now that bumpers are part of the shell
  this.lap = 0; this.nextCP = 0; this.progress = 0;
  this.waypoints = opts.waypoints || null;
  this.wpIndex = 0;
  this.hitFlash = 0;
  this.stunTimer = 0; // brief post-crash window where throttle/brake input is ignored, so the bounce-back can separate the car from what it hit
  this.busted = 0; // cop-chase capture meter
}
Car.prototype.forwardVec = function(){ return new THREE.Vector3(-Math.sin(this.heading),0,Math.cos(this.heading)); };

var MAX_SPEED = 46, MAX_SPEED_NITRO = 66, ACCEL = 26, BRAKE_DECEL = 46, DRAG = 9, REVERSE_MAX = 16;
var TURN_RATE = 2.6; // rad/sec at low speed

Car.prototype.updatePhysics = function(dt, input){
  if (this.wrecked) {
    this.wreckTimer -= dt;
    this.speed *= 0.9;
    if (this.wreckTimer<=0) this.wrecked=false, this.damage=Math.min(this.damage,60);
  }
  var throttle = input.throttle, brake = input.brake, steer = input.steer, drift = input.drift, nitro = input.nitro;

  var speedFactor = Math.min(1, Math.abs(this.speed)/MAX_SPEED);
  var turnRate;
  if (Math.abs(this.speed) < 2) turnRate = TURN_RATE * 0.5; // low-speed pivot, e.g. wheels turning near a stop
  else turnRate = TURN_RATE * (1 - speedFactor*0.55) * (this.speed<0?-1:1);
  this.heading += steer * turnRate * dt * (drift?1.5:1);

  // spin from crash impulses decays
  if (Math.abs(this.angularVel)>0.001){
    this.heading += this.angularVel*dt;
    this.angularVel *= Math.max(0, 1 - 2.2*dt);
  }

  if (this.stunTimer>0) this.stunTimer -= dt;
  var stunned = this.stunTimer>0;

  var maxFwd = nitro && this.nitroFuel>0 ? MAX_SPEED_NITRO : MAX_SPEED;
  if (throttle>0 && !stunned){
    this.speed += ACCEL*(nitro&&this.nitroFuel>0?1.7:1)*dt;
    this.speed = Math.min(this.speed, maxFwd);
  } else if (brake>0 && !stunned){
    if (this.speed>0.5) this.speed -= BRAKE_DECEL*dt;
    else this.speed = Math.max(this.speed-ACCEL*0.6*dt, -REVERSE_MAX);
  } else {
    if (this.speed>0) this.speed = Math.max(0, this.speed-DRAG*dt);
    else if (this.speed<0) this.speed = Math.min(0, this.speed+DRAG*dt);
  }

  // drift: lateral slip builds while handbrake+turning at speed, decays otherwise
  var targetSlip = (drift && Math.abs(this.speed)>6) ? steer*-0.55 : 0;
  this.driftSlip += (targetSlip - this.driftSlip) * Math.min(1, 6*dt);

  var fwd = this.forwardVec();
  var right = new THREE.Vector3(fwd.z,0,-fwd.x);
  var moveDir = fwd.clone().addScaledVector(right, this.driftSlip).normalize();
  this.prevX=this.x; this.prevZ=this.z;
  this.x += moveDir.x*this.speed*dt;
  this.z += moveDir.z*this.speed*dt;

  if (drift && Math.abs(this.speed)>10) addSkid(this.x,this.z,this.heading);

  // visual
  this.mesh.position.set(this.x,0,this.z);
  this.mesh.rotation.y = -this.heading;
  var lean = THREE.MathUtils.clamp(-steer*0.12*speedFactor, -0.16,0.16);
  var pitchLean = THREE.MathUtils.clamp((throttle-brake)*-0.03,-0.05,0.05);
  this.mesh.rotation.z = lean;
  this.mesh.rotation.x = pitchLean;
  var wheels = this.mesh.userData.wheels;
  for (var i=0;i<wheels.length;i++) wheels[i].rotation.x -= this.speed*dt*1.2;
  if (this.mesh.userData.copRed){
    var t=performance.now()*0.006;
    this.mesh.userData.copRed.intensity = (Math.sin(t)>0)?3:0;
    this.mesh.userData.copBlue.intensity = (Math.sin(t)>0)?0:3;
  }
  if (this.hitFlash>0){
    this.hitFlash -= dt;
    this.mesh.userData.body.material.emissive.setHex(0x551100);
  } else {
    this.mesh.userData.body.material.emissive.setHex(0x000000);
  }
};

Car.prototype.applyDamage = function(amount){
  this.damage = Math.min(100, this.damage+amount);
  this.hitFlash = 0.15;
  if (this.damage>=100 && !this.wrecked){ this.wrecked=true; this.wreckTimer=2.2; burst(new THREE.Vector3(this.x,0.6,this.z), 0xff5500, 26, 12); }
};

// ── Collision resolution ────────────────────────────────────────────────────
function closestPointOnAABB(px,pz,b){
  return { x: THREE.MathUtils.clamp(px,b.minX,b.maxX), z: THREE.MathUtils.clamp(pz,b.minZ,b.maxZ) };
}
function closestPointOnSeg(px,pz,s){
  var dx=s.x2-s.x1, dz=s.z2-s.z1;
  var len2 = dx*dx+dz*dz || 1;
  var t = THREE.MathUtils.clamp(((px-s.x1)*dx+(pz-s.z1)*dz)/len2, 0, 1);
  return { x: s.x1+dx*t, z: s.z1+dz*t };
}

function resolveCrash(car, nx, nz, penetration, impactSpeed){
  // Always resolve interpenetration geometrically, even for merely-resting contact
  // (no damage/bounce implied) — this alone must never be skipped or the car visibly clips.
  car.x += nx*(penetration+0.12); car.z += nz*(penetration+0.12);
  var fwd = car.forwardVec();
  var vx = fwd.x*car.speed, vz = fwd.z*car.speed;
  var vn = vx*nx + vz*nz; // velocity component along normal (negative = into surface)
  var headOn = Math.abs(fwd.x*nx+fwd.z*nz); // 0 glancing .. 1 head-on

  // Require a real closing speed, not just trivial creep, to count as an actual crash —
  // otherwise a car resting against a wall re-triggers "vn<0" every single frame forever
  // (throttle re-applies a hair of inward speed each frame, satisfying vn<0 endlessly).
  if (vn < -1.0){
    var restitution = 0.25;
    vx -= nx*vn*(1+restitution);
    vz -= nz*vn*(1+restitution);
    // extra tangential scrub
    vx *= 0.86; vz *= 0.86;
    car.speed = Math.sign(vx*fwd.x+vz*fwd.z || 1) * Math.sqrt(vx*vx+vz*vz);
    var sev = Math.min(1, Math.abs(impactSpeed)/MAX_SPEED_NITRO);
    var dmg = sev*sev*45*(0.4+headOn*0.9);
    car.applyDamage(dmg);
    // angular kick — more spin on glancing hits, less on dead-on
    var cross = fwd.x*nz - fwd.z*nx;
    car.angularVel += (cross>=0?1:-1) * sev * (1.2 + (1-headOn)*3.5) * (0.6+Math.random()*0.6);
    // nx/nz point FROM the obstacle TOWARD the car, so the actual contact point on the car's
    // surface is car.center MINUS that direction (toward the obstacle) — using +nx here was
    // placing both the spark burst and the deformation on the car's far side, away from the hit.
    burst(new THREE.Vector3(car.x - nx*car.radius, 0.6, car.z - nz*car.radius), 0xffaa33, 10+sev*16, 6+sev*10);
    if (sev>0.05) deformCarBody(car, new THREE.Vector3(car.x - nx*car.radius, 0.55, car.z - nz*car.radius), nx, nz, sev);
    if (car.isPlayer) shakeAmt = Math.max(shakeAmt, 0.15+sev*0.6);
    if (car.isPlayer && window.__RL_DEBUG) console.log('[world-crash] pen='+penetration.toFixed(3)+' sev='+sev.toFixed(3)+' dmg='+dmg.toFixed(2)+' newSpeed='+car.speed.toFixed(2)+' pos=('+car.x.toFixed(2)+','+car.z.toFixed(2)+')');
    // Brief control lockout on a real hit so the bounce-back can actually separate
    // the car from what it hit, instead of the player re-flooring straight back into it.
    car.stunTimer = Math.max(car.stunTimer, 0.15+sev*0.5);
  }
}

function collideCarWithWorld(car, dt){
  var hitThisFrame = false, avgNx = 0, avgNz = 0, hitCount = 0;
  for (var i=0;i<aabbColliders.length;i++){
    var b = aabbColliders[i];
    var cp = closestPointOnAABB(car.x,car.z,b);
    var dx=car.x-cp.x, dz=car.z-cp.z, dist=Math.sqrt(dx*dx+dz*dz);
    if (dist < car.radius){
      var nx,nz;
      if (dist>0.0001){ nx=dx/dist; nz=dz/dist; } else { nx=1; nz=0; }
      var pen = car.radius-dist;
      var speedAtHit = car.speed;
      resolveCrash(car, nx, nz, pen, speedAtHit);
      hitThisFrame = true; avgNx += nx; avgNz += nz; hitCount++;
    }
  }
  for (var i=0;i<segColliders.length;i++){
    var s = segColliders[i];
    var cp = closestPointOnSeg(car.x,car.z,s);
    var dx=car.x-cp.x, dz=car.z-cp.z, dist=Math.sqrt(dx*dx+dz*dz);
    var minD = car.radius+s.r;
    if (dist < minD){
      var nx,nz;
      if (dist>0.0001){ nx=dx/dist; nz=dz/dist; } else { nx=1; nz=0; }
      resolveCrash(car, nx, nz, minD-dist, car.speed);
      hitThisFrame = true; avgNx += nx; avgNz += nz; hitCount++;
    }
  }
  // world boundary
  var d = Math.sqrt(car.x*car.x+car.z*car.z);
  if (d > WORLD_R-20){
    var nx=-car.x/d, nz=-car.z/d;
    resolveCrash(car, nx, nz, d-(WORLD_R-20), car.speed);
    hitThisFrame = true; avgNx += nx; avgNz += nz; hitCount++;
  }

  // Safety net: whatever the exact geometric cause (e.g. a car caught between two
  // adjacent guardrail segments around a curve, each shove undoing the other's), a
  // car should never be able to grind in roughly the same spot indefinitely. Track
  // real elapsed time + actual displacement (not a per-frame streak, which a subtle
  // hit/no-hit alternation between adjacent colliders could reset before it fires)
  // and force a decisive separation once it's clear the car isn't making progress.
  if (car._stuckCheckX==null){ car._stuckCheckX=car.x; car._stuckCheckZ=car.z; car._stuckCheckT=0; car._stuckDamaged=false; }
  car._stuckCheckT += dt||0;
  if (hitThisFrame) car._stuckDamaged = true;
  if (car._stuckCheckT > 0.8){
    var moved = Math.hypot(car.x-car._stuckCheckX, car.z-car._stuckCheckZ);
    if (moved < 2.0 && car._stuckDamaged){
      var mnx = hitCount>0 ? avgNx/hitCount : (car.x-car._stuckCheckX)||1;
      var mnz = hitCount>0 ? avgNz/hitCount : (car.z-car._stuckCheckZ)||0;
      var mlen = Math.hypot(mnx,mnz) || 1;
      car.x += (mnx/mlen)*4.0; car.z += (mnz/mlen)*4.0;
      car.speed = 0; car.driftSlip = 0; car.angularVel = 0; car.stunTimer = Math.max(car.stunTimer, 0.5);
    }
    car._stuckCheckX = car.x; car._stuckCheckZ = car.z; car._stuckCheckT = 0; car._stuckDamaged = false;
  }
}

function collideCarCar(a,b){
  var dx=a.x-b.x, dz=a.z-b.z, dist=Math.sqrt(dx*dx+dz*dz);
  var minD = a.radius+b.radius;
  if (dist < minD && dist>0.001){
    var nx=dx/dist, nz=dz/dist;
    // push fully apart (plus a small margin) rather than splitting the gap in half —
    // halving it left cars sitting just inside minD, re-triggering next frame forever
    var sep = (minD-dist)+0.08;
    a.x += nx*sep*0.5; a.z += nz*sep*0.5;
    b.x -= nx*sep*0.5; b.z -= nz*sep*0.5;

    // Only a real hit if the cars are actually closing on each other, not just resting
    // in contact — otherwise two stopped/grazing cars would grind damage forever.
    var relVx = (a.forwardVec().x*a.speed) - (b.forwardVec().x*b.speed);
    var relVz = (a.forwardVec().z*a.speed) - (b.forwardVec().z*b.speed);
    var closingSpeed = -(relVx*nx + relVz*nz); // positive = closing
    if (closingSpeed > 1.5){
      var sev = Math.min(1, closingSpeed/(MAX_SPEED*1.4));
      a.applyDamage(sev*sev*30);
      b.applyDamage(sev*sev*30);
      a.angularVel += sev*2.2*(Math.random()<0.5?1:-1);
      b.angularVel += sev*2.2*(Math.random()<0.5?1:-1);
      a.speed *= 0.5; b.speed *= 0.5;
      burst(new THREE.Vector3((a.x+b.x)/2,0.6,(a.z+b.z)/2), 0xffcc55, 16, 9);
      var midPt = new THREE.Vector3((a.x+b.x)/2, 0.55, (a.z+b.z)/2);
      deformCarBody(a, midPt, nx, nz, sev);
      deformCarBody(b, midPt, -nx, -nz, sev);
      if (a.isPlayer||b.isPlayer) shakeAmt = Math.max(shakeAmt, 0.3+sev*0.5);
      if ((a.isPlayer||b.isPlayer) && window.__RL_DEBUG) console.log('[car-crash] closingSpeed='+closingSpeed.toFixed(2)+' sev='+sev.toFixed(3)+' dist='+dist.toFixed(3)+' minD='+minD.toFixed(2));
      var stun = 0.15+sev*0.5;
      a.stunTimer = Math.max(a.stunTimer, stun);
      b.stunTimer = Math.max(b.stunTimer, stun);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════════════════════════
var gameState = 'menu'; // menu|playing|paused|results|busted
var mode = 'freeroam';  // freeroam|circuit|copchase
var player, traffic=[], cops=[], racers=[];
var camMode = 'chase';
var shakeAmt = 0;
var raceTime=0, raceLaps=3, checkpoints=[], copTimer=0, bustMeter=0;
var startPos = new THREE.Vector3(0, 0, downtownHalf+STREET_W*0.5+30);

// checkpoints: loop using highway points subsampled + a downtown leg
function buildCheckpoints(){
  checkpoints = [];
  for (var i=0;i<HW_SEG;i+=6) checkpoints.push({x:highwayPts[i].x, z:highwayPts[i].z});
}
buildCheckpoints();

function trafficWaypoints(){
  // simple rectangular loop through downtown streets
  var r = downtownHalf*0.7;
  return [{x:-r,z:-r},{x:r,z:-r},{x:r,z:r},{x:-r,z:r}];
}

function resetWorldEntities(){
  traffic.forEach(function(c){ scene.remove(c.mesh); });
  cops.forEach(function(c){ scene.remove(c.mesh); });
  racers.forEach(function(c){ scene.remove(c.mesh); });
  traffic=[]; cops=[]; racers=[];
}

function spawnTraffic(n){
  var wp = trafficWaypoints();
  for (var i=0;i<n;i++){
    var p = wp[i%wp.length];
    var c = new Car({ x:p.x+(Math.random()-0.5)*10, z:p.z+(Math.random()-0.5)*10, color:[0x3355ff,0x22cc66,0xcccccc,0xdddd33][i%4], isAI:true, waypoints:wp, heading:Math.random()*Math.PI*2 });
    c.wpIndex = i%wp.length;
    traffic.push(c);
  }
}
function spawnRacers(n){
  for (var i=0;i<n;i++){
    var p = checkpoints[0];
    var c = new Car({ x:p.x+(i+1)*4, z:p.z, color:[0xff5533,0x33ff88,0xffaa33][i%3], isAI:true });
    c.nextCP = 1; c.lap=0;
    racers.push(c);
  }
}
function spawnCops(n){
  for (var i=0;i<n;i++){
    var ang = Math.random()*Math.PI*2;
    var c = new Car({ x:player.x+Math.cos(ang)*40, z:player.z+Math.sin(ang)*40, color:0x111133, isCop:true, isAI:true });
    cops.push(c);
  }
}

// simple AI: steer toward a target point
function aiSteerToward(car, tx, tz, dt, aggressive){
  var dx=tx-car.x, dz=tz-car.z;
  var targetHeading = Math.atan2(-dx,dz); // matches forwardVec's (-sin(h), cos(h)) convention
  var diff = targetHeading - car.heading;
  while (diff>Math.PI) diff-=Math.PI*2; while (diff<-Math.PI) diff+=Math.PI*2;
  var steer = THREE.MathUtils.clamp(diff*1.4, -1, 1);
  var dist = Math.sqrt(dx*dx+dz*dz);
  var throttle = dist>4 ? 1 : 0.3;
  car.updatePhysics(dt, { throttle:throttle, brake:0, steer:steer, drift:aggressive&&Math.abs(steer)>0.6, nitro:false });
}

function updateTraffic(dt){
  traffic.forEach(function(c){
    var wp = c.waypoints[c.wpIndex];
    var d = Math.hypot(wp.x-c.x, wp.z-c.z);
    if (d<8) c.wpIndex = (c.wpIndex+1)%c.waypoints.length;
    aiSteerToward(c, wp.x, wp.z, dt, false);
    collideCarWithWorld(c, dt);
  });
}
function updateRacers(dt){
  racers.forEach(function(c){
    var cp = checkpoints[c.nextCP];
    var d = Math.hypot(cp.x-c.x, cp.z-c.z);
    if (d<14){ c.nextCP=(c.nextCP+1)%checkpoints.length; if (c.nextCP===0) c.lap++; }
    aiSteerToward(c, cp.x, cp.z, dt, true);
    collideCarWithWorld(c, dt);
  });
}
function updateCops(dt){
  cops.forEach(function(c){
    aiSteerToward(c, player.x, player.z, dt, true);
    collideCarWithWorld(c, dt);
    var d = Math.hypot(player.x-c.x, player.z-c.z);
    if (d < 6){
      bustMeter += dt*38;
      collideCarCar(player, c);
    } else {
      bustMeter = Math.max(0, bustMeter - dt*14);
    }
  });
  if (bustMeter>=100 && gameState==='playing') doBusted();
}

// ══════════════════════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════════════════════
var keys = {};
window.addEventListener('keydown', function(e){
  keys[e.code]=true;
  if (e.code==='KeyC' && gameState==='playing') camMode = camMode==='chase'?'far':'chase';
  if ((e.code==='KeyP'||e.code==='Escape') ){
    if (gameState==='playing') pauseGame();
    else if (gameState==='paused') resumeGame();
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code)>=0) e.preventDefault();
});
window.addEventListener('keyup', function(e){ keys[e.code]=false; });

var touchSteerId=null, touchSteerBaseX=0, touchSteerOffsetX=0;
var touchGas=false, touchBrake=false, touchDrift=false, touchNitro=false;

function initTouch(){
  if (!hasTouchScreen) return;
  document.getElementById('touch-controls').style.display='block';
  document.getElementById('touch-pause').style.display='flex';
  var steerZone = document.getElementById('touch-steer-zone');
  var jb = document.getElementById('touch-joystick-base'), jk = document.getElementById('touch-joystick-knob');
  steerZone.addEventListener('touchstart', function(e){
    e.preventDefault(); var t=e.changedTouches[0];
    touchSteerId=t.identifier; touchSteerBaseX=t.clientX; touchSteerOffsetX=0;
    jb.style.left=t.clientX+'px'; jb.style.top=t.clientY+'px'; jb.style.display='block';
    jk.style.left=t.clientX+'px'; jk.style.top=t.clientY+'px'; jk.style.display='block';
  }, {passive:false});
  steerZone.addEventListener('touchmove', function(e){
    e.preventDefault();
    for (var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i]; if (t.identifier!==touchSteerId) continue;
      var dx=t.clientX-touchSteerBaseX; var maxR=70;
      touchSteerOffsetX = THREE.MathUtils.clamp(dx/maxR,-1,1);
      var cdx = THREE.MathUtils.clamp(dx,-maxR,maxR);
      jk.style.left=(touchSteerBaseX+cdx)+'px';
    }
  }, {passive:false});
  function endSteer(e){
    for (var i=0;i<e.changedTouches.length;i++) if (e.changedTouches[i].identifier===touchSteerId){
      touchSteerId=null; touchSteerOffsetX=0; jb.style.display='none'; jk.style.display='none';
    }
  }
  steerZone.addEventListener('touchend', endSteer, {passive:false});
  steerZone.addEventListener('touchcancel', endSteer, {passive:false});

  function btn(id, on, off){
    var el=document.getElementById(id);
    el.addEventListener('touchstart', function(e){ e.preventDefault(); on(); el.classList.add('active'); }, {passive:false});
    el.addEventListener('touchend', function(e){ e.preventDefault(); off(); el.classList.remove('active'); }, {passive:false});
    el.addEventListener('touchcancel', function(e){ e.preventDefault(); off(); el.classList.remove('active'); }, {passive:false});
  }
  btn('touch-gas', function(){touchGas=true;}, function(){touchGas=false;});
  btn('touch-brake', function(){touchBrake=true;}, function(){touchBrake=false;});
  btn('touch-drift', function(){touchDrift=true;}, function(){touchDrift=false;});
  btn('touch-nitro', function(){touchNitro=true;}, function(){touchNitro=false;});
  document.getElementById('touch-pause').addEventListener('touchstart', function(e){
    e.preventDefault();
    if (gameState==='playing') pauseGame(); else if (gameState==='paused') resumeGame();
  }, {passive:false});
}
initTouch();

function readInput(){
  var steer = 0;
  if (keys['ArrowLeft']||keys['KeyA']) steer -= 1;
  if (keys['ArrowRight']||keys['KeyD']) steer += 1;
  if (touchSteerId!==null) steer = touchSteerOffsetX;
  var throttle = (keys['ArrowUp']||keys['KeyW']||touchGas) ? 1 : 0;
  var brake = (keys['ArrowDown']||keys['KeyS']||touchBrake) ? 1 : 0;
  var drift = !!(keys['Space']||touchDrift);
  var nitro = !!(keys['ShiftLeft']||keys['ShiftRight']||touchNitro);
  return { throttle:throttle, brake:brake, steer:steer, drift:drift, nitro:nitro };
}

// ══════════════════════════════════════════════════════════════════════════
//  SCREENS / FLOW
// ══════════════════════════════════════════════════════════════════════════
var homeScreen=document.getElementById('home-screen'), pauseScreen=document.getElementById('pause-screen');
var resultsScreen=document.getElementById('results-screen'), bustedScreen=document.getElementById('busted-screen');
var hud=document.getElementById('hud'), pauseBtnHud=document.getElementById('pause-btn-hud');
var bustedFlash=document.getElementById('busted-flash');
var modeDesc=document.getElementById('mode-desc'), bestDisplay=document.getElementById('best-display');

var MODE_DESCS = {
  freeroam: 'Free Roam: explore the open city, no fail state. Crash, drift, and boost freely.',
  circuit: 'Circuit Race: 3 laps against 3 rivals through downtown and the highway loop. First past the line wins.',
  copchase: 'Cop Chase: outrun the police. Getting rammed while boxed in fills the bust meter — survive as long as you can.'
};

function loadBest(){
  try { return JSON.parse(localStorage.getItem('redline_best')) || {}; } catch(e){ return {}; }
}
function saveBest(obj){
  try { localStorage.setItem('redline_best', JSON.stringify(obj)); } catch(e){}
}
function refreshBestDisplay(){
  var b = loadBest();
  var parts=[];
  if (b.circuit) parts.push('Best Circuit: '+fmtTime(b.circuit));
  if (b.copchase) parts.push('Best Chase: '+fmtTime(b.copchase));
  bestDisplay.textContent = parts.join('   ·   ');
}
function fmtTime(s){
  var m=Math.floor(s/60), sec=(s%60).toFixed(1);
  return (m>0?m+':':'')+(m>0&&sec<10?'0':'')+sec;
}
refreshBestDisplay();

['freeroam','circuit','copchase'].forEach(function(m){
  document.getElementById('btn-'+m).addEventListener('mouseenter', function(){ modeDesc.textContent = MODE_DESCS[m]; });
});
document.getElementById('btn-freeroam').addEventListener('click', function(){ startGame('freeroam'); });
document.getElementById('btn-circuit').addEventListener('click', function(){ startGame('circuit'); });
document.getElementById('btn-copchase').addEventListener('click', function(){ startGame('copchase'); });
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit').addEventListener('click', goHome);
document.getElementById('btn-results-menu').addEventListener('click', goHome);
document.getElementById('btn-busted-menu').addEventListener('click', goHome);
pauseBtnHud.addEventListener('click', function(){ if (gameState==='playing') pauseGame(); });
pauseBtnHud.style.display = hasTouchScreen ? 'none' : 'block';

function startGame(m){
  mode = m;
  resetWorldEntities();
  player = new Car({ x:startPos.x, z:startPos.z, heading:Math.PI, color:0xff2233, isPlayer:true });
  spawnTraffic(mode==='freeroam'?7:4);
  raceTime = 0; bustMeter = 0;
  if (mode==='circuit'){ spawnRacers(3); player.lap=0; player.nextCP=0; raceLaps=3; }
  if (mode==='copchase'){ spawnCops(3); copTimer=0; }
  gameState='playing';
  homeScreen.style.display='none'; hud.style.display='block';
  document.getElementById('lap-panel').style.display = mode==='circuit'?'block':'none';
  document.getElementById('pos-panel').style.display = mode==='circuit'?'block':'none';
  document.getElementById('timer-panel').style.display = (mode==='circuit'||mode==='copchase')?'block':'none';
  document.getElementById('cam-hint').textContent = mode==='circuit' ? 'follow the compass to the next checkpoint' : (mode==='copchase' ? 'lose the cops — avoid getting boxed in' : '');
  pauseBtnHud.style.display = hasTouchScreen ? 'none' : 'block';
}
function pauseGame(){ if (gameState!=='playing') return; gameState='paused'; pauseScreen.style.display='flex'; }
function resumeGame(){ if (gameState!=='paused') return; gameState='playing'; pauseScreen.style.display='none'; }
function goHome(){
  gameState='menu';
  homeScreen.style.display='flex'; hud.style.display='none'; pauseScreen.style.display='none';
  resultsScreen.style.display='none'; bustedScreen.style.display='none'; pauseBtnHud.style.display='none';
  refreshBestDisplay();
}
function doFinishRace(place){
  gameState='results';
  hud.style.display='none';
  document.getElementById('results-title').textContent = place===1 ? 'YOU WIN' : place+(place===2?'nd':place===3?'rd':'th')+' PLACE';
  document.getElementById('results-stats').innerHTML =
    '<div class="stat-row">TIME <span>'+fmtTime(raceTime)+'</span></div>' +
    '<div class="stat-row">FINISH <span>'+place+' / 4</span></div>';
  var best = loadBest();
  if (place===1 && (!best.circuit || raceTime<best.circuit)){ best.circuit=raceTime; saveBest(best); }
  resultsScreen.style.display='flex';
}
function doBusted(){
  gameState='busted';
  hud.style.display='none';
  bustedFlash.style.transition='none'; bustedFlash.style.opacity='0.8';
  setTimeout(function(){ bustedFlash.style.transition='opacity .6s'; bustedFlash.style.opacity='0'; }, 30);
  document.getElementById('busted-stats').innerHTML =
    '<div class="stat-row">SURVIVED <span>'+fmtTime(raceTime)+'</span></div>';
  var best = loadBest();
  if (!best.copchase || raceTime>best.copchase){ best.copchase=raceTime; saveBest(best); }
  bustedScreen.style.display='flex';
}

// ══════════════════════════════════════════════════════════════════════════
//  HUD RENDER
// ══════════════════════════════════════════════════════════════════════════
var speedoCtx = document.getElementById('speedo-canvas').getContext('2d');
var compassCtx = document.getElementById('compass-canvas').getContext('2d');
var minimapCtx = document.getElementById('minimap-canvas').getContext('2d');

function drawSpeedo(mph){
  var c=speedoCtx, W=150,H=150,cx=75,cy=75,r=62;
  c.clearRect(0,0,W,H);
  c.lineWidth=8; c.strokeStyle='rgba(255,255,255,0.12)';
  c.beginPath(); c.arc(cx,cy,r,Math.PI*0.7,Math.PI*2.3); c.stroke();
  var pct = Math.min(1, mph/160);
  c.strokeStyle = pct>0.85?'#ff3355':'#00e5ff';
  c.beginPath(); c.arc(cx,cy,r,Math.PI*0.7,Math.PI*0.7+pct*Math.PI*1.6); c.stroke();
  document.getElementById('speed-val').textContent = Math.round(mph);
}
function drawCompass(targetAngleRel){
  var c=compassCtx, W=90,H=90,cx=45,cy=45;
  c.clearRect(0,0,W,H);
  c.strokeStyle='rgba(0,229,255,0.4)'; c.lineWidth=1.5;
  c.beginPath(); c.arc(cx,cy,38,0,Math.PI*2); c.stroke();
  if (targetAngleRel===null) return;
  c.save(); c.translate(cx,cy); c.rotate(targetAngleRel);
  c.fillStyle='#ffcc00';
  c.beginPath(); c.moveTo(0,-30); c.lineTo(-8,-14); c.lineTo(8,-14); c.closePath(); c.fill();
  c.restore();
}
function drawMinimap(){
  var c=minimapCtx, W=130,H=130, scale=W/(WORLD_R*2.1);
  c.clearRect(0,0,W,H);
  c.save(); c.translate(W/2,H/2);
  c.fillStyle='rgba(255,255,255,0.55)';
  [player].concat(mode==='circuit'?racers:[]).concat(mode==='copchase'?cops:[]).forEach(function(e,i){
    if (!e) return;
    c.fillStyle = e===player ? '#ff3355' : (e.isCop ? '#3388ff' : '#ffcc33');
    c.beginPath(); c.arc(e.x*scale, e.z*scale, e===player?3.5:2.5, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════════════════════════════════════
var clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  var dt = Math.min(0.05, clock.getDelta());

  if (gameState==='playing'){
    raceTime += dt;
    var input = readInput();
    player.nitroFuel = player.nitroFuel==null?100:player.nitroFuel;
    if (input.nitro && player.nitroFuel>0) player.nitroFuel = Math.max(0,player.nitroFuel-40*dt);
    else player.nitroFuel = Math.min(100, player.nitroFuel+12*dt);
    player.updatePhysics(dt, input);
    collideCarWithWorld(player, dt);
    traffic.forEach(function(t){ collideCarCar(player,t); });
    emitSmoke(player);

    updateTraffic(dt);
    if (mode==='circuit'){
      updateRacers(dt);
      racers.forEach(function(r){ traffic.forEach(function(t){ collideCarCar(r,t); }); });
      var cp = checkpoints[player.nextCP];
      var d = Math.hypot(cp.x-player.x, cp.z-player.z);
      if (d<14){
        player.nextCP=(player.nextCP+1)%checkpoints.length;
        if (player.nextCP===0){
          player.lap++;
          if (player.lap>=raceLaps){
            var ahead = racers.filter(function(r){ return r.lap>player.lap || (r.lap===player.lap&&r.nextCP>0); }).length;
            doFinishRace(ahead+1);
          }
        }
      }
      document.getElementById('lap-val').textContent = Math.min(player.lap+1,raceLaps)+'/'+raceLaps;
      var place = 1 + racers.filter(function(r){ return (r.lap*checkpoints.length+r.nextCP) > (player.lap*checkpoints.length+player.nextCP); }).length;
      document.getElementById('pos-val').textContent = place+(place===1?'st':place===2?'nd':place===3?'rd':'th');
      document.getElementById('timer-val').textContent = fmtTime(raceTime);
      var tang = Math.atan2(cp.x-player.x, cp.z-player.z) - player.heading;
      drawCompass(tang);
    } else if (mode==='copchase'){
      updateCops(dt);
      document.getElementById('timer-val').textContent = fmtTime(raceTime);
      var nearest=null, nd=1e9;
      cops.forEach(function(c){ var d=Math.hypot(c.x-player.x,c.z-player.z); if (d<nd){nd=d;nearest=c;} });
      if (nearest) drawCompass(Math.atan2(nearest.x-player.x, nearest.z-player.z) - player.heading);
    } else {
      drawCompass(null);
    }

    updateParticles(dt);
    drawMinimap();
    drawSpeedo(Math.abs(player.speed)*2.1);
    document.getElementById('gear-ind').textContent = player.speed<-0.2?'R':(player.speed>0.2?'D':'N');
    document.getElementById('nitro-bar-fill').style.width = (player.nitroFuel)+'%';
    document.getElementById('damage-bar-fill').style.width = player.damage+'%';
    document.getElementById('wrecked-label').style.display = player.wrecked?'block':'none';

    // camera
    var fwd = player.forwardVec();
    var camDist = camMode==='chase'?9:16, camH = camMode==='chase'?3.6:6.5;
    var desired = new THREE.Vector3(player.x - fwd.x*camDist, camH, player.z - fwd.z*camDist);
    camera.position.lerp(desired, Math.min(1, 6*dt));
    var lookAt = new THREE.Vector3(player.x + fwd.x*6, 1.2, player.z + fwd.z*6);
    if (shakeAmt>0.001){
      camera.position.x += (Math.random()-0.5)*shakeAmt;
      camera.position.y += (Math.random()-0.5)*shakeAmt;
      camera.position.z += (Math.random()-0.5)*shakeAmt;
      shakeAmt *= Math.max(0, 1-6*dt);
    }
    camera.lookAt(lookAt);
  }

  if (composer) composer.render(); else renderer.render(scene,camera);
}
camera.position.set(startPos.x, 8, startPos.z+14);
camera.lookAt(startPos.x,0,startPos.z);
if (window.__RL_DEBUG) window.__RL_SCENE = { scene:scene, camera:camera, renderer:renderer, player:function(){return player;} };
animate();

})();

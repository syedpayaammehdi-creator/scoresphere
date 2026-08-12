'use strict';
const http   = require('http');
const {createHash} = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT     = process.env.PORT || 8080;
const WS_GUID  = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ROOT     = __dirname;
const MIME     = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
                  '.json':'application/json','.ttf':'font/ttf','.wav':'audio/wav','.mp3':'audio/mpeg',
                  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};

// ── WebSocket protocol ────────────────────────────────────────
function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  return true;
}

function wsDecode(buf) {
  const msgs = []; let off = 0;
  while (off + 2 <= buf.length) {
    const op = buf[off] & 0x0f, masked = (buf[off+1]>>7)&1;
    let plen = buf[off+1] & 0x7f, ho = off + 2;
    if (plen === 126) { if (ho+2 > buf.length) break; plen = buf.readUInt16BE(ho); ho+=2; }
    else if (plen === 127) { if (ho+8 > buf.length) break; plen = Number(buf.readBigUInt64BE(ho)); ho+=8; }
    const mk = ho; if (masked) ho+=4;
    if (ho+plen > buf.length) break;
    if (op === 8) { msgs.push(null); off=ho+plen; break; }
    if (op === 1 || op === 2) {
      const pay = Buffer.alloc(plen);
      for (let i=0;i<plen;i++) pay[i] = masked ? buf[ho+i]^buf[mk+(i&3)] : buf[ho+i];
      msgs.push(pay.toString('utf8'));
    }
    off = ho+plen;
  }
  return { msgs, rem: buf.slice(off) };
}

function wsEncode(obj) {
  const pay = Buffer.from(typeof obj==='string'?obj:JSON.stringify(obj));
  const L=pay.length;
  let hdr;
  if (L<126)       hdr=Buffer.from([0x81,L]);
  else if(L<65536) { hdr=Buffer.alloc(4);hdr[0]=0x81;hdr[1]=126;hdr.writeUInt16BE(L,2); }
  else             { hdr=Buffer.alloc(10);hdr[0]=0x81;hdr[1]=127;hdr.writeBigUInt64BE(BigInt(L),2); }
  return Buffer.concat([hdr,pay]);
}

function send(socket, msg) {
  if (!socket||socket.destroyed) return;
  try { socket.write(wsEncode(msg)); } catch(e){}
}

function broadcast(room, msg, except) {
  const frame = wsEncode(msg);
  for (const p of room.players)
    if (p.socket && !p.socket.destroyed && p.socket!==except)
      try { p.socket.write(frame); } catch(e){}
}

// ── Accounts (portal-wide login, persisted to disk) ─────────────
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveAccounts() {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts)); } catch(e){}
}
const accounts = loadAccounts(); // key: lowercase username -> {user, hash}

function hashPass(s) {
  // FNV-1a — matches the hashing convention already used client-side in stellar-assault
  let h = 0x811c9dc5;
  for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h>>>0).toString(16);
}

// ── Chat / forum ──────────────────────────────────────────────
const chatSockets = new Set();
const chatHistory = [];
const CHAT_HISTORY_MAX = 50;

const BAD_WORDS = [
  'fuck','shit','bitch','asshole','bastard','cunt','dick','piss','pussy',
  'slut','whore','nigger','nigga','faggot','fag','retard','cock','twat',
  'wanker','douche','damn','crap'
];
const BAD_WORD_RE = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\b', 'gi');
function filterProfanity(text) {
  return text.replace(BAD_WORD_RE, m => m[0] + '*'.repeat(Math.max(1, m.length-1)));
}

function broadcastChat(msg) {
  const frame = wsEncode(msg);
  for (const s of chatSockets)
    if (!s.destroyed) try { s.write(frame); } catch(e){}
}

// ── Rooms ─────────────────────────────────────────────────────
const rooms = new Map();
let rid = 1;
const BOT_NAMES = ['NOVA','KIRA','AXEL','SORA','ZINC','BYTE','VEGA','ECHO','HAWK','LYNX'];
let bni = 0;

function mkRoom(game) {
  const maxP = game==='blitz'?4:game==='neon'?6:10;
  const r = {id:'r'+(rid++), game, maxP, players:[], state:'lobby', fillTimer:null};
  rooms.set(r.id, r);
  return r;
}

function findLobby(game) {
  for (const r of rooms.values())
    if (r.game===game && r.state==='lobby' && r.players.length < r.maxP) return r;
  return null;
}

// ── Blitz bot ─────────────────────────────────────────────────
function startBlitzBot(room, p) {
  let lines=0, lvl=1, lockN=0;
  const board=Array.from({length:22},()=>new Array(10).fill(0));

  function tick() {
    if (room.state!=='playing'||p.ko) return;
    // Simulate a couple of cells placed
    for (let k=0;k<2;k++) {
      const r=14+Math.floor(Math.random()*7), c=Math.floor(Math.random()*9);
      board[r][c]=1; board[r][Math.min(c+1,9)]=1;
    }
    lockN++;
    const clearEvery = Math.max(3, 6-Math.floor(lvl/3));
    let cleared = (lockN%clearEvery===0) ? 1+(Math.random()>.6?1+(Math.random()>.7?1:0):0) : 0;
    cleared = Math.min(cleared,4);
    if (cleared>0) {
      lines+=cleared;
      lvl = lines<50?1+Math.floor(lines/10):lines<85?6+Math.floor((lines-50)/7):11+Math.floor((lines-85)/5);
      for(let i=0;i<cleared;i++){board.splice(21,1);board.unshift(new Array(10).fill(0));}
      // Compact snap (only filled/empty)
      const snap=board.map(row=>row.map(c=>c?1:0));
      broadcast(room, {type:'board',slot:p.slot,snap});
      // Attack
      const garbage = cleared===4?4:cleared===3?2:cleared===2?1:0;
      if (garbage>0) {
        const targets=room.players.filter(q=>q.slot!==p.slot&&!q.ko);
        if (targets.length) {
          const tgt=targets[Math.floor(Math.random()*targets.length)];
          const holes=[Math.floor(Math.random()*9)];
          if (tgt.socket) send(tgt.socket,{type:'garbage',fromSlot:p.slot,rows:garbage,holes});
          broadcast(room,{type:'attack',fromSlot:p.slot,toSlot:tgt.slot,rows:garbage});
        }
      }
    }
    const interval=Math.max(180,1100-lvl*75+(Math.random()-.5)*400);
    p.timer=setTimeout(tick,interval);
  }
  p.timer=setTimeout(tick,2000+Math.random()*3000);
}

// ── Stellar bot ───────────────────────────────────────────────
function startStellarBot(room, p) {
  let kills=0;
  function tick() {
    if (room.state!=='playing') return;
    kills+=Math.floor(Math.random()*2);
    broadcast(room,{type:'ally_kills',slot:p.slot,kills,hp:70+Math.floor(Math.random()*30)});
    p.timer=setTimeout(tick,4000+Math.random()*7000);
  }
  p.timer=setTimeout(tick,2000+Math.random()*5000);
}

// ── Neon Grid bot (Tron-style light-cycle) ──────────────────────
function startNeonBot(room, p) {
  const ARENA=60; // matches client GRID size convention
  let x=Math.floor(Math.random()*ARENA), y=Math.floor(Math.random()*ARENA);
  let dir=Math.floor(Math.random()*4); // 0up 1right 2down 3left
  let alive=true, ticks=0;
  const maxTicks = 260 + Math.floor(Math.random()*400); // bot "survives" a while then dies
  function tick() {
    if (room.state!=='playing'||!alive||p.ko) return;
    ticks++;
    if (Math.random()<0.18) dir=(dir+(Math.random()<0.5?1:3))%4; // occasional turn
    if (x<=1||x>=ARENA-1||y<=1||y>=ARENA-1) dir=(dir+2)%4; // steer off walls
    if (dir===0) y--; else if (dir===1) x++; else if (dir===2) y++; else x--;
    broadcast(room,{type:'pos',slot:p.slot,x,y});
    if (ticks>=maxTicks) { alive=false; eliminate(room,p); return; }
    p.timer=setTimeout(tick,90+Math.random()*30);
  }
  p.timer=setTimeout(tick,600+Math.random()*1200);
}

function eliminate(room, p) {
  if (p.ko) return;
  p.ko=true;
  broadcast(room,{type:'ko',slot:p.slot});
  const alive=room.players.filter(q=>!q.ko);
  if (alive.length<=1) {
    broadcast(room,{type:'winner',slot:alive[0]?alive[0].slot:-1});
    room.state='ended';
    room.players.forEach(q=>{if(q.timer){clearTimeout(q.timer);q.timer=null;}});
  }
}

// ── Room lifecycle ────────────────────────────────────────────
function fillBots(room) {
  while (room.players.length < room.maxP) {
    const slot=room.players.length;
    const p={slot,name:BOT_NAMES[bni++%BOT_NAMES.length],socket:null,isBot:true,ko:false,timer:null};
    room.players.push(p);
  }
}

function tryStart(room) {
  if (room.state!=='lobby'||room.players.length===0) return;
  if (room.fillTimer){clearTimeout(room.fillTimer);room.fillTimer=null;}
  fillBots(room);
  room.state='playing';
  const list=room.players.map(p=>({slot:p.slot,name:p.name,isBot:p.isBot}));
  for (const p of room.players)
    if (p.socket) send(p.socket,{type:'start',yourSlot:p.slot,players:list});
  for (const p of room.players)
    if (p.isBot) (room.game==='blitz'?startBlitzBot:room.game==='neon'?startNeonBot:startStellarBot)(room,p);
}

function joinRoom(socket, game, name) {
  let room = findLobby(game);
  if (!room) room=mkRoom(game);
  const slot=room.players.length;
  const p={slot,name,socket,isBot:false,ko:false,timer:null};
  socket._room=room; socket._player=p;
  room.players.push(p);
  broadcast(room,{type:'joined',slot,name},socket);
  send(socket,{type:'lobby',roomId:room.id,yourSlot:slot,players:room.players.map(q=>({slot:q.slot,name:q.name,isBot:q.isBot}))});
  // Start immediately if full, else wait 20s
  if (room.players.filter(q=>!q.isBot).length>=room.maxP) tryStart(room);
  else if (!room.fillTimer) room.fillTimer=setTimeout(()=>tryStart(room),20000);
}

// ── Message handler ───────────────────────────────────────────
function handle(socket, raw) {
  let msg; try{msg=JSON.parse(raw);}catch(e){return;}
  const room=socket._room, player=socket._player;
  switch(msg.type) {
    case 'join':
      if (!room) joinRoom(socket,msg.game||'blitz',msg.name||'PILOT');
      break;
    case 'board':
      if (room) broadcast(room,{type:'board',slot:player.slot,snap:msg.snap},socket);
      break;
    case 'lines':
      if (room&&msg.rows>0&&msg.toSlot!=null) {
        const tgt=room.players[msg.toSlot];
        const holes=msg.holes||[Math.floor(Math.random()*9)];
        if (tgt&&tgt.socket&&!tgt.ko) send(tgt.socket,{type:'garbage',fromSlot:player.slot,rows:msg.rows,holes});
        broadcast(room,{type:'attack',fromSlot:player.slot,toSlot:msg.toSlot,rows:msg.rows});
      }
      break;
    case 'ko':
      if (room&&player) eliminate(room,player);
      break;
    case 'pos':
      if (room&&player) broadcast(room,{type:'pos',slot:player.slot,x:msg.x,y:msg.y},socket);
      break;
    case 'ally_kills':
      if (room) broadcast(room,{type:'ally_kills',slot:player.slot,kills:msg.kills,hp:msg.hp},socket);
      break;

    case 'signup': {
      const uname = String(msg.user||'').trim();
      const key = uname.toLowerCase();
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(uname)) { send(socket,{type:'auth_err',msg:'Username must be 3-16 letters/numbers/underscore'}); break; }
      if (!msg.pass || String(msg.pass).length<4) { send(socket,{type:'auth_err',msg:'Password must be at least 4 characters'}); break; }
      if (accounts[key]) { send(socket,{type:'auth_err',msg:'That username is taken'}); break; }
      accounts[key] = { user: uname, hash: hashPass(String(msg.pass)) };
      saveAccounts();
      socket._authUser = uname;
      send(socket,{type:'auth_ok',user:uname});
      break;
    }
    case 'login': {
      const key = String(msg.user||'').trim().toLowerCase();
      const acc = accounts[key];
      if (!acc || acc.hash !== hashPass(String(msg.pass||''))) { send(socket,{type:'auth_err',msg:'Invalid username or password'}); break; }
      socket._authUser = acc.user;
      send(socket,{type:'auth_ok',user:acc.user});
      break;
    }
    case 'login_hash': {
      // Silent re-login for "remembered" sessions: client stores its own FNV hash
      // locally (never the plaintext password) and replays it here.
      const key = String(msg.user||'').trim().toLowerCase();
      const acc = accounts[key];
      if (!acc || acc.hash !== String(msg.hash||'')) { send(socket,{type:'auth_err',msg:'Session expired, please sign in again'}); break; }
      socket._authUser = acc.user;
      send(socket,{type:'auth_ok',user:acc.user});
      break;
    }

    case 'chat_join': {
      const name = socket._authUser || String(msg.name||'Guest').trim().slice(0,16) || 'Guest';
      socket._chatName = name;
      chatSockets.add(socket);
      send(socket,{type:'chat_history',messages:chatHistory});
      broadcastChat({type:'chat_presence',count:chatSockets.size});
      break;
    }
    case 'chat_msg': {
      if (!socket._chatName) break;
      let text = String(msg.text||'').slice(0,300).trim();
      if (!text) break;
      text = filterProfanity(text);
      const entry = {user:socket._chatName, text, ts:Date.now()};
      chatHistory.push(entry);
      if (chatHistory.length>CHAT_HISTORY_MAX) chatHistory.shift();
      broadcastChat({type:'chat_msg', user:entry.user, text:entry.text, ts:entry.ts});
      break;
    }
    case 'chat_leave':
      chatSockets.delete(socket);
      broadcastChat({type:'chat_presence',count:chatSockets.size});
      break;

    case 'ping': send(socket,{type:'pong'}); break;
  }
}

// ── Disconnect ────────────────────────────────────────────────
function onClose(socket) {
  if (chatSockets.has(socket)) {
    chatSockets.delete(socket);
    broadcastChat({type:'chat_presence',count:chatSockets.size});
  }
  const room=socket._room, player=socket._player;
  if (!room||!player) return;
  player.socket=null; player.ko=true;
  broadcast(room,{type:'left',slot:player.slot});
  const anyLive=room.players.some(p=>p.socket||p.isBot);
  if (!anyLive) {
    room.players.forEach(p=>{if(p.timer){clearTimeout(p.timer);p.timer=null;}});
    if(room.fillTimer)clearTimeout(room.fillTimer);
    rooms.delete(room.id);
  }
}

// ── HTTP + WS server ──────────────────────────────────────────
const server = http.createServer((req,res)=>{
  let url=req.url.split('?')[0]; if(url==='/')url='/index.html';
  const full=path.resolve(ROOT,'.'+url);
  if(!full.startsWith(ROOT)||path.basename(full)==='accounts.json'){res.writeHead(403);res.end();return;}
  fs.readFile(full,(err,data)=>{
    if(err){res.writeHead(404);res.end('404');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'text/plain','Access-Control-Allow-Origin':'*'});
    res.end(data);
  });
});

server.on('upgrade',(req,socket)=>{
  if(!wsHandshake(req,socket))return;
  socket._wsBuffer=Buffer.alloc(0);
  socket._room=null; socket._player=null;
  socket.on('data',chunk=>{
    socket._wsBuffer=Buffer.concat([socket._wsBuffer,chunk]);
    const {msgs,rem}=wsDecode(socket._wsBuffer);
    socket._wsBuffer=rem;
    for(const m of msgs){if(m===null){socket.destroy();return;}handle(socket,m);}
  });
  socket.on('close',()=>onClose(socket));
  socket.on('error',()=>{try{socket.destroy();}catch(e){}});
});

server.listen(PORT,()=>console.log('ScoreSphere WS server → http://localhost:'+PORT));

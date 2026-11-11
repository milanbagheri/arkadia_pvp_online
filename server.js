// Arcadia PvP — authoritative, turn-based room server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingTimeout: 20000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const COUNTRIES = [
  {id:'avalon',name:'Avalon',emoji:'🏰'}, {id:'solaria',name:'Solaria',emoji:'☀️'},
  {id:'frostholm',name:'Frostholm',emoji:'❄️'}, {id:'verdantia',name:'Verdantia',emoji:'🌿'},
  {id:'emberfall',name:'Emberfall',emoji:'🔥'}, {id:'tidewatch',name:'Tidewatch',emoji:'🌊'},
  {id:'moonreach',name:'Moonreach',emoji:'🌙'}, {id:'stormhold',name:'Stormhold',emoji:'⚡'}
];
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res) => res.json({ok:true, rooms:rooms.size}));
function code(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function cleanName(v){ return String(v||'Player').trim().replace(/[<>]/g,'').slice(0,20)||'Player'; }
function emitRoom(room){ io.to(room.code).emit('state', {
  code:room.code, hostId:room.hostId, phase:room.phase, turn:room.turn, turnIndex:room.turnIndex,
  players:[...room.players.values()].map(p=>({id:p.id,name:p.name,country:p.country,online:p.online,ready:p.ready,score:p.score})),
  countries:COUNTRIES, territories:room.territories, log:room.log.slice(-30), settings:room.settings
 }); }
function log(room,text){room.log.push({text,at:Date.now()}); if(room.log.length>60) room.log.shift();}
function error(socket,message){socket.emit('notice',{type:'error',message});}
function active(room){return [...room.players.values()].filter(p=>p.online);}
function createRoom(socket,data){
  const player={id:socket.id,name:cleanName(data.name),country:null,online:true,ready:false,score:0};
  let c; do{c=code()}while(rooms.has(c));
  const room={code:c,hostId:socket.id,phase:'lobby',turn:1,turnIndex:0,players:new Map([[socket.id,player]]),
    territories:{},log:[],settings:{mode:data.mode==='coop'?'coop':'pvp',maxPlayers:8}};
  rooms.set(c,room); socket.join(c); log(room,`${player.name} created the room.`); emitRoom(room);
  socket.emit('joined',{code:c,id:socket.id});
}
function joinRoom(socket,data){
 const c=String(data.code||'').trim().toUpperCase(), room=rooms.get(c);
 if(!room) return error(socket,'Room not found. Check the code and try again.');
 if(room.phase!=='lobby') return error(socket,'This game has already started.');
 if(room.players.size>=room.settings.maxPlayers) return error(socket,'This room is full.');
 const p={id:socket.id,name:cleanName(data.name),country:null,online:true,ready:false,score:0};
 room.players.set(socket.id,p);socket.join(c);log(room,`${p.name} joined the room.`);socket.emit('joined',{code:c,id:socket.id});emitRoom(room);
}
function current(room){const ps=active(room); if(!ps.length)return null; room.turnIndex=((room.turnIndex%ps.length)+ps.length)%ps.length; return ps[room.turnIndex];}
function requireRoom(socket){const room=rooms.get(socket.data.room); if(!room){error(socket,'Join a room first.');return null;} return room;}
function act(socket,payload={}){
 const room=requireRoom(socket);if(!room)return;
 if(room.phase!=='playing')return error(socket,'The game has not started.');
 const player=current(room);if(!player||player.id!==socket.id)return error(socket,'Wait for your turn.');
 const type=String(payload.type||''), target=String(payload.target||''), terr=room.territories[target];
 const owned=Object.values(room.territories).filter(t=>t.owner===socket.id).length;
 if(type==='endTurn'){log(room,`${player.name} ended their turn.`); room.turnIndex=(room.turnIndex+1)%active(room).length;if(room.turnIndex===0)room.turn++;emitRoom(room);return;}
 if(type==='gather'){
   const amount=2;player.score+=amount;log(room,`${player.name} gathered ${amount} ✦.`);emitRoom(room);return;
 }
 if(type==='build'){
   if(!terr||terr.owner!==socket.id)return error(socket,'Choose one of your own territories to build on.');
   if(player.score<3)return error(socket,'Building costs 3 ✦. Gather first.');
   if(terr.level>=5)return error(socket,'This territory is already at maximum level.');
   player.score-=3;terr.level++;log(room,`${player.name} upgraded ${terr.name} to level ${terr.level}.`);emitRoom(room);return;
 }
 if(type==='claim'){
   if(terr)return error(socket,'That country is already claimed.');
   if(owned===0)return error(socket,'Choose a country in the lobby first.');
   if(player.score<2)return error(socket,'Claiming costs 2 ✦. Gather first.');
   player.score-=2;room.territories[target]={owner:socket.id,name:COUNTRIES.find(x=>x.id===target)?.name||target,level:1};
   log(room,`${player.name} claimed ${room.territories[target].name}.`);emitRoom(room);return;
 }
 if(type==='attack'){
   if(!terr||terr.owner===socket.id)return error(socket,'Choose an opponent territory to attack.');
   if(player.score<4)return error(socket,'An attack costs 4 ✦. Gather first.');
   player.score-=4;
   // Deterministic, transparent turn-based combat: attacker needs stronger force than target level.
   const power=owned+Math.floor(player.score/5)+1;
   if(power>=terr.level+2){const old=room.players.get(terr.owner);if(old)old.score=Math.max(0,old.score-1);terr.owner=socket.id;terr.level=1;log(room,`${player.name} conquered ${terr.name}!`);}
   else {terr.level=Math.max(1,terr.level-1);log(room,`${player.name} attacked ${terr.name}; its defenses weakened.`);}
   emitRoom(room);return;
 }
 error(socket,'Unknown action.');
}
io.on('connection',socket=>{
 socket.on('createRoom',data=>createRoom(socket,data||{}));
 socket.on('joinRoom',data=>joinRoom(socket,data||{}));
 socket.on('selectCountry',data=>{
  const room=requireRoom(socket);if(!room||room.phase!=='lobby')return;
  const p=room.players.get(socket.id),id=String((data||{}).country||'');
  if(!COUNTRIES.some(c=>c.id===id))return error(socket,'Unknown country.');
  if([...room.players.values()].some(x=>x.country===id&&x.id!==socket.id))return error(socket,'That country is already taken.');
  p.country=id;p.ready=true;log(room,`${p.name} selected ${COUNTRIES.find(c=>c.id===id).name}.`);emitRoom(room);
 });
 socket.on('startGame',()=>{
  const room=requireRoom(socket);if(!room)return;
  if(socket.id!==room.hostId)return error(socket,'Only the room host can start the game.');
  const ps=active(room);if(ps.length<2)return error(socket,'At least two players are required.');
  if(ps.some(p=>!p.country))return error(socket,'Every player must select a country first.');
  room.phase='playing';room.turn=1;room.turnIndex=0;
  for(const p of ps){const c=COUNTRIES.find(x=>x.id===p.country);room.territories[p.country]={owner:p.id,name:c.name,level:1};p.score=3;}
  log(room,`Game started — ${room.settings.mode==='coop'?'co-op':'PvP'} mode.`);emitRoom(room);
 });
 socket.on('action',payload=>act(socket,payload));
 socket.on('chat',data=>{const room=requireRoom(socket);if(!room)return;const p=room.players.get(socket.id);const text=String((data||{}).text||'').trim().slice(0,240);if(text){log(room,`${p.name}: ${text}`);emitRoom(room);}});
 socket.on('disconnect',()=>{
  const room=rooms.get(socket.data.room);if(!room)return;
  const p=room.players.get(socket.id);if(p){p.online=false;log(room,`${p.name} disconnected.`);}
  const online=active(room);
  if(!online.length){rooms.delete(room.code);return;}
  if(room.hostId===socket.id)room.hostId=online[0].id;
  emitRoom(room);
 });
 // Save room membership on socket when joined.
 const join=socket.join.bind(socket);socket.join=(name)=>{socket.data.room=name;return join(name);};
});
server.listen(PORT,()=>console.log(`Arcadia PvP listening on ${PORT}`));

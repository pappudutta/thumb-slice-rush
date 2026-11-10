(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: true });
  const scoreNode = document.getElementById('score');
  const bestNode = document.getElementById('best');
  const toast = document.getElementById('toast');
  const overlay = document.getElementById('overlay');
  const playButton = document.getElementById('playButton');
  const soundButton = document.getElementById('soundButton');
  const tip = document.getElementById('tip');
  const TAU = Math.PI * 2;
  const colors = [
    { main:'#ff665e', light:'#ffb07a', dark:'#a72838', leaf:'#a4ef83' },
    { main:'#ffb62e', light:'#ffe276', dark:'#d05a27', leaf:'#83de81' },
    { main:'#b47bff', light:'#e6b2ff', dark:'#7137bb', leaf:'#a6ee8b' },
    { main:'#49d8a4', light:'#a8ffd2', dark:'#138c79', leaf:'#a9ed7d' },
    { main:'#ffdb57', light:'#fff3a0', dark:'#db8b22', leaf:'#82d66c' },
    { main:'#55a9ff', light:'#a8e8ff', dark:'#3561c1', leaf:'#90e68b' }
  ];
  const state = {
    w: innerWidth, h: innerHeight, dpr: 1, cx: innerWidth / 2, cy: innerHeight * .56,
    score: 0, best: Number(localStorage.getItem('thumb-slice-best') || 0),
    fruits: [], knives: [], lodged: [], particles: [], sparks: [], running: false,
    last: 0, elapsed: 0, spawnIn: .4, pointer: null, sound: false, audio: null,
    portalPulse: 0, shake: 0
  };
  bestNode.textContent = state.best;

  function resize() {
    state.w = innerWidth; state.h = innerHeight;
    state.dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.w * state.dpr);
    canvas.height = Math.round(state.h * state.dpr);
    canvas.style.width = `${state.w}px`; canvas.style.height = `${state.h}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.cx = state.w / 2;
    state.cy = Math.min(state.h * .57, state.h - Math.min(115, state.h * .16));
  }
  addEventListener('resize', resize); resize();
  const rand = (a,b) => a + Math.random() * (b-a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = t => 1 - (1-t) ** 3;

  function sound(freq=420, duration=.07, type='sine', volume=.035) {
    if (!state.sound) return;
    try {
      state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = state.audio.createOscillator(), gain = state.audio.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, state.audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq*.55), state.audio.currentTime+duration);
      gain.gain.setValueAtTime(volume, state.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, state.audio.currentTime+duration);
      osc.connect(gain); gain.connect(state.audio.destination); osc.start(); osc.stop(state.audio.currentTime+duration);
    } catch (_) { /* Audio is optional. */ }
  }

  function addFruit() {
    if (!state.running || state.fruits.length > 10) return;
    const angle = rand(-Math.PI, Math.PI);
    const speed = rand(150, 255);
    const radius = rand(17, 24);
    state.fruits.push({
      x: state.cx, y: state.cy, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      radius, rotation: rand(0, TAU), spin: rand(-3.3,3.3), color: pick(colors),
      age: 0, scale: .2, sliced: false, wobble: rand(0, TAU)
    });
    state.portalPulse = 1;
    state.sparks.push({x:state.cx,y:state.cy,life:.35,max:.35,color:'#d8ff69'});
    sound(180,.12,'triangle',.022);
  }

  function throwKnife(x,y) {
    if (!state.running) return;
    const dx = x - state.cx, dy = y - state.cy;
    const length = Math.hypot(dx,dy);
    const angle = length > 16 ? Math.atan2(dy,dx) : -Math.PI/2;
    state.knives.push({x:state.cx,y:state.cy,px:state.cx,py:state.cy,angle,vx:Math.cos(angle)*850,vy:Math.sin(angle)*850,
      life:1.1,trail:[],hit:false});
    state.portalPulse = Math.max(state.portalPulse,.55);
    sound(620,.045,'triangle',.018);
    if (!state.pointer?.usedTip) { tip.classList.add('fade'); if(state.pointer) state.pointer.usedTip = true; }
  }

  function showPoints(x,y,amount=10) {
    toast.textContent = `+${amount}`;
    toast.style.left = `${x}px`; toast.style.top = `${y}px`;
    toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
  }
  function burst(fruit) {
    for (let i=0;i<16;i++) {
      const a = TAU*i/16 + rand(-.18,.18), speed=rand(45,190);
      state.particles.push({x:fruit.x,y:fruit.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
        life:rand(.35,.7),max:.7,size:rand(2,5),color:pick([fruit.color.light,fruit.color.main,fruit.color.leaf,'#fff5cf'])});
    }
    state.shake = .12; sound(240,.12,'sawtooth',.025);
    state.score += 10; scoreNode.textContent = state.score;
    if(state.score>state.best){state.best=state.score;bestNode.textContent=state.best;localStorage.setItem('thumb-slice-best',String(state.best));}
    showPoints(fruit.x, fruit.y-28);
  }

  // Check the whole knife movement segment, not just its final position, so fast throws register reliably.
  function segmentHitsFruit(x1,y1,x2,y2,fruit) {
    const dx=x2-x1, dy=y2-y1;
    const lengthSq=dx*dx+dy*dy || 1;
    const t=Math.max(0,Math.min(1,((fruit.x-x1)*dx+(fruit.y-y1)*dy)/lengthSq));
    const nearestX=x1+dx*t, nearestY=y1+dy*t;
    return Math.hypot(fruit.x-nearestX,fruit.y-nearestY) < fruit.radius+8;
  }

  function stickKnife(knife, kind, x=knife.x, y=knife.y) {
    // Leave a short-lived embedded knife at the impact point, including fruit hits.
    state.lodged.push({x,y,angle:knife.angle,kind,life:kind==='fruit'?1.25:5, maxLife:kind==='fruit'?1.25:5});
    if(state.lodged.length>36)state.lodged.shift();
  }

  function update(dt) {
    state.elapsed += dt;
    state.portalPulse = Math.max(0,state.portalPulse-dt*2.7);
    state.shake = Math.max(0,state.shake-dt);
    if(state.running){
      state.spawnIn-=dt;
      if(state.spawnIn<=0){addFruit();state.spawnIn=rand(.48,.88);}
    }
    for(const f of state.fruits){
      f.age+=dt; f.scale=Math.min(1,easeOut(Math.min(1,f.age/.18)));
      f.x+=f.vx*dt; f.y+=f.vy*dt;
      f.vx*=Math.exp(-.15*dt); f.vy*=Math.exp(-.15*dt);
      f.rotation+=f.spin*dt;
      if(f.age>.32){f.vy+=210*dt;}
    }
    state.fruits=state.fruits.filter(f=>f.x>-50&&f.x<state.w+50&&f.y>-60&&f.y<state.h+70);

    for(const k of state.knives){
      k.life-=dt;k.px=k.x;k.py=k.y;k.x+=k.vx*dt;k.y+=k.vy*dt;
      k.trail.push({x:k.x,y:k.y});if(k.trail.length>7)k.trail.shift();
      for(const f of state.fruits){
        if(!f.sliced&&segmentHitsFruit(k.px,k.py,k.x,k.y,f)){
          f.sliced=true;burst(f);k.hit=true;
          stickKnife(k,'fruit',f.x,f.y);
          break;
        }
      }
      if(!k.hit&&(k.life<=0||k.x<-20||k.x>state.w+20||k.y<-20||k.y>state.h+20)){
        const x=Math.max(12,Math.min(state.w-12,k.x));
        const y=Math.max(12,Math.min(state.h-12,k.y));
        stickKnife(k,'board',x,y);k.hit=true;
      }
    }
    state.knives=state.knives.filter(k=>!k.hit);
    state.fruits=state.fruits.filter(f=>!f.sliced);
    for(const lodged of state.lodged)lodged.life-=dt;
    state.lodged=state.lodged.filter(k=>k.life>0);

    for(const p of state.particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.exp(-2.2*dt);p.vy=(p.vy+250*dt)*Math.exp(-.25*dt);}
    state.particles=state.particles.filter(p=>p.life>0);
    for(const p of state.sparks)p.life-=dt;
    state.sparks=state.sparks.filter(p=>p.life>0);
  }

  function drawPortal() {
    const pulse=state.portalPulse;
    const breathe=Math.sin(state.elapsed*2.2)*1.5;
    const r=31+breathe+pulse*10;
    const glow=ctx.createRadialGradient(state.cx,state.cy,2,state.cx,state.cy,r*2.8);
    glow.addColorStop(0,'#83f2e033');glow.addColorStop(.4,'#47cecc12');glow.addColorStop(1,'#47cecc00');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(state.cx,state.cy,r*2.8,0,TAU);ctx.fill();
    ctx.save();ctx.translate(state.cx,state.cy);
    ctx.rotate(state.elapsed*.28);
    ctx.strokeStyle='#83f2e044';ctx.lineWidth=1;ctx.setLineDash([2,8]);
    ctx.beginPath();ctx.arc(0,0,r+12,0,TAU);ctx.stroke();ctx.setLineDash([]);
    const ring=ctx.createRadialGradient(-5,-6,2,0,0,r);
    ring.addColorStop(0,'#040c12');ring.addColorStop(.63,'#07131c');ring.addColorStop(.8,'#153540');ring.addColorStop(1,'#83f2e0');
    ctx.fillStyle=ring;ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();
    ctx.strokeStyle='#b9fff3aa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,r-1,0,TAU);ctx.stroke();
    ctx.fillStyle='#d8ff69';ctx.shadowColor='#d8ff69';ctx.shadowBlur=14;
    for(let i=0;i<4;i++){const a=i*TAU/4+state.elapsed*.28;ctx.beginPath();ctx.arc(Math.cos(a)*(r+12),Math.sin(a)*(r+12),2,0,TAU);ctx.fill();}
    ctx.restore();ctx.shadowBlur=0;
  }

  function drawFruit(f) {
    const r=f.radius*f.scale;
    ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rotation);
    ctx.shadowColor=f.color.main+'66';ctx.shadowBlur=16;
    const grad=ctx.createRadialGradient(-r*.34,-r*.42,r*.04,0,0,r*1.12);
    grad.addColorStop(0,f.color.light);grad.addColorStop(.38,f.color.main);grad.addColorStop(1,f.color.dark);
    ctx.fillStyle=grad;ctx.beginPath();ctx.ellipse(0,0,r*.91,r,0,0,TAU);ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle='#ffffff44';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,0,r*.91,r,0,0,TAU);ctx.stroke();
    ctx.strokeStyle='#66462b';ctx.lineWidth=2.3;ctx.beginPath();ctx.moveTo(0,-r*.76);ctx.quadraticCurveTo(2,-r*1.06,5,-r*1.08);ctx.stroke();
    ctx.fillStyle=f.color.leaf;ctx.beginPath();ctx.ellipse(8,-r*.91,5,2.4,-.45,0,TAU);ctx.fill();
    ctx.fillStyle='#ffffff9a';ctx.beginPath();ctx.ellipse(-r*.34,-r*.36,r*.12,r*.07,-.65,0,TAU);ctx.fill();
    ctx.restore();
  }

  function drawKnife(k, lodged=false) {
    ctx.save();
    if(!lodged&&k.trail?.length>1){ctx.beginPath();ctx.moveTo(k.trail[0].x,k.trail[0].y);for(const p of k.trail)ctx.lineTo(p.x,p.y);
      ctx.strokeStyle='#d8ff6966';ctx.lineWidth=3;ctx.lineCap='round';ctx.shadowColor='#d8ff69';ctx.shadowBlur=12;ctx.stroke();ctx.shadowBlur=0;}
    ctx.translate(k.x,k.y);ctx.rotate(k.angle+Math.PI/2);
    // Blade points forward; use a metallic bevel and wrapped handle for a more knife-like silhouette.
    ctx.shadowColor='#d9fbff77';ctx.shadowBlur=lodged?4:9;
    const blade=ctx.createLinearGradient(-5,0,5,0);blade.addColorStop(0,'#71838b');blade.addColorStop(.32,'#d7e5e5');blade.addColorStop(.48,'#ffffff');blade.addColorStop(1,'#718e99');
    ctx.fillStyle=blade;ctx.beginPath();ctx.moveTo(0,-23);ctx.quadraticCurveTo(7,-12,5,1);ctx.lineTo(-5,1);ctx.quadraticCurveTo(-7,-12,0,-23);ctx.fill();
    ctx.strokeStyle='#ffffffaa';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(1,-1);ctx.stroke();
    ctx.shadowBlur=0;ctx.fillStyle='#d8ff69';ctx.fillRect(-8,0,16,3);
    ctx.fillStyle='#d7e4dc';ctx.beginPath();ctx.roundRect(-3,-1,6,16,2);ctx.fill();
    ctx.fillStyle='#71523a';ctx.beginPath();ctx.roundRect(-3,12,6,13,2);ctx.fill();
    ctx.strokeStyle='#d8b484';ctx.lineWidth=1;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-2,14+i*3);ctx.lineTo(2,16+i*3);ctx.stroke();}
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0,0,state.w,state.h);
    ctx.save();if(state.shake>0)ctx.translate(rand(-3,3)*state.shake/.12,rand(-3,3)*state.shake/.12);
    drawPortal();
    for(const f of state.fruits)drawFruit(f);
    for(const p of state.particles){ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=8;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill();}
    ctx.globalAlpha=1;ctx.shadowBlur=0;
    for(const k of state.knives)drawKnife(k);
    for(const k of state.lodged){ctx.globalAlpha=k.kind==='fruit'?Math.min(1,k.life/.25):Math.min(1,k.life/.5);drawKnife(k,true);}
    ctx.globalAlpha=1;
    for(const p of state.sparks){ctx.globalAlpha=p.life/p.max;ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,12+(1-p.life/p.max)*25,0,TAU);ctx.stroke();}
    ctx.globalAlpha=1;ctx.restore();
  }

  function frame(now) {
    const dt=Math.min(.033,(now-state.last)/1000||0);state.last=now;
    update(dt);render();requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function point(e){return{x:e.clientX,y:e.clientY};}
  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();canvas.setPointerCapture?.(e.pointerId);
    const p=point(e);state.pointer={...p,usedTip:false};
  });
  canvas.addEventListener('pointerup',e=>{
    e.preventDefault();if(!state.pointer)return;
    const p=point(e);const dx=p.x-state.pointer.x,dy=p.y-state.pointer.y;
    if(Math.hypot(dx,dy)>20)throwKnife(state.cx+dx*2,state.cy+dy*2);else throwKnife(p.x,p.y);
    state.pointer=null;
  });
  canvas.addEventListener('pointercancel',()=>state.pointer=null);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  playButton.addEventListener('click',()=>{
    overlay.classList.add('hidden');state.running=true;state.spawnIn=.12;
    for(let i=0;i<3;i++)setTimeout(addFruit,i*220);
    sound(520,.1,'sine',.02);
  });
  soundButton.addEventListener('click',()=>{
    state.sound=!state.sound;soundButton.textContent=state.sound?'♫':'♪';
    if(state.sound)sound(520,.08);
  });
})();

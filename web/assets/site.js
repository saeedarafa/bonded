// Landing page behaviour (W1). Moved out of index.html so the CSP needs no unsafe-inline for scripts.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm=1/.test(location.search);
  const clamp = (v,a=0,b=1) => Math.min(b,Math.max(a,v));
  const sm = (a,b,v) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
  const lerp = (a,b,t) => a+(b-a)*t;

  // mascots
  const face = blush => `<g class="body"><use href="#dough"/>
    <g class="calm"><g class="eyes"><circle cx="31" cy="40" r="3" fill="#2A1407"/><circle cx="49" cy="40" r="3" fill="#2A1407"/></g><path d="M36 46 Q40 50 44 46" fill="none" stroke="#2A1407" stroke-width="2.5" stroke-linecap="round"/></g>
    <g class="happy"><path d="M26 40 Q31 35 36 40 M44 40 Q49 35 54 40" fill="none" stroke="#2A1407" stroke-width="2.5" stroke-linecap="round"/><path d="M35 45 Q40 53 45 45 Z" fill="#2A1407"/></g>
    <g class="sleepy"><path d="M26 41 Q31 44 36 41 M44 41 Q49 44 54 41" fill="none" stroke="#2A1407" stroke-width="2.5" stroke-linecap="round"/><path d="M37 47 Q40 49 43 47" fill="none" stroke="#2A1407" stroke-width="2.2" stroke-linecap="round"/></g>
    <circle cx="24" cy="47" r="4.5" fill="${blush}"/><circle cx="56" cy="47" r="4.5" fill="${blush}"/></g>`;
  document.querySelectorAll('[data-m]').forEach(s => { s.innerHTML = face(s.dataset.m==='bao'?'#FF8A4C':'#9CC9FF'); s.setAttribute('aria-hidden','true'); });

  // today's weekday on the note
  try { document.getElementById('today').textContent = new Date().toLocaleDateString('en-US',{weekday:'long'}); } catch(e){}

  // crumpled paper: a triangle mesh that morphs from a ball to a flat sheet
  const W=300,H=380,C=12,R=15;
  let s=11; const rnd=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646};
  const V=[];
  for(let j=0;j<=R;j++)for(let i=0;i<=C;i++){
    const x=i/C*W,y=j/R*H,u=(x-W/2)/(W/2),v=(y-H/2)/(H/2),d=Math.min(1,Math.hypot(u,v)/1.414);
    const a=Math.atan2(v,u)+(rnd()-.5)*1.3+Math.sin(d*9)*.6, r=86*Math.pow(.12+.88*d,.65)*(.86+rnd()*.24);
    V.push({x,y,cx:W/2+Math.cos(a)*r,cy:H/2+Math.sin(a)*r*.94,wx:(rnd()-.5)*30,wy:(rnd()-.5)*30,dl:d*.32});
  }
  const T=[],NS='http://www.w3.org/2000/svg',mesh=document.getElementById('mesh');
  const idx=(i,j)=>j*(C+1)+i;
  for(let j=0;j<R;j++)for(let i=0;i<C;i++){
    const a=idx(i,j),b=idx(i+1,j),c=idx(i,j+1),d=idx(i+1,j+1);
    for(const t of (rnd()<.5?[[a,b,d],[a,d,c]]:[[a,b,c],[b,d,c]])){
      const el=document.createElementNS(NS,'polygon'); el.setAttribute('stroke-linejoin','round'); mesh.appendChild(el);
      T.push({v:t,el,j:rnd(),fa:(W/C)*(H/R)/2});
    }
  }
  const P=[];
  function paper(p){
    for(let k=0;k<V.length;k++){const q=V[k],e=sm(0,1,clamp((p-q.dl)/(1-.32))),w=Math.sin(Math.PI*e);
      P[k]=[lerp(q.cx,q.x,e)+q.wx*w,lerp(q.cy,q.y,e)+q.wy*w];}
    for(const t of T){const [a,b,c]=t.v.map(i=>P[i]);
      const ar=((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2/t.fa;
      const lit=Math.cos(t.j*6.283), k=1-p;
      let L = ar<0 ? 79+t.j*7 : 97.6 - (1-Math.min(1,Math.abs(ar)))*9*k - k*(9-lit*7) - t.j*1.1;
      t.el.setAttribute('points',`${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`);
      t.el.setAttribute('fill',`hsl(34 ${ar<0?45:80}% ${L.toFixed(1)}%)`);
    }
    mesh.setAttribute('stroke',`hsla(34,60%,${(92-20*(1-p)).toFixed(0)}%,${(.04+.5*(1-p)).toFixed(2)})`);
    mesh.setAttribute('stroke-width','.6');
    mesh.setAttribute('transform',`rotate(${((1-p)*-28).toFixed(1)} 150 190)`);
  }

  // scroll scenes
  const tracks={};
  document.querySelectorAll('[data-track]').forEach(t=>tracks[t.dataset.track]=t);
  const prog=t=>{const r=t.getBoundingClientRect(),n=t.offsetHeight-innerHeight;return n>0?clamp(-r.top/n):1};
  const q=(t,sel)=>tracks[t].querySelector(sel);
  const bubbles=t=>tracks[t].querySelectorAll('[data-b]');
  const typedEl=document.getElementById('typed');
  const PAIRS=[
    ["What's a small thing I do that makes your day better?","When you leave the last bite for me.","The way you hum when you cook. Every single time.","You noticed that? 🥹","Every time 😂"],
    ["If we had a theme song, what would it be?","Anything we can't sing on key 🎤","The one from that road trip. You know the one.","Road trip again? 🚗","Windows down 🎶"],
    ["When did you first feel at home with me?","The night the power went out and we just talked.","The first time you fell asleep on my shoulder on the train.","I remember that 🥹","Best nap ever 😴"]];
  let pi=0, ANS=PAIRS[0][1];
  const flap=document.getElementById('flap');
  function setBubbles(t,p){bubbles(t).forEach(b=>{const [a,z]=b.dataset.b.split(',').map(Number);b.classList.toggle('on',p>=a&&p<=z)})}
  function happy(t,on){tracks[t].querySelectorAll('.m').forEach(m=>m.classList.toggle('is-happy',on))}
  function layer(el,o,dy=0){el.style.opacity=o;el.style.transform=`translateY(${dy}px)`;el.style.visibility=o<.02?'hidden':'visible';el.setAttribute('aria-hidden',o<.5)}

  // scrub smoothing (like ScrollTrigger scrub: .5): eased progress chases the scroll position
  const sp={paper:0,notes:0,day:0}; let snap=true;
  const ease=k=>{const t=prog(tracks[k]);if(snap||RM){sp[k]=t;return t}sp[k]+= (t-sp[k])*.16;if(Math.abs(t-sp[k])<.0005)sp[k]=t;return sp[k]};
  const settled=()=>['paper','notes','day'].every(k=>Math.abs(prog(tracks[k])-sp[k])<.0005);
  function frame(){
    let p=RM?1:ease('paper');
    const pp=RM?1:sm(.12,.82,p);
    paper(pp);
    { const cp=q('paper','.copy'); if(!RM){ const hA=q('paper','[data-l=hero]').offsetHeight, hB=q('paper','[data-l=cap]').offsetHeight; cp.style.height=lerp(hA,hB,sm(.2,.42,p)).toFixed(1)+'px'; } else cp.style.height=''; }
    layer(q('paper','[data-l=hero]'),RM?1:1-sm(.04,.22,p),-24*sm(.04,.22,p));
    layer(q('paper','[data-l=cap]'),RM?0:sm(.3,.48,p),12*(1-sm(.3,.48,p)));
    layer(q('paper','[data-l=hint]'),RM?0:1-sm(0,.06,p));
    q('paper','.ink').style.opacity=sm(.78,.95,pp);
    document.getElementById('sheet').classList.toggle('idle',!RM&&p<.03);
    document.getElementById('sheet').style.transform=`scale(${lerp(.82,1,sm(.08,.6,p)).toFixed(3)})`;
    // desktop: anchor mascots, bubbles and hint to the note itself
    { const st=q('paper','.stage'), sh=document.getElementById('sheet'), dl=q('paper','.duo.l'), dr=q('paper','.duo.r'), hint=q('paper','.hint');
      const bl=[...tracks.paper.querySelectorAll('.bubble.bl')], br=[...tracks.paper.querySelectorAll('.bubble.br')];
      [dl,dr,hint,...bl,...br].forEach(e=>{e.dataset.bot??=e.style.bottom});
      if(innerWidth>=960){ const W=st.clientWidth,H=st.clientHeight,pw=sh.offsetWidth,ph=sh.offsetHeight,pl=sh.offsetLeft,pt=sh.offsetTop;
        const fb=Math.max(0,H-(pt+ph))-8; const mw=dl.offsetWidth;
        dl.style.left=(pl-mw*.55)+'px'; dl.style.right='auto'; dl.style.bottom=fb+'px';
        dr.style.left=(pl+pw-mw*.45)+'px'; dr.style.right='auto'; dr.style.bottom=fb+'px';
        bl.forEach(b=>{b.style.left=(pl-mw*.75)+'px';b.style.bottom=(fb+mw*.9)+'px'}); br.forEach(b=>{b.style.right=(W-(pl+pw)-mw*.75)+'px';b.style.bottom=(fb+mw*.9)+'px'});
        hint.style.bottom=Math.max(4,fb-30)+'px'; }
      else { [dl,dr,hint,...bl,...br].forEach(e=>{e.dataset.bot??=e.style.bottom;e.style.left='';e.style.right='';e.style.bottom=e.dataset.bot}); } }
    setBubbles('paper',RM?.9:p); happy('paper',p>.78);

    // phones: the notes take all the stage height left above the button (72px) and the bubbles (122px); pair height = (W - 12) x 0.783
    { const st=q('notes','.stage'), pe=q('notes','.pair');
      if(innerWidth<960){ const w=Math.min(st.clientWidth,420,(st.clientHeight-20-194)*1.276+12); pe.style.setProperty('--pw',Math.max(160,w).toFixed(0)+'px'); }
      else pe.style.removeProperty('--pw'); }
    let n=RM?1:ease('notes');
    const ty=Math.round(ANS.length*sm(.05,.38,n));
    typedEl.textContent=ANS.slice(0,ty);
    typedEl.nextElementSibling.style.display=ty>=ANS.length?'none':'inline-block';
    { const ang=180*(1-sm(.56,.8,n)); flap.style.transform=`rotateX(${ang.toFixed(1)}deg)`;
      // Safari ignores backface-visibility in this 3D setup: show only the face turned to the viewer
      flap.querySelector('.back').style.visibility=ang>90?'visible':'hidden'; flap.querySelector('.face').style.visibility=ang>90?'hidden':'visible'; }
    flap.setAttribute('aria-hidden',n<.7);
    layer(q('notes','[data-l=lockcap]'),1-sm(.46,.56,n));
    layer(q('notes','[data-l=opencap]'),sm(.5,.6,n));
    // reaction pop: one-shot animation when the notes open, never scrubbed (a scrub froze the emojis mid-air when the scroll stopped)
    { const pe=tracks.notes.querySelector('.pair'); if(RM) pe.classList.remove('pop'); else if(n>=.82) pe.classList.add('pop'); else if(n<.78) pe.classList.remove('pop'); }
    setBubbles('notes',n); happy('notes',n>.82);
    { const st=document.getElementById('steps'); const rp=tracks.paper.getBoundingClientRect(), rn=tracks.notes.getBoundingClientRect();
      const show=(p>.22)&&rn.bottom>innerHeight*.6; st.classList.toggle('on',show);
      const cur=rp.bottom>innerHeight*.5?0:(n<.5?1:2);
      st.querySelectorAll('span').forEach((e,i)=>{e.classList.toggle('cur',i===cur);e.classList.toggle('done',i<cur)}); }
    document.getElementById('another').classList.toggle('on',n>.9);

    // one day of little moments
    let d=RM?.56:ease('day');
    const sky=document.getElementById('sky'), W2=sky.clientWidth, H2=sky.clientHeight;
    const dusk=sm(.64,.76,d), noon=sm(.3,.4,d)*(1-dusk);
    const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
    let col=mix([255,227,209],[255,249,241],sm(.3,.4,d)); col=mix(col,[38,28,22],dusk);
    sky.style.background=`rgb(${col})`;
    document.getElementById('clock').textContent = d<.33?'7:52 am':d<.68?'3:15 pm':'10:40 pm';
    const sun=document.getElementById('sun'), moon=document.getElementById('moon');
    sun.style.opacity=(1-dusk).toFixed(2); sun.style.transform=`translate(${lerp(-W2*.3,W2*.3,sm(0,.66,d))}px,${(Math.abs(.33-d)*90).toFixed(0)}px) rotate(${d*180}deg)`;
    moon.style.opacity=dusk.toFixed(2); moon.style.transform=`translateY(${(1-dusk)*30}px)`;
    sky.querySelectorAll('.star').forEach((st,i)=>st.style.opacity=(dusk*(.5+.5*Math.sin(i*2+d*40))).toFixed(2));
    const hug=sm(.38,.48,d)*(1-sm(.6,.68,d));
    document.getElementById('dBao').style.transform=`translateX(${(hug*W2*.16).toFixed(0)}px)`;
    document.getElementById('dBun').style.transform=`translateX(${(-hug*W2*.16).toFixed(0)}px)`;
    const gift=document.getElementById('gift'), fly=(t,ch,from)=>{const x=from?lerp(W2*.18,W2*.72,t):lerp(W2*.72,W2*.18,t);const y=H2-110-Math.sin(Math.PI*t)*90;gift.textContent=ch;gift.style.opacity=(t>0&&t<1)?1:0;gift.style.transform=`translate(${x}px,${y}px) scale(${.8+Math.sin(Math.PI*t)*.4})`};
    const g1=clamp((d-.05)/.13), g2=clamp((d-.74)/.12);
    if(d<.4) fly(g1,'☀️',true); else fly(g2,'🌙',true);
    const ht=sm(.47,.58,d), heart=document.getElementById('heart');
    heart.style.opacity=(Math.sin(Math.PI*ht)).toFixed(2); heart.style.transform=`translate(${W2/2-15}px,${H2-150-ht*50}px) scale(${.6+ht*.6})`;
    layer(q('day','[data-l=dayA]'),RM?0:1-sm(.8,.87,d),-12*sm(.8,.87,d));layer(q('day','[data-l=dayB]'),RM?1:sm(.84,.92,d),10*(1-sm(.84,.92,d)));
    setBubbles('day',d);
    tracks.day.querySelectorAll('.m').forEach(m=>{m.classList.toggle('is-happy',(d>.18&&d<.3)||(d>.48&&d<.64));m.classList.toggle('is-sleepy',d>.9)});
  }
  let raf=0; const req=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;frame();if(!settled())req()})};
  addEventListener('scroll',req,{passive:true}); addEventListener('resize',req);

  // another answer pair
  const pairEl=tracks.notes.querySelector('.pair');
  document.getElementById('another').addEventListener('click',()=>{
    pi=(pi+1)%PAIRS.length; const [qq,a1,a2]=PAIRS[pi];
    const apply=()=>{tracks.notes.querySelectorAll('[data-r]').forEach(e=>e.textContent=PAIRS[pi][+e.dataset.r]);pairEl.querySelectorAll('[data-q]').forEach(e=>e.textContent=qq);ANS=a1;typedEl.textContent=a1;document.getElementById('samAns').textContent=a2;};
    if(RM){apply();return}
    pairEl.classList.add('swap'); flap.style.transition='transform .35s cubic-bezier(.2,.8,.2,1)'; flap.style.transform='rotateX(180deg)';
    setTimeout(()=>{apply();pairEl.classList.remove('swap');flap.style.transform='rotateX(0deg)';setTimeout(()=>flap.style.transition='',400)},450);
  });


  // situations
  const SIT=[
    ['saving-a-seat','Same question, different time zones 🌍',"Something to share every day, even when you can't share a room.","What's something near you right now that you wish you could show me?"],
    ['napping','Kids asleep? Our turn 😴','A few quiet minutes after bedtime that are about the two of you, not the to-do list.',"What's one thing you miss doing, just the two of us?"],
    ['snuggled','Tell me everything 🥰',"Skip the small talk. Learn the things you'd otherwise find out over years.",'What did you think of me the first time we met?'],
    ['together','Still surprising each other 💛',"Think you know all their answers? Every question shows there's more.","What's something about you that's changed since we met?"]];
  document.querySelectorAll('[data-w]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-w]').forEach(x=>x.setAttribute('aria-selected',x===b));
    const [img,say,line,q]=SIT[+b.dataset.w];
    document.getElementById('wImg').src='/assets/mascot/'+img+'.svg';
    const set=(id,t)=>{const e=document.getElementById(id);e.textContent=t;if(!RM){e.classList.remove('fade');void e.offsetWidth;e.classList.add('fade')}};
    set('wSay',say);set('wLine',line);set('wQ',q);
  }));

  // scroll-in animations (once) + streak count-up
  if(RM) document.documentElement.classList.add('rm');
  const aio=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const t=e.target;t.classList.add('in');
    t.querySelectorAll('.cnt').forEach(c=>{const to=+c.dataset.count;if(RM){c.textContent=to;return}let k=0;const tick=()=>{c.textContent=++k;if(k<to)setTimeout(tick,160)};setTimeout(tick,200)});
    aio.unobserve(t)}),{threshold:.35});
  document.querySelectorAll('[data-anim]').forEach(el=>aio.observe(el));

  // playground: tap to kiss, hold to hug, plus morning / night / miss you, with the app's own sounds
  (()=>{const st=document.getElementById('pstage'),say=document.getElementById('pSay'),bao=document.getElementById('pBao'),bun=document.getElementById('pBun');
    const kBtn=document.getElementById('kissBtn'),kN=document.getElementById('kissN'),hBtn=document.getElementById('hugBtn'),heart=document.getElementById('hugHeart'),cta=document.getElementById('pCta'),sndBtn=document.getElementById('sndBtn'),hFi=document.getElementById('hugBtn').querySelector('.fi');
    // sounds: same synthesis as design-handoff/prototypes/little-things.html (D48)
    let AC=null,soundOn=true;
    const ac=()=>{if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC};
    const tone=(t0,f,dur,{type='sine',vol=.18,attack=.01,f2=null,lp=null}={})=>{const c=ac(),o=c.createOscillator(),g=c.createGain();let node=o;o.type=type;o.frequency.setValueAtTime(f,t0);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t0+dur*.8);g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+attack);g.gain.exponentialRampToValueAtTime(.0008,t0+dur);if(lp){const fl=c.createBiquadFilter();fl.type='lowpass';fl.frequency.value=lp;o.connect(fl);node=fl}node.connect(g);g.connect(c.destination);o.start(t0);o.stop(t0+dur+.05)};
    const SOUNDS={
      kiss(){const t=ac().currentTime;tone(t,880,.14,{type:'triangle',vol:.16,f2:520});tone(t+.13,1180,.12,{vol:.12,f2:900})},
      hug(len=1.4){const c=ac(),t=c.currentTime;len=Math.max(.8,Math.min(len,4));const nb=c.createBuffer(1,c.sampleRate*1.2,c.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;const ns=c.createBufferSource(),bp=c.createBiquadFilter(),ng=c.createGain();ns.buffer=nb;bp.type='bandpass';bp.Q.value=1.2;bp.frequency.setValueAtTime(380,t);bp.frequency.exponentialRampToValueAtTime(180,t+.5);ng.gain.setValueAtTime(0,t);ng.gain.linearRampToValueAtTime(.16,t+.12);ng.gain.exponentialRampToValueAtTime(.001,t+.6);ns.connect(bp);bp.connect(ng);ng.connect(c.destination);ns.start(t);ns.stop(t+.7);tone(t+.18,329.6,len*.5+.4,{vol:.12,attack:.12,f2:392,lp:1400});tone(t+.18,261.6,len*.5+.4,{vol:.08,attack:.12,f2:329.6,lp:1100});tone(t+.25+len*.5,1568,.6,{vol:.05});tone(t+.33+len*.5,2093,.5,{vol:.035})},
      night(){const t=ac().currentTime;[[1318.5,0],[1046.5,.38],[880,.76]].forEach(([f,d])=>{tone(t+d+.05,f,1.1,{vol:.11});tone(t+d+.05,f*2,.5,{vol:.025})})},
      morning(){const t=ac().currentTime;[523.3,659.3,784,1046.5].forEach((f,i)=>tone(t+.05+i*.11,f,.45,{type:'triangle',vol:.12}))},
      miss(){const t=ac().currentTime+.1;[0,.24,.9,1.14].forEach((d,i)=>tone(t+d,i%2?70:90,.28,{vol:.5,f2:42,attack:.005,lp:300}))}};
    const play=(k,o)=>{if(soundOn)try{SOUNDS[k](o)}catch(e){}};
    const SON='<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',SOFF='<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>';
    const drawSnd=()=>{sndBtn.innerHTML=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${soundOn?SON:SOFF}</svg>`;sndBtn.setAttribute('aria-pressed',soundOn);sndBtn.setAttribute('aria-label',soundOn?'Sound on':'Sound off')};
    drawSnd(); sndBtn.onclick=()=>{soundOn=!soundOn;drawSnd()};
    let sayT=0; const sayIt=t=>{clearTimeout(sayT);say.style.opacity=0;sayT=setTimeout(()=>{say.textContent=t;say.style.opacity=1},150)};
    const face=(who,cls,ms)=>{who.classList.add(cls);if(ms)setTimeout(()=>who.classList.remove(cls),ms)};
    const fly=(ch,cls='')=>{if(RM)return;const k=document.createElement('span');k.className='kfly '+cls;k.textContent=ch;st.appendChild(k);setTimeout(()=>k.remove(),1000)};
    const hugFb=document.getElementById('hugBtn');hugFb.classList.add('invite');
    if(document.getElementById('bids').dataset.default==='night') st.classList.add('dusk','still');
    let sentN=0;const sentEl=document.getElementById('sentN');const hintTxt=()=>innerWidth>=960?'Tap or hold one on the left 👈':'Tap or hold below 👇';say.textContent=hintTxt();addEventListener('resize',()=>{if(!sentN)say.textContent=hintTxt()});const bump=(el)=>{sentN++;sentEl.textContent=sentN;sentEl.classList.remove('pop');void sentEl.offsetWidth;sentEl.classList.add('pop');if(el){el.classList.remove('sent');void el.offsetWidth;el.classList.add('sent');if(!RM){const pl=document.createElement('span');pl.className='plus1';pl.textContent='+1';el.appendChild(pl);setTimeout(()=>pl.remove(),800)}}};
    const showCta=()=>{cta.classList.add('on');hugFb.classList.remove('invite')};
    let kisses=0,kt=0;
    kBtn.addEventListener('click',()=>{if(kisses>=5)return;kisses++;kN.textContent='×'+kisses;fly('💋');play('kiss');bump(kBtn);
      clearTimeout(kt);kt=setTimeout(()=>{face(bun,'is-happy',1800);sayIt(kisses===1?'A kiss! 😚':kisses+' kisses! 😚 Kissing you back');kisses=0;kN.textContent='';showCta()},900)});
    let t0=0,raf2=0;
    const loop=()=>{const e=Math.min(1,(performance.now()-t0)/5000),sq=RM?0:Math.min(1,e*3);
      bao.style.transform=`translateX(${(sq*24).toFixed(0)}px)`;bun.style.transform=`translateX(${(-sq*24).toFixed(0)}px)`;hFi.style.background=`conic-gradient(var(--youText) ${(e*360).toFixed(0)}deg,var(--you) 0)`;
      heart.style.opacity=Math.min(1,e*4);heart.style.transform=`scale(${(.6+e*.9).toFixed(2)})`;raf2=requestAnimationFrame(loop)};
    const down=ev=>{ev.preventDefault();if(t0)return;ac();t0=performance.now();hBtn.classList.add('down');bao.classList.add('is-happy');bun.classList.add('is-happy');sayIt('Mmm, hug 🤗');loop()};
    const up=()=>{if(!t0)return;const secs=(performance.now()-t0)/1000;cancelAnimationFrame(raf2);t0=0;hBtn.classList.remove('down');hFi.style.background='';
      bao.style.transform='';bun.style.transform='';heart.style.opacity=0;if(!RM){for(let b=0;b<7;b++){const h=document.createElement('span');h.className='burst';h.textContent=b%2?'🧡':'💛';const a=Math.PI*(1.1+b*.13);h.style.setProperty('--dx',Math.cos(a)*90+'px');h.style.setProperty('--dy',Math.sin(a)*90+'px');st.appendChild(h);setTimeout(()=>h.remove(),1050)}}bao.classList.remove('is-happy');play('hug',secs);bump(hugFb);
      sayIt(secs<1?'Quick hug! Again? 🙂':secs<4?'That was a good one 🧡':'Best hug ever. Hugging you back 🤗');setTimeout(()=>bun.classList.remove('is-happy'),1800);showCta()};
    hBtn.addEventListener('pointerdown',down);addEventListener('pointerup',up);addEventListener('pointercancel',up);
    hBtn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)down(e)});hBtn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')up()});
    const G={morning:['☀️','Morning, sunshine ☀️','is-happy'],night:['🌙','Night night 💤','is-sleepy'],miss:['💓','Miss you too 🫶','is-happy']};
    document.querySelectorAll('.fb[data-g=morning],.fb[data-g=night],.fb[data-g=miss]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.g,[ch,line,cls]=G[k];fly(ch,k==='miss'?'beatfly':'');play(k);bump(b);
      st.classList.remove('sunrise','dusk','beat');void st.offsetWidth;st.classList.add(k==='morning'?'sunrise':k==='night'?'dusk':'beat');{const sec=document.getElementById('bids');if(k==='morning')sec.classList.remove('nightfall');else sec.classList.add('nightfall');}setTimeout(()=>{face(bun,cls,2200);if(k==='night')face(bao,'is-sleepy',2200);sayIt(line)},650);setTimeout(()=>{st.classList.remove('sunrise','dusk','beat');const sec=document.getElementById('bids');if(sec.dataset.default==='night'){sec.classList.add('nightfall');void st.offsetWidth;st.classList.add('dusk','still')}},2800);showCta()}));
  })();

  // mobile carousels: dots follow the swipe
  document.querySelectorAll('.vgrid').forEach(g=>{const d=document.createElement('div');d.className='vdots';d.setAttribute('aria-hidden','true');d.innerHTML=[...g.children].map(()=>'<i></i>').join('');g.after(d);
    const upd=()=>{const w=g.children[0].offsetWidth+14;const k=Math.round(g.scrollLeft/w);[...d.children].forEach((x,i)=>x.classList.toggle('on',i===Math.min(k,d.children.length-1)))};let dr=0;g.addEventListener('scroll',()=>{if(!dr)dr=requestAnimationFrame(()=>{dr=0;upd()})},{passive:true});upd()});

  // live countdown to the next question (midnight, visitor's timezone)
  const cdEls=document.querySelectorAll('.cdt');
  const tickCd=()=>{const n=new Date(),m=new Date(n);m.setHours(24,0,0,0);let d=Math.max(0,Math.floor((m-n)/1000));const h=String(Math.floor(d/3600)).padStart(2,'0'),mi=String(Math.floor(d%3600/60)).padStart(2,'0'),se=String(d%60).padStart(2,'0');cdEls.forEach(e=>e.textContent=`${h}:${mi}:${se}`)};
  tickCd(); setInterval(tickCd,1000);

  // CTA panels: Bao & Bun talk while in view, cheer on badge hover
  document.querySelectorAll('.ctabox').forEach(box=>{
    const [bao,bun]=box.querySelectorAll('.ctamascots .m'), bub=box.querySelector('.cbub');
    const LINES=[[bao,"Tonight's question is ready ✨",false],[bun,"Let's answer it together 🧡",true],[bao,"Tap a badge 👇",false]];
    let i=0,timer=0;
    const step=()=>{const [who,txt,sky]=LINES[i%LINES.length];bub.classList.remove('on');
      setTimeout(()=>{bub.textContent=txt;bub.classList.toggle('sky',sky);bub.style.setProperty('--tr',sky?'22px':'90px');bub.classList.add('on');
        [bao,bun].forEach(m=>m.classList.remove('is-happy'));void who.offsetWidth;who.classList.add('is-happy');},220);i++};
    const io2=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){if(!timer){step();timer=setInterval(step,2600)}}else{clearInterval(timer);timer=0;bub.classList.remove('on')}}),{threshold:.5});
    io2.observe(box);
    box.querySelectorAll('.badge').forEach(b=>b.addEventListener('pointerenter',()=>{[bao,bun].forEach(m=>{m.classList.remove('is-happy');void m.offsetWidth;m.classList.add('is-happy')});bub.textContent='Yay! See you inside 🎉';bub.classList.remove('sky');bub.style.setProperty('--tr','56px');bub.classList.add('on')}));
  });

  // citation chips open the references list
  document.querySelectorAll('.cite').forEach(a=>a.addEventListener('click',()=>{document.getElementById('refs').open=true}));
  if(RM) document.querySelectorAll('animateMotion').forEach(m=>m.remove());


  // research figure viewer: tabs + autoplay while in view
  (()=>{const v=document.getElementById('viewer');if(!v)return;const tabs=[...v.querySelectorAll('.vtab')],figs=[...v.querySelectorAll('.vpane')],txts=[...v.querySelectorAll('.vtxt')];
    let cur=1,auto=!RM,t0=0,raf3=0,visible=false;const DUR=7000;
    const show=(n,user)=>{cur=n;tabs.forEach(t=>{const on=+t.dataset.n===n;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;t.style.setProperty('--p',on?(auto?0:1):0)});
      figs.forEach((f,i)=>{const on=i+1===n;f.hidden=!on;f.classList.remove('in');if(on){void f.offsetWidth;f.classList.add('in')}});
      txts.forEach((x,i)=>x.hidden=i+1!==n);if(user){auto=false;tabs.forEach(t=>t.style.setProperty('--p',+t.dataset.n===n?1:0))}t0=performance.now()};
    tabs.forEach(t=>{t.addEventListener('click',()=>show(+t.dataset.n,true));t.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const n=((cur-1+(e.key==='ArrowRight'?1:3))%4)+1;show(n,true);tabs[n-1].focus()}})});
    const tick=()=>{const rr=v.getBoundingClientRect(),vis=rr.top<innerHeight*.75&&rr.bottom>innerHeight*.25;if(vis&&!visible){visible=true;if(!t0)show(1,false);else t0=performance.now()-(parseFloat(tabs[cur-1].style.getPropertyValue('--p')||0)*DUR)}else if(!vis)visible=false;
      if(auto&&visible&&!hold){const p=Math.min(1,(performance.now()-t0)/DUR);tabs[cur-1].style.setProperty('--p',p.toFixed(3));if(p>=1)show(cur%4+1,false)}raf3=requestAnimationFrame(tick)};
    show(1,false);t0=0;
    new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)show(cur,false)}),{threshold:.35}).observe(v);
    let hold=0;v.addEventListener('pointerenter',()=>{hold=performance.now()});v.addEventListener('pointerleave',()=>{if(hold){t0+=performance.now()-hold;hold=0}});
    tick();})();

  // thread pops in once
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){[...e.target.children].forEach((m,i)=>setTimeout(()=>m.classList.add('in'),RM?0:i*350));io.unobserve(e.target)}}),{threshold:.4});
  document.querySelectorAll('.thread').forEach(t=>io.observe(t));

  addEventListener('load',req);
  frame(); snap=false;
})();

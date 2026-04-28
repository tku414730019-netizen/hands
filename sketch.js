// ═══════════════════════════════════════════════════════════
//  Chapter 13_2 — 即時影像擷取 + 手部辨識 + 指尖特效
//
//  按鍵 0-3 切換像素效果模式
//  左手關節點：洋紅色 / 右手關節點：黃色
//  指尖（4,8,12,16,20）：激光 + 泡泡粒子
// ═══════════════════════════════════════════════════════════

let capture;
let pulseT   = 0;
let camReady = false;
let mode     = "0";
let span     = 15;
let noiseTexture;
let lastBox  = null;
let txt      = "一二三四五田雷電龕龘";

let effectMode = 'all';   // 'none' | 'bubble' | 'laser' | 'all'
let isMirror   = false;

// ── ml5 HandPose ───────────────────────────────────────────
let handPose;
let hands = [];

// ── 指尖粒子系統 ───────────────────────────────────────────
let tips = [];
const TIP_INDICES    = [4, 8, 12, 16, 20];
const KNUCKLE_BELOW  = [3, 7, 11, 15, 19];

// ── preload：初始化 HandPose 模型 ──────────────────────────
function preload() {
  handPose = ml5.handPose();
}

function gotHands(results) {
  hands = results;
}

// ── setup ──────────────────────────────────────────────────
async function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(60);
  textFont('serif');

  const hasCamera = await checkHasCamera();

  if (hasCamera) {
    // ── 攝影機模式：ready callback 裡才啟動偵測 ────────────
    capture = createCapture(VIDEO, { flipped: true }, () => {
      camReady = true;
      handPose.detectStart(capture, gotHands); // ✅ 攝影機就緒後才偵測
    });
    capture.size(640, 480);
    capture.hide();

  } else {
    // ── 影片 fallback ──────────────────────────────────────
    // 修正：detectStart 必須等影片真正開始播放才能呼叫，
    // 否則 ml5 拿到的是空白畫面，永遠偵測不到手。
    capture = createVideo('video.mp4');
    capture.size(640, 480);
    capture.hide();
    capture.loop();   // 直接用 loop() 取代手動 onended + play()

    capture.elt.addEventListener('canplay', () => {
      if (!camReady) {
        capture.elt.play().catch(e => console.log('自動播放被阻擋:', e));
        camReady = true;
        handPose.detectStart(capture, gotHands); // ✅ 影片可播放後才偵測
      }
    }, { once: true });

    // 備用：500ms 後若還沒觸發就強制嘗試
    setTimeout(() => {
      if (!camReady) {
        try {
          capture.play();
          camReady = true;
          handPose.detectStart(capture, gotHands);
        } catch(e) {}
      }
    }, 800);
  }

  noiseTexture = createGraphics(windowWidth, windowHeight);
  generateNoiseTexture();
  initInterface();

  const closeBtn = document.getElementById('close-modal');
  if (closeBtn) closeBtn.onclick = closeModal;
  const modalEl  = document.getElementById('qr-modal');
  if (modalEl) modalEl.onclick = (e) => { if (e.target.id === 'qr-modal') closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

async function checkHasCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === 'videoinput');
  } catch(e) { return false; }
}

// ── draw ───────────────────────────────────────────────────
function draw() {
  background('#297BB2');
  pulseT += 0.035;

  if (!camReady) { drawWaiting(); return; }
  if (capture.elt?.paused) { try { capture.play(); } catch(e){} }

  const BOX_W = width  * 0.70;
  const BOX_H = height * 0.70;
  const BOX_X = (width  - BOX_W) / 2;
  const BOX_Y = (height - BOX_H) / 2;

  const vw = capture.width;
  const vh = capture.height;
  const { x, y, w, h } = fitKeepRatio(vw, vh, BOX_W, BOX_H, BOX_X, BOX_Y);
  lastBox = { x: int(x), y: int(y), w: int(w), h: int(h) };

  drawGlow(x, y, w, h);

  // 1. 先畫影像
  if (mode === "0") {
    if (isMirror) {
      push(); 
      image(capture, x, y, w, h);
      pop();
    } else {
      image(capture, x, y, w, h);
    }
  } else {
    renderPixelArt(x, y, w, h);
  }

  // 指尖粒子
  updateTips();
  drawTips();

  // 3. 繪製手部 (mapToCanvas 會處理內部的鏡像對位)
  if (hands.length > 0) {
    for (let hand of hands) {
      if (hand.confidence > 0.1) {
        const isLeft  = (hand.handedness === "Left");
        const baseCol = isLeft ? color(255, 0, 220)  : color(255, 220, 0);
        const glowCol = isLeft ? color(255, 80, 255) : color(255, 255, 80);

        drawHandSkeleton(hand, x, y, w, h, vw, vh, baseCol);

        for (let i = 0; i < hand.keypoints.length; i++) {
          const kp  = hand.keypoints[i];
          const cx  = mapToCanvas(kp.x, kp.y, x, y, w, h, vw, vh); // ✅ 關鍵修正
          const isTip = TIP_INDICES.includes(i);
          
          if (isTip) {
            
            spawnTipEffect(cx.px, cx.py, hand, i, baseCol, vw, vh, x, y, w, h);
            if (effectMode === 'laser' || effectMode === 'all') {
              drawLaser(hand, i, x, y, w, h, vw, vh, glowCol);
            }
          } else {
            fill(red(baseCol), green(baseCol), blue(baseCol), 200);
            noStroke();
            circle(cx.px, cx.py, 10);
          }
        }
      }
    }
  }

  push(); blendMode(MULTIPLY); image(noiseTexture, 0, 0, width, height); pop();
  drawUIElements(x, y, w, h);
}

// ── 關節座標映射 ───────────────────────────────────────────
function mapToCanvas(kpx, kpy, bx, by, bw, bh, vw, vh) {
  let finalX = kpx;

  if (isMirror) {
    finalX = vw - kpx;
  }

  return { 
    px: bx + (finalX / vw) * bw, 
    py: by + (kpy / vh) * bh 
  };
}

// ── 骨架連線定義 ───────────────────────────────────────────
const FINGER_CHAINS = [
  [0,1,2,3,4], [0,5,6,7,8], [0,9,10,11,12], [0,13,14,15,16], [0,17,18,19,20]
];

function drawHandSkeleton(hand, bx, by, bw, bh, vw, vh, col) {
  stroke(red(col), green(col), blue(col), 130);
  strokeWeight(2); noFill();
  for (let chain of FINGER_CHAINS) {
    beginShape();
    for (let idx of chain) {
      const kp = hand.keypoints[idx];
      const c  = mapToCanvas(kp.x, kp.y, bx, by, bw, bh, vw, vh);
      vertex(c.px, c.py);
    }
    endShape();
  }
  strokeWeight(1);
}

// ── 激光效果 ───────────────────────────────────────────────
function drawLaser(hand, tipIdx, bx, by, bw, bh, vw, vh, col) {
  const kpIdxBelow = KNUCKLE_BELOW[TIP_INDICES.indexOf(tipIdx)];
  const tip  = hand.keypoints[tipIdx];
  const base = hand.keypoints[kpIdxBelow];
  const tc   = mapToCanvas(tip.x,  tip.y,  bx, by, bw, bh, vw, vh);
  const bc   = mapToCanvas(base.x, base.y, bx, by, bw, bh, vw, vh);
  const dx   = tc.px - bc.px, dy = tc.py - bc.py;
  const len  = dist(tc.px, tc.py, bc.px, bc.py);
  if (len === 0) return;
  const nx = dx / len, ny = dy / len;
  const laserLen = 60 + 30 * sin(pulseT * 4);
  const ex = tc.px + nx * laserLen, ey = tc.py + ny * laserLen;
  const layers = [{ w:8,a:40 },{ w:4,a:120 },{ w:2,a:220 },{ w:1,a:255 }];
  for (let l of layers) {
    stroke(red(col), green(col), blue(col), l.a);
    strokeWeight(l.w);
    line(tc.px, tc.py, ex, ey);
  }
  noStroke(); fill(255, 255, 255, 200); circle(ex, ey, 5);
}

// ── 發光圓形 ───────────────────────────────────────────────
function drawGlowCircle(cx, cy, r, glowCol, coreCol) {
  noStroke();
  for (let i = 3; i >= 1; i--) {
    fill(red(glowCol), green(glowCol), blue(glowCol), 30 * i);
    circle(cx, cy, r + i * 8);
  }
  fill(red(coreCol), green(coreCol), blue(coreCol), 230); circle(cx, cy, r);
  fill(255, 255, 255, 160); circle(cx - r*0.2, cy - r*0.2, r*0.35);
}

// ── 指尖粒子生成 ───────────────────────────────────────────
function spawnTipEffect(px, py, hand, tipIdx, col, vw, vh, bx, by, bw, bh) {
  if (effectMode === 'none') return;
  const belowIdx = KNUCKLE_BELOW[TIP_INDICES.indexOf(tipIdx)];
  const tip   = hand.keypoints[tipIdx];
  const below = hand.keypoints[belowIdx];
  const tc = mapToCanvas(tip.x,   tip.y,   bx, by, bw, bh, vw, vh);
  const bc = mapToCanvas(below.x, below.y, bx, by, bw, bh, vw, vh);
  const dx = tc.px - bc.px, dy = tc.py - bc.py;
  const len = dist(tc.px, tc.py, bc.px, bc.py) || 1;
  const nx = dx / len, ny = dy / len;
  const count = floor(random(1, 3));
  for (let i = 0; i < count; i++) {
    const angle = atan2(ny, nx) + random(-0.4, 0.4);
    const speed = random(1.5, 4.5);
    const type  = effectMode === 'bubble' ? 'bubble'
                : effectMode === 'laser'  ? 'spark'
                : (random() > 0.5 ? 'bubble' : 'spark');
    tips.push({ x:px, y:py, vx:cos(angle)*speed, vy:sin(angle)*speed,
                life:1.0, decay:random(0.02,0.05), r:random(4,12), col, type });
  }
}

// ── 粒子更新 ───────────────────────────────────────────────
function updateTips() {
  for (let i = tips.length - 1; i >= 0; i--) {
    const p = tips[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.97; p.life -= p.decay;
    if (p.life <= 0) tips.splice(i, 1);
  }
}

// ── 粒子繪製 ───────────────────────────────────────────────
function drawTips() {
  for (let p of tips) {
    const a = p.life * 255;
    const r = red(p.col), g = green(p.col), b = blue(p.col);
    if (p.type === 'bubble') {
      noFill(); stroke(r, g, b, a * 0.8); strokeWeight(1.5); circle(p.x, p.y, p.r * 2);
      noStroke(); fill(255, 255, 255, a * 0.4); circle(p.x - p.r*0.3, p.y - p.r*0.3, p.r*0.4);
    } else {
      noStroke();
      fill(r, g, b, a * 0.3); circle(p.x, p.y, p.r * 2.5);
      fill(r, g, b, a);       circle(p.x, p.y, p.r);
      fill(255, 255, 255, a * 0.7); circle(p.x, p.y, p.r * 0.4);
    }
  }
  noStroke();
}

// ── 等待畫面 ───────────────────────────────────────────────
function drawWaiting() {
  const r = 12 + 4 * sin(pulseT * 2);
  noStroke();
  fill(255, 255, 255, 80 + 40 * sin(pulseT * 2));
  ellipse(width/2, height/2 - 20, r, r);
  fill(255, 255, 255, 160);
  textAlign(CENTER, CENTER); textFont('DM Mono, monospace'); textSize(14);
  text('鏡頭啟動中...', width/2, height/2 + 16);
}

// ── 光暈效果 ───────────────────────────────────────────────
function drawGlow(x, y, w, h) {
  const a = 30 + 15 * sin(pulseT);
  noStroke();
  for (let i = 3; i >= 1; i--) {
    fill(255, 255, 255, a * (i/3) * 0.25);
    const p = i * 7;
    rect(x-p, y-p, w+p*2, h+p*2, 4+p);
  }
}

// ── 像素化渲染 ─────────────────────────────────────────────
function renderPixelArt(targetX, targetY, targetW, targetH) {
  capture.loadPixels();
  if (!capture.pixels || capture.pixels.length === 0) return;

  if (mode === "2") {
    const COLS = 20, ROWS = 20;
    const cWs = capture.width/COLS, cHs = capture.height/ROWS;
    const cWd = targetW/COLS,       cHd = targetH/ROWS;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const sx = floor(col*cWs), sy = floor(row*cHs);
        const sw = max(1,floor(cWs)), sh = max(1,floor(cHs));
        let rS=0,gS=0,bS=0,cnt=0;
        for (let yy=sy; yy<min(sy+sh,capture.height); yy++) {
          for (let xx=sx; xx<min(sx+sw,capture.width); xx++) {
            const idx=(xx+yy*capture.width)*4;
            rS+=capture.pixels[idx]; gS+=capture.pixels[idx+1]; bS+=capture.pixels[idx+2]; cnt++;
          }
        }
        if(cnt===0)cnt=1;
        const gray=(rS+gS+bS)/(3*cnt);
        noStroke(); fill(gray);
        rect(targetX+(COLS-1-col)*cWd, targetY+row*cHd, cWd+1, cHd+1);
      }
    }
    return;
  }

  const scaleX = targetW/capture.width, scaleY = targetH/capture.height;
  for (let py=0; py<capture.height; py+=span) {
    for (let px=0; px<capture.width; px+=span) {
      const srcX  = isMirror ? (capture.width-1-px) : px;
      const index = (srcX + py*capture.width)*4;
      const r=capture.pixels[index], g=capture.pixels[index+1], b=capture.pixels[index+2];
      const bk=(r+g+b)/3;
      const drawX=targetX+px*scaleX, drawY=targetY+py*scaleY, ds=span*scaleX;
      push(); translate(drawX,drawY); noStroke();
      if (mode==="1") { fill(r,g,b); rect(0,0,map(bk,0,255,0,ds)); }
      else if (mode==="3") {
        let bkId=int(map(bk,0,255,txt.length-1,0));
        fill(r,g,b); textSize(ds); textAlign(LEFT,TOP); text(txt[bkId],0,0);
      }
      pop();
    }
  }
}

// ── 雜訊材質 ───────────────────────────────────────────────
function generateNoiseTexture() {
  noiseTexture.loadPixels();
  for (let i=0; i<noiseTexture.pixels.length; i+=4) {
    let v=random(255);
    noiseTexture.pixels[i]=v; noiseTexture.pixels[i+1]=v;
    noiseTexture.pixels[i+2]=v; noiseTexture.pixels[i+3]=random(15,45);
  }
  noiseTexture.updatePixels();
}

// ── 鍵盤快捷鍵 ─────────────────────────────────────────────
function keyPressed() {
  if (['0','1','2','3'].includes(key)) { mode=key; updateModeButtons(); }
}

// ── UI 元素（邊框 + 狀態列 + 提示文字）────────────────────
function drawUIElements(x, y, w, h) {
  noFill(); stroke(255,255,255,80); rect(x,y,w,h,4);
  drawStatusBar();
  fill(255); textAlign(CENTER); textSize(13);
  text(`模式: ${mode} (按 0-3) | 間距: ${span}px | 手部: ${hands.length>0?'✋':'—'}`, width/2, height-70);
}

function drawStatusBar() {
  noStroke(); fill(0,0,0,38); rect(0,height-46,width,46);
  fill(255,255,255,75); textAlign(LEFT,CENTER); textFont('DM Mono, monospace'); textSize(11);
  text(/Mobi|Android/i.test(navigator.userAgent)?'📱 Mobile Camera':'💻 Desktop Camera', 18, height-23);
  fill(255,255,255,140); textAlign(RIGHT,CENTER); textSize(12);
  text('🟢 Live', width-18, height-23);
}

// ── 比例保持 ───────────────────────────────────────────────
function fitKeepRatio(srcW, srcH, boxW, boxH, offsetX, offsetY) {
  const srcR=srcW/srcH, boxR=boxW/boxH;
  let w,h;
  if(srcR>boxR){w=boxW;h=boxW/srcR;}else{h=boxH;w=boxH*srcR;}
  return {x:offsetX+(boxW-w)/2, y:offsetY+(boxH-h)/2, w, h};
}

// ══════════════════════════════════════════════════════════
//  介面初始化 — 所有按鈕統一放在底部兩排
//
//  排版結構（由上到下）：
//    ┌─────────────────────────────────────────────────────┐
//    │  Row 1: [❌無特效] [🫧泡泡] [✨激光] [🌟全部]         │
//    │         [🪞鏡像] [🔗分享] [📸截圖]                    │
//    ├─────────────────────────────────────────────────────┤
//    │  Row 2: [🪞原色] [🟨彩色] [⬛灰階] [✍️文字]           │
//    └─────────────────────────────────────────────────────┘
// ══════════════════════════════════════════════════════════
function initInterface() {
  if (document.getElementById('bottom-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'bottom-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 54px;           /* 停在狀態列上方 */
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  `;

  // ── Row 1：特效 + 鏡像 + 工具按鈕 ───────────────────────
  const row1 = document.createElement('div');
  row1.style.cssText = `
    display: flex;
    gap: 7px;
    background: rgba(0,0,0,0.45);
    padding: 8px 12px;
    border-radius: 10px;
    backdrop-filter: blur(12px);
    flex-wrap: wrap;
    justify-content: center;
  `;

  const effects = [
    { id:'none',   label:'❌ 無特效' },
    { id:'bubble', label:'🫧 泡泡'   },
    { id:'laser',  label:'✨ 激光'   },
    { id:'all',    label:'🌟 全部'   }
  ];
  effects.forEach(e => {
    const btn = makeBtn(e.label, `effect-${e.id}`, () => {
      effectMode = e.id;
      updateEffectButtons();
    });
    row1.appendChild(btn);
  });

  // 分隔線
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px;background:rgba(255,255,255,0.25);margin:2px 4px;';
  row1.appendChild(sep);

  // 鏡像
  const mirrorBtn = makeBtn('🚫 鏡像 OFF', 'mirror-btn', () => {
    isMirror = !isMirror;
    mirrorBtn.innerHTML = isMirror ? '🪞 鏡像 ON' : '🚫 鏡像 OFF';
    mirrorBtn.style.background = isMirror ? 'rgba(100,200,100,0.75)' : 'rgba(41,123,178,0.6)';
  });
  row1.appendChild(mirrorBtn);

  // 截圖
  const saveBtn = makeBtn('📸 截圖', 'save-btn', captureSnapshot);
  row1.appendChild(saveBtn);

  // ── Row 2：模式按鈕 ─────────────────────────────────────
  const row2 = document.createElement('div');
  row2.id = 'mode-buttons';
  row2.style.cssText = `
    display: flex;
    gap: 7px;
    background: rgba(0,0,0,0.45);
    padding: 8px 12px;
    border-radius: 10px;
    backdrop-filter: blur(12px);
  `;

  const modes = [
    { id:'0', label:'🪞 原色鏡像' },
    { id:'1', label:'🟨 彩色方塊' },
    { id:'2', label:'⬛ 灰階馬賽克' },
    { id:'3', label:'✍️ 文字雲'   }
  ];
  modes.forEach(m => {
    const btn = makeBtn(m.label, `mode-btn-${m.id}`, () => {
      mode = m.id;
      updateModeButtons();
    });
    row2.appendChild(btn);
  });

  panel.appendChild(row1);
  panel.appendChild(row2);
  document.body.appendChild(panel);

  updateEffectButtons();
  updateModeButtons();

  // Modal 事件
  const closeEl = document.getElementById('close-modal');
  if (closeEl) closeEl.onclick = closeModal;
  const modal = document.getElementById('qr-modal');
  if (modal) modal.onclick = (e) => { if (e.target.id==='qr-modal') closeModal(); };
}

// ── 按鈕工廠 ───────────────────────────────────────────────
function makeBtn(label, id, onclick) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.innerHTML = label;
  btn.onclick = onclick;
  btn.style.cssText = `
    padding: 9px 13px;
    border: 1.5px solid rgba(255,255,255,0.5);
    background: rgba(41,123,178,0.6);
    color: #fff;
    border-radius: 7px;
    cursor: pointer;
    font-size: 13px;
    font-weight: bold;
    white-space: nowrap;
    transition: background .2s, transform .15s;
  `;
  btn.onmouseover = () => btn.style.transform = 'scale(1.06)';
  btn.onmouseout  = () => btn.style.transform = 'scale(1)';
  return btn;
}

// ── 按鈕狀態更新 ───────────────────────────────────────────
function updateEffectButtons() {
  ['none','bubble','laser','all'].forEach(id => {
    const btn = document.getElementById(`effect-${id}`);
    if (!btn) return;
    btn.style.background   = effectMode===id ? 'rgba(255,215,0,0.85)'  : 'rgba(41,123,178,0.6)';
    btn.style.borderColor  = effectMode===id ? '#FFD700'                : 'rgba(255,255,255,0.5)';
    btn.style.transform    = effectMode===id ? 'scale(1.08)'            : 'scale(1)';
  });
}

function updateModeButtons() {
  ['0','1','2','3'].forEach(m => {
    const btn = document.getElementById(`mode-btn-${m}`);
    if (!btn) return;
    btn.style.background  = mode===m ? 'rgba(255,215,0,0.85)'  : 'rgba(41,123,178,0.6)';
    btn.style.borderColor = mode===m ? '#FFD700'                : 'rgba(255,255,255,0.5)';
    btn.style.transform   = mode===m ? 'scale(1.08)'            : 'scale(1)';
  });
}

// ── QR Modal ───────────────────────────────────────────────
function openModal() {
  const modal=document.getElementById('qr-modal');
  const qrEl=document.getElementById('qr-code');
  const urlEl=document.getElementById('url-display');
  if (!modal||!qrEl||!urlEl) return;
  urlEl.textContent=location.href;
  qrEl.innerHTML='';
  new QRCode(qrEl,{text:location.href,width:184,height:184,colorDark:'#297BB2',colorLight:'#f4f8fc',correctLevel:QRCode.CorrectLevel.M});
  modal.classList.remove('hidden');
}

function closeModal() {
  const modal=document.getElementById('qr-modal');
  if (modal) modal.classList.add('hidden');
}

// ── 截圖 ───────────────────────────────────────────────────
function captureSnapshot() {
  if (!lastBox) return;
  save(get(lastBox.x, lastBox.y, lastBox.w, lastBox.h), 'snapshot.jpg');
}

// ── 視窗縮放 ───────────────────────────────────────────────
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  noiseTexture = createGraphics(windowWidth, windowHeight);
  generateNoiseTexture();
}

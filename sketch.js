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

// ── ml5 HandPose ───────────────────────────────────────────
let handPose;
let hands = [];

// ── 指尖粒子系統 ───────────────────────────────────────────
let tips = [];   // { x, y, vx, vy, life, maxLife, r, col, type }
const TIP_INDICES = [4, 8, 12, 16, 20];   // 拇指~小指指尖
const KNUCKLE_BELOW = [3, 7, 11, 15, 19]; // 指尖下一節（用於計算方向）

// ── preload：初始化 HandPose 模型 ──────────────────────────
function preload() {
  handPose = ml5.handPose({ flipped: true });
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
    capture = createCapture(VIDEO, { flipped: true }, () => { camReady = true; });
    capture.size(640, 480);
    capture.hide();
  } else {
    // fallback 影片
    capture = createVideo('video.mp4');
    capture.size(640, 480);
    capture.hide();
    capture.onended(() => capture.play());
    capture.elt.oncanplay = () => {
      if (!camReady) {
        capture.elt.play().catch(e => console.log('自動播放被阻擋:', e));
        camReady = true;
      }
    };
    setTimeout(() => { try { capture.play(); } catch(e){} }, 500);
  }

  // 啟動手部偵測（偵測到結果就呼叫 gotHands）
  handPose.detectStart(capture, gotHands);

  noiseTexture = createGraphics(windowWidth, windowHeight);
  generateNoiseTexture();
  initInterface();

  const closeBtn = document.getElementById('close-modal');
  if (closeBtn) closeBtn.onclick = closeModal;
  const modalEl = document.getElementById('qr-modal');
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

  // 計算顯示區塊
  const BOX_W = width  * 0.70;
  const BOX_H = height * 0.70;
  const BOX_X = (width  - BOX_W) / 2;
  const BOX_Y = (height - BOX_H) / 2;

  const vw = capture.elt?.videoWidth  || 640;
  const vh = capture.elt?.videoHeight || 480;
  const { x, y, w, h } = fitKeepRatio(vw, vh, BOX_W, BOX_H, BOX_X, BOX_Y);
  lastBox = { x: int(x), y: int(y), w: int(w), h: int(h) };

  // snapshot 按鈕定位
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn && lastBox) {
    saveBtn.style.left = (lastBox.x + lastBox.w + 12) + 'px';
    saveBtn.style.top  = lastBox.y + 'px';
  }

  span = int(map(mouseX, 0, width, 8, 40));

  // 外光暈
  drawGlow(x, y, w, h);

  // 核心渲染
  if (mode === "0") {
    push();
      translate(x + w, y);
      scale(-1, 1);
      image(capture, 0, 0, w, h);
    pop();
  } else {
    renderPixelArt(x, y, w, h);
  }

  // ── 指尖粒子（更新 + 繪製）──────────────────────────────
  updateTips();
  drawTips();

  // ── 手部骨架 + 激光 + 粒子生成 ──────────────────────────
  if (hands.length > 0) {
    for (let hand of hands) {
      if (hand.confidence > 0.1) {
        const isLeft = (hand.handedness === "Left");

        // 基底顏色（左手洋紅 / 右手黃色）
        const baseCol  = isLeft ? color(255, 0, 220)   : color(255, 220, 0);
        const glowCol  = isLeft ? color(255, 80, 255)  : color(255, 255, 80);

        // 繪製骨架連線
        drawHandSkeleton(hand, x, y, w, h, vw, vh, baseCol);

        // 繪製所有關節點
        for (let i = 0; i < hand.keypoints.length; i++) {
          const kp = hand.keypoints[i];
          const cx = mapToCanvas(kp.x, kp.y, x, y, w, h, vw, vh);

          const isTip = TIP_INDICES.includes(i);
          noStroke();
          if (isTip) {
            // 指尖：大圓 + 亮邊
            drawGlowCircle(cx.px, cx.py, 18, glowCol, baseCol);

            // 每幀在指尖生成粒子
            spawnTipEffect(cx.px, cx.py, hand, i, baseCol, vw, vh, x, y, w, h);

            // 繪製激光
            drawLaser(hand, i, x, y, w, h, vw, vh, glowCol);
          } else {
            // 一般關節：小點
            fill(red(baseCol), green(baseCol), blue(baseCol), 200);
            circle(cx.px, cx.py, 10);
          }
        }
      }
    }
  }

  // 雜訊材質
  push(); blendMode(MULTIPLY); image(noiseTexture, 0, 0, width, height); pop();

  drawUIElements(x, y, w, h);
}

// ── 關節座標映射（影片座標 → 畫布座標）────────────────────
function mapToCanvas(kpx, kpy, bx, by, bw, bh, vw, vh) {
  return {
    px: bx + (kpx / vw) * bw,
    py: by + (kpy / vh) * bh
  };
}

// ── 繪製手部骨架 ───────────────────────────────────────────
// 每根手指的關節索引順序
const FINGER_CHAINS = [
  [0, 1, 2, 3, 4],   // 拇指
  [0, 5, 6, 7, 8],   // 食指
  [0, 9,10,11,12],   // 中指
  [0,13,14,15,16],   // 無名指
  [0,17,18,19,20]    // 小指
];

function drawHandSkeleton(hand, bx, by, bw, bh, vw, vh, col) {
  stroke(red(col), green(col), blue(col), 130);
  strokeWeight(2);
  noFill();

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

  const tc = mapToCanvas(tip.x,  tip.y,  bx, by, bw, bh, vw, vh);
  const bc = mapToCanvas(base.x, base.y, bx, by, bw, bh, vw, vh);

  // 指尖方向向量，延伸激光長度
  const dx = tc.px - bc.px;
  const dy = tc.py - bc.py;
  const len = dist(tc.px, tc.py, bc.px, bc.py);
  if (len === 0) return;

  const nx  = dx / len;
  const ny  = dy / len;
  const laserLen = 60 + 30 * sin(pulseT * 4); // 脈動長度

  const ex = tc.px + nx * laserLen;
  const ey = tc.py + ny * laserLen;

  // 多層光暈線段
  const layers = [
    { w: 8, a: 40  },
    { w: 4, a: 120 },
    { w: 2, a: 220 },
    { w: 1, a: 255 }
  ];
  for (let l of layers) {
    stroke(red(col), green(col), blue(col), l.a);
    strokeWeight(l.w);
    line(tc.px, tc.py, ex, ey);
  }
  noStroke();

  // 激光頂端亮點
  fill(255, 255, 255, 200);
  circle(ex, ey, 5);
}

// ── 發光圓形 ───────────────────────────────────────────────
function drawGlowCircle(cx, cy, r, glowCol, coreCol) {
  noStroke();
  // 外光暈
  for (let i = 3; i >= 1; i--) {
    fill(red(glowCol), green(glowCol), blue(glowCol), 30 * i);
    circle(cx, cy, r + i * 8);
  }
  // 核心
  fill(red(coreCol), green(coreCol), blue(coreCol), 230);
  circle(cx, cy, r);
  // 高光
  fill(255, 255, 255, 160);
  circle(cx - r * 0.2, cy - r * 0.2, r * 0.35);
}

// ── 指尖粒子生成 ───────────────────────────────────────────
function spawnTipEffect(px, py, hand, tipIdx, col, vw, vh, bx, by, bw, bh) {
  // 計算指尖方向
  const belowIdx = KNUCKLE_BELOW[TIP_INDICES.indexOf(tipIdx)];
  const tip   = hand.keypoints[tipIdx];
  const below = hand.keypoints[belowIdx];
  const tc = mapToCanvas(tip.x,   tip.y,   bx, by, bw, bh, vw, vh);
  const bc = mapToCanvas(below.x, below.y, bx, by, bw, bh, vw, vh);

  const dx  = tc.px - bc.px;
  const dy  = tc.py - bc.py;
  const len = dist(tc.px, tc.py, bc.px, bc.py) || 1;
  const nx  = dx / len;
  const ny  = dy / len;

  // 每幀生成 1~2 顆粒子
  const count = floor(random(1, 3));
  for (let i = 0; i < count; i++) {
    const angle = atan2(ny, nx) + random(-0.4, 0.4);
    const speed = random(1.5, 4.5);
    const isBubble = random() > 0.5; // 50% 激光粒子，50% 泡泡

    tips.push({
      x:       px,
      y:       py,
      vx:      cos(angle) * speed,
      vy:      sin(angle) * speed,
      life:    1.0,
      decay:   random(0.02, 0.05),
      r:       random(4, 12),
      col:     col,
      type:    isBubble ? 'bubble' : 'spark'
    });
  }
}

// ── 粒子更新 ───────────────────────────────────────────────
function updateTips() {
  for (let i = tips.length - 1; i >= 0; i--) {
    const p = tips[i];
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.08;   // 重力
    p.vx   *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) tips.splice(i, 1);
  }
}

// ── 粒子繪製 ───────────────────────────────────────────────
function drawTips() {
  noStroke();
  for (let p of tips) {
    const a = p.life * 255;
    const r = red(p.col), g = green(p.col), b = blue(p.col);

    if (p.type === 'bubble') {
      // 泡泡：空心圓圈 + 高光
      noFill();
      stroke(r, g, b, a * 0.8);
      strokeWeight(1.5);
      circle(p.x, p.y, p.r * 2);
      noStroke();
      fill(255, 255, 255, a * 0.4);
      circle(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.4);
    } else {
      // 火花：發光小圓
      fill(r, g, b, a * 0.3);
      circle(p.x, p.y, p.r * 2.5);
      fill(r, g, b, a);
      circle(p.x, p.y, p.r);
      fill(255, 255, 255, a * 0.7);
      circle(p.x, p.y, p.r * 0.4);
    }
  }
  noStroke();
}

// ══════════════════════════════════════════════════════════
//  以下為原始功能（等待、像素處理、UI 等，維持不變）
// ══════════════════════════════════════════════════════════

function drawWaiting() {
  const r = 12 + 4 * sin(pulseT * 2);
  noStroke();
  fill(255, 255, 255, 80 + 40 * sin(pulseT * 2));
  ellipse(width / 2, height / 2 - 20, r, r);
  fill(255, 255, 255, 160);
  textAlign(CENTER, CENTER);
  textFont('DM Mono, monospace');
  textSize(14);
  text('鏡頭啟動中...', width / 2, height / 2 + 16);
}

function drawGlow(x, y, w, h) {
  const a = 30 + 15 * sin(pulseT);
  noStroke();
  for (let i = 3; i >= 1; i--) {
    fill(255, 255, 255, a * (i / 3) * 0.25);
    const p = i * 7;
    rect(x - p, y - p, w + p * 2, h + p * 2, 4 + p);
  }
}

function renderPixelArt(targetX, targetY, targetW, targetH) {
  capture.loadPixels();
  if (!capture.pixels || capture.pixels.length === 0) return;

  if (mode === "2") {
    const COLS = 20, ROWS = 20;
    const cellW_src = capture.width / COLS;
    const cellH_src = capture.height / ROWS;
    const cellW_draw = targetW / COLS;
    const cellH_draw = targetH / ROWS;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const sx = floor(col * cellW_src), sy = floor(row * cellH_src);
        const sw = max(1, floor(cellW_src)), sh = max(1, floor(cellH_src));
        let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
        for (let yy = sy; yy < min(sy + sh, capture.height); yy++) {
          for (let xx = sx; xx < min(sx + sw, capture.width); xx++) {
            const idx = (xx + yy * capture.width) * 4;
            rSum += capture.pixels[idx]; gSum += capture.pixels[idx+1]; bSum += capture.pixels[idx+2]; cnt++;
          }
        }
        if (cnt === 0) cnt = 1;
        const gray = (rSum + gSum + bSum) / (3 * cnt);
        const drawX = targetX + (COLS - 1 - col) * cellW_draw;
        const drawY = targetY + row * cellH_draw;
        noStroke(); fill(gray);
        rect(drawX, drawY, cellW_draw + 1, cellH_draw + 1);
      }
    }
    return;
  }

  let scaleX = targetW / capture.width;
  let scaleY = targetH / capture.height;
  for (let py = 0; py < capture.height; py += span) {
    for (let px = 0; px < capture.width; px += span) {
      let mirroredX = capture.width - 1 - px;
      let index = (mirroredX + py * capture.width) * 4;
      let r = capture.pixels[index], g = capture.pixels[index+1], b = capture.pixels[index+2];
      let bk = (r + g + b) / 3;
      let drawX = targetX + px * scaleX, drawY = targetY + py * scaleY;
      let drawSpan = span * scaleX;
      push(); translate(drawX, drawY); noStroke();
      if (mode === "1") {
        fill(r, g, b); rect(0, 0, map(bk, 0, 255, 0, drawSpan));
      } else if (mode === "3") {
        let bkId = int(map(bk, 0, 255, txt.length - 1, 0));
        fill(r, g, b); textSize(drawSpan); textAlign(LEFT, TOP); text(txt[bkId], 0, 0);
      }
      pop();
    }
  }
}

function generateNoiseTexture() {
  noiseTexture.loadPixels();
  for (let i = 0; i < noiseTexture.pixels.length; i += 4) {
    let v = random(255);
    noiseTexture.pixels[i] = v; noiseTexture.pixels[i+1] = v;
    noiseTexture.pixels[i+2] = v; noiseTexture.pixels[i+3] = random(15, 45);
  }
  noiseTexture.updatePixels();
}

function keyPressed() {
  if (['0','1','2','3'].includes(key)) mode = key;
}

function drawUIElements(x, y, w, h) {
  noFill(); stroke(255, 255, 255, 80); rect(x, y, w, h, 4);
  drawStatusBar();
  fill(255); textAlign(CENTER); textSize(13);
  text(`模式: ${mode} (按 0-3 切換) | 間距: ${span}px | 手部偵測: ${hands.length > 0 ? '✋' : '—'}`, width/2, height - 70);
}

function drawStatusBar() {
  noStroke(); fill(0, 0, 0, 38); rect(0, height - 46, width, 46);
  fill(255, 255, 255, 75); textAlign(LEFT, CENTER); textFont('DM Mono, monospace'); textSize(11);
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  text(isMobile ? '📱 Mobile Camera' : '💻 Desktop Camera', 18, height - 23);
  fill(255, 255, 255, 140); textAlign(RIGHT, CENTER); textSize(12);
  text('🟢 Live', width - 18, height - 23);
}

function fitKeepRatio(srcW, srcH, boxW, boxH, offsetX, offsetY) {
  const srcR = srcW / srcH, boxR = boxW / boxH;
  let w, h;
  if (srcR > boxR) { w = boxW; h = boxW / srcR; } else { h = boxH; w = boxH * srcR; }
  return { x: offsetX + (boxW - w) / 2, y: offsetY + (boxH - h) / 2, w, h };
}

function initInterface() {
  if (!document.getElementById('share-btn')) {
    const btn = document.createElement('button');
    btn.id = 'share-btn'; btn.innerHTML = '🔗 在其他裝置開啟'; btn.onclick = openModal;
    document.body.appendChild(btn);
  }
  if (!document.getElementById('save-btn')) {
    const sb = document.createElement('button');
    sb.id = 'save-btn'; sb.innerHTML = '📸 儲存截圖'; sb.onclick = captureSnapshot;
    sb.style.position = 'absolute'; sb.style.zIndex = 9999;
    document.body.appendChild(sb);
  }
  if (!document.getElementById('mode-buttons')) {
    const container = document.createElement('div');
    container.id = 'mode-buttons';
    container.style.cssText = `position:fixed;bottom:60px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:1000;background:rgba(0,0,0,0.4);padding:10px;border-radius:8px;backdrop-filter:blur(10px);`;
    const modes = [
      { id:'0', label:'🪞 原色鏡像' }, { id:'1', label:'🟨 彩色方塊' },
      { id:'2', label:'⬛ 灰階馬賽克' }, { id:'3', label:'✍️ 文字雲' }
    ];
    modes.forEach(m => {
      const btn = document.createElement('button');
      btn.id = `mode-btn-${m.id}`; btn.innerHTML = m.label;
      btn.style.cssText = `padding:10px 14px;border:2px solid #fff;background:rgba(41,123,178,0.6);color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;transition:all 0.3s ease;white-space:nowrap;`;
      btn.onclick = () => { mode = m.id; updateModeButtons(); };
      container.appendChild(btn);
    });
    document.body.appendChild(container);
    updateModeButtons();
  }
  const closeEl = document.getElementById('close-modal');
  if (closeEl) closeEl.onclick = closeModal;
  const modal = document.getElementById('qr-modal');
  if (modal) modal.onclick = (e) => { if (e.target.id === 'qr-modal') closeModal(); };
}

function updateModeButtons() {
  ['0','1','2','3'].forEach(m => {
    const btn = document.getElementById(`mode-btn-${m}`);
    if (!btn) return;
    if (mode === m) {
      btn.style.background = 'rgba(255,215,0,0.8)'; btn.style.borderColor = '#FFD700'; btn.style.transform = 'scale(1.1)';
    } else {
      btn.style.background = 'rgba(41,123,178,0.6)'; btn.style.borderColor = '#fff'; btn.style.transform = 'scale(1)';
    }
  });
}

function openModal() {
  const modal = document.getElementById('qr-modal');
  const qrEl  = document.getElementById('qr-code');
  const urlEl = document.getElementById('url-display');
  if (!modal || !qrEl || !urlEl) return;
  urlEl.textContent = location.href;
  qrEl.innerHTML = '';
  new QRCode(qrEl, { text: location.href, width: 184, height: 184, colorDark: '#297BB2', colorLight: '#f4f8fc', correctLevel: QRCode.CorrectLevel.M });
  modal.classList.remove('hidden');
}

function closeModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) modal.classList.add('hidden');
}

function captureSnapshot() {
  if (!lastBox) return;
  save(get(lastBox.x, lastBox.y, lastBox.w, lastBox.h), 'snapshot.jpg');
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  noiseTexture = createGraphics(windowWidth, windowHeight);
  generateNoiseTexture();
}

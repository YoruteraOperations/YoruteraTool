/* ============================================================
   ピクセルエディタ 共通処理（サイズ指定で使い回す）
   使用ページ：pixelEditorArmor.html（64×32）／ pixelEditorSkin.html（64×64）
   ※ ピクセルエディタ16（pixelEditor.html）は単独ファイルのまま（このファイルを使わない）

   使い方：
     PixelEditorCore.init({
       root: document.getElementById("editorRoot"),
       width: 64, height: 64,          // キャンバスの実寸（書き出しPNGのサイズ）
       fileName: "my_skin",            // 書き出しファイル名の初期値
       guides: [...],                  // 下敷き（部位の位置）の候補
       samples: [...],                 // 読み込めるサンプル
       guideNote: "..."                // 下敷きの説明文
     });
   ============================================================ */
(function () {
  "use strict";

  // ── 定数 ──
  const CELL = 16;            // 内部描画での1ドットのピクセル数（表示は CSS で拡大縮小）
  const MAX_RECENT = 16;      // 最近使った色の保持数
  const MAX_UNDO = 100;       // 元に戻すの保持数
  const MIN_CELL_PX = 3;      // 表示上の1マスの最小サイズ（px）
  const MAX_CELL_PX = 48;     // 表示上の1マスの最大サイズ（px）
  const ZOOM_STEP = 1.25;     // 拡大縮小1回あたりの倍率
  const MAJOR_GRID = 8;       // 濃いグリッド線の間隔（マス）
  const GUIDE_FILL_ALPHA = 0.10;   // 下敷きの塗りの濃さ
  const GUIDE_LINE_ALPHA = 0.75;   // 下敷きの枠線の濃さ
  const GUIDE_TEXT_ALPHA = 0.8;    // 下敷きの文字の濃さ

  // 上下左右の4マス（斜めの1マス幅の線でも枠として閉じるよう、斜めはつながりに含めない）
  const NEIGHBORS_4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];

  // ── 部位の箱（ボックスUV）から、6面の領域を作る ──
  // (u,v)：UVの左上、w：幅、h：高さ、d：奥行き。面の並びはMinecraftのボックスUVの規則どおり
  //   上:(u+d, v)  下:(u+d+w, v)  右:(u, v+d)  前:(u+d, v+d)  左:(u+d+w, v+d)  後:(u+2d+w, v+d)
  function boxRegions(u, v, w, h, d, name, color, opts) {
    const o = opts || {};
    const base = { color: color, dashed: !!o.dashed, part: name };
    return [
      Object.assign({ x: u + d,         y: v,     w: w, h: d, label: "上" }, base),
      Object.assign({ x: u + d + w,     y: v,     w: w, h: d, label: "下" }, base),
      Object.assign({ x: u,             y: v + d, w: d, h: h, label: "右" }, base),
      Object.assign({ x: u + d,         y: v + d, w: w, h: h, label: name, front: true }, base),
      Object.assign({ x: u + d + w,     y: v + d, w: d, h: h, label: "左" }, base),
      Object.assign({ x: u + 2 * d + w, y: v + d, w: w, h: h, label: "後" }, base),
    ];
  }

  // ── 色ユーティリティ ──
  function hsvToRgb(h, s, v) {
    h = (h % 360 + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }
  function rgbToHex(r, g, b) {
    const f = n => n.toString(16).padStart(2, "0");
    return ("#" + f(r) + f(g) + f(b)).toUpperCase();
  }
  function hexToRgb(hex) {
    let h = String(hex).replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.substr(0, 2), 16),
      g: parseInt(h.substr(2, 2), 16),
      b: parseInt(h.substr(4, 2), 16),
    };
  }
  // 明るさを変えた色（サンプルの面ごとの陰影用）
  function shade(hex, k) {
    const c = hexToRgb(hex);
    const f = n => Math.max(0, Math.min(255, Math.round(n * k)));
    return { r: f(c.r), g: f(c.g), b: f(c.b) };
  }

  // ── 画面の部品（HTML）を作る ──
  function buildMarkup(cfg) {
    const guideOptions = cfg.guides.map((g, i) =>
      `<option value="${i}">${g.label}</option>`).join("");
    const sampleOptions = cfg.samples.map((s, i) =>
      `<option value="${i}">${s.label}</option>`).join("");
    return `
    <div class="editor-layout">
      <div class="canvas-col">
        <div class="view-bar">
          <button class="mini-btn" id="zoomOutBtn" title="縮小">－</button>
          <span class="zoom-val" id="zoomVal">100%</span>
          <button class="mini-btn" id="zoomInBtn" title="拡大">＋</button>
          <button class="mini-btn" id="zoomFitBtn" title="全体を表示">全体表示</button>
          <button class="mini-btn" id="panBtn" data-tool="pan" title="表示を動かす (H)">✋ 移動</button>
          <span class="spacer"></span>
          <button class="mini-btn on" id="guideBtn" title="下敷きの表示を切り替え">下敷き：ON</button>
          ${cfg.guides.length > 1 ? `<select class="guide-select" id="guideSelect" aria-label="下敷きの種類">${guideOptions}</select>` : ""}
        </div>
        <div class="canvas-viewport" id="viewport">
          <div class="canvas-stage" id="stage">
            <canvas id="drawCanvas"></canvas>
            <canvas id="guideCanvas"></canvas>
          </div>
        </div>
        <div class="canvas-caption">サイズ：${cfg.width} × ${cfg.height} px（固定）／「＋」「－」で拡大縮小、「移動」で表示を動かせます</div>
        <div class="guide-legend" id="guideLegend"></div>

        <div class="card" style="width:100%;">
          <h2>ツール</h2>
          <div class="tool-grid" id="toolGrid">
            <div class="tool-btn active" data-tool="pen" title="ペン (B)"><span class="ic">✏️</span><span>ペン</span></div>
            <div class="tool-btn" data-tool="eraser" title="消しゴム (E)"><span class="ic">🧽</span><span>消しゴム</span></div>
            <div class="tool-btn" data-tool="eyedropper" title="スポイト (I)"><span class="ic">💧</span><span>スポイト</span></div>
            <div class="tool-btn" data-tool="line" title="直線 (L)"><span class="ic">📏</span><span>直線</span></div>
            <div class="tool-btn" data-tool="rect" title="四角 (R)"><span class="ic">⬜</span><span>四角</span></div>
            <div class="tool-btn" data-tool="circle" title="円 (C)"><span class="ic">⭕</span><span>円</span></div>
            <div class="tool-btn" data-tool="diamond" title="ひし形 (D)"><span class="ic">🔷</span><span>ひし形</span></div>
            <div class="tool-btn" data-tool="fill" title="塗りつぶし (F)"><span class="ic">🪣</span><span>塗りつぶし</span></div>
          </div>

          <p class="hint" style="margin-top:0.6rem;">図形ツールは始点から終点へドラッグして描きます。色は選択中のカラーが使われます（正方形・正円にしたい時は同じ幅・高さでドラッグ）。</p>
          <p class="hint" style="margin-top:0.3rem;">塗りつぶしは、クリックしたマスと同じ色でつながっている範囲（上下左右）を選択中の色で塗ります。斜めの線や円で囲んだ内側も、はみ出さずに塗れます。透明の部分も塗れます。</p>

          <div class="action-row" style="margin-top:0.6rem;">
            <button class="mini-btn" id="undoBtn" title="元に戻す (Ctrl+Z)">↩ 元に戻す</button>
            <button class="mini-btn" id="redoBtn" title="やり直し (Ctrl+Y)">やり直し ↪</button>
            <button class="mini-btn danger" id="clearBtn" title="全消去">🗑 全消去</button>
          </div>

          <div class="toggle-row" style="margin-top:0.7rem;">
            <input type="checkbox" id="gridToggle" checked>
            <label for="gridToggle" style="margin:0;font-weight:400;cursor:pointer;">グリッド線を表示</label>
          </div>
        </div>
      </div>

      <div class="panel-col">
        <div class="card">
          <h2>カラー</h2>
          <div class="picker-sv" id="svWrap">
            <canvas id="svCanvas" width="240" height="180"></canvas>
            <div class="picker-cursor" id="svCursor"></div>
          </div>
          <div class="slider-block" style="margin-top:0.7rem;">
            <div class="slider-label"><span>色相</span><span id="hueVal">0°</span></div>
            <input type="range" class="hue-range" id="hueRange" min="0" max="360" value="0">
          </div>
          <div class="slider-block" style="margin-top:0.6rem;">
            <div class="slider-label"><span>不透明度（アルファ）</span><span id="alphaVal">100%</span></div>
            <div class="alpha-track">
              <div class="alpha-fill" id="alphaFill"></div>
              <input type="range" class="alpha-range" id="alphaRange" min="0" max="100" value="100">
            </div>
          </div>
          <div class="color-readout" style="margin-top:0.8rem;">
            <div class="swatch-preview"><div class="fill" id="previewFill"></div></div>
            <div class="hex-field">
              <label for="hexInput">HEX</label>
              <input type="text" id="hexInput" maxlength="7" autocomplete="off" spellcheck="false" value="#000000">
            </div>
          </div>
          <div style="margin-top:0.9rem;">
            <div class="recent-title">最近使った色</div>
            <div class="recent-swatches" id="recentSwatches"></div>
          </div>
        </div>

        ${cfg.samples.length ? `
        <div class="card">
          <h2>サンプル</h2>
          <div class="action-row">
            <select class="guide-select" id="sampleSelect" aria-label="サンプルの種類" style="flex:1 1 auto;">${sampleOptions}</select>
            <button class="btn-primary" id="sampleBtn">サンプルを読み込む</button>
          </div>
          <p class="hint">部位ごとに色分けした下絵です。読み込んでからそのまま編集・書き出しできます。</p>
        </div>` : ""}

        <div class="card">
          <h2>読み込み（PNG）</h2>
          <div class="import-mode">
            <label><input type="radio" name="importMode" value="cover" checked> 中央クロップ（はみ出し切り取り）</label>
            <label><input type="radio" name="importMode" value="contain"> 全体を収める</label>
            <label><input type="radio" name="importMode" value="topleft"> 左上に原寸で置く</label>
          </div>
          <div class="action-row" style="margin-top:0.7rem;">
            <button class="btn-primary" id="importBtn">🖼 PNGを読み込む</button>
          </div>
          <input type="file" id="fileInput" accept="image/png,image/*" style="display:none;">
          <p class="hint">${cfg.width}×${cfg.height}px の画像はそのまま読み込みます。それ以外のサイズは ${cfg.width}×${cfg.height}px に変換されます（ドット感を保つ補間なし）。</p>
        </div>

        <div class="card">
          <h2>書き出し</h2>
          <div class="export-row">
            <button class="btn-primary" id="exportBtn">💾 透過PNGで書き出し</button>
          </div>
          <div class="field" style="margin-top:0.7rem;">
            <label for="fileNameInput">ファイル名</label>
            <input type="text" id="fileNameInput" value="${cfg.fileName}" autocomplete="off" spellcheck="false">
          </div>
          <p class="hint">出力は実寸 ${cfg.width}×${cfg.height}px・アンチエイリアスなし。描いていない/消した部分は透明（アルファ0）で保存されます。下敷きは書き出しに含まれません。</p>
        </div>
      </div>
    </div>`;
  }

  // ── 本体 ──
  function init(cfg) {
    cfg = Object.assign({ fileName: "my_texture", guides: [], samples: [], guideNote: "" }, cfg);
    const W = cfg.width, H = cfg.height;
    cfg.root.innerHTML = buildMarkup(cfg);

    // 画素データ：RGBA を1マス4バイトで保持（アルファ0＝透明）
    let pixels = new Uint8ClampedArray(W * H * 4);
    let currentTool = "pen";
    let showGrid = true;
    let showGuide = true;
    let guideIndex = 0;
    let cellPx = 10;            // 表示上の1マスのサイズ（px）

    // カラー状態（HSV + アルファ）
    let hue = 0, sat = 1, val = 0, alpha = 255;
    let recentColors = [];
    const undoStack = [];
    const redoStack = [];

    // 描画中の状態
    let isDrawing = false;
    let lastCell = null;
    let shapeStart = null;
    let shapeBase = null;
    let panStart = null;

    // ── DOM ──
    const $ = id => document.getElementById(id);
    const viewport = $("viewport");
    const stage = $("stage");
    const drawCanvas = $("drawCanvas");
    const ctx = drawCanvas.getContext("2d");
    const guideCanvas = $("guideCanvas");
    const gctx = guideCanvas.getContext("2d");
    const svCanvas = $("svCanvas");
    const svCtx = svCanvas.getContext("2d");
    const svWrap = $("svWrap");
    const svCursor = $("svCursor");
    const hueRange = $("hueRange");
    const alphaRange = $("alphaRange");
    const hexInput = $("hexInput");
    const previewFill = $("previewFill");
    const alphaFill = $("alphaFill");
    const hueVal = $("hueVal");
    const alphaVal = $("alphaVal");
    const recentEl = $("recentSwatches");
    const undoBtn = $("undoBtn");
    const redoBtn = $("redoBtn");
    const guideBtn = $("guideBtn");
    const guideSelect = $("guideSelect");
    const guideLegend = $("guideLegend");

    drawCanvas.width = guideCanvas.width = W * CELL;
    drawCanvas.height = guideCanvas.height = H * CELL;

    // 実寸の作業用キャンバス（画素 → 拡大表示の受け渡しに使う）
    const work = document.createElement("canvas");
    work.width = W; work.height = H;
    const wctx = work.getContext("2d");

    // ── 画素アクセス ──
    function idx(x, y) { return (y * W + x) * 4; }
    function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
    function currentRgb() { return hsvToRgb(hue, sat, val); }
    function currentPaint() { const c = currentRgb(); return [c.r, c.g, c.b, alpha]; }
    function setPx(x, y, p) {
      if (!inBounds(x, y)) return;
      const i = idx(x, y);
      pixels[i] = p[0]; pixels[i + 1] = p[1]; pixels[i + 2] = p[2]; pixels[i + 3] = p[3];
    }
    function clearPx(x, y) { setPx(x, y, [0, 0, 0, 0]); }
    // 同じ色か（透明同士は色の値に関係なく同じとみなす）
    function samePx(i, p) {
      if (pixels[i + 3] === 0 && p[3] === 0) return true;
      return pixels[i] === p[0] && pixels[i + 1] === p[1] && pixels[i + 2] === p[2] && pixels[i + 3] === p[3];
    }
    function isEmpty() {
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return false;
      return true;
    }

    // ── 描画（表示） ──
    function render() {
      wctx.putImageData(new ImageData(pixels, W, H), 0, 0);
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(work, 0, 0, W * CELL, H * CELL);
      if (showGrid) drawGridLines();
    }
    function drawGridLines() {
      const DW = W * CELL, DH = H * CELL;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      for (let i = 0; i <= W; i++) { const p = i * CELL + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, DH); }
      for (let i = 0; i <= H; i++) { const p = i * CELL + 0.5; ctx.moveTo(0, p); ctx.lineTo(DW, p); }
      ctx.stroke();
      // 8マスごとの区切りを少し濃く（位置合わせの目安）
      ctx.strokeStyle = "rgba(0,0,0,0.34)";
      ctx.beginPath();
      for (let i = 0; i <= W; i += MAJOR_GRID) { const p = i * CELL + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, DH); }
      for (let i = 0; i <= H; i += MAJOR_GRID) { const p = i * CELL + 0.5; ctx.moveTo(0, p); ctx.lineTo(DW, p); }
      ctx.stroke();
      ctx.restore();
    }

    // ── 下敷き（表示専用のキャンバスに描く。画素データ・書き出しには一切関係しない） ──
    function renderGuide() {
      gctx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
      const g = cfg.guides[guideIndex];
      guideBtn.textContent = showGuide ? "下敷き：ON" : "下敷き：OFF";
      guideBtn.classList.toggle("on", showGuide);
      if (guideSelect) guideSelect.disabled = !showGuide;
      guideLegend.innerHTML = g ? (g.note || "") + (cfg.guideNote ? "<br>" + cfg.guideNote : "") : "";
      if (!showGuide || !g) return;
      gctx.save();
      for (const r of g.regions) {
        const x = r.x * CELL, y = r.y * CELL, w = r.w * CELL, h = r.h * CELL;
        const c = hexToRgb(r.color);
        gctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${GUIDE_FILL_ALPHA})`;
        gctx.fillRect(x, y, w, h);
        gctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${GUIDE_LINE_ALPHA})`;
        gctx.lineWidth = 3;
        gctx.setLineDash(r.dashed ? [8, 6] : []);
        gctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
        // 面の名前（前面は部位名）
        const size = Math.max(11, Math.min(22, Math.floor(Math.min(w / Math.max(1, r.label.length) * 0.9, h * 0.5))));
        gctx.setLineDash([]);
        gctx.font = `bold ${size}px sans-serif`;
        gctx.textAlign = "center";
        gctx.textBaseline = "middle";
        gctx.lineWidth = 3;
        gctx.strokeStyle = `rgba(255,255,255,${GUIDE_TEXT_ALPHA})`;
        gctx.fillStyle = `rgba(${Math.round(c.r * 0.6)},${Math.round(c.g * 0.6)},${Math.round(c.b * 0.6)},${GUIDE_TEXT_ALPHA})`;
        gctx.strokeText(r.label, x + w / 2, y + h / 2);
        gctx.fillText(r.label, x + w / 2, y + h / 2);
      }
      gctx.restore();
    }

    // ── 表示サイズ（拡大縮小） ──
    function applyZoom() {
      stage.style.width = (W * cellPx) + "px";
      stage.style.height = (H * cellPx) + "px";
      const chk = cellPx * 2; // 市松模様は2マスで1周期
      stage.style.backgroundSize = `${chk}px ${chk}px`;
      stage.style.backgroundPosition = `0 0, 0 ${chk / 2}px, ${chk / 2}px -${chk / 2}px, -${chk / 2}px 0`;
      $("zoomVal").textContent = Math.round(cellPx * 10) + "%";
    }
    function fitCellPx() {
      const vw = viewport.clientWidth - 2;
      const vh = Math.max(200, Math.min(window.innerHeight * 0.7, viewport.clientWidth * 1.2));
      return Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.floor(Math.min(vw / W, vh / H))));
    }
    function zoomTo(px, cx, cy) {
      // 画面上の基準点（cx,cy）がずれないように拡大縮小する
      const rect = viewport.getBoundingClientRect();
      const ox = (cx === undefined ? rect.width / 2 : cx - rect.left);
      const oy = (cy === undefined ? rect.height / 2 : cy - rect.top);
      const fx = (viewport.scrollLeft + ox) / (W * cellPx);
      const fy = (viewport.scrollTop + oy) / (H * cellPx);
      cellPx = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, px));
      applyZoom();
      viewport.scrollLeft = fx * W * cellPx - ox;
      viewport.scrollTop = fy * H * cellPx - oy;
    }
    $("zoomInBtn").addEventListener("click", () => zoomTo(Math.max(cellPx + 1, Math.round(cellPx * ZOOM_STEP))));
    $("zoomOutBtn").addEventListener("click", () => zoomTo(Math.min(cellPx - 1, Math.round(cellPx / ZOOM_STEP))));
    $("zoomFitBtn").addEventListener("click", () => zoomTo(fitCellPx()));
    // Ctrl（Mac は ⌘）＋ホイールで拡大縮小
    viewport.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const next = e.deltaY < 0 ? Math.max(cellPx + 1, Math.round(cellPx * ZOOM_STEP))
                                : Math.min(cellPx - 1, Math.round(cellPx / ZOOM_STEP));
      zoomTo(next, e.clientX, e.clientY);
    }, { passive: false });

    // ── 座標変換（画面座標→マス） ──
    function eventToCell(e) {
      const rect = drawCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (rect.width / W));
      const y = Math.floor((e.clientY - rect.top) / (rect.height / H));
      if (!inBounds(x, y)) return null;
      return { x: x, y: y };
    }
    // 範囲内に収める（図形のドラッグで端まで届くように）
    function eventToCellClamped(e) {
      const rect = drawCanvas.getBoundingClientRect();
      let x = Math.floor((e.clientX - rect.left) / (rect.width / W));
      let y = Math.floor((e.clientY - rect.top) / (rect.height / H));
      x = Math.min(W - 1, Math.max(0, x));
      y = Math.min(H - 1, Math.max(0, y));
      return { x: x, y: y };
    }

    // ── 描画操作 ──
    function applyAt(cell) {
      if (!cell) return;
      if (currentTool === "pen") setPx(cell.x, cell.y, currentPaint());
      else if (currentTool === "eraser") clearPx(cell.x, cell.y);
      else if (currentTool === "eyedropper") pickColorFrom(cell.x, cell.y);
      render();
    }
    // ペン・消しゴムを速く動かしても途切れないよう、前回のマスから直線で補う
    function strokeTo(a, b) {
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
      let err = dx - dy, x = a.x, y = a.y;
      const p = currentPaint();
      while (true) {
        if (currentTool === "pen") setPx(x, y, p); else clearPx(x, y);
        if (x === b.x && y === b.y) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      render();
    }

    // ── 図形ツール（枠線のみ） ──
    const SHAPE_TOOLS = ["line", "rect", "circle", "diamond"];
    function isShapeTool(t) { return SHAPE_TOOLS.indexOf(t) !== -1; }
    function setPixel(x, y) { setPx(x, y, currentPaint()); }
    function drawShape(a, b) {
      if (currentTool === "line") drawLine(a.x, a.y, b.x, b.y);
      else if (currentTool === "rect") drawRect(a.x, a.y, b.x, b.y);
      else if (currentTool === "circle") drawMembership(a.x, a.y, b.x, b.y, ellipseInside);
      else if (currentTool === "diamond") drawMembership(a.x, a.y, b.x, b.y, diamondInside);
    }
    // 直線（ブレゼンハム）
    function drawLine(x0, y0, x1, y1) {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      while (true) {
        setPixel(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }
    // 四角（外周のみ）
    function drawRect(x0, y0, x1, y1) {
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      for (let x = xa; x <= xb; x++) { setPixel(x, ya); setPixel(x, yb); }
      for (let y = ya; y <= yb; y++) { setPixel(xa, y); setPixel(xb, y); }
    }
    // 図形内かどうかの判定から、外周（内側かつ上下左右に外側があるマス）を描く
    function drawMembership(x0, y0, x1, y1, makeInside) {
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      const cx = (xa + xb + 1) / 2, cy = (ya + yb + 1) / 2;
      const rx = (xb - xa + 1) / 2, ry = (yb - ya + 1) / 2;
      const inside = makeInside(cx, cy, rx, ry);
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          if (!inside(x, y)) continue;
          if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
            setPixel(x, y);
          }
        }
      }
    }
    function ellipseInside(cx, cy, rx, ry) {
      return (x, y) => {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        return nx * nx + ny * ny <= 1;
      };
    }
    function diamondInside(cx, cy, rx, ry) {
      return (x, y) => {
        const nx = Math.abs(x + 0.5 - cx) / rx, ny = Math.abs(y + 0.5 - cy) / ry;
        return nx + ny <= 1;
      };
    }

    // ── 塗りつぶし ──
    // クリックしたマスと同じ色（透明も1つの色として扱う）で、上下左右の4マスでつながっている範囲を塗る（斜めの線や円の枠からはみ出さない）
    function floodFill(sx, sy) {
      const si = idx(sx, sy);
      const target = [pixels[si], pixels[si + 1], pixels[si + 2], pixels[si + 3]];
      const paint = currentPaint();
      // 塗る色と同じなら何もしない
      if ((target[3] === 0 && paint[3] === 0) ||
          (target[0] === paint[0] && target[1] === paint[1] && target[2] === paint[2] && target[3] === paint[3])) {
        return false;
      }
      const visited = new Uint8Array(W * H);
      const stack = [sx, sy];
      visited[sy * W + sx] = 1;
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        setPx(x, y, paint);
        for (const [dx, dy] of NEIGHBORS_4) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const k = ny * W + nx;
          if (visited[k] || !samePx(k * 4, target)) continue;
          visited[k] = 1;
          stack.push(nx, ny);
        }
      }
      return true;
    }

    function pickColorFrom(x, y) {
      const i = idx(x, y);
      if (pixels[i + 3] === 0) return; // 透明はスポイト対象外
      const hsv = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);
      hue = hsv.h; sat = hsv.s; val = hsv.v; alpha = pixels[i + 3];
      syncColorUI();
      setTool("pen"); // スポイト後はペンに戻す
    }

    // ── 元に戻す／やり直し（画素データのスナップショット） ──
    function pushSnapshot(snap) {
      undoStack.push(snap);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack.length = 0;
      updateUndoButtons();
    }
    function pushUndo() { pushSnapshot(pixels.slice()); }
    function updateUndoButtons() {
      undoBtn.disabled = undoStack.length === 0;
      redoBtn.disabled = redoStack.length === 0;
    }
    function undo() {
      if (!undoStack.length) return;
      redoStack.push(pixels.slice());
      pixels = undoStack.pop();
      render();
      updateUndoButtons();
    }
    function redo() {
      if (!redoStack.length) return;
      undoStack.push(pixels.slice());
      pixels = redoStack.pop();
      render();
      updateUndoButtons();
    }

    // ── ポインタ操作（マウス＆タッチ共通） ──
    drawCanvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { drawCanvas.setPointerCapture(e.pointerId); } catch (_) {}

      // 移動ツール：表示をドラッグで動かす
      if (currentTool === "pan") {
        panStart = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
        return;
      }
      const cell = eventToCell(e);
      if (!cell) return;

      if (currentTool === "eyedropper") { applyAt(cell); return; }

      // 塗りつぶしは1クリック＝1操作。変化がなければ履歴に残さない
      if (currentTool === "fill") {
        const snap = pixels.slice();
        if (floodFill(cell.x, cell.y)) {
          pushSnapshot(snap);
          addRecent();
          render();
        }
        return;
      }

      pushUndo(); // ストローク開始時に1回だけ保存
      isDrawing = true;
      if (isShapeTool(currentTool)) {
        shapeStart = cell;
        shapeBase = pixels.slice();
        drawShape(shapeStart, cell);
        render();
        addRecent();
      } else {
        lastCell = cell;
        applyAt(cell);
        if (currentTool === "pen") addRecent();
      }
    });
    drawCanvas.addEventListener("pointermove", (e) => {
      if (panStart) {
        viewport.scrollLeft = panStart.sl - (e.clientX - panStart.x);
        viewport.scrollTop = panStart.st - (e.clientY - panStart.y);
        return;
      }
      if (!isDrawing) return;
      if (isShapeTool(currentTool)) {
        const cell = eventToCellClamped(e);
        pixels.set(shapeBase);
        drawShape(shapeStart, cell);
        render();
      } else if (currentTool === "pen" || currentTool === "eraser") {
        const cell = eventToCell(e);
        if (!cell) return;
        if (lastCell && cell.x === lastCell.x && cell.y === lastCell.y) return;
        if (lastCell) strokeTo(lastCell, cell); else applyAt(cell);
        lastCell = cell;
      }
    });
    function endStroke() {
      panStart = null;
      if (!isDrawing) return;
      isDrawing = false;
      lastCell = null;
      shapeStart = null;
      shapeBase = null;
    }
    drawCanvas.addEventListener("pointerup", endStroke);
    drawCanvas.addEventListener("pointercancel", endStroke);
    drawCanvas.addEventListener("pointerleave", endStroke);

    // ── ツール切替 ──
    function setTool(tool) {
      currentTool = tool;
      document.querySelectorAll(".tool-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.tool === tool);
      });
      $("panBtn").classList.toggle("on", tool === "pan");
      stage.classList.toggle("panning", tool === "pan");
    }
    $("toolGrid").addEventListener("click", (e) => {
      const btn = e.target.closest(".tool-btn");
      if (btn) setTool(btn.dataset.tool);
    });
    $("panBtn").addEventListener("click", () => setTool(currentTool === "pan" ? "pen" : "pan"));

    // ── 全消去・グリッド・下敷き ──
    $("clearBtn").addEventListener("click", () => {
      if (!confirm("キャンバスを全消去しますか？")) return;
      pushUndo();
      pixels.fill(0);
      render();
    });
    $("gridToggle").addEventListener("change", (e) => {
      showGrid = e.target.checked;
      render();
    });
    guideBtn.addEventListener("click", () => {
      showGuide = !showGuide;
      renderGuide();
    });
    if (guideSelect) {
      guideSelect.addEventListener("change", () => {
        guideIndex = parseInt(guideSelect.value, 10) || 0;
        renderGuide();
      });
    }
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);

    // ── サンプル読み込み ──
    if (cfg.samples.length) {
      $("sampleBtn").addEventListener("click", () => {
        const s = cfg.samples[parseInt($("sampleSelect").value, 10) || 0];
        if (!isEmpty() && !confirm("サンプルを読み込むと、今描いている内容は消えます（「元に戻す」で戻せます）。読み込みますか？")) return;
        pushUndo();
        pixels.fill(0);
        paintSample(s);
        render();
        // サンプルに対応する下敷きがあれば合わせて切り替える
        if (typeof s.guide === "number" && guideSelect) {
          guideIndex = s.guide;
          guideSelect.value = String(s.guide);
          renderGuide();
        }
      });
    }
    // 部位ごとに色分けして塗る（前面は明るく、上は少し明るく、下と後ろは暗く）
    function paintSample(s) {
      const FACE_SHADE = { "上": 1.12, "下": 0.72, "右": 0.86, "左": 0.86, "後": 0.78 };
      for (const r of s.regions) {
        const k = r.front ? 1.0 : (FACE_SHADE[r.label] || 1.0);
        const c = shade(r.color, k);
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) setPx(x, y, [c.r, c.g, c.b, 255]);
        }
      }
      // 追加の点描き（目など）
      (s.dots || []).forEach(d => {
        const c = hexToRgb(d.color);
        setPx(d.x, d.y, [c.r, c.g, c.b, 255]);
      });
    }

    // ── カラーピッカー ──
    function drawSV() {
      const w = svCanvas.width, h = svCanvas.height;
      const base = hsvToRgb(hue, 1, 1);
      const gx = svCtx.createLinearGradient(0, 0, w, 0);
      gx.addColorStop(0, "#ffffff");
      gx.addColorStop(1, `rgb(${base.r},${base.g},${base.b})`);
      svCtx.fillStyle = gx;
      svCtx.fillRect(0, 0, w, h);
      const gy = svCtx.createLinearGradient(0, 0, 0, h);
      gy.addColorStop(0, "rgba(0,0,0,0)");
      gy.addColorStop(1, "rgba(0,0,0,1)");
      svCtx.fillStyle = gy;
      svCtx.fillRect(0, 0, w, h);
    }
    function updateSVCursor() {
      svCursor.style.left = (sat * 100) + "%";
      svCursor.style.top = ((1 - val) * 100) + "%";
      const rgb = currentRgb();
      svCursor.style.background = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    }
    let svDragging = false;
    function svPick(e) {
      const rect = svWrap.getBoundingClientRect();
      sat = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      val = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      syncColorUI();
    }
    svWrap.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      svDragging = true;
      svPick(e);
      try { svWrap.setPointerCapture(e.pointerId); } catch (_) {}
    });
    svWrap.addEventListener("pointermove", (e) => { if (svDragging) svPick(e); });
    svWrap.addEventListener("pointerup", () => { svDragging = false; });
    svWrap.addEventListener("pointercancel", () => { svDragging = false; });
    hueRange.addEventListener("input", (e) => { hue = parseInt(e.target.value, 10); syncColorUI(); });
    alphaRange.addEventListener("input", (e) => {
      alpha = Math.round(parseInt(e.target.value, 10) / 100 * 255);
      syncColorUI();
    });
    hexInput.addEventListener("input", (e) => {
      const rgb = hexToRgb(e.target.value);
      if (!rgb) return;
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hue = hsv.h; sat = hsv.s; val = hsv.v;
      syncColorUI(true); // HEX入力中は自分自身を上書きしない
    });
    function syncColorUI(skipHex) {
      drawSV();
      updateSVCursor();
      const rgb = currentRgb();
      const aPct = Math.round(alpha / 255 * 100);
      previewFill.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${(alpha / 255).toFixed(3)})`;
      hueRange.value = Math.round(hue);
      alphaRange.value = aPct;
      hueVal.textContent = Math.round(hue) + "°";
      alphaVal.textContent = aPct + "%";
      alphaFill.style.background =
        `linear-gradient(to right, rgba(${rgb.r},${rgb.g},${rgb.b},0), rgba(${rgb.r},${rgb.g},${rgb.b},1))`;
      if (!skipHex) hexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    // ── 最近使った色 ──
    function addRecent() {
      const rgb = currentRgb();
      const key = `${rgb.r},${rgb.g},${rgb.b},${alpha}`;
      recentColors = recentColors.filter(c => c.key !== key);
      recentColors.unshift({ key, r: rgb.r, g: rgb.g, b: rgb.b, a: alpha });
      if (recentColors.length > MAX_RECENT) recentColors.pop();
      renderRecent();
    }
    function renderRecent() {
      recentEl.innerHTML = "";
      if (recentColors.length === 0) {
        recentEl.innerHTML = '<span style="font-size:0.72rem;color:var(--color-text-muted);">まだありません</span>';
        return;
      }
      recentColors.forEach(c => {
        const sw = document.createElement("div");
        sw.className = "recent-sw";
        sw.title = rgbToHex(c.r, c.g, c.b) + ` / α${Math.round(c.a / 255 * 100)}%`;
        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.background = `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
        sw.appendChild(fill);
        sw.addEventListener("click", () => {
          const hsv = rgbToHsv(c.r, c.g, c.b);
          hue = hsv.h; sat = hsv.s; val = hsv.v; alpha = c.a;
          syncColorUI();
        });
        recentEl.appendChild(sw);
      });
    }

    // ── PNG 読み込み ──
    const fileInput = $("fileInput");
    $("importBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        importImage(img);
        URL.revokeObjectURL(url);
        fileInput.value = ""; // 同じファイルを再選択できるように
      };
      img.onerror = () => {
        alert("画像の読み込みに失敗しました。");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    function importImage(img) {
      const mode = document.querySelector('input[name="importMode"]:checked').value;
      const tmp = document.createElement("canvas");
      tmp.width = W; tmp.height = H;
      const tctx = tmp.getContext("2d");
      tctx.imageSmoothingEnabled = false;
      tctx.clearRect(0, 0, W, H);
      const iw = img.width, ih = img.height;
      if ((iw === W && ih === H) || mode === "topleft") {
        // 同じサイズ、または「左上に原寸で置く」：拡大縮小しない
        tctx.drawImage(img, 0, 0);
      } else if (mode === "cover") {
        // 中央クロップ：キャンバスの縦横比で中央を切り出す
        const scale = Math.max(W / iw, H / ih);
        const sw = W / scale, sh = H / scale;
        tctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
      } else {
        // 全体を収める：中央配置（余白は透明）
        const scale = Math.min(W / iw, H / ih);
        const dw = Math.round(iw * scale), dh = Math.round(ih * scale);
        tctx.drawImage(img, 0, 0, iw, ih, Math.floor((W - dw) / 2), Math.floor((H - dh) / 2), dw, dh);
      }
      const data = tctx.getImageData(0, 0, W, H).data;
      pushUndo();
      pixels.set(data);
      // アルファ0のマスは色の値も0に揃える（透明の扱いを統一）
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; }
      }
      render();
    }

    // ── PNG 書き出し（実寸・透過。下敷き・グリッドは含めない） ──
    $("exportBtn").addEventListener("click", () => {
      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      out.getContext("2d").putImageData(new ImageData(pixels.slice(), W, H), 0, 0);
      let name = ($("fileNameInput").value || cfg.fileName).trim();
      name = name.replace(/[\\/:*?"<>|]/g, "_"); // ファイル名に使えない文字を除去
      if (!/\.png$/i.test(name)) name += ".png";
      out.toBlob((blob) => {
        if (!blob) { alert("書き出しに失敗しました。"); return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    });

    // ── キーボードショートカット ──
    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redo(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "b": setTool("pen"); break;
        case "e": setTool("eraser"); break;
        case "i": setTool("eyedropper"); break;
        case "l": setTool("line"); break;
        case "r": setTool("rect"); break;
        case "c": setTool("circle"); break;
        case "d": setTool("diamond"); break;
        case "f": setTool("fill"); break;
        case "h": setTool("pan"); break;
      }
    });

    // ── 初期化 ──
    syncColorUI();
    renderRecent();
    cellPx = fitCellPx();
    applyZoom();
    render();
    renderGuide();
    updateUndoButtons();

    // 動作確認用の窓口（画面の操作には使わない）
    return {
      getPixels: () => pixels.slice(),
      setTool: setTool,
      getCellPx: () => cellPx,
    };
  }

  window.PixelEditorCore = { init: init, boxRegions: boxRegions };
})();

// ==============================================================================
// ATLAS DE SECAS DO RJ - MÓDULO DO MAPA (LEAFLET + CANVAS)
// NASA Science Climate Interactives Theme
// Paleta RdBu, Camadas de Alta Resolução e Textura Hachurada para Projeções ARIMA
// ==============================================================================

class DroughtMap {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.options = options;
    this.map = null;
    this.canvas = null;
    this.ctx = null;
    this.pixels = [];            // Metadados dos 1.746 pixels
    this.muniGeojson = null;     // Camada GeoJSON de alta resolução dos 92 municípios
    this.stateGeojson = null;    // Camada GeoJSON dos estados (RJ, SP, MG, ES)
    this.muniLayersByCode = {};  // Indexação por code_muni
    this.highlightedMuni = null; // Destaque vetorial do município ativo (halo externo)
    this.highlightedMuniInner = null; // Linha interna neon
    this.currentMonthIdx = 548;  // Índice inicial: último mês observado
    this.currentScaleData = [];  // Matriz de dados para a escala ativa
    this.nHistoricalCutoff = 549; // Ponto de transição entre observado e previsão
    this.selectedPixelId = null; // ID do pixel selecionado (0 a 1745)
    this.hoveredPixel = null;
    this.tooltip = null;
    this.resolutionDeg = 0.05;   // Resolução nativa CHIRPS v3
    this.hatchPatternCache = {}; // Cache de padrões hachurados para renderização de alta performance

    this.onPixelClick = options.onPixelClick || function() {};
  }

  init() {
    // Inicializar mapa centrado no Estado do Rio de Janeiro
    this.map = L.map(this.containerId, {
      center: [-22.25, -42.80],
      zoom: 8,
      minZoom: 7,
      maxZoom: 13,
      zoomControl: true
    });

    // Camada Base Esri World Dark Gray Canvas
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 16
    }).addTo(this.map);

    // Painéis Leaflet com controle rigoroso de z-index
    this.map.createPane("pixelsPane");
    this.map.getPane("pixelsPane").style.zIndex = "400";

    this.map.createPane("muniPane");
    const muniPaneEl = this.map.getPane("muniPane");
    muniPaneEl.style.zIndex = "450";
    muniPaneEl.style.pointerEvents = "none";

    this.map.createPane("statePane");
    const statePaneEl = this.map.getPane("statePane");
    statePaneEl.style.zIndex = "500";
    statePaneEl.style.pointerEvents = "none";

    this.map.createPane("highlightPane");
    const highlightPaneEl = this.map.getPane("highlightPane");
    highlightPaneEl.style.zIndex = "550";
    highlightPaneEl.style.pointerEvents = "none";

    this.initCanvasOverlay();

    this.map.on("move", () => this.draw());
    this.map.on("zoom", () => {
      this.hatchPatternCache = {}; // Limpar cache para regenerar no novo nível de zoom se necessário
      this.draw();
    });
    this.map.on("resize", () => {
      this.resizeCanvas();
      this.draw();
    });

    this.tooltip = L.tooltip({
      sticky: true,
      className: "custom-map-tooltip",
      direction: "top",
      offset: [0, -10]
    });

    this.initMouseInteractions();
  }

  initCanvasOverlay() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.pointerEvents = "auto";
    this.map.getPane("pixelsPane").appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.resizeCanvas();
  }

  resizeCanvas() {
    const size = this.map.getSize();
    this.canvas.width = size.x;
    this.canvas.height = size.y;
    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
  }

  // Gera ou recupera padrão de hachura diagonal para distinguir projeções (ARIMA) de observações
  getHatchPattern(color) {
    if (this.hatchPatternCache[color]) return this.hatchPatternCache[color];

    const pSize = 14;
    const pCanvas = document.createElement("canvas");
    pCanvas.width = pSize;
    pCanvas.height = pSize;
    const pCtx = pCanvas.getContext("2d");

    // Fundo colorido semitranslúcido
    pCtx.fillStyle = color;
    pCtx.fillRect(0, 0, pSize, pSize);

    // Linha diagonal escura (sombra / contraste)
    pCtx.strokeStyle = "rgba(0, 0, 0, 0.42)";
    pCtx.lineWidth = 2.4;
    pCtx.beginPath();
    pCtx.moveTo(0, pSize);
    pCtx.lineTo(pSize, 0);
    pCtx.moveTo(-pSize / 2, pSize / 2);
    pCtx.lineTo(pSize / 2, -pSize / 2);
    pCtx.moveTo(pSize / 2, pSize + pSize / 2);
    pCtx.lineTo(pSize + pSize / 2, pSize / 2);
    pCtx.stroke();

    // Linha diagonal clara fina (brilho / textura nítida)
    pCtx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    pCtx.lineWidth = 1.0;
    pCtx.beginPath();
    pCtx.moveTo(1.2, pSize + 1.2);
    pCtx.lineTo(pSize + 1.2, 1.2);
    pCtx.stroke();

    const pat = this.ctx.createPattern(pCanvas, "repeat");
    this.hatchPatternCache[color] = pat;
    return pat;
  }

  initMouseInteractions() {
    const container = this.map.getContainer();

    container.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const mousePoint = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const latlng = this.map.containerPointToLatLng(mousePoint);

      const hitPixel = this.findPixelAtLatLng(latlng.lat, latlng.lng);
      if (hitPixel !== this.hoveredPixel) {
        this.hoveredPixel = hitPixel;
        if (hitPixel) {
          const val = this.getPixelValue(hitPixel.id);
          const cat = this.getCategory(val);
          const isForecast = this.currentMonthIdx >= (this.nHistoricalCutoff || 549);
          const statusTag = isForecast ? 
            `<span style="background: rgba(250, 204, 21, 0.2); color: #facc15; font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(250, 204, 21, 0.4); margin-left: 4px;">PROJEÇÃO ARIMA</span>` : 
            `<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">OBSERVADO</span>`;

          const content = `
            <div style="font-family: 'Public Sans', 'Inter', -apple-system, sans-serif; font-size: 11px; line-height: 1.45; background: rgba(7, 10, 18, 0.96); color: #fff; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <strong style="color: #00b4d8; font-size: 12px;">${hitPixel.muni_name}</strong>
                ${statusTag}
              </div>
              <div style="color: #94a3b8; font-family: monospace;">Coord: ${hitPixel.lat.toFixed(3)}°, ${hitPixel.lon.toFixed(3)}°</div>
              <div style="margin-top: 2px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${cat.color}; margin-right: 4px;"></span>
                <strong style="color: #fff;">SPEI: ${val !== null ? (val > 0 ? "+" : "") + val.toFixed(2) : "S/D"}</strong>
                <span style="color: #cbd5e1;"> (${cat.label})</span>
              </div>
            </div>
          `;
          this.tooltip.setLatLng(latlng).setContent(content);
          if (!this.map.hasLayer(this.tooltip)) {
            this.tooltip.addTo(this.map);
          }
          container.style.cursor = "pointer";
        } else {
          this.map.removeLayer(this.tooltip);
          container.style.cursor = "";
        }
      }
    });

    container.addEventListener("click", (e) => {
      const rect = container.getBoundingClientRect();
      const mousePoint = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const latlng = this.map.containerPointToLatLng(mousePoint);

      const hitPixel = this.findPixelAtLatLng(latlng.lat, latlng.lng);
      if (hitPixel) {
        this.selectPixel(hitPixel.id);
        this.onPixelClick(hitPixel);
      }
    });
  }

  findPixelAtLatLng(lat, lon) {
    const halfRes = this.resolutionDeg / 2;
    for (let i = 0; i < this.pixels.length; i++) {
      const p = this.pixels[i];
      if (
        Math.abs(p.lat - lat) <= halfRes &&
        Math.abs(p.lon - lon) <= halfRes
      ) {
        return p;
      }
    }
    return null;
  }

  loadData(pixels, muniGeojson, stateGeojson) {
    this.pixels = pixels;
    this.muniGeojson = muniGeojson;
    this.stateGeojson = stateGeojson;

    if (stateGeojson) {
      L.geoJSON(stateGeojson, {
        pane: "statePane",
        style: (feature) => {
          const isRJ = feature.properties.code_state === 33 || feature.properties.abbrev_state === "RJ";
          if (isRJ) {
            return {
              color: "#ffffff",
              weight: 2.2,
              fillColor: "transparent",
              fillOpacity: 0
            };
          } else {
            return {
              color: "rgba(148, 163, 184, 0.6)",
              weight: 1.2,
              dashArray: "3, 4",
              fillColor: "transparent",
              fillOpacity: 0
            };
          }
        }
      }).addTo(this.map);
    }

    if (muniGeojson) {
      L.geoJSON(muniGeojson, {
        pane: "muniPane",
        style: {
          color: "rgba(255, 255, 255, 0.35)",
          weight: 0.85,
          fillColor: "transparent",
          fillOpacity: 0
        },
        onEachFeature: (feature, layer) => {
          this.muniLayersByCode[String(feature.properties.code_muni)] = layer;
        }
      }).addTo(this.map);
    }

    this.draw();
  }

  setScaleData(dataMatrix, nHist = null) {
    this.currentScaleData = dataMatrix;
    if (nHist) this.nHistoricalCutoff = nHist;
    this.draw();
  }

  setMonthIndex(monthIdx) {
    this.currentMonthIdx = monthIdx;
    this.draw();
  }

  selectPixel(pixelId) {
    this.selectedPixelId = pixelId;
    this.draw();
  }

  selectMunicipality(codeMuni) {
    if (this.highlightedMuni) {
      this.map.removeLayer(this.highlightedMuni);
      this.highlightedMuni = null;
    }
    if (this.highlightedMuniInner) {
      this.map.removeLayer(this.highlightedMuniInner);
      this.highlightedMuniInner = null;
    }

    if (!codeMuni || codeMuni === "ALL") {
      this.map.setView([-22.25, -42.80], 8);
      return;
    }

    const layer = this.muniLayersByCode[String(codeMuni)];
    if (layer) {
      this.highlightedMuni = L.geoJSON(layer.feature, {
        pane: "highlightPane",
        style: {
          color: "#000000",
          weight: 5.5,
          opacity: 0.9,
          fillColor: "rgba(250, 204, 21, 0.12)",
          fillOpacity: 1
        }
      }).addTo(this.map);

      this.highlightedMuniInner = L.geoJSON(layer.feature, {
        pane: "highlightPane",
        style: {
          color: "#facc15",
          weight: 2.8,
          opacity: 1,
          dashArray: "6, 4",
          fillColor: "transparent",
          fillOpacity: 0
        }
      }).addTo(this.map);

      this.map.fitBounds(layer.getBounds(), {
        padding: [40, 40],
        maxZoom: 11,
        animate: true
      });
    }
  }

  getPixelValue(pixelId) {
    if (!this.currentScaleData || !this.currentScaleData[pixelId]) return null;
    const val = this.currentScaleData[pixelId][this.currentMonthIdx];
    return val !== undefined && val !== null ? val : null;
  }

  getColor(val) {
    if (val === null || val === undefined || isNaN(val)) return "rgba(100, 116, 139, 0.25)";

    if (val <= -2.00) return "#67001f"; // Seca Excepcional
    if (val <= -1.60) return "#b2182b"; // Seca Extrema
    if (val <= -1.30) return "#d6604d"; // Seca Severa
    if (val <= -0.80) return "#f4a582"; // Seca Moderada
    if (val <= -0.50) return "#fddbc7"; // Anormalmente Seco
    if (val <   0.50) return "#f7f7f7"; // Normalidade
    if (val <   0.80) return "#d1e5f0"; // Levemente Úmido
    if (val <   1.30) return "#92c5de"; // Moderadamente Úmido
    if (val <   1.60) return "#4393c3"; // Muito Úmido
    if (val <   2.00) return "#2166ac"; // Extremamente Úmido
    return "#053061";                   // Excepcionalmente Úmido
  }

  getCategory(val) {
    if (val === null || val === undefined || isNaN(val)) return { label: "Sem Dados", color: "#64748b" };
    if (val <= -2.00) return { label: "Seca Excepcional", color: "#67001f" };
    if (val <= -1.60) return { label: "Seca Extrema", color: "#b2182b" };
    if (val <= -1.30) return { label: "Seca Severa", color: "#d6604d" };
    if (val <= -0.80) return { label: "Seca Moderada", color: "#f4a582" };
    if (val <= -0.50) return { label: "Anormalmente Seco", color: "#fddbc7" };
    if (val <   0.50) return { label: "Normalidade", color: "#f8fafc" };
    if (val <   0.80) return { label: "Levemente Úmido", color: "#d1e5f0" };
    if (val <   1.30) return { label: "Moderadamente Úmido", color: "#92c5de" };
    if (val <   1.60) return { label: "Muito Úmido", color: "#4393c3" };
    if (val <   2.00) return { label: "Extremamente Úmido", color: "#2166ac" };
    return { label: "Excepcionalmente Úmido", color: "#053061" };
  }

  draw() {
    if (!this.canvas || !this.map || this.pixels.length === 0) return;

    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const p1 = this.map.latLngToContainerPoint([-22.0, -42.0]);
    const p2 = this.map.latLngToContainerPoint([-22.0 + this.resolutionDeg, -42.0 + this.resolutionDeg]);
    const w = Math.ceil(Math.abs(p2.x - p1.x)) + 1;
    const h = Math.ceil(Math.abs(p2.y - p1.y)) + 1;

    let selectedPt = null;
    const isForecast = this.currentMonthIdx >= (this.nHistoricalCutoff || 549);

    // Renderizar todos os pixels
    for (let i = 0; i < this.pixels.length; i++) {
      const p = this.pixels[i];
      const pt = this.map.latLngToContainerPoint([p.lat, p.lon]);

      if (pt.x < -w || pt.x > this.canvas.width + w || pt.y < -h || pt.y > this.canvas.height + h) {
        continue;
      }

      const val = this.getPixelValue(p.id);
      const color = this.getColor(val);
      const px = Math.floor(pt.x - w / 2);
      const py = Math.floor(pt.y - h / 2);

      if (isForecast) {
        // Modo Previsão: preenchimento com padrão de hachuras diagonais (listras na diagonal)
        ctx.fillStyle = this.getHatchPattern(color);
        ctx.fillRect(px, py, w, h);

        // Borda sutil para delimitar as células projetadas
        ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, w, h);
      } else {
        // Modo Observado: sólido de alta fidelidade
        ctx.fillStyle = color;
        ctx.fillRect(px, py, w, h);
      }

      if (p.id === this.selectedPixelId) {
        selectedPt = { x: pt.x, y: pt.y, w: w, h: h };
      }
    }

    // Destaque do pixel selecionado com halo de alto contraste
    if (selectedPt) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 4;
      ctx.strokeRect(
        Math.floor(selectedPt.x - selectedPt.w / 2) - 2,
        Math.floor(selectedPt.y - selectedPt.h / 2) - 2,
        selectedPt.w + 4,
        selectedPt.h + 4
      );

      ctx.strokeStyle = isForecast ? "#facc15" : "#38bdf8";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(
        Math.floor(selectedPt.x - selectedPt.w / 2) - 1,
        Math.floor(selectedPt.y - selectedPt.h / 2) - 1,
        selectedPt.w + 2,
        selectedPt.h + 2
      );
    }
  }
}

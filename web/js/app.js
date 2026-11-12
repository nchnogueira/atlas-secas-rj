// ==============================================================================
// ATLAS DE SECAS DO RJ - CONTROLADOR PRINCIPAL (APP.JS)
// NASA Science Climate Interactives Edition
// Horizonte: 549 Meses Observados (1981-2026) + 12 Meses Previsão ARIMA (2026/2027)
// ==============================================================================

class DroughtAtlasApp {
  constructor() {
    this.map = null;
    this.chart = null;

    // Estado da Aplicação
    this.gridMeta = null;
    this.dates = [];
    this.forecastData = null;
    this.muniGeojson = null;
    this.stateGeojson = null;
    this.cachedScales = {};
    this.activeScale = "12";
    this.currentMonthIdx = 548; // Setembro de 2026 (final da série observada)
    this.selectedPixelId = null;
    this.selectedMuniCode = "ALL";
    this.isPlaying = false;
    this.playbackInterval = null;
    this.playbackSpeed = 160; // ms por mês

    // Atalhos Históricos Notáveis (1981-01 = 0)
    this.historicalEvents = {
      megadrought2014: (2014 - 1981) * 12 + (10 - 1), // Out/2014 (Índice 405)
      flood2011: (2011 - 1981) * 12 + (1 - 1),        // Jan/2011 (Índice 360)
      crisis2001: (2001 - 1981) * 12 + (7 - 1),       // Jul/2001 (Índice 246)
      latest: 548,                                    // Set/2026 (Último mês observado)
      fc2026: 549                                     // Out/2026 (Início da previsão)
    };
  }

  getNHistorical() {
    if (this.forecastData && this.forecastData.n_historical) {
      return this.forecastData.n_historical;
    }
    return this.dates.length > 12 ? this.dates.length - 12 : 549;
  }

  async init() {
    try {
      this.initTabs();
      this.initMap();
      this.initChart();

      // Carregar metadados orbitais e geometrias vetoriais de alta resolução
      await this.loadInitialData();

      // Configurar controles de interface e atalhos NASA
      this.initControls();

      // Carregar a escala ativa e sincronizar telemetria
      await this.switchScale(this.activeScale);

      // Selecionar pixel inicial emblemático (Campos dos Goytacazes)
      this.selectInitialPixel();

      // Renderizar fórmulas científicas KaTeX
      this.renderLatexFormulas();

    } catch (err) {
      console.error("Erro na inicialização do Atlas:", err);
    }
  }

  initTabs() {
    const tabBtns = document.querySelectorAll(".nav-tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        tabBtns.forEach(b => b.classList.remove("active"));
        tabPanes.forEach(p => p.classList.remove("active"));

        btn.classList.add("active");
        const pane = document.getElementById(targetTab);
        if (pane) pane.classList.add("active");

        if (targetTab === "tab-atlas") {
          setTimeout(() => {
            if (this.map && this.map.map) {
              this.map.map.invalidateSize();
              this.map.resizeCanvas();
              this.map.draw();
            }
            if (this.chart && this.chart.chart) {
              this.chart.chart.resize();
            }
          }, 100);
        } else if (targetTab === "tab-methodology") {
          this.renderLatexFormulas();
        }
      });
    });
  }

  renderLatexFormulas() {
    if (typeof renderMathInElement === "function") {
      const targets = [
        document.querySelector(".intro-card"),
        document.getElementById("tab-methodology")
      ];
      targets.forEach(container => {
        if (container) {
          renderMathInElement(container, {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "$", right: "$", display: false },
              { left: "\\[", right: "\\]", display: true },
              { left: "\\(", right: "\\)", display: false }
            ],
            throwOnError: false
          });
        }
      });
    }
  }

  initMap() {
    this.map = new DroughtMap("map", {
      onPixelClick: (pixel) => {
        this.selectedPixelId = pixel.id;
        this.selectedMuniCode = pixel.muni_code;
        const selectEl = document.getElementById("selectMuni");
        if (selectEl) selectEl.value = pixel.muni_code;
        this.updateChartAndAnalytics();
        this.updateMapHud();
      }
    });
    this.map.init();
  }

  initChart() {
    this.chart = new DroughtChart("speiChart", {
      onDateClick: (dataIndex) => {
        this.setMonthIndex(dataIndex);
      }
    });
    this.chart.init();
  }

  async loadInitialData() {
    const [metaRes, datesRes, fcRes, muniRes, stateRes] = await Promise.all([
      fetch("data/grid_meta.json"),
      fetch("data/dates.json"),
      fetch("data/forecast.json"),
      fetch("data/muni_bounds.geojson"),
      fetch("data/state_bounds.geojson")
    ]);

    this.gridMeta = await metaRes.json();
    this.dates = await datesRes.json();
    this.forecastData = await fcRes.json();
    this.muniGeojson = await muniRes.json();
    this.stateGeojson = await stateRes.json();

    // Sincronizar índice inicial para o último mês observado (Setembro de 2026)
    const nHist = this.getNHistorical();
    this.currentMonthIdx = Math.max(0, nHist - 1);

    // Carregar matriz de pixels e limites vetoriais
    this.map.loadData(this.gridMeta.pixels, this.muniGeojson, this.stateGeojson);

    // Popular dropdown de municípios
    this.populateMuniSelect();

    // Configurar Time Slider (561 meses totais: 0 a 560)
    const slider = document.getElementById("timeSlider");
    if (slider) {
      slider.min = 0;
      slider.max = this.dates.length - 1;
      slider.value = this.currentMonthIdx;
    }
    this.updateDateDisplay();
  }

  populateMuniSelect() {
    const select = document.getElementById("selectMuni");
    if (!select || !this.gridMeta) return;

    select.innerHTML = '<option value="ALL">Todos os 92 Municípios (Visão Estadual)</option>';

    const munis = Object.values(this.gridMeta.municipalities);
    munis.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    munis.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.code;
      opt.textContent = `${m.name} (${m.pixel_count} células)`;
      select.appendChild(opt);
    });
  }

  selectInitialPixel() {
    let initPx = this.gridMeta.pixels.find(p => p.muni_name.includes("Campos"));
    if (!initPx) initPx = this.gridMeta.pixels[Math.floor(this.gridMeta.pixels.length / 2)];

    if (initPx) {
      this.selectedPixelId = initPx.id;
      this.selectedMuniCode = initPx.muni_code;
      const selectEl = document.getElementById("selectMuni");
      if (selectEl) selectEl.value = initPx.muni_code;
      this.map.selectPixel(initPx.id);
      this.updateChartAndAnalytics();
      this.updateMapHud();
    }
  }

  async switchScale(scale) {
    this.activeScale = scale;

    document.querySelectorAll(".scale-btn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-scale") === scale);
    });

    if (!this.cachedScales[scale]) {
      const res = await fetch(`data/spei_${scale}.json`);
      this.cachedScales[scale] = await res.json();
    }

    const scaleData = this.cachedScales[scale];
    const nHist = scaleData.n_historical || (this.forecastData ? this.forecastData.n_historical : 549);
    this.map.setScaleData(scaleData.pixels, nHist);

    this.updateChartAndAnalytics();
    this.updateMapHud();
  }

  initControls() {
    // 1. Escalas SPEI
    document.querySelectorAll(".scale-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const sc = btn.getAttribute("data-scale");
        if (sc !== this.activeScale) {
          this.switchScale(sc);
        }
      });
    });

    // 2. Seletor de Município
    const selectMuni = document.getElementById("selectMuni");
    if (selectMuni) {
      selectMuni.addEventListener("change", (e) => {
        const code = e.target.value;
        this.selectedMuniCode = code;
        this.map.selectMunicipality(code);

        if (code !== "ALL") {
          const px = this.gridMeta.pixels.find(p => p.muni_code === code);
          if (px) {
            this.selectedPixelId = px.id;
            this.map.selectPixel(px.id);
          }
        }
        this.updateChartAndAnalytics();
        this.updateMapHud();
      });
    }

    // 3. Slider de Tempo
    const slider = document.getElementById("timeSlider");
    if (slider) {
      slider.addEventListener("input", (e) => {
        this.setMonthIndex(parseInt(e.target.value, 10));
      });
    }

    // 4. Playback Temporal (Climate Time Machine)
    const btnPlay = document.getElementById("btnPlay");
    if (btnPlay) {
      btnPlay.addEventListener("click", () => this.togglePlayback());
    }

    const btnPrev = document.getElementById("btnPrev");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (this.currentMonthIdx > 0) {
          this.setMonthIndex(this.currentMonthIdx - 1);
        }
      });
    }

    const btnNext = document.getElementById("btnNext");
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (this.currentMonthIdx < this.dates.length - 1) {
          this.setMonthIndex(this.currentMonthIdx + 1);
        }
      });
    }

    const selectSpeed = document.getElementById("selectSpeed");
    if (selectSpeed) {
      selectSpeed.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        this.playbackSpeed = Math.round(160 / val);
        if (this.isPlaying) {
          this.stopPlayback();
          this.startPlayback();
        }
      });
    }

    // 5. Atalhos Históricos Notáveis
    document.querySelectorAll(".shortcut-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const evt = btn.getAttribute("data-event");
        if (evt === "latest") {
          this.setMonthIndex(this.getNHistorical() - 1);
        } else if (this.historicalEvents[evt] !== undefined) {
          this.setMonthIndex(this.historicalEvents[evt]);
        }
      });
    });

    // 6. Atalhos Rápidos de Décadas e Previsão 12 Meses
    document.querySelectorAll(".decade-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".decade-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const yr = btn.getAttribute("data-year");
        if (yr === "2026-fc") {
          this.setMonthIndex(this.getNHistorical()); // Início da previsão (Out/2026)
        } else if (yr === "latest") {
          this.setMonthIndex(this.getNHistorical() - 1); // Último mês observado (Set/2026)
        } else {
          const ano = parseInt(yr, 10);
          const idx = (ano - 1981) * 12; // Janeiro do ano selecionado
          this.setMonthIndex(Math.min(this.dates.length - 1, Math.max(0, idx)));
        }
      });
    });

    // 7. Toggle do Card de Introdução
    const btnToggleIntro = document.getElementById("btnToggleIntro");
    const introContent = document.getElementById("introContent");
    const introToggleText = document.getElementById("introToggleText");
    const introToggleIcon = document.getElementById("introToggleIcon");

    if (btnToggleIntro && introContent) {
      btnToggleIntro.addEventListener("click", () => {
        const isCollapsed = introContent.classList.toggle("collapsed");
        btnToggleIntro.setAttribute("aria-expanded", !isCollapsed);
        if (introToggleText) {
          introToggleText.textContent = isCollapsed ? "Expandir Guia" : "Recolher Guia";
        }
        if (introToggleIcon) {
          introToggleIcon.style.transform = isCollapsed ? "rotate(180deg)" : "rotate(0deg)";
        }
      });
    }

    // 8. Teclas de Atalho
    window.addEventListener("keydown", (e) => {
      if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT")) {
        return;
      }
      if (e.key === "ArrowLeft") {
        if (this.currentMonthIdx > 0) this.setMonthIndex(this.currentMonthIdx - 1);
      } else if (e.key === "ArrowRight") {
        if (this.currentMonthIdx < this.dates.length - 1) this.setMonthIndex(this.currentMonthIdx + 1);
      } else if (e.key === " ") {
        e.preventDefault();
        this.togglePlayback();
      }
    });

    // 9. Exportação CSV
    const btnExport = document.getElementById("btnExportCSV");
    if (btnExport) {
      btnExport.addEventListener("click", () => this.exportCurrentSeriesCSV());
    }
  }

  setMonthIndex(idx) {
    const maxIdx = this.dates.length > 0 ? this.dates.length - 1 : 551;
    this.currentMonthIdx = Math.max(0, Math.min(maxIdx, idx));

    const slider = document.getElementById("timeSlider");
    if (slider) slider.value = this.currentMonthIdx;

    this.map.setMonthIndex(this.currentMonthIdx);
    this.updateDateDisplay();

    const dateStr = this.dates[this.currentMonthIdx];
    this.chart.setCurrentMonth(this.currentMonthIdx, dateStr);

    this.updateMapHud();
  }

  updateDateDisplay() {
    const dateStr = this.dates[this.currentMonthIdx] || "";
    const badge = document.getElementById("currentDateBadge");
    if (badge) {
      const [ano, mes] = dateStr.split("-");
      const mesesNomes = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      const nomeMes = mesesNomes[parseInt(mes, 10) - 1] || mes;

      const nHist = this.getNHistorical();
      if (this.currentMonthIdx >= nHist) {
        const fcStep = this.currentMonthIdx - nHist + 1;
        badge.innerHTML = `<span style="color: #facc15; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase;">[PROJEÇÃO ARIMA h=${fcStep}/12]</span> ${nomeMes} de ${ano}`;
        badge.style.background = "linear-gradient(135deg, rgba(168, 85, 247, 0.4) 0%, rgba(250, 204, 21, 0.3) 100%)";
        badge.style.border = "1px solid rgba(250, 204, 21, 0.5)";
      } else {
        badge.textContent = `${nomeMes} de ${ano}`;
        badge.style.background = "linear-gradient(135deg, #105bd8 0%, #0284c7 100%)";
        badge.style.border = "none";
      }
    }
  }

  updateMapHud() {
    const hudLocTitle = document.getElementById("hudLocationTitle");
    const hudLocName = document.getElementById("hudLocationName");
    const hudSpeiVal = document.getElementById("hudSpeiVal");
    const hudSpeiBadge = document.getElementById("hudSpeiBadge");
    const hudCoverageText = document.getElementById("hudCoverageText");
    const hudCoverageFill = document.getElementById("hudCoverageFill");

    if (!hudSpeiVal || !this.cachedScales[this.activeScale]) return;

    const scalePayload = this.cachedScales[this.activeScale];
    const nHist = this.getNHistorical();
    const isForecast = this.currentMonthIdx >= nHist;
    let val = null;

    if (this.selectedPixelId !== null && scalePayload.pixels[this.selectedPixelId]) {
      const px = this.gridMeta.pixels[this.selectedPixelId];
      if (hudLocTitle) {
        hudLocTitle.innerHTML = isForecast ? 
          `<span style="color: #facc15;">PROJEÇÃO ARIMA (Célula Orbital)</span>` : 
          `Pixel Orbital Selecionado`;
      }
      if (hudLocName) hudLocName.textContent = `${px.muni_name} (${px.lat.toFixed(2)}°, ${px.lon.toFixed(2)}°)`;
      val = scalePayload.pixels[this.selectedPixelId][this.currentMonthIdx];
    } else if (this.selectedMuniCode !== "ALL" && scalePayload.municipalities[this.selectedMuniCode]) {
      const muni = this.gridMeta.municipalities[this.selectedMuniCode];
      if (hudLocTitle) {
        hudLocTitle.innerHTML = isForecast ? 
          `<span style="color: #facc15;">PROJEÇÃO ARIMA (Média Municipal)</span>` : 
          `Município Selecionado`;
      }
      if (hudLocName) hudLocName.textContent = muni.name;
      val = scalePayload.municipalities[this.selectedMuniCode][this.currentMonthIdx];
    } else {
      if (hudLocTitle) {
        hudLocTitle.innerHTML = isForecast ? 
          `<span style="color: #facc15;">PROJEÇÃO ARIMA (Média Estadual)</span>` : 
          `Estado do Rio de Janeiro`;
      }
      if (hudLocName) hudLocName.textContent = "Média dos 92 Municípios";
      let sum = 0;
      let count = 0;
      for (let i = 0; i < scalePayload.pixels.length; i++) {
        const v = scalePayload.pixels[i][this.currentMonthIdx];
        if (v !== null && !isNaN(v)) {
          sum += v;
          count++;
        }
      }
      val = count > 0 ? sum / count : null;
    }

    if (val !== null && !isNaN(val)) {
      const sign = val > 0 ? "+" : "";
      hudSpeiVal.textContent = `${sign}${val.toFixed(2)}`;
      const cat = this.chart.getCategoryInfo(val);
      if (hudSpeiBadge) {
        hudSpeiBadge.textContent = isForecast ? `${cat.label} (Simulado)` : cat.label;
        hudSpeiBadge.style.background = cat.color;
        hudSpeiBadge.style.color = (val > -0.5 && val < 0.5) ? "#0b0f19" : "#ffffff";
      }
    } else {
      hudSpeiVal.textContent = "--";
      if (hudSpeiBadge) {
        hudSpeiBadge.textContent = "Sem Dados";
        hudSpeiBadge.style.background = "rgba(255,255,255,0.1)";
        hudSpeiBadge.style.color = "#fff";
      }
    }

    // Percentual de território em seca no mês (SPEI < -1.0)
    let droughtCount = 0;
    const totalPixels = scalePayload.pixels.length;
    for (let i = 0; i < totalPixels; i++) {
      const v = scalePayload.pixels[i][this.currentMonthIdx];
      if (v !== null && v <= -1.0) {
        droughtCount++;
      }
    }
    const percentDrought = (droughtCount / totalPixels) * 100;

    if (hudCoverageText) {
      hudCoverageText.innerHTML = `${isForecast ? "Projeção de Seca" : "Território em Seca"} (SPEI &le; -1,0): <strong>${percentDrought.toFixed(1)}%</strong>`;
    }
    if (hudCoverageFill) {
      hudCoverageFill.style.width = `${percentDrought.toFixed(1)}%`;
      if (percentDrought > 50) {
        hudCoverageFill.style.background = "linear-gradient(90deg, #f4a582 0%, #b2182b 100%)";
      } else {
        hudCoverageFill.style.background = "linear-gradient(90deg, #00b4d8 0%, #f4a582 100%)";
      }
    }
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  startPlayback() {
    this.isPlaying = true;
    const btn = document.getElementById("btnPlay");
    if (btn) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
      btn.classList.add("active");
    }

    const maxIdx = this.dates.length - 1;
    this.playbackInterval = setInterval(() => {
      if (this.currentMonthIdx >= maxIdx) {
        this.setMonthIndex(0);
      } else {
        this.setMonthIndex(this.currentMonthIdx + 1);
      }
    }, this.playbackSpeed);
  }

  stopPlayback() {
    this.isPlaying = false;
    const btn = document.getElementById("btnPlay");
    if (btn) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      btn.classList.remove("active");
    }
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  updateChartAndAnalytics() {
    if (!this.cachedScales[this.activeScale]) return;

    const scalePayload = this.cachedScales[this.activeScale];
    let title = "";
    let subtitle = "";
    let historicalSeries = [];
    let fcData = null;
    let trend = null;
    let extremos = null;

    if (this.selectedPixelId !== null && scalePayload.pixels[this.selectedPixelId]) {
      const px = this.gridMeta.pixels[this.selectedPixelId];
      title = `Série Histórica e Projeção: SPEI-${this.activeScale}`;
      subtitle = `Pixel Orbital [${px.lat.toFixed(3)}°, ${px.lon.toFixed(3)}°] &mdash; ${px.muni_name}`;
      historicalSeries = scalePayload.pixels[this.selectedPixelId];

      const pxMeta = this.forecastData.pixels[this.selectedPixelId];
      if (pxMeta) {
        fcData = pxMeta.forecast[this.activeScale];
        trend = pxMeta.trend;
        extremos = pxMeta.extremos;
      }
    } else if (this.selectedMuniCode !== "ALL" && scalePayload.municipalities[this.selectedMuniCode]) {
      const muni = this.gridMeta.municipalities[this.selectedMuniCode];
      title = `Média Territorial: SPEI-${this.activeScale} (${muni.name})`;
      subtitle = `Média ponderada de ${muni.pixel_count} células no território municipal`;
      historicalSeries = scalePayload.municipalities[this.selectedMuniCode];

      const muniMeta = this.forecastData.municipalities[this.selectedMuniCode];
      if (muniMeta) {
        fcData = muniMeta.forecast[this.activeScale];
        trend = muniMeta.trend;
        extremos = muniMeta.extremos;
      }
    }

    this.chart.update({
      title,
      subtitle,
      dates: this.dates,
      historicalSeries,
      forecastData: fcData,
      currentMonthIdx: this.currentMonthIdx,
      trendData: trend,
      extremosData: extremos
    });
  }

  exportCurrentSeriesCSV() {
    if (!this.cachedScales[this.activeScale] || this.selectedPixelId === null) return;

    const px = this.gridMeta.pixels[this.selectedPixelId];
    const series = this.cachedScales[this.activeScale].pixels[this.selectedPixelId];
    const fc = this.forecastData.pixels[this.selectedPixelId].forecast[this.activeScale];

    let csvContent = "data,tipo,spei,ic80_inf,ic80_sup,ic95_inf,ic95_sup,municipio,latitude,longitude\n";

    const nHist = (this.forecastData && this.forecastData.n_historical) ? 
                  this.forecastData.n_historical : (this.dates.length - 12);

    for (let i = 0; i < nHist; i++) {
      const d = this.dates[i];
      const val = series[i] !== null ? series[i] : "";
      csvContent += `${d},historico_observado,${val},,,,${px.muni_name},${px.lat},${px.lon}\n`;
    }

    if (fc && fc.mean) {
      for (let j = 0; j < fc.mean.length; j++) {
        const d = this.dates[nHist + j];
        csvContent += `${d},projecao_arima,${fc.mean[j]},${fc.lo80[j]},${fc.hi80[j]},${fc.lo95[j]},${fc.hi95[j]},${px.muni_name},${px.lat},${px.lon}\n`;
      }
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `SPEI_${this.activeScale}_Pixel_${px.lat}_${px.lon}_${px.muni_name}_Forecast12m.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.atlasApp = new DroughtAtlasApp();
  window.atlasApp.init();
});

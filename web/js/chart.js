// ==============================================================================
// ATLAS DE SECAS DO RJ - MÓDULO DE GRÁFICOS (APACHE ECHARTS)
// NASA Science Climate Interactives Theme
// Horizonte: 549 meses observados (1981-2026) + Projeção ARIMA 12 meses (2026/2027)
// ==============================================================================

class DroughtChart {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.options = options;
    this.chart = null;
    this.currentData = null;
    this.currentMonthIdx = 548;
    this.onDateClick = options.onDateClick || function() {};
  }

  init() {
    const dom = document.getElementById(this.containerId);
    if (!dom) return;

    this.chart = echarts.init(dom, "dark", {
      renderer: "canvas"
    });

    window.addEventListener("resize", () => {
      if (this.chart) this.chart.resize();
    });

    // Sincronização Bidirecional: Clicar no gráfico sincroniza o mapa e o slider (até 552 meses)
    this.chart.on("click", (params) => {
      if (params.dataIndex !== undefined && params.dataIndex < 552) {
        this.onDateClick(params.dataIndex);
      }
    });
  }

  getColor(val) {
    if (val === null || val === undefined || isNaN(val)) return "#475569";
    if (val <= -2.00) return "#67001f"; // Seca Excepcional
    if (val <= -1.60) return "#b2182b"; // Seca Extrema
    if (val <= -1.30) return "#d6604d"; // Seca Severa
    if (val <= -0.80) return "#f4a582"; // Seca Moderada
    if (val <= -0.50) return "#fddbc7"; // Anormalmente Seco
    if (val <   0.50) return "#f8fafc"; // Próximo ao Normal
    if (val <   0.80) return "#d1e5f0"; // Levemente Úmido
    if (val <   1.30) return "#92c5de"; // Moderadamente Úmido
    if (val <   1.60) return "#4393c3"; // Muito Úmido
    if (val <   2.00) return "#2166ac"; // Extremamente Úmido
    return "#053061";                   // Excepcionalmente Úmido
  }

  getCategoryInfo(val) {
    if (val === null || val === undefined || isNaN(val)) return { label: "Sem Dados", color: "#64748b", class: "severity-normal" };
    if (val <= -2.00) return { label: "Seca Excepcional", color: "#67001f", class: "severity-exceptional" };
    if (val <= -1.60) return { label: "Seca Extrema", color: "#b2182b", class: "severity-extreme" };
    if (val <= -1.30) return { label: "Seca Severa", color: "#d6604d", class: "severity-severe" };
    if (val <= -0.80) return { label: "Seca Moderada", color: "#f4a582", class: "severity-moderate" };
    if (val <= -0.50) return { label: "Anormalmente Seco", color: "#fddbc7", class: "severity-moderate" };
    if (val <   0.50) return { label: "Normalidade", color: "#f8fafc", class: "severity-normal" };
    if (val <   0.80) return { label: "Levemente Úmido", color: "#d1e5f0", class: "severity-wet" };
    if (val <   1.30) return { label: "Moderadamente Úmido", color: "#92c5de", class: "severity-wet" };
    if (val <   1.60) return { label: "Muito Úmido", color: "#4393c3", class: "severity-wet" };
    if (val <   2.00) return { label: "Extremamente Úmido", color: "#2166ac", class: "severity-wet" };
    return { label: "Excepcionalmente Úmido", color: "#053061", class: "severity-wet" };
  }

  update(params) {
    const {
      title,
      subtitle,
      dates,             // Array de 564 strings de datas (540 hist + 24 fc)
      historicalSeries,  // Array de 564 valores (540 observados + 24 fc)
      forecastData,      // { mean: [24], lo80: [24], hi80: [24], lo95: [24], hi95: [24] }
      currentMonthIdx,   // Índice do mês atual do slider (0 a 563)
      trendData,         // { slope_decade, p_value }
      extremosData       // { min_val, min_idx, max_val, max_idx }
    } = params;

    this.currentData = params;
    this.currentMonthIdx = currentMonthIdx;

    this.updateKPIs(params);

    const nHist = (forecastData && forecastData.n_historical) ? forecastData.n_historical : (dates.length - (forecastData && forecastData.mean ? forecastData.mean.length : 12));
    const nTotal = dates.length;

    // 1. Barras históricas (apenas meses 0 a nHist - 1)
    const barData = new Array(nTotal);
    for (let i = 0; i < nHist; i++) {
      const val = historicalSeries[i];
      if (val === null || val === undefined) {
        barData[i] = { value: null };
      } else {
        barData[i] = {
          value: val,
          itemStyle: {
            color: this.getColor(val)
          }
        };
      }
    }
    for (let i = nHist; i < nTotal; i++) {
      barData[i] = { value: null };
    }

    // 2. Linhas de Previsão de 12 Meses (inicia no último mês observado para continuidade visual)
    const lastHistVal = historicalSeries[nHist - 1];

    const fcMean = new Array(nTotal).fill(null);
    const fcHi95 = new Array(nTotal).fill(null);
    const fcLo95 = new Array(nTotal).fill(null);
    const fcHi80 = new Array(nTotal).fill(null);
    const fcLo80 = new Array(nTotal).fill(null);

    fcMean[nHist - 1] = lastHistVal;
    fcHi95[nHist - 1] = lastHistVal;
    fcLo95[nHist - 1] = lastHistVal;
    fcHi80[nHist - 1] = lastHistVal;
    fcLo80[nHist - 1] = lastHistVal;

    if (forecastData && forecastData.mean) {
      const nFc = forecastData.mean.length;
      for (let i = 0; i < nFc; i++) {
        const targetIdx = nHist + i;
        if (targetIdx < nTotal) {
          fcMean[targetIdx] = forecastData.mean[i];
          fcHi95[targetIdx] = forecastData.hi95[i];
          fcLo95[targetIdx] = forecastData.lo95[i];
          fcHi80[targetIdx] = forecastData.hi80[i];
          fcLo80[targetIdx] = forecastData.lo80[i];
        }
      }
    }

    const currentDateName = dates[currentMonthIdx] || dates[0];
    const isForecast = currentMonthIdx >= nHist;

    const option = {
      backgroundColor: "transparent",
      animation: false,
      title: {
        text: title,
        subtext: subtitle,
        textStyle: {
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 800,
          fontFamily: "'Public Sans', 'Inter', sans-serif"
        },
        subtextStyle: {
          color: "#94a3b8",
          fontSize: 12
        },
        left: 0,
        top: 0
      },
      legend: {
        show: true,
        top: 0,
        right: "2%",
        textStyle: { color: "#94a3b8", fontSize: 11 },
        data: ["SPEI Histórico", "Previsão ARIMA (Média 12m)", "IC 95%", "IC 80%"]
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          crossStyle: { color: "#00b4d8" }
        },
        backgroundColor: "rgba(7, 10, 18, 0.95)",
        borderColor: "rgba(255, 255, 255, 0.15)",
        textStyle: { color: "#f8fafc", fontSize: 12, fontFamily: "'Public Sans', 'Inter', sans-serif" },
        formatter: (paramList) => {
          if (!paramList || paramList.length === 0) return "";
          const dataIdx = paramList[0].dataIndex;
          const dateStr = dates[dataIdx];

          if (dataIdx < nHist) {
            const val = historicalSeries[dataIdx];
            if (val === null || val === undefined) return `<strong>${dateStr}</strong><br/>Sem dados`;
            const cat = this.getCategoryInfo(val);
            return `
              <div style="font-family: inherit; line-height: 1.5; padding: 2px;">
                <strong style="color: #00b4d8; font-size: 13px;">${dateStr} &mdash; Registro Histórico Observado</strong><br/>
                <span style="color: ${cat.color}; font-weight: 800; font-size: 14px;">● SPEI: ${(val > 0 ? "+" : "") + val.toFixed(2)}</span><br/>
                <span style="color: #cbd5e1;">Classificação: <strong>${cat.label}</strong></span><br/>
                <span style="color: #64748b; font-size: 10px;">Clique para sincronizar o mapa com esta data</span>
              </div>
            `;
          } else {
            const fcIdx = dataIdx - nHist;
            if (!forecastData || !forecastData.mean || fcIdx >= forecastData.mean.length) return "";
            const m = forecastData.mean[fcIdx];
            const l80 = forecastData.lo80[fcIdx];
            const h80 = forecastData.hi80[fcIdx];
            const l95 = forecastData.lo95[fcIdx];
            const h95 = forecastData.hi95[fcIdx];
            const cat = this.getCategoryInfo(m);
            return `
              <div style="font-family: inherit; line-height: 1.5; padding: 2px;">
                <strong style="color: #facc15; font-size: 13px;">${dateStr} &mdash; Projeção ARIMA (Mês ${fcIdx + 1} de 12)</strong><br/>
                <span style="color: #facc15; font-weight: 800; font-size: 14px;">● Previsão: ${(m > 0 ? "+" : "") + m.toFixed(2)} (${cat.label})</span><br/>
                <span style="color: #cbd5e1; font-size: 11px;">Intervalo de Confiança 80%: [${l80.toFixed(2)} a ${h80.toFixed(2)}]</span><br/>
                <span style="color: #94a3b8; font-size: 11px;">Intervalo de Confiança 95%: [${l95.toFixed(2)} a ${h95.toFixed(2)}]</span><br/>
                <span style="color: #facc15; font-size: 10px;">★ No mapa: representado em textura hachurada diagonal</span>
              </div>
            `;
          }
        }
      },
      grid: {
        left: "3%",
        right: "3%",
        bottom: "16%",
        top: "16%",
        containLabel: true
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: "rgba(255, 255, 255, 0.12)" } },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          fontFamily: "monospace",
          formatter: (val) => {
            if (val.endsWith("-01")) return val.slice(0, 4);
            return "";
          }
        },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        min: -4.0,
        max: 4.0,
        interval: 1.0,
        axisLine: { lineStyle: { color: "rgba(255, 255, 255, 0.12)" } },
        splitLine: { lineStyle: { color: "rgba(255, 255, 255, 0.05)", type: "dashed" } },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          fontFamily: "monospace",
          formatter: "{value}"
        }
      },
      dataZoom: [
        {
          type: "slider",
          show: true,
          xAxisIndex: [0],
          bottom: "2%",
          height: 22,
          borderColor: "rgba(255, 255, 255, 0.1)",
          fillerColor: "rgba(0, 180, 216, 0.18)",
          textStyle: { color: "#94a3b8", fontSize: 10, fontFamily: "monospace" },
          handleStyle: { color: "#00b4d8" },
          start: 0,
          end: 100
        },
        {
          type: "inside",
          xAxisIndex: [0]
        }
      ],
      series: [
        // Faixas de Severidade de Fundo (markArea)
        {
          type: "line",
          data: [],
          markArea: {
            silent: true,
            data: [
              [{ yAxis: -4.0, itemStyle: { color: "rgba(103, 0, 31, 0.16)" } }, { yAxis: -2.0 }],
              [{ yAxis: -2.0, itemStyle: { color: "rgba(178, 24, 43, 0.12)" } }, { yAxis: -1.6 }],
              [{ yAxis: -1.6, itemStyle: { color: "rgba(214, 96, 77, 0.09)" } }, { yAxis: -1.3 }],
              [{ yAxis: -1.3, itemStyle: { color: "rgba(244, 165, 130, 0.06)" } }, { yAxis: -0.8 }],
              [{ yAxis: 0.8, itemStyle: { color: "rgba(146, 197, 222, 0.06)" } }, { yAxis: 1.3 }],
              [{ yAxis: 1.3, itemStyle: { color: "rgba(67, 147, 195, 0.09)" } }, { yAxis: 1.6 }],
              [{ yAxis: 1.6, itemStyle: { color: "rgba(33, 102, 172, 0.12)" } }, { yAxis: 2.0 }],
              [{ yAxis: 2.0, itemStyle: { color: "rgba(5, 48, 97, 0.16)" } }, { yAxis: 4.0 }]
            ]
          }
        },
        // Barras da Série Histórica
        {
          name: "SPEI Histórico",
          type: "bar",
          barWidth: "85%",
          data: barData,
          markLine: {
            silent: true,
            symbol: ["none", "none"],
            label: {
              formatter: isForecast ? "Mês Projetado (ARIMA)" : "Mês Observado",
              position: "insideEndTop",
              color: isForecast ? "#facc15" : "#00b4d8",
              fontSize: 10,
              backgroundColor: "rgba(7, 10, 18, 0.9)",
              padding: [2, 6],
              borderRadius: 4,
              borderWidth: 1,
              borderColor: isForecast ? "rgba(250, 204, 21, 0.5)" : "rgba(0, 180, 216, 0.4)"
            },
            lineStyle: {
              color: isForecast ? "#facc15" : "#00b4d8",
              width: 2,
              type: isForecast ? "dashed" : "solid"
            },
            data: [
              { xAxis: currentDateName }
            ]
          }
        },
        // Limite Superior IC 95%
        {
          name: "IC 95%",
          type: "line",
          data: fcHi95,
          lineStyle: {
            color: "rgba(250, 204, 21, 0.6)",
            width: 1.5,
            type: "dotted"
          },
          symbol: "triangle",
          symbolSize: 4,
          itemStyle: { color: "rgba(250, 204, 21, 0.8)" }
        },
        // Limite Inferior IC 95%
        {
          name: "IC 95%",
          type: "line",
          data: fcLo95,
          lineStyle: {
            color: "rgba(250, 204, 21, 0.6)",
            width: 1.5,
            type: "dotted"
          },
          symbol: "triangle",
          symbolSize: 4,
          symbolRotate: 180,
          itemStyle: { color: "rgba(250, 204, 21, 0.8)" }
        },
        // Limite Superior IC 80%
        {
          name: "IC 80%",
          type: "line",
          data: fcHi80,
          lineStyle: {
            color: "rgba(250, 204, 21, 0.9)",
            width: 1.2,
            type: "dashed"
          },
          symbol: "none"
        },
        // Limite Inferior IC 80%
        {
          name: "IC 80%",
          type: "line",
          data: fcLo80,
          lineStyle: {
            color: "rgba(250, 204, 21, 0.9)",
            width: 1.2,
            type: "dashed"
          },
          symbol: "none"
        },
        // Linha Principal de Projeção Média ARIMA
        {
          name: "Previsão ARIMA (Média 24m)",
          type: "line",
          data: fcMean,
          lineStyle: {
            color: "#facc15",
            width: 3,
            type: "dashed"
          },
          itemStyle: {
            color: "#facc15"
          },
          symbol: "circle",
          symbolSize: 5
        }
      ]
    };

    this.chart.setOption(option);
  }

  setCurrentMonth(monthIdx, dateName) {
    this.currentMonthIdx = monthIdx;
    if (!this.chart || !this.currentData) return;

    const nHist = (this.currentData.forecastData && this.currentData.forecastData.n_historical) ? 
                  this.currentData.forecastData.n_historical : 
                  (this.currentData.dates ? this.currentData.dates.length - 12 : 549);
    const isForecast = monthIdx >= nHist;

    this.chart.setOption({
      series: [
        {}, // markArea
        {
          markLine: {
            label: {
              formatter: isForecast ? "Mês Projetado (ARIMA)" : "Mês Observado",
              color: isForecast ? "#facc15" : "#00b4d8",
              borderColor: isForecast ? "rgba(250, 204, 21, 0.5)" : "rgba(0, 180, 216, 0.4)"
            },
            lineStyle: {
              color: isForecast ? "#facc15" : "#00b4d8",
              type: isForecast ? "dashed" : "solid"
            },
            data: [{ xAxis: dateName }]
          }
        }
      ]
    });

    this.updateCurrentMonthKPI(monthIdx);
  }

  updateKPIs(params) {
    this.updateCurrentMonthKPI(params.currentMonthIdx);

    const elMin = document.getElementById("kpiWorstDrought");
    const elMinSub = document.getElementById("kpiWorstDroughtSub");
    if (elMin && params.extremosData) {
      const minV = params.extremosData.min_val;
      const minD = params.dates[params.extremosData.min_idx];
      elMin.textContent = minV !== null ? minV.toFixed(2) : "--";
      if (elMinSub) elMinSub.textContent = `Registrado em ${minD}`;
    }

    const elFc = document.getElementById("kpiForecast");
    const elFcSub = document.getElementById("kpiForecastSub");
    if (elFc && params.forecastData && params.forecastData.mean) {
      const m = params.forecastData.mean[0];
      const sign = m > 0 ? "+" : "";
      elFc.textContent = `${sign}${m.toFixed(2)}`;
      if (elFcSub) {
        const nHist = (params.forecastData && params.forecastData.n_historical) ?
                      params.forecastData.n_historical :
                      (params.dates ? params.dates.length - 12 : 549);
        const startFcDate = params.dates ? params.dates[nHist] : "Out/2026";
        const endFcDate = params.dates ? params.dates[params.dates.length - 1] : "Set/2027";
        elFcSub.textContent = `Previsão 12m (${startFcDate} a ${endFcDate}) com IC 95%`;
      }
    }
  }

  updateCurrentMonthKPI(monthIdx) {
    const elVal = document.getElementById("kpiCurrentVal");
    const elSub = document.getElementById("kpiCurrentSub");
    const card = document.getElementById("kpiCurrentCard");

    if (!elVal || !this.currentData) return;

    const val = this.currentData.historicalSeries[monthIdx];
    const dateStr = this.currentData.dates[monthIdx] || "";
    const nHist = (this.currentData.forecastData && this.currentData.forecastData.n_historical) ? 
                  this.currentData.forecastData.n_historical : 
                  (this.currentData.dates.length - 12);
    const isForecast = monthIdx >= nHist;

    if (val === null || val === undefined) {
      elVal.textContent = "--";
      if (elSub) elSub.textContent = dateStr;
      if (card) card.className = "kpi-card severity-normal";
    } else {
      const sign = val > 0 ? "+" : "";
      elVal.textContent = `${sign}${val.toFixed(2)}`;
      const cat = this.getCategoryInfo(val);
      if (elSub) {
        elSub.textContent = isForecast ? 
          `[Projeção ARIMA] ${cat.label} em ${dateStr}` : 
          `${cat.label} em ${dateStr}`;
      }
      if (card) {
        card.className = `kpi-card ${cat.class}`;
      }
    }
  }
}
